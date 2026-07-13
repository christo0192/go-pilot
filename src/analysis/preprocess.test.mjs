import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTable, computeStats, toCompactTable, reductionReport } from "./preprocess.mjs";

// 12 rows x 5 cols: a month dimension (ordered), a revenue column with one
// obvious outlier (row 5, Jun-24), a %-formatted margin column, a cost
// column perfectly correlated with revenue, and a quoted cell with a comma.
const CSV = `Month,Revenue,MarginPct,Cost,Location
Jan-24,10000,12%,4000,"Austin, TX"
Feb-24,10500,12.5%,4200,Dallas
Mar-24,11000,11%,4400,Houston
Apr-24,11500,13%,4600,Denver
May-24,12000,12%,4800,Chicago
Jun-24,95000,9%,38000,Miami
Jul-24,12500,13%,5000,Seattle
Aug-24,13000,12%,5200,Boston
Sep-24,13500,11.5%,5400,Atlanta
Oct-24,14000,12%,5600,Phoenix
Nov-24,14500,13%,5800,Portland
Dec-24,15000,12.5%,6000,Detroit
`;

test("parseTable: header/rows, numeric coercion, %, currency, quoted comma cell", () => {
  const { headers, rows } = parseTable(CSV);
  assert.deepEqual(headers, ["Month", "Revenue", "MarginPct", "Cost", "Location"]);
  assert.equal(rows.length, 12);
  assert.equal(rows[0][0], "Jan-24");
  assert.equal(typeof rows[0][1], "number");
  assert.equal(rows[0][1], 10000);
  assert.equal(rows[0][2], 12); // "12%" -> 12
  assert.equal(rows[0][3], 4000);
  assert.equal(rows[0][4], "Austin, TX"); // quoted cell, comma preserved, unquoted
  assert.equal(rows[5][1], 95000);

  // empty cell -> null
  const { rows: r2 } = parseTable("A,B\n1,\n,2\n");
  assert.equal(r2[0][1], null);
  assert.equal(r2[1][0], null);

  // currency symbols (comma-formatted amount must be quoted — it's a plain
  // comma-delimited file, so an unquoted embedded comma would be ambiguous
  // with the delimiter itself, same as any real CSV)
  const { rows: r3 } = parseTable('Amt\n"$1,234.50"\n₹500\n€75\n');
  assert.equal(r3[0][0], 1234.5);
  assert.equal(r3[1][0], 500);
  assert.equal(r3[2][0], 75);
});

test("parseTable: delimiter autodetect for TSV", () => {
  const tsv = "A\tB\n1\t2\n3\t4\n";
  const { headers, rows } = parseTable(tsv);
  assert.deepEqual(headers, ["A", "B"]);
  assert.deepEqual(rows, [[1, 2], [3, 4]]);
});

test("parseTable: explicit delimiter override", () => {
  const { headers, rows } = parseTable("A;B\n1;2\n", { delimiter: ";" });
  assert.deepEqual(headers, ["A", "B"]);
  assert.deepEqual(rows, [[1, 2]]);
});

test("parseTable: throws TypeError on garbage/too-short input", () => {
  assert.throws(() => parseTable("only one line, no data"), TypeError);
  assert.throws(() => parseTable(""), TypeError);
  assert.throws(() => parseTable(null), TypeError);
  assert.throws(() => parseTable(12345), TypeError);
});

test("computeStats: mean/median/min/max exactness on Revenue", () => {
  const stats = computeStats(parseTable(CSV));
  const rev = stats.columns.Revenue;
  assert.equal(rev.count, 12);
  assert.equal(rev.sum, 232500);
  assert.equal(rev.mean, 19375);
  assert.equal(rev.median, 12750); // avg of sorted[5]=12500 and sorted[6]=13000
  assert.equal(rev.min, 10000);
  assert.equal(rev.max, 95000);
});

