// Deterministic spreadsheet/data preprocessor (Codex §4): parse tables locally,
// compute stats locally, emit a COMPACT derived table so the workhorse model
// never sees raw bloated data. Zero deps (node:* only — none needed here).

const DELIMITER_CANDIDATES = [",", "\t", "|", ";"];
const CURRENCY_OR_SEPARATOR = /[,%$₹€]/g;
const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/;
const MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/**
 * Guess the field delimiter by counting occurrences of each candidate in the
 * first (header) line. Ties favor the earlier candidate in
 * [",", "\t", "|", ";"].
 * @param {string} firstLine
 * @returns {string}
 */
function detectDelimiter(firstLine) {
  let best = DELIMITER_CANDIDATES[0];
  let bestCount = -1;
  for (const d of DELIMITER_CANDIDATES) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Split one line into raw string cells, honoring double-quoted fields (which
 * may contain the delimiter) and doubled-quote escaping ("" -> ").
 * @param {string} line
 * @param {string} delimiter
 * @returns {string[]}
 */
function parseLine(line, delimiter) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"' && cur === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/**
 * Coerce a raw cell string to Number when it looks numeric (after stripping
 * thousands-commas, "%", and currency symbols $/₹/€), else return the
 * trimmed string, else null for an empty cell.
 * @param {string} raw
 * @returns {number|string|null}
 */
function coerceCell(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const stripped = trimmed.replace(CURRENCY_OR_SEPARATOR, "");
  if (stripped !== "" && NUMERIC_RE.test(stripped)) return Number(stripped);
  return trimmed;
}

/**
 * Parse delimited text into a headers/rows table. Auto-detects the delimiter
 * from the header line when not given.
 * @param {string} text
 * @param {{delimiter?: string}} [opts]
 * @returns {{headers: string[], rows: any[][]}}
 */
export function parseTable(text, { delimiter } = {}) {
  if (typeof text !== "string") throw new TypeError("parseTable: text must be a string");
  const lines = text.split(/\r\n|\r|\n/).filter((l, idx, arr) => !(idx === arr.length - 1 && l === ""));
  if (lines.length < 2) throw new TypeError("parseTable: input must have at least a header and one data row");
  const delim = delimiter || detectDelimiter(lines[0]);
  const headers = parseLine(lines[0], delim).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => parseLine(line, delim).map(coerceCell));
  return { headers, rows };
}

/** @param {any[]} values @returns {boolean} */
function isMonotonic(values) {
  let inc = true;
  let dec = true;
  for (let i = 1; i < values.length; i++) {
    if (values[i] <= values[i - 1]) inc = false;
    if (values[i] >= values[i - 1]) dec = false;
  }
  return inc || dec;
}

/**
 * Heuristic: does the first column look like an ordered dimension (dates or
 * sequential labels), so delta/growth can be computed meaningfully?
 * @param {any[]} values first-column values in row order
 * @returns {boolean}
 */
function isOrderedDimension(values) {
  if (!values || values.length < 2) return false;
  if (values.every((v) => typeof v === "string" && (MONTH_RE.test(v) || !Number.isNaN(Date.parse(v))))) {
    return true;
  }
  if (values.every((v) => typeof v === "number")) return isMonotonic(values);
  const trailingNums = values.map((v) => {
    if (typeof v !== "string") return null;
    const m = v.match(/(\d+)\s*$/);
    return m ? Number(m[1]) : null;
  });
  if (trailingNums.every((n) => n !== null)) return isMonotonic(trailingNums);
  return false;
}

/** @param {number[]} sorted ascending @param {number} p in [0,1] @returns {number} */
function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** @param {[number, number][]} pairs @returns {number|null} Pearson r, or null if undefined */
function pearson(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  const mx = pairs.reduce((a, [x]) => a + x, 0) / n;
  const my = pairs.reduce((a, [, y]) => a + y, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx, dy = y - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

/** @param {any[][]} rows @param {number} colIdx @returns {boolean} */
function isNumericColumn(rows, colIdx) {
  let sawNumber = false;
  for (const row of rows) {
    const v = row[colIdx];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number") return false;
    sawNumber = true;
  }
  return sawNumber;
}

/**
 * Compute per-column stats, outliers, optional delta/growth (when the first
 * column is an ordered dimension), pairwise correlations, and top/bottom rows.
 * @param {{headers: string[], rows: any[][]}} table
 * @returns {{
 *   columns: Record<string, {count:number, sum:number, mean:number, median:number,
 *     min:number, max:number, p25:number, p75:number,
 *     outliers: {row:number, value:number}[],
 *     delta?: number, growthPct?: number|null}>,
 *   correlations: {a:string, b:string, r:number|null}[],
 *   topBottom: Record<string, {top:{label:any,value:number}[], bottom:{label:any,value:number}[]}>
 * }}
 */
export function computeStats(table) {
  const { headers, rows } = table;
  const numericCols = [];
  for (let c = 0; c < headers.length; c++) {
    if (isNumericColumn(rows, c)) numericCols.push(c);
  }
  const firstColOrdered = isOrderedDimension(rows.map((r) => r[0]));

  const columns = {};
  for (const c of numericCols) {
    const name = headers[c];
    const entries = [];
    rows.forEach((row, i) => {
      const v = row[c];
      if (typeof v === "number") entries.push({ row: i, value: v });
    });
    const values = entries.map((e) => e.value);
    const count = values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = count ? sum / count : NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    const p25 = percentile(sorted, 0.25);
    const p75 = percentile(sorted, 0.75);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const iqr = p75 - p25;
    const lowFence = p25 - 1.5 * iqr;
    const highFence = p75 + 1.5 * iqr;
    const outliers = entries
      .filter((e) => e.value < lowFence || e.value > highFence)
      .map((e) => ({ row: e.row, value: e.value }));

    const stat = { count, sum, mean, median, min, max, p25, p75, outliers };
    if (firstColOrdered && rows.length) {
      const firstVal = rows[0][c];
      const lastVal = rows[rows.length - 1][c];
      if (typeof firstVal === "number" && typeof lastVal === "number") {
        stat.delta = lastVal - firstVal;
        stat.growthPct = firstVal === 0 ? null : ((lastVal - firstVal) / Math.abs(firstVal)) * 100;
      }
    }
    columns[name] = stat;
  }

  const correlations = [];
  for (let i = 0; i < numericCols.length; i++) {
    for (let j = i + 1; j < numericCols.length; j++) {
      const a = numericCols[i], b = numericCols[j];
      const pairs = [];
      for (const row of rows) {
        const va = row[a], vb = row[b];
        if (typeof va === "number" && typeof vb === "number") pairs.push([va, vb]);
      }
      const r = pearson(pairs);
      correlations.push({ a: headers[a], b: headers[b], r: r === null ? null : Math.round(r * 1000) / 1000 });
    }
  }

  const topBottom = {};
  for (const c of numericCols) {
    const name = headers[c];
    const entries = rows
      .map((row) => ({ label: row[0], value: row[c] }))
      .filter((e) => typeof e.value === "number");
    const sortedDesc = [...entries].sort((x, y) => y.value - x.value);
    topBottom[name] = {
      top: sortedDesc.slice(0, 3),
      bottom: sortedDesc.slice(-3).reverse(),
    };
  }

  return { columns, correlations, topBottom };
}

/** @param {number} n @returns {string} */
function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  return String(Math.round(n * 100) / 100);
}

/**
 * Render stats as a compact plain-text block for the workhorse model:
 * one summary line per numeric column, then outliers/correlations/top-bottom
 * sections, truncated to maxChars with a trailing "…truncated" marker.
 * @param {ReturnType<typeof computeStats>} stats
 * @param {{maxChars?: number}} [opts]
 * @returns {string}
 */
export function toCompactTable(stats, { maxChars = 2000 } = {}) {
  const lines = [];
  for (const [name, s] of Object.entries(stats.columns)) {
    let line = `${name}: n=${s.count}, sum=${fmt(s.sum)}, mean=${fmt(s.mean)}, median=${fmt(s.median)}, min/max=${fmt(s.min)}/${fmt(s.max)}`;
    if (s.delta !== undefined) {
      line += `, Δ=${fmt(s.delta)}, growth=${s.growthPct === null ? "n/a" : fmt(s.growthPct)}%`;
    }
    lines.push(line);
  }

  lines.push("outliers:");
  for (const [name, s] of Object.entries(stats.columns)) {
    for (const o of s.outliers) lines.push(`  ${name}[row ${o.row}]=${fmt(o.value)}`);
  }

  lines.push("correlations:");
  for (const c of stats.correlations) {
    if (c.r !== null && Math.abs(c.r) >= 0.5) lines.push(`  ${c.a}~${c.b}: r=${c.r}`);
  }

  lines.push("top/bottom:");
  for (const [name, tb] of Object.entries(stats.topBottom)) {
    const top = tb.top.map((e) => `${e.label}=${fmt(e.value)}`).join(", ");
    const bottom = tb.bottom.map((e) => `${e.label}=${fmt(e.value)}`).join(", ");
    lines.push(`  ${name} top: ${top}; bottom: ${bottom}`);
  }

  let out = lines.join("\n");
  if (out.length > maxChars) {
    const marker = "\n…truncated";
    out = out.slice(0, Math.max(0, maxChars - marker.length)) + marker;
  }
  return out;
}

/**
 * Report how much the compact table shrank the raw text — the metric the
 * orchestrator logs to prove the workhorse never saw the raw bloat.
 * @param {string} rawText
 * @param {string} compactText
 * @returns {{rawChars: number, compactChars: number, reductionPct: number}}
 */
export function reductionReport(rawText, compactText) {
  const rawChars = String(rawText ?? "").length;
  const compactChars = String(compactText ?? "").length;
  const reductionPct = rawChars === 0 ? 0 : ((rawChars - compactChars) / rawChars) * 100;
  return { rawChars, compactChars, reductionPct };
}
