// Reference > Compressed > Full boundary guard.
//
// Enforces the token-efficiency invariant: content crossing a pane boundary
// must be a reference/pointer or a compressed summary by default — NEVER raw
// full content unless explicitly justified.
//
// Pure and deterministic: no I/O, no clock, no randomness.

export const DEFAULT_THRESHOLD = 800;

const VALID_TIERS = new Set(["reference", "compressed", "full"]);

/**
 * Guard a payload crossing a pane boundary.
 *
 * @param {{ tier: "reference"|"compressed"|"full", content?: string, ref?: unknown, justification?: string }} payload
 * @param {{ threshold?: number }} [opts]
 * @returns {{ tier: string, content?: string, ref?: unknown, flagged: boolean, reason: string }}
 */
export function guardBoundary(payload, opts = {}) {
  if (payload === null || typeof payload !== "object") {
    throw new Error("guardBoundary: payload must be an object");
  }

  const { tier, content, ref, justification } = payload;

  if (tier === undefined || tier === null) {
    throw new Error("guardBoundary: missing tier");
  }
  if (!VALID_TIERS.has(tier)) {
    throw new Error(
      `guardBoundary: unknown tier "${tier}" (expected reference | compressed | full)`,
    );
  }

  if (tier === "reference") {
    return { tier: "reference", ref, flagged: false, reason: "reference passes" };
  }

  if (tier === "compressed") {
    return { tier: "compressed", content, flagged: false, reason: "compressed passes" };
  }

  // tier === "full"
  if (typeof content !== "string") {
    throw new Error("guardBoundary: full tier requires a string `content`");
  }

  // Explicit justification always allows raw full content through.
  if (typeof justification === "string" && justification.length > 0) {
    return { tier: "full", content, flagged: false, reason: "justified" };
  }

  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  // Small enough to pass without justification.
  if (content.length <= threshold) {
    return { tier: "full", content, flagged: false, reason: "under threshold" };
  }

  // Unjustified full content over threshold → downgrade.
  if (ref !== undefined && ref !== null) {
    return {
      tier: "reference",
      ref,
      flagged: true,
      reason: "downgraded: unjustified full content over threshold, ref available",
    };
  }

  // No ref → compress by truncating to threshold + elision marker.
  const elided = content.length - threshold;
  const truncated = content.slice(0, threshold) + ` …[+${elided} chars elided]`;
  return {
    tier: "compressed",
    content: truncated,
    flagged: true,
    reason: "downgraded: unjustified full content, no ref — truncated",
  };
}
