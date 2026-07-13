// Schema-first extraction pipeline (Codex §3): chunk a source document, retrieve
// the chunks most relevant to each schema field, ask a workhorse model to fill
// the WHOLE schema in one call with a parallel evidence map, validate the
// result, repair once on failure, then null out any field whose evidence
// doesn't actually support its value. Zero deps (node:* only) — the LLM call
// itself is injected via `dispatch`, never built in here.
import { validateJson, validateSchema } from "../validation/validate.mjs";

/**
 * Split source text into chunks on blank-line/paragraph boundaries, then
 * greedily merge consecutive paragraphs until adding the next one would push
 * a chunk past `maxChars`. A single paragraph longer than `maxChars` becomes
 * its own (oversized) chunk rather than being force-split.
 * @param {string} text
 * @param {{ maxChars?: number }} [opts]
 * @returns {{ id: string, text: string }[]}
 */
export function chunkSource(text, { maxChars = 1200 } = {}) {
  const paragraphs = String(text ?? "")
    .split(/\r?\n\s*\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const merged = [];
  let current = "";
  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (current && candidate.length > maxChars) {
      merged.push(current);
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current) merged.push(current);

  return merged.map((chunkText, i) => ({ id: `c${i + 1}`, text: chunkText }));
}

/**
 * Tokenize a schema field name (splitting camelCase/snake_case/kebab-case)
 * plus a free-text hint into lowercase keyword tokens.
 * @param {string} s
 * @returns {string[]}
 */
function tokenize(s) {
  return String(s ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Rank chunks by case-insensitive keyword-overlap score against
 * `fieldName` + `fieldHint`, returning the top 3 (or fewer, if that's all
 * there is). Ties keep original chunk order.
 * @param {{ id: string, text: string }[]} chunks
 * @param {string} fieldName
 * @param {string} [fieldHint]
 * @returns {{ id: string, text: string }[]}
 */
export function retrieveChunks(chunks, fieldName, fieldHint = "") {
  const tokens = [...new Set(tokenize(`${fieldName} ${fieldHint}`))];
  const scored = chunks.map((chunk, i) => {
    const hay = chunk.text.toLowerCase();
    const score = tokens.reduce((sum, tok) => sum + (hay.match(new RegExp(tok, "g"))?.length ?? 0), 0);
    return { chunk, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, 3).map((s) => s.chunk);
}

/** Build the single-call extraction prompt: deduped evidence chunks + schema + instructions. */
function buildExtractionPrompt(schema, evidenceChunks) {
  const evidenceBlock = evidenceChunks.length
    ? evidenceChunks.map((c) => `[${c.id}] ${c.text}`).join("\n\n")
    : "(no evidence chunks retrieved)";
  return [
    "Evidence chunks:",
    evidenceBlock,
    "",
    "Schema:",
    JSON.stringify(schema, null, 2),
    "",
    "Return ONLY a JSON object matching the schema. For each field also return its evidence " +
      "chunk id in a parallel object under key `_evidence` (fieldName → chunk id). Use null " +
      "for fields not present in the evidence.",
  ].join("\n");
}

/** Append the exact validation errors to the base prompt for a single repair round. */
function buildRepairPrompt(basePrompt, errors) {
  return `${basePrompt}\n\nYour output failed: ${errors.join("; ")}. Return the corrected JSON only.`;
}

/**
 * Does `value` actually appear in `chunkText`? String fields use a
 * case-insensitive substring match; number fields just need their digit
 * sequence to appear.
 */
function isSupported(value, chunkText, fieldSchema) {
  const type = fieldSchema?.type;
  if (type === "number" || type === "integer") return chunkText.includes(String(value));
  return chunkText.toLowerCase().includes(String(value).toLowerCase());
}

/**
 * Schema-first, evidence-grounded extraction of one record from source text.
 * Chunks the source, retrieves the top chunks per field, dispatches ONE call
 * for the whole schema (repairing once on validation failure), then nulls out
 * any field whose `_evidence` chunk id is missing/unknown or doesn't actually
 * contain the field's value.
 * @param {object} params
 * @param {string} params.sourceText
 * @param {object} params.schema JSON-schema-lite: {type:"object", required:[...], properties:{...}}
 * @param {(args: { prompt: string }) => Promise<string>} params.dispatch injected workhorse call
 * @param {number} [params.maxRepairs=1]
 * @returns {Promise<{ ok: boolean, record: object, report: {
 *   schemaValid: boolean, repairs: number, missingFields: string[],
 *   hallucinatedFields: string[], evidenceSupport: number, dispatchCalls: number
 * } }>}
 */
export async function extractRecord({ sourceText, schema, dispatch, maxRepairs = 1 }) {
  const chunks = chunkSource(sourceText);
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));
  const fieldNames = Object.keys(schema.properties ?? {});

  const evidencePool = new Map();
  for (const field of fieldNames) {
    const hint = schema.properties[field]?.description ?? "";
    for (const c of retrieveChunks(chunks, field, hint)) evidencePool.set(c.id, c);
  }
  const evidenceChunks = chunks.filter((c) => evidencePool.has(c.id));
  const basePrompt = buildExtractionPrompt(schema, evidenceChunks);

  let record = Object.fromEntries(fieldNames.map((f) => [f, null]));
  let evidenceMap = {};
  let schemaValid = false;
  let dispatchCalls = 0;
  let repairs = 0;
  let prompt = basePrompt;

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const raw = await dispatch({ prompt });
    dispatchCalls++;

    const parsed = validateJson(raw);
    if (!parsed.ok) {
      if (attempt < maxRepairs) {
        prompt = buildRepairPrompt(basePrompt, parsed.errors);
        repairs++;
        continue;
      }
      break; // repairs exhausted on malformed JSON — keep default nulled record
    }

    const value = parsed.value;
    const candidateRecord = Object.fromEntries(
      fieldNames.map((f) => [f, value && typeof value === "object" && value[f] !== undefined ? value[f] : null]),
    );
    const candidateEvidence =
      value && typeof value === "object" && value._evidence && typeof value._evidence === "object"
        ? value._evidence
        : {};

    // Fields the model correctly left null shouldn't fail the schema's type
    // check — relax those to an open schema before validating shape/type.
    const patchedSchema = {
      ...schema,
      properties: Object.fromEntries(
        fieldNames.map((f) => [f, candidateRecord[f] === null ? {} : schema.properties[f]]),
      ),
    };
    const schemaRes = validateSchema(candidateRecord, patchedSchema);
    if (!schemaRes.ok) {
      if (attempt < maxRepairs) {
        prompt = buildRepairPrompt(basePrompt, schemaRes.errors);
        repairs++;
        continue;
      }
      record = candidateRecord;
      evidenceMap = candidateEvidence;
      schemaValid = false;
      break;
    }

    record = candidateRecord;
    evidenceMap = candidateEvidence;
    schemaValid = true;
    break;
  }

  const missingFields = fieldNames.filter((f) => record[f] === null);
  const nonNullCount = fieldNames.length - missingFields.length;

  const hallucinatedFields = [];
  for (const f of fieldNames) {
    if (record[f] === null) continue;
    const chunkId = evidenceMap[f];
    const chunk = chunkId != null ? chunkMap.get(chunkId) : undefined;
    const supported = chunk ? isSupported(record[f], chunk.text, schema.properties[f]) : false;
    if (!supported) {
      hallucinatedFields.push(f);
      record[f] = null;
    }
  }

  const verifiedCount = nonNullCount - hallucinatedFields.length;
  const evidenceSupport = nonNullCount === 0 ? 1 : verifiedCount / nonNullCount;

  const report = { schemaValid, repairs, missingFields, hallucinatedFields, evidenceSupport, dispatchCalls };
  return { ok: schemaValid && hallucinatedFields.length === 0, record, report };
}
