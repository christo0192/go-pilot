import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState, updateState, renderState, consistencyCheck, compressionReport,
} from "./session-compress.mjs";

// A realistic 8-turn coding session: the user asks a question, the assistant
// decides/implements, a constraint is stated, a question is asked and later
// answered, files/URLs/backticked tokens are referenced, and work is marked
// done. Used across most tests below so the fixture is exercised end-to-end
// exactly once and every assertion reasons about the SAME accumulated state.
const TURNS = [
  { role: "user", text: "Can you help me build a session compression module for multi-turn chat state? We need to keep memory usage low across long conversations. Right now every turn resends the entire transcript back to the model, and as the conversation grows past a few dozen exchanges the token cost balloons and latency gets noticeably worse for everyone in the room. I've been thinking about this problem for a while and wanted to get your take on the cleanest design before diving into any implementation work this afternoon." },
  { role: "assistant", text: "Let's go with a plain JavaScript approach using pure functions with zero external dependencies. We will implement createState, updateState, renderState, consistencyCheck, and compressionReport in src/memory/session-compress.mjs, matching the style of src/validation/validate.mjs. This keeps the whole thing testable in isolation, easy to reason about, and trivial to swap out later if we ever want a smarter, model-based summarizer instead of the regex heuristics we are starting with today." },
  { role: "user", text: "Good. One constraint: the rendered output must always stay under a strict character budget, and we cannot exceed that limit under any circumstance. This matters because whatever we produce here eventually gets prepended to every subsequent prompt, so any bloat compounds turn after turn instead of staying flat the way the whole point of this exercise requires." },
  { role: "assistant", text: "Understood, decided: I will cap renderState output at maxChars using a whole-line truncation strategy with an ellipsis marker. I implemented the truncation logic and verified it against a fixed cap in the fixture test I created in src/memory/session-compress.test.mjs. The truncation walks the section lines in order and stops as soon as adding the next whole line would blow the threshold, so nothing ever gets cut off mid-sentence in the rendered block." },
  { role: "user", text: "Quick question: should refs capture URLs and backtick tokens? I keep going back and forth on whether that scope is too broad for a first pass, or whether narrowing it now would just mean revisiting the extraction logic again in a week or two once real usage patterns show up." },
  { role: "assistant", text: "Decided: refs will capture URLs and backtick tokens as planned. For example see https://nodejs.org/api/test.html and the `config.json` settings file mentioned earlier. That gives us three concrete ref shapes to detect deterministically without needing anything fancier than a couple of regexes and a small set of known file extensions." },
  { role: "user", text: "Also, please stick to built-in Node modules only — never add an npm dependency, and don't forget the deadline is end of day today. I know that is a tight turnaround, but the team already committed to a live demo tomorrow morning and there is genuinely no slack left in the schedule to bring in anything extra right now." },
  { role: "assistant", text: "Done: I fixed the stopword list, shipped the final version, and confirmed all tests passed in src/memory/session-compress.test.mjs. Along the way I also tightened up the ref-extraction regex so a URL and an overlapping backtick span no longer produce two near-duplicate entries in the refs list, which was a subtle bug in an earlier draft of this module." },
];

/** Fold every turn into a fresh state via updateState, returning the final state. */
function buildState(turns) {
  return turns.reduce((state, turn) => updateState(state, turn), createState());
}

test("createState: initial shape", () => {
  assert.deepEqual(createState(), {
    decisions: [],
    constraints: [],
    openQuestions: [],
    refs: [],
    doneSteps: [],
    turnCount: 0,
  });
});

