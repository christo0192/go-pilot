import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { emit, parse } from './toon.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const metricsDir = resolve(here, '../../metrics');

// A plain spec: scalars + array-of-strings only.
const plainSpec = {
  id: 'T01',
  category: 'code',
  prompt: 'Install the substrate',
  depends: [],
  acceptance: ['round-trips', 'fewer tokens than JSON'],
};

// A spec with an array-of-uniform-objects (the `files` field).
const objectArraySpec = {
  id: 'T02',
  category: 'code',
  prompt: 'Adopt TOON for task specs',
  depends: ['T01'],
  acceptance: ['round-trips', 'fewer tokens than JSON'],
  files: [
    { path: 'src/toon/toon.mjs', action: 'create' },
    { path: 'src/toon/toon.test.mjs', action: 'create' },
  ],
};

// A spec that exercises quoting: comma, colon, leading space, a numeric-looking
// string, a boolean-looking string, one level of nesting, and a null field.
const quotingSpec = {
  id: 'T03',
  category: 'research',
  prompt: 'Compare TOON, JSON: measure tokens',
  note: ' leading space and trailing ',
  version: '42',        // numeric-looking string must stay a string
  flag: 'true',         // boolean-looking string must stay a string
  owner: null,          // null field
  depends: ['T01', 'T02'],
  meta: { retries: 2, blocking: false, label: 'has, comma' }, // nested one level
  files: [{ path: 'a.mjs', action: 'create' }],
};

for (const [name, spec] of [
  ['plain', plainSpec],
  ['object-array', objectArraySpec],
  ['quoting-edge-cases', quotingSpec],
]) {
  test(`round-trips: ${name}`, () => {
    const wire = emit(spec);
    assert.deepEqual(parse(wire), spec);
  });
}

test('object-array emits a tabular block (header once, one row per item)', () => {
  const wire = emit(objectArraySpec);
  assert.match(wire, /files\[2\]\{path,action\}:/); // header declared once
  const rows = wire.split('\n').filter((l) => /toon\.(mjs|test\.mjs),create/.test(l));
  assert.equal(rows.length, 2); // one compact row per element, keys NOT repeated
  assert.equal((wire.match(/path/g) || []).length, 1); // "path" appears once total
});

test('empty array round-trips', () => {
  const spec = { id: 'X', depends: [], files: [] };
  assert.deepEqual(parse(emit(spec)), spec);
  assert.match(emit(spec), /depends\[0\]:/);
});

test('null field round-trips', () => {
  const spec = { id: 'X', owner: null };
  assert.deepEqual(parse(emit(spec)), spec);
});

test('numeric- and boolean-looking strings stay strings', () => {
  const spec = { a: '42', b: 'true', c: 'null', n: 42, bool: true };
  assert.deepEqual(parse(emit(spec)), spec);
});

test('TOON serializes a real spec in fewer tokens than pretty JSON', () => {
  const spec = objectArraySpec;
  const toonStr = emit(spec);
  const jsonStr = JSON.stringify(spec, null, 2);
  const toks = (s) => Math.ceil(s.length / 4); // token proxy = chars / 4
  const toonTokens = toks(toonStr);
  const jsonTokens = toks(jsonStr);

  assert.ok(toonTokens < jsonTokens, `expected TOON(${toonTokens}) < JSON(${jsonTokens})`);

  const pct = (((jsonTokens - toonTokens) / jsonTokens) * 100).toFixed(1);
  mkdirSync(metricsDir, { recursive: true });
  writeFileSync(
    resolve(metricsDir, 'toon-vs-json.md'),
    [
      '# TOON vs JSON — token comparison',
      '',
      'Token proxy: `tokens = Math.ceil(str.length / 4)` (chars / 4).',
      'Spec measured: task-spec `T02` (with the `files` array-of-objects).',
      '',
      '| format | chars | tokens |',
      '| --- | ---: | ---: |',
      `| TOON (\`emit\`) | ${toonStr.length} | ${toonTokens} |`,
      `| JSON (\`JSON.stringify(spec, null, 2)\`) | ${jsonStr.length} | ${jsonTokens} |`,
      '',
      `TOON uses **${toonTokens}** tokens vs JSON's **${jsonTokens}** — a **${pct}%** reduction.`,
      '',
    ].join('\n'),
  );
});