test("computeStats: outlier detected at the right row via IQR", () => {
  const stats = computeStats(parseTable(CSV));
  const rev = stats.columns.Revenue;
  assert.equal(rev.outliers.length, 1);
  assert.deepEqual(rev.outliers[0], { row: 5, value: 95000 }); // Jun-24, 0-based data row
});

test("computeStats: growthPct/delta computed from ordered first column (Month)", () => {
  const stats = computeStats(parseTable(CSV));
  const rev = stats.columns.Revenue;
  assert.equal(rev.delta, 5000); // 15000 - 10000
  assert.equal(rev.growthPct, 50); // 5000/10000*100
});

test("computeStats: growthPct is null when first value is 0", () => {
  const stats = computeStats(parseTable("Month,V\nJan-24,0\nFeb-24,10\nMar-24,20\n"));
  assert.equal(stats.columns.V.growthPct, null);
});

test("computeStats: Pearson r = 1 for a perfectly correlated pair (Revenue, Cost)", () => {
  const stats = computeStats(parseTable(CSV));
  const pair = stats.correlations.find((c) => c.a === "Revenue" && c.b === "Cost");
  assert.ok(pair);
  assert.equal(pair.r, 1);
});

test("computeStats: topBottom labels and values are correct", () => {
  const stats = computeStats(parseTable(CSV));
  const rev = stats.topBottom.Revenue;
  assert.deepEqual(rev.top.map((e) => e.label), ["Jun-24", "Dec-24", "Nov-24"]);
  assert.deepEqual(rev.top.map((e) => e.value), [95000, 15000, 14500]);
  assert.deepEqual(rev.bottom.map((e) => e.label), ["Jan-24", "Feb-24", "Mar-24"]);
  assert.deepEqual(rev.bottom.map((e) => e.value), [10000, 10500, 11000]);
});

test("computeStats: non-numeric columns (Month, Location) are excluded", () => {
  const stats = computeStats(parseTable(CSV));
  assert.equal(stats.columns.Month, undefined);
  assert.equal(stats.columns.Location, undefined);
});

test("toCompactTable: contains expected sections and stays under maxChars", () => {
  const stats = computeStats(parseTable(CSV));
  const compact = toCompactTable(stats);
  assert.match(compact, /Revenue: n=12/);
  assert.match(compact, /outliers:/);
  assert.match(compact, /Revenue\[row 5\]=95000/);
  assert.match(compact, /correlations:/);
  assert.match(compact, /Revenue~Cost: r=1/);
  assert.match(compact, /top\/bottom:/);
  assert.ok(compact.length <= 2000);
});

test("toCompactTable: truncates to maxChars with a marker", () => {
  const stats = computeStats(parseTable(CSV));
  const compact = toCompactTable(stats, { maxChars: 100 });
  assert.ok(compact.length <= 100);
  assert.match(compact, /…truncated$/);
});

test("reductionReport: >50% reduction on a realistically sized table", () => {
  // A single 12-row fixture is too small for the summary to beat the raw
  // text on size; the preprocessor's payoff shows up at scale, so this
  // simulates a bigger spreadsheet dump (120 rows) the way a real workhorse
  // call would see one.
  const lines = ["Period,Value,Cost"];
  for (let i = 1; i <= 120; i++) {
    const value = 1000 + i * 13;
    lines.push(`R${i},${value},${value * 0.5}`);
  }
  const rawText = lines.join("\n") + "\n";
  const stats = computeStats(parseTable(rawText));
  const compactText = toCompactTable(stats);
  const report = reductionReport(rawText, compactText);
  assert.equal(report.rawChars, rawText.length);
  assert.equal(report.compactChars, compactText.length);
  assert.ok(report.reductionPct > 50, `expected >50% reduction, got ${report.reductionPct}`);
  assert.ok(compactText.length <= 2000);
});

test("reductionReport: handles empty raw text without dividing by zero", () => {
  const report = reductionReport("", "");
  assert.equal(report.rawChars, 0);
  assert.equal(report.compactChars, 0);
  assert.equal(report.reductionPct, 0);
});