test("8-turn fixture: decisions/constraints/refs/doneSteps captured; answered question resolved, unanswered one remains", () => {
  const state = buildState(TURNS);

  assert.equal(state.turnCount, 8);

  // Decisions: "let's go with", "we will", "decided" all fired.
  assert.equal(state.decisions.length, 4);
  assert.ok(state.decisions.some((d) => /let's go with/i.test(d)));
  assert.ok(state.decisions.some((d) => /we will implement/i.test(d)));
  assert.ok(state.decisions.some((d) => /^Understood, decided:/.test(d)));
  assert.ok(state.decisions.some((d) => /^Decided: refs will capture/.test(d)));
  assert.ok(state.decisions.every((d) => d.length <= 200));

  // Constraints: "must/always/cannot/limit" and "only/never/don't/deadline".
  assert.equal(state.constraints.length, 2);
  assert.ok(state.constraints.some((c) => /character budget/.test(c)));
  assert.ok(state.constraints.some((c) => /deadline is end of day/.test(c)));

  // Refs: file paths (with "/"), a URL, and a backtick-quoted token.
  assert.deepEqual(state.refs, [
    "src/memory/session-compress.mjs",
    "src/validation/validate.mjs",
    "src/memory/session-compress.test.mjs",
    "https://nodejs.org/api/test.html",
    "config.json",
  ]);

  // Done steps: only from the assistant.
  assert.equal(state.doneSteps.length, 2);
  assert.ok(state.doneSteps.some((d) => /implemented the truncation logic/i.test(d)));
  assert.ok(state.doneSteps.some((d) => /^Done: I fixed the stopword list/.test(d)));

  // Open questions: the turn-5 question was answered in turn 6 and must be
  // gone; the turn-1 question was never answered and must remain.
  assert.equal(state.openQuestions.length, 1);
  assert.ok(state.openQuestions[0].startsWith("Can you help me build a session compression module"));
  assert.ok(!state.openQuestions.some((q) => /should refs capture URLs/i.test(q)));
});

test("renderState: all sections present, most-recent-first, within default maxChars", () => {
  const state = buildState(TURNS);
  const rendered = renderState(state);

  assert.ok(rendered.length <= 1500);
  assert.ok(rendered.startsWith("## Session state (turn 8)"));
  for (const heading of ["Decisions:", "Constraints:", "Open:", "Refs:", "Done:"]) {
    assert.ok(rendered.includes(heading), `missing section "${heading}"`);
  }

  // Most-recent-first within a section: the LAST decision added ("Decided:
  // refs will capture...") should appear as the bullet directly under
  // "Decisions:".
  const lines = rendered.split("\n");
  const decisionsIdx = lines.indexOf("Decisions:");
  assert.match(lines[decisionsIdx + 1], /^- Decided: refs will capture/);
});

test("renderState: forced truncation keeps whole lines and ends with a marker", () => {
  const state = buildState(TURNS);
  const tiny = renderState(state, { maxChars: 80 });

  assert.ok(tiny.length <= 80);
  assert.ok(tiny.endsWith("…"));
  // Every line except the trailing marker must be a whole line from the full
  // render (no mid-line cut).
  const full = renderState(state, { maxChars: 100000 });
  const fullLines = new Set(full.split("\n"));
  const keptBody = tiny.slice(0, tiny.length - "\n…".length);
  for (const line of keptBody.split("\n")) {
    if (line) assert.ok(fullLines.has(line), `truncated output has a partial line: "${line}"`);
  }
});

test("consistencyCheck: ok on the real fixture state, flags an injected fake item", () => {
  const state = buildState(TURNS);

  const clean = consistencyCheck(state, TURNS);
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.unsupported, []);

  const fakeItem = "We decided to migrate everything to Rust for maximum performance gains";
  const tainted = {
    ...state,
    decisions: [...state.decisions, fakeItem],
  };
  const dirty = consistencyCheck(tainted, TURNS);
  assert.equal(dirty.ok, false);
  assert.ok(dirty.unsupported.includes(fakeItem));
});

test("compressionReport: reductionPct >= 50 for the fixture", () => {
  const state = buildState(TURNS);
  const rendered = renderState(state);
  const report = compressionReport(TURNS, rendered);

  const expectedFullChars = TURNS.reduce((sum, t) => sum + t.text.length, 0);
  assert.equal(report.fullChars, expectedFullChars);
  assert.equal(report.compressedChars, rendered.length);
  assert.ok(report.reductionPct >= 50, `reductionPct was only ${report.reductionPct}`);
});

test("updateState immutability: input state is never mutated", () => {
  const before = buildState(TURNS.slice(0, 4));
  const snapshot = JSON.parse(JSON.stringify(before));

  const after = updateState(before, TURNS[4]);

  assert.deepEqual(before, snapshot, "input state was mutated by updateState");
  assert.notEqual(after, before);
  assert.equal(after.turnCount, before.turnCount + 1);
});

test("dedupe: restating the same decision does not grow the list", () => {
  const turn = { role: "assistant", text: "Decided: we will use SQLite for local storage." };

  const once = updateState(createState(), turn);
  assert.equal(once.decisions.length, 1);

  const twice = updateState(once, turn);
  assert.equal(twice.decisions.length, 1);

  // Case-insensitive restatement also dedupes.
  const restated = { role: "assistant", text: "DECIDED: WE WILL USE SQLITE FOR LOCAL STORAGE." };
  const thrice = updateState(twice, restated);
  assert.equal(thrice.decisions.length, 1);
});
