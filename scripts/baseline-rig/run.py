#!/usr/bin/env python3
"""
Go-pilot baseline-paradox measurement rig (S00/T03).

Compares a task run SINGLE-AGENT vs MULTI-PANE and captures real tokens + cost via
`claude -p --output-format json`. Answers PLAN #12: does multi-pane actually beat a
single agent by >=20% tokens at <=5% quality loss? (quality scored separately, see
metrics/quality-rubric.md).

Usage:
  python3 run.py run   <task.json>          # runs both modes, writes metrics/runs/<id>-*.json
  python3 run.py single <task.json>
  python3 run.py multi  <task.json>
  python3 run.py compare <id>               # prints token/cost deltas + GO/NO-GO (token axis)

Task fixture (JSON):
{
  "id": "trivial-smoke",
  "single": { "model": "haiku", "prompt": "..." },
  "multi": {
    "orchestrator": { "model": "opus", "prompt": "..." },   # optional planning call
    "workers":      [ { "model": "haiku", "prompt": "..." }, { "model": "sonnet", "prompt": "..." } ],
    "combine":      { "model": "sonnet", "prompt": "..." }   # optional synthesis call
  }
}

Notes:
- Headline metric is total_cost_usd (truest billing comparison; accounts for cache pricing).
- Also captures raw input/output/cache tokens. Claude Code injects a large system prompt,
  so EACH claude -p call re-pays cache-creation/read overhead — the rig makes that visible.
- Quality is NOT auto-scored here; score outputs with metrics/quality-rubric.md and record
  in docs/task-class-decisions.md.
"""
import json, subprocess, sys, os, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
RUNS = ROOT / "metrics" / "runs"
RUNS.mkdir(parents=True, exist_ok=True)


def run_claude(prompt: str, model: str) -> dict:
    """One headless claude call → parsed result with token/cost fields."""
    proc = subprocess.run(
        ["claude", "-p", "--output-format", "json", "--model", model],
        input=prompt, capture_output=True, text=True, timeout=600,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"claude failed ({model}): {proc.stderr[:300]}")
    data = json.loads(proc.stdout)
    u = data.get("usage", {}) or {}
    return {
        "model": model,
        "result": data.get("result", ""),
        "cost_usd": data.get("total_cost_usd", 0.0) or 0.0,
        "input_tokens": u.get("input_tokens", 0),
        "output_tokens": u.get("output_tokens", 0),
        "cache_creation_tokens": u.get("cache_creation_input_tokens", 0),
        "cache_read_tokens": u.get("cache_read_input_tokens", 0),
        "duration_ms": data.get("duration_ms", 0),
    }


def totals(calls: list[dict]) -> dict:
    keys = ["cost_usd", "input_tokens", "output_tokens",
            "cache_creation_tokens", "cache_read_tokens"]
    agg = {k: sum(c.get(k, 0) for c in calls) for k in keys}
    agg["total_tokens"] = (agg["input_tokens"] + agg["output_tokens"]
                           + agg["cache_creation_tokens"] + agg["cache_read_tokens"])
    agg["n_calls"] = len(calls)
    return agg


def run_single(task: dict) -> dict:
    s = task["single"]
    call = run_claude(s["prompt"], s["model"])
    rec = {"id": task["id"], "mode": "single", "calls": [call], **totals([call])}
    _write(task["id"], "single", rec)
    return rec


def run_multi(task: dict) -> dict:
    m = task["multi"]
    calls = []
    if m.get("orchestrator"):
        calls.append(run_claude(m["orchestrator"]["prompt"], m["orchestrator"]["model"]))
    for w in m.get("workers", []):
        calls.append(run_claude(w["prompt"], w["model"]))
    if m.get("combine"):
        calls.append(run_claude(m["combine"]["prompt"], m["combine"]["model"]))
    rec = {"id": task["id"], "mode": "multi", "calls": calls, **totals(calls)}
    _write(task["id"], "multi", rec)
    return rec


def _write(task_id: str, mode: str, rec: dict):
    (RUNS / f"{task_id}-{mode}.json").write_text(json.dumps(rec, indent=2))


def compare(task_id: str):
    s = json.loads((RUNS / f"{task_id}-single.json").read_text())
    mu = json.loads((RUNS / f"{task_id}-multi.json").read_text())
    dtok = 1 - (mu["total_tokens"] / s["total_tokens"]) if s["total_tokens"] else 0
    dcost = 1 - (mu["cost_usd"] / s["cost_usd"]) if s["cost_usd"] else 0
    print(f"\n== Baseline comparison: {task_id} ==")
    print(f"  single: {s['total_tokens']:>10,} tok  ${s['cost_usd']:.4f}  ({s['n_calls']} call)")
    print(f"  multi:  {mu['total_tokens']:>10,} tok  ${mu['cost_usd']:.4f}  ({mu['n_calls']} calls)")
    print(f"  Δtokens: {dtok*100:+.1f}%   Δcost: {dcost*100:+.1f}%")
    token_go = dtok >= 0.20
    print(f"  TOKEN axis: {'GO ✅ (>=20% cut)' if token_go else 'NO-GO ❌ (<20% cut)'}")
    print("  NOTE: also score quality (<=5% loss) before final GO — see quality-rubric.md\n")


def main():
    if len(sys.argv) < 3 and not (len(sys.argv) == 3 and sys.argv[1] == "compare"):
        print(__doc__); sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "compare":
        compare(sys.argv[2]); return
    task = json.loads(pathlib.Path(sys.argv[2]).read_text())
    if cmd == "single":
        print(json.dumps(run_single(task), indent=2))
    elif cmd == "multi":
        print(json.dumps(run_multi(task), indent=2))
    elif cmd == "run":
        run_single(task); run_multi(task); compare(task["id"])
    else:
        print(__doc__); sys.exit(1)


if __name__ == "__main__":
    main()
