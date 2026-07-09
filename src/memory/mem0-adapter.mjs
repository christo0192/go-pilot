// Tier-2 persistent memory — Mem0 adapter INTERFACE + a deterministic in-memory MOCK.
//
// The real Tier-2 store will be Mem0 running in Docker (Step 4.3, DEFERRED —
// Docker is not installed yet). To let the promotion filter and recall seam be
// built and tested WITHOUT Docker, this module defines the stable adapter
// contract and ships a zero-dependency, deterministic mock behind it.
//
// THE CONTRACT (the ONLY coupling point): an adapter exposes { add, search }.
// The real Docker Mem0 client will implement this SAME {add, search} contract,
// so callers written against the mock keep working when Mem0 drops in.
//
//   add(memory)          -> stored memory (with its id)
//   search(query, topK)  -> Array<{ memory, score }>, length <= topK,
//                           highest score first, deterministic tie-break
//
// The mock's relevance is deterministic keyword/substring overlap — no LLM, no
// embeddings, no I/O, no Date.now/Math.random. Given the same insertion
// sequence, two fresh mocks are byte-for-byte reproducible.

/**
 * A memory record handed to `add`.
 *
 * @typedef {Object} Memory
 * @property {string} [id]    Optional stable id. When absent, the adapter
 *                            assigns a deterministic `mem-${n}` id based on
 *                            insertion order (n = number of prior inserts).
 * @property {string} text    Required. The memory content that is searched.
 * @property {string} [kind]  Optional class, e.g. "decision" | "summary" | "pref".
 * @property {string[]} [tags] Optional string tags (also matched by search).
 * @property {Object} [meta]  Optional free-form metadata (not scored).
 */

/**
 * A single ranked search hit.
 *
 * @typedef {Object} SearchHit
 * @property {Memory} memory  The stored memory.
 * @property {number} score   Relevance in [0, 1]; higher is more relevant.
 */

/**
 * The Mem0 adapter interface. Both the mock below and the future Docker Mem0
 * client implement exactly this shape.
 *
 * @typedef {Object} Mem0Adapter
 * @property {(memory: Memory) => Memory} add
 *   Store `memory` and return it with its assigned id. `text` (non-empty
 *   string) is required. If `id` is absent, a deterministic id is assigned.
 *   Adding a memory whose id already exists UPSERTS (overwrites in place) and
 *   does NOT consume a new insertion-order slot.
 * @property {(query: string, topK?: number) => SearchHit[]} search
 *   Return up to `topK` (default 5) hits ranked by relevance, highest first,
 *   with a deterministic insertion-order tie-break. An empty/whitespace query,
 *   or no token overlap, returns `[]`.
 */

/** Lowercase + split into distinct alphanumeric word tokens. */
function tokenize(str) {
  return String(str)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** The searchable token set of a memory: its text plus any tags. */
function memoryTokenSet(memory) {
  const parts = [memory.text ?? ""];
  if (Array.isArray(memory.tags)) parts.push(...memory.tags);
  return new Set(tokenize(parts.join(" ")));
}

/**
 * Create a deterministic in-memory Mem0 adapter (the mock).
 *
 * Relevance formula: lowercase-tokenize the query into DISTINCT words; score a
 * memory by the fraction of distinct query tokens that appear in the memory's
 * token set (text + tags):
 *
 *     score = (# distinct query tokens present) / (# distinct query tokens)
 *
 * This is stable, comparable across memories, and needs no LLM/embeddings.
 * Ties are broken by insertion order (ascending), so results are reproducible.
 *
 * @returns {Mem0Adapter}
 */
export function createMockMem0() {
  // Map<id, { memory, order }> — `order` is the monotonic insertion index used
  // for id assignment and as the deterministic tie-break key.
  const byId = new Map();
  let count = 0; // number of NEW inserts so far (drives mem-${n} ids)

  function add(memory) {
    if (!memory || typeof memory.text !== "string" || memory.text.trim() === "") {
      throw new Error("add: memory.text is required and must be a non-empty string");
    }

    const providedId = memory.id;
    const isUpsert = providedId !== undefined && byId.has(providedId);

    let id;
    let order;
    if (isUpsert) {
      // Overwrite in place; keep the original insertion order (no new slot).
      id = providedId;
      order = byId.get(providedId).order;
    } else {
      id = providedId !== undefined && providedId !== null && providedId !== ""
        ? providedId
        : `mem-${count}`;
      order = count;
      count += 1;
    }

    const stored = {
      ...memory,
      id,
      tags: Array.isArray(memory.tags) ? [...memory.tags] : undefined,
    };
    // Drop an undefined tags key so stored shape stays clean.
    if (stored.tags === undefined) delete stored.tags;

    byId.set(id, { memory: stored, order });
    return stored;
  }

  function search(query, topK = 5) {
    const queryTokens = [...new Set(tokenize(query))];
    if (queryTokens.length === 0) return [];

    const hits = [];
    for (const { memory, order } of byId.values()) {
      const memTokens = memoryTokenSet(memory);
      let overlap = 0;
      for (const qt of queryTokens) {
        if (memTokens.has(qt)) overlap += 1;
      }
      if (overlap === 0) continue; // no token overlap — not a match
      hits.push({ memory, score: overlap / queryTokens.length, order });
    }

    // Highest score first; deterministic tie-break by insertion order (asc).
    hits.sort((a, b) => (b.score - a.score) || (a.order - b.order));

    return hits.slice(0, Math.max(0, topK)).map(({ memory, score }) => ({ memory, score }));
  }

  return { add, search };
}
