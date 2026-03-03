import fs from "node:fs/promises";
import path from "node:path";

const HISTORY_FILES = {
  "data/run-history.json": JSON.stringify({ runs: [] }, null, 2) + "\n",
  "data/found-history.json":
    JSON.stringify({ updatedAt: null, byWatch: {} }, null, 2) + "\n",
  "data/state.json": JSON.stringify({ updatedAt: null, seen: {} }, null, 2) + "\n",
  "data/latest-results.json":
    JSON.stringify(
      {
        runAt: null,
        summary: {
          totalWatches: 0,
          totalSources: 0,
          totalNewItems: 0,
          errorCount: 0
        },
        newItemsByWatch: [],
        errors: []
      },
      null,
      2
    ) + "\n",
  "data/last-run.md": "# Hlidacka bazaru\n\nHistorie byla vycistena.\n"
};

function isAuthorized(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return true;
  const provided = req.headers.get("x-admin-token");
  return provided && provided === expected;
}

async function writeLocalFiles() {
  for (const [filePath, content] of Object.entries(HISTORY_FILES)) {
    const absPath = path.join(process.cwd(), filePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, "utf8");
  }
}

async function readRepoFileMeta(repo, token, branch, filePath) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${encodeURIComponent(
      branch
    )}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "hlidacka-admin"
      }
    }
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub read failed (${filePath}): ${response.status}`);
  }
  return await response.json();
}

async function writeRepoFile(repo, token, branch, filePath, content, message) {
  const current = await readRepoFileMeta(repo, token, branch, filePath);
  const body = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch
  };
  if (current?.sha) body.sha = current.sha;

  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "hlidacka-admin"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`GitHub write failed (${filePath}): ${response.status}`);
  }
}

async function writeHistoryToRepo() {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!repo || !token) return false;

  for (const [filePath, content] of Object.entries(HISTORY_FILES)) {
    await writeRepoFile(repo, token, branch, filePath, content, "chore: clear history data");
  }
  return true;
}

export async function POST(req) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    if (body.action && body.action !== "clear") {
      return Response.json({ error: "Unsupported action" }, { status: 400 });
    }

    const wroteToRepo = await writeHistoryToRepo();
    if (!wroteToRepo) {
      await writeLocalFiles();
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to clear history" },
      { status: 500 }
    );
  }
}
