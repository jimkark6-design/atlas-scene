import { createHash } from "crypto";

const DEFAULT_BRANCH = process.env.ATLAS_RUN_GIT_BRANCH || "main";
const DEFAULT_REPO = process.env.ATLAS_RUN_GIT_REPO || "jimkark6-design/atlas-scene";

function githubConfig() {
  const token = process.env.ATLAS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
  const repo = process.env.ATLAS_RUN_GIT_REPO || DEFAULT_REPO;
  const branch = process.env.ATLAS_RUN_GIT_BRANCH || DEFAULT_BRANCH;
  return { token, repo, branch };
}

async function githubJson(url: string, init: RequestInit, token: string) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-04",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body?.message || text}`);
  return body;
}

function runPath(runId: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `.atlas/runs/${day}/run-${runId}.json`;
}

export async function syncAtlasRunSnapshot(runId: string, snapshot: unknown) {
  const { token, repo, branch } = githubConfig();
  if (!token) return { enabled: false, synced: false, reason: "missing ATLAS_GITHUB_TOKEN" };
  if (!repo) return { enabled: false, synced: false, reason: "missing ATLAS_RUN_GIT_REPO" };

  const payload = JSON.stringify(snapshot, null, 2) + "\n";
  const path = runPath(runId);
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const shaPayload = createHash("sha1").update(payload).digest("hex");
  let existingSha: string | undefined;

  try {
    const existing = await githubJson(`${url}?ref=${encodeURIComponent(branch)}`, { method: "GET" }, token);
    existingSha = existing?.sha;
  } catch (error: any) {
    if (!String(error?.message || "").includes("GitHub API 404")) throw error;
  }

  const response = await githubJson(
    url,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `ATLAS run ${runId} diagnostics snapshot`,
        content: Buffer.from(payload, "utf8").toString("base64"),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    },
    token,
  );

  return {
    enabled: true,
    synced: true,
    repo,
    branch,
    path,
    contentHash: shaPayload,
    commitSha: response?.commit?.sha || null,
  };
}
