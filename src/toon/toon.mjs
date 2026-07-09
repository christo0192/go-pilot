// TOON (Token-Oriented Object Notation) — task-spec-scoped subset.
//
// emit(obj) -> TOON string, parse(str) -> object, with an exact round-trip
// guarantee for the task-spec shape:
//   scalars (string | number | boolean | null),
//   arrays of strings, arrays of uniform objects, and one level of nesting.
//
// Efficiency comes from: no braces (indentation carries structure), declaring
// array-of-object field names ONCE then one compact comma row per element, and
// quoting string scalars only when a bare form would be ambiguous.

const INDENT = '  '; // 2 spaces per depth level
const NUMERIC = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

// ---------------------------------------------------------------- emit -------

function needsQuote(s) {
  if (s === '') return true;
  if (/^\s|\s$/.test(s)) return true;            // leading/trailing whitespace
  if (/[",:\n\\]/.test(s)) return true;          // delimiter / quote / newline / backslash
  if (s === 'true' || s === 'false' || s === 'null') return true; // literal collision
  if (NUMERIC.test(s)) return true;              // would parse back as a number
  return false;
}

function quote(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

function encodeScalar(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return needsQuote(v) ? quote(v) : v;
  throw new TypeError(`TOON: unsupported scalar ${typeof v}`);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function emitEntry(key, value, depth, out) {
  const pad = INDENT.repeat(depth);

  if (Array.isArray(value)) {
    const n = value.length;
    const allObjects = n > 0 && value.every(isPlainObject);
    if (allObjects) {
      const fields = Object.keys(value[0]);
      out.push(`${pad}${key}[${n}]{${fields.join(',')}}:`);
      const rowPad = INDENT.repeat(depth + 1);
      for (const item of value) {
        out.push(rowPad + fields.map((f) => encodeScalar(item[f])).join(','));
      }
    } else {
      // array of primitives (or empty array)
      const body = value.map(encodeScalar).join(',');
      out.push(`${pad}${key}[${n}]:${body ? ' ' + body : ''}`);
    }
    return;
  }

  if (isPlainObject(value)) {
    out.push(`${pad}${key}:`);
    for (const [k, v] of Object.entries(value)) emitEntry(k, v, depth + 1, out);
    return;
  }

  out.push(`${pad}${key}: ${encodeScalar(value)}`);
}

export function emit(obj) {
  if (!isPlainObject(obj)) throw new TypeError('TOON emit: top level must be an object');
  const out = [];
  for (const [k, v] of Object.entries(obj)) emitEntry(k, v, 0, out);
  return out.join('\n');
}

// --------------------------------------------------------------- parse -------

// Split a comma row, respecting double-quoted spans (keeps quotes/escapes intact).
function splitRow(s) {
  const out = [];
  let cur = '';
  let inq = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '"') {
      inq = !inq;
      cur += ch;
    } else if (ch === '\\' && inq) {
      cur += ch + (s[k + 1] ?? '');
      k++;
    } else if (ch === ',' && !inq) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function decodeScalar(tokenRaw) {
  const t = tokenRaw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (NUMERIC.test(t)) return Number(t);
  return t; // bare string
}

const KEY_LINE = /^([^:[]+)(?:\[(\d+)\](?:\{([^}]*)\})?)?:(.*)$/;

export function parse(str) {
  const lines = str.split('\n').filter((l) => l.trim() !== '');
  let i = 0;
  const indentOf = (line) => line.match(/^ */)[0].length;

  function parseBlock(baseIndent) {
    const obj = {};
    while (i < lines.length) {
      const line = lines[i];
      const ind = indentOf(line);
      if (ind < baseIndent) break;
      if (ind > baseIndent) { i++; continue; } // defensive; shouldn't happen

      const content = line.slice(baseIndent);
      const m = content.match(KEY_LINE);
      if (!m) throw new SyntaxError(`TOON parse: bad line "${line}"`);
      const [, keyRaw, count, fields, rest] = m;
      const key = keyRaw.trim();
      i++;

      if (count !== undefined) {
        const n = Number(count);
        if (fields !== undefined) {
          // array of uniform objects — n comma rows follow, indented one level
          const cols = fields === '' ? [] : fields.split(',');
          const arr = [];
          const rowIndent = baseIndent + INDENT.length;
          for (let r = 0; r < n; r++) {
            const row = lines[i].slice(rowIndent);
            const cells = splitRow(row).map(decodeScalar);
            const item = {};
            cols.forEach((c, ci) => { item[c] = cells[ci]; });
            arr.push(item);
            i++;
          }
          obj[key] = arr;
        } else {
          // array of primitives (empty when rest is blank)
          obj[key] = rest.trim() === '' ? [] : splitRow(rest).map(decodeScalar);
        }
      } else if (rest.trim() === '') {
        // nested object — children indented one level deeper
        obj[key] = parseBlock(baseIndent + INDENT.length);
      } else {
        obj[key] = decodeScalar(rest);
      }
    }
    return obj;
  }

  return parseBlock(0);
}
