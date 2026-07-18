import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkSource, retrieveChunks, extractRecord } from "./extract.mjs";

test("chunkSource: splits on paragraph breaks and merges under maxChars", () => {
  const text =
    "Alpha section text here.\n\nBeta section text here.\n\n" +
    "Gamma section text here that is a bit longer to push chunk size over the limit.";
  const chunks = chunkSource(text, { maxChars: 40 });
  assert.ok(chunks.length >= 2);
  chunks.forEach((c, i) => assert.equal(c.id, `c${i + 1}`));
  const rejoined = chunks.map((c) => c.text).join(" ");
  assert.match(rejoined, /Alpha/);
  assert.match(rejoined, /Beta/);
  assert.match(rejoined, /Gamma/);
});

test("chunkSource: default maxChars merges short paragraphs into one chunk", () => {
  const text = "Line one.\n\nLine two.\n\nLine three.";
  const chunks = chunkSource(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].id, "c1");
  assert.match(chunks[0].text, /Line one/);
  assert.match(chunks[0].text, /Line three/);
});

test("retrieveChunks: ranks by keyword overlap with fieldName+hint, top 3", () => {
  const chunks = [
    { id: "c1", text: "The invoice total amount is 500 dollars." },
    { id: "c2", text: "Customer name is listed here: John Appleseed." },
    { id: "c3", text: "Shipping address: 123 Main Street." },
    { id: "c4", text: "Payment terms and total amount due at checkout." },
  ];
  const top = retrieveChunks(chunks, "totalAmount", "total amount due");
  assert.equal(top.length, 3);
  assert.equal(top[0].id, "c4"); // matches total+amount+due
  assert.equal(top[1].id, "c1"); // matches total+amount
  assert.equal(top[2].id, "c2"); // no match, but first among the zero-score ties
});

test("retrieveChunks: returns all chunks when fewer than 3 available", () => {
  const chunks = [
    { id: "c1", text: "alpha beta" },
    { id: "c2", text: "gamma delta" },
  ];
  const top = retrieveChunks(chunks, "alpha", "");
  assert.equal(top.length, 2);
  assert.equal(top[0].id, "c1");
});

const invoiceSchema = {
  type: "object",
  required: ["invoiceNumber", "customerName", "totalAmount"],
  properties: {
    invoiceNumber: { type: "string", description: "invoice number" },
    customerName: { type: "string", description: "customer name" },
    totalAmount: { type: "number", description: "total amount due" },
  },
};

const invoiceSourceText =
  "Invoice Number: INV-2024-001\nThis document confirms the purchase order.\n\n" +
  "Customer Name: Acme Corporation\nThey are a long-standing client.\n\n" +
  "Total Amount: 4500 USD\nPayment due within 30 days.";

test("extractRecord: happy path extracts 3 fields with evidence and passes", async () => {
  let calls = 0;
  const dispatch = async () => {
    calls++;
    return JSON.stringify({
      invoiceNumber: "INV-2024-001",
      customerName: "Acme Corporation",
      totalAmount: 4500,
      _evidence: { invoiceNumber: "c1", customerName: "c1", totalAmount: "c1" },
    });
  };

  const { ok, record, report } = await extractRecord({ sourceText: invoiceSourceText, schema: invoiceSchema, dispatch });

  assert.equal(ok, true);
  assert.equal(record.invoiceNumber, "INV-2024-001");
  assert.equal(record.customerName, "Acme Corporation");
  assert.equal(record.totalAmount, 4500);
  assert.equal(report.schemaValid, true);
  assert.equal(report.repairs, 0);
  assert.deepEqual(report.missingFields, []);
  assert.deepEqual(report.hallucinatedFields, []);
  assert.equal(report.evidenceSupport, 1);
  assert.equal(report.dispatchCalls, 1);
  assert.equal(calls, 1);
});

test("extractRecord: malformed JSON first response, then valid on repair", async () => {
  const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } } };
  const sourceText = "Name: Jane Doe\nJane Doe is the primary contact.";
  let call = 0;
  const dispatch = async ({ prompt }) => {
    call++;
    if (call === 1) return "this is not { valid json";
    assert.match(prompt, /Your output failed/);
    return JSON.stringify({ name: "Jane Doe", _evidence: { name: "c1" } });
  };

  const { ok, record, report } = await extractRecord({ sourceText, schema, dispatch, maxRepairs: 1 });

  assert.equal(ok, true);
  assert.equal(record.name, "Jane Doe");
  assert.equal(report.repairs, 1);
  assert.equal(report.dispatchCalls, 2);
  assert.equal(call, 2);
});

test("extractRecord: hallucinated field gets nulled and reported", async () => {
  const schema = { type: "object", required: ["city"], properties: { city: { type: "string" } } };
  const sourceText = "Location: Springfield\nThe office is downtown.";
  const dispatch = async () => JSON.stringify({ city: "Atlantis", _evidence: { city: "c1" } });

  const { ok, record, report } = await extractRecord({ sourceText, schema, dispatch });

  assert.equal(ok, false);
  assert.equal(record.city, null);
  assert.equal(report.schemaValid, true);
  assert.deepEqual(report.hallucinatedFields, ["city"]);
  assert.deepEqual(report.missingFields, []);
  assert.equal(report.evidenceSupport, 0);
  assert.equal(report.dispatchCalls, 1);
});

test("extractRecord: a required null field fails closed", async () => {
  const schema = {
    type: "object",
    required: ["name", "age"],
    properties: { name: { type: "string" }, age: { type: "number" } },
  };
  const sourceText = "Name: Bob Smith\nBob works in sales.";
  const dispatch = async () => JSON.stringify({ name: "Bob Smith", age: null, _evidence: { name: "c1", age: null } });

  const { ok, record, report } = await extractRecord({ sourceText, schema, dispatch });

  assert.equal(ok, false);
  assert.equal(record.name, "Bob Smith");
  assert.equal(record.age, null);
  assert.equal(report.schemaValid, false);
  assert.deepEqual(report.missingFields, ["age"]);
  assert.deepEqual(report.missingRequired, ["age"]);
  assert.deepEqual(report.hallucinatedFields, []);
  assert.equal(report.evidenceSupport, 1);
  assert.equal(report.dispatchCalls, 2);
});

test("extractRecord: repairs exhausted still returns a nulled record with schemaValid false", async () => {
  const schema = { type: "object", required: ["x"], properties: { x: { type: "string" } } };
  const dispatch = async () => "not json at all";

  const { ok, record, report } = await extractRecord({
    sourceText: "X: y\nsome text.",
    schema,
    dispatch,
    maxRepairs: 1,
  });

  assert.equal(ok, false);
  assert.equal(report.schemaValid, false);
  assert.equal(report.dispatchCalls, 2);
  assert.equal(report.repairs, 1);
  assert.equal(record.x, null);
});
