import { evaluate } from "../metrics/acceptance.mjs";

export async function runBenchmark(fixtures, strategies, opts = {}) {
  const records = [];
  const outcomes = [];
  for (const fixture of fixtures) {
    for (const strategy of strategies) {
      for (let trial = 0; trial < (opts.trials || 1); trial += 1) {
        const started = Date.now();
        const outcome = await opts.run(fixture, strategy, trial);
        const latencyMs = Date.now() - started;
        outcomes.push({ fixture: fixture.id, strategy, trial, latencyMs, ...outcome });
        if (outcome.metricsRecord) records.push(outcome.metricsRecord);
      }
    }
  }
  return { outcomes, records, acceptance: records.length ? evaluate(records, opts.targets) : null };
}
