function isAuthorized(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return true;
  const provided = req.headers.get("x-admin-token");
  return provided && provided === expected;
}

export async function POST(req) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const branch = process.env.GITHUB_BRANCH || "main";
  const workflowId = process.env.GITHUB_WORKFLOW_ID || "market-watch.yml";

  if (!repo || !token) {
    return Response.json(
      { error: "Missing GITHUB_REPO or GITHUB_TOKEN in server environment." },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "user-agent": "hlidacka-admin"
        },
        body: JSON.stringify({ ref: branch })
      }
    );

    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      const suffix = details?.message ? ` (${details.message})` : "";
      throw new Error(`GitHub dispatch failed: ${response.status}${suffix}`);
    }

    return Response.json({ ok: true, message: "Workflow run started." });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to trigger workflow." },
      { status: 500 }
    );
  }
}
