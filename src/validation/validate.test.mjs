import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSchema, validateJson, validateCode, validateNumeric,
  validateCitations, classifyFailure,
} from "./validate.mjs";

test("validateSchema: type/required/enum/items/bounds", () => {
  const schema = {
    type: "object",
    required: ["name", "score"],
    properties: {
      name: { type: "string", minLength: 1 },
      score: { type: "number", minimum: 0, maximum: 100 },
      tags: { type: "array", items: { type: "string" } },
      kind: { type: "string", enum: ["a", "b"] },
    },
  };
  assert.equal(validateSchema({ name: "x", score: 50 }, schema).ok, true);
  assert.equal(validateSchema({ name: "x" }, schema).ok, false);
  assert.equal(validateSchema({ name: "", score: 50 }, schema).ok, false);
  assert.equal(validateSchema({ name: "x", score: 101 }, schema).ok, false);
  assert.equal(validateSchema({ name: "x", score: 1, tags: ["ok", 3] }, schema).ok, false);
  assert.equal(validateSchema({ name: "x", score: 1, kind: "c" }, schema).ok, false);
  assert.equal(validateSchema(5, { type: "integer" }).ok, true);
  assert.equal(validateSchema(5.5, { type: "integer" }).ok, false);
  assert.equal(validateSchema(null, { type: ["string", "null"] }).ok, true);
  assert.equal(validateSchema({ name: null, score: 1 }, schema).ok, false, "required null fails closed");
  assert.equal(validateSchema({ value: "x", extra: true }, {
    type: "object", properties: { value: { type: "string", pattern: "^[a-z]+$" } }, additionalProperties: false,
  }).ok, false);
  assert.equal(validateSchema(["one"], { type: "array", minItems: 2, items: { type: "string" } }).ok, false);
  assert.equal(validateSchema("2026/07/18", { type: "string", format: "date" }).ok, false);
});

test("validateJson: plain, fenced, invalid, with schema", () => {
  assert.equal(validateJson('{"a":1}').ok, true);
  assert.equal(validateJson('```json\n{"a":1}\n```').ok, true);
  assert.equal(validateJson("not json").ok, false);
  const res = validateJson('{"a":"x"}', { schema: { type: "object", required: ["b"], properties: {} } });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /required/);
});

test("validateCode: passing and failing commands", () => {
  assert.equal(validateCode({ runCmd: "true" }).ok, true);
  const fail = validateCode({ runCmd: "echo bad >&2; exit 3" });
  assert.equal(fail.ok, false);
  assert.equal(fail.exitCode, 3);
  assert.match(fail.stderr, /bad/);
  assert.equal(validateCode({}).ok, false);
});

test("validateNumeric: last number wins, tolerance, commas", () => {
  assert.equal(validateNumeric("thinking... the answer is 42", { expected: 42 }).ok, true);
  assert.equal(validateNumeric("first 10 then 20", { expected: 20 }).ok, true);
  assert.equal(validateNumeric("total: 1,234", { expected: 1234 }).ok, true);
  assert.equal(validateNumeric("approx 3.14", { expected: 3.1416, tolerance: 0.01 }).ok, true);
  assert.equal(validateNumeric("no digits here", { expected: 1 }).ok, false);
});

test("validateCitations: known ids, unknown ids, minimum", () => {
  const ids = ["doc1.s2", "doc1.s3"];
  assert.equal(validateCitations("claim [doc1.s2].", { evidenceIds: ids }).ok, true);
  const unknown = validateCitations("claim [doc9.s9].", { evidenceIds: ids });
  assert.equal(unknown.ok, false);
  assert.deepEqual(unknown.unknown, ["doc9.s9"]);
  assert.equal(validateCitations("no cites at all", { evidenceIds: ids }).ok, false);
});

test("classifyFailure taxonomy", () => {
  assert.equal(classifyFailure({ outcome: "timeout" }), "timeout");
  assert.equal(classifyFailure({ outcome: "truncated", text: "part" }), "truncated");
  assert.equal(classifyFailure({ text: "   " }), "empty");
  assert.equal(classifyFailure({ text: "x", validation: { ok: false, errors: ["invalid JSON: y"] } }), "malformed");
  assert.equal(classifyFailure({ text: "x", validation: { ok: false, errors: ["needs ≥1 valid citation(s), found 0"] } }), "wrong");
  assert.equal(classifyFailure({ text: "fine", validation: { ok: true, errors: [] } }), null);
});
