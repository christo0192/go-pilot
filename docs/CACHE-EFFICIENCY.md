# Cache, token, and quality efficiency

Run `node scripts/gopilot-status.mjs` for the installed rig's current evidence.
The report deliberately separates:

- **latest cache hit**: Pi's status-bar `CH` semantics;
- **cumulative cache hit**: cached / (cached + fresh) across inspected sessions;
- **eligible warm calls**: successful calls in the same session/model/provider,
  within ten minutes, with fewer than 4,000 fresh tokens;
- cold reasons: first call, model switch, idle expiry, or a large fresh delta.

The cache aspiration is **98% on eligible warm calls**. It is not applied to a
first call, a provider/model change, expired cache, or necessary new evidence.
Those calls cannot honestly reach 98% when their fresh suffix exceeds roughly
2% of the cached prefix.

Quality has two thresholds:

- hard acceptance floor: retain at least **95%** of baseline quality;
- active aspiration: retain at least **98%** of baseline quality.

Acceptance reports show both. A result below 95% fails; a result between 95%
and 98% is safe enough to accept but remains visibly short of the target.

## Reproducible defaults

[`config/execution-contracts.json`](../config/execution-contracts.json) is the
source of truth used by fresh installs and upgrades. Default repository
retrieval uses relevant chunks, a 2,000-token ceiling, 500-token chunks, six
files, and at least two meaningful query terms. Evidence-heavy categories have
explicit larger budgets; code/repo-change categories permit a single symbol.

Tier-2 promotion remains validation-gated and now skips exact normalized
duplicates. Recalled Mem0 context retains its relevance floor and bounded token
budget. Transient tool/cache diagnostics are not promoted as durable memory.

The Windows application updater reruns the idempotent app installer after a
source update. That installer verifies the pinned Herdr font and migrates its
obsolete pre-v3 family name as well as copying
the current launcher/config resources, so new and existing installations
converge on the same setup.
