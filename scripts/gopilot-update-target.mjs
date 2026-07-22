#!/usr/bin/env node
// Resolve an update target without trusting a moving branch blindly.
// stable: latest non-prerelease GitHub Release tag
// nightly: main HEAD only when the repository's CI workflow passed for it

const channel = process.argv[2] || "stable";
const slug = process.env.GOPILOT_REPO_SLUG || "christo0192/go-pilot";
const api = (process.env.GOPILOT_GITHUB_API || "https://api.github.com").replace(/\/$/, "");

if (!new Set(["stable", "nightly"]).has(channel)) {
  process.stderr.write(`unsupported update channel: ${channel}\n`);
  process.exit(2);
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug)) {
  process.stderr.write("GOPILOT_REPO_SLUG must be owner/repository\n");
  process.exit(2);
}

async function get(path) {
  const response = await fetch(`${api}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "go-pilot-updater",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = new Error(`GitHub API ${response.status} for ${path}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

try {
  if (channel === "stable") {
    let tag;
    let source;
    try {
      const release = await get(`/repos/${slug}/releases/latest`);
      if (release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name || "")) {
        throw new Error("latest release is not a valid stable semantic version");
      }
      tag = release.tag_name;
      source = release.html_url;
    } catch (error) {
      // The project historically published signed-off version tags before it
      // created GitHub Release objects. Preserve that valid upgrade path.
      if (error.status !== 404) throw error;
      const tags = await get(`/repos/${slug}/tags?per_page=100`);
      const stable = tags
        .map(item => item.name)
        .filter(name => /^v?\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => {
          const av = a.replace(/^v/, "").split(".").map(Number);
          const bv = b.replace(/^v/, "").split(".").map(Number);
          return bv[0] - av[0] || bv[1] - av[1] || bv[2] - av[2];
        });
      if (!stable[0]) throw new Error("repository has no stable semantic-version release or tag");
      tag = stable[0];
      source = `https://github.com/${slug}/releases/tag/${tag}`;
    }
    process.stdout.write(JSON.stringify({ channel, ref: tag, sha: null, source }) + "\n");
  } else {
    const commit = await get(`/repos/${slug}/commits/main`);
    if (!/^[0-9a-f]{40}$/.test(commit.sha || "")) throw new Error("main did not resolve to a full commit SHA");
    const params = new URLSearchParams({ head_sha: commit.sha, event: "push", status: "completed", per_page: "30" });
    const runs = await get(`/repos/${slug}/actions/runs?${params}`);
    const green = (runs.workflow_runs || []).some(run =>
      run.name === "CI" && run.head_sha === commit.sha && run.conclusion === "success"
    );
    if (!green) throw new Error(`main ${commit.sha.slice(0, 12)} has no successful completed CI run`);
    process.stdout.write(JSON.stringify({ channel, ref: "origin/main", sha: commit.sha, source: commit.html_url }) + "\n");
  }
} catch (error) {
  process.stderr.write(`gopilot update: ${error.message}\n`);
  process.exit(1);
}
