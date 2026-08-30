import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const DEFAULT_BRANCH = process.env.ATLAS_RUN_GIT_BRANCH || "main";
const DEFAULT_REPO = process.env.ATLAS_RUN_GIT_REPO || "jimkark6-design/atlas-scene";

async function commandToken(command: string, args: string[], input?: string) {
  try {
    const result = await execFileAsync(command, args, {
      input,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    } as any);
    const token = String(result.stdout || "").trim();
    return token || "";
  } catch {
    return "";
  }
}

async function resolveGithubToken() {
  const envToken = process.env.ATLAS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (envToken.trim()) return { token: envToken.trim(), source: "env" };

  const ghToken = await commandToken("gh", ["auth", "token"]);
  if (ghToken) return { token: ghToken, source: "gh-cli" };

  const credentialInput = "protocol=https\nhost=github.com\n\n";
  const credential = await commandToken("git", ["credential", "fill"], credentialInput);
  const password = credential.match(/(?:^|\n)password=([^\n]+)/)?.[1]?.trim() || "";
  if (password) return { token: password, source: "git-credential" };

  return { token: "", source: "none" };
}

function githubConfig() {
  const repo = process.env.ATLAS_RUN_GIT_REPO || DEFAULT_REPO;
  const branch = process.env.ATLAS_RUN_GIT_BRANCH || DEFAULT_BRANCH;
  return { repo, branch };
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

function runPath(runId: string, snapshot: any) {
  const day = String(snapshot?.day || new Date().toISOString().slice(0, 10));
  return `.atlas/runs/${day}/run-${runId}.json`;
}

export async function syncAtlasRunSnapshot(runId: string, snapshot: unknown) {
  const { repo, branch } = githubConfig();
  if (!repo) return { enabled: false, synced: false, reason: "missing ATLAS_RUN_GIT_REPO" };

  const auth = await resolveGithubToken();
  if (!auth.token) {
    return {
      enabled: true,
      synced: false,
      reason: "missing GitHub write credential; set ATLAS_GITHUB_TOKEN or authenticate gh/git",
      authSource: auth.source,
    };
  }

  const payload = JSON.stringify(snapshot, null, 2) + "\n";
  const path = runPath(runId, snapshot);
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const contentHash = createHash("sha1").update(payload).digest("hex");
  let existingSha: string | undefined;

  try {
    const existing = await githubJson(`${url}?ref=${encodeURIComponent(branch)}`, { method: "GET" }, auth.token);
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
    auth.token,
  );

  return {
    enabled: true,
    synced: true,
    repo,
    branch,
    path,
    contentHash,
    authSource: auth.source,
    commitSha: response?.commit?.sha || null,
  };
}
