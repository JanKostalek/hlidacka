import fs from "node:fs/promises";
import path from "node:path";
import { buildSourcesForQuery, listSupportedMarketplaces } from "../../../lib/marketplaces";

const CONFIG_PATH = path.join(process.cwd(), "config", "watches.json");
const CONFIG_REPO_PATH = "config/watches.json";

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readConfig() {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (repo && token) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${CONFIG_REPO_PATH}?ref=${encodeURIComponent(
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
    if (!response.ok) {
      throw new Error(`GitHub read failed: ${response.status}`);
    }
    const payload = await response.json();
    const content = Buffer.from(payload.content, "base64").toString("utf8");
    return JSON.parse(content);
  }

  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

async function writeConfig(config, actor = "admin") {
  const output = JSON.stringify(config, null, 2) + "\n";
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (repo && token) {
    const currentResponse = await fetch(
      `https://api.github.com/repos/${repo}/contents/${CONFIG_REPO_PATH}?ref=${encodeURIComponent(
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
    if (!currentResponse.ok) {
      throw new Error(`GitHub read sha failed: ${currentResponse.status}`);
    }
    const currentPayload = await currentResponse.json();

    const updateResponse = await fetch(
      `https://api.github.com/repos/${repo}/contents/${CONFIG_REPO_PATH}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "user-agent": "hlidacka-admin"
        },
        body: JSON.stringify({
          message: `chore: update watches config (${actor})`,
          content: Buffer.from(output, "utf8").toString("base64"),
          sha: currentPayload.sha,
          branch
        })
      }
    );
    if (!updateResponse.ok) {
      throw new Error(`GitHub write failed: ${updateResponse.status}`);
    }
    return;
  }

  await fs.writeFile(CONFIG_PATH, output, "utf8");
}

function configToAdminModel(config) {
  return (config.watches || []).map((watch, index) => {
    const marketplaces = Array.from(
      new Set((watch.sources || []).map((source) => source.id).filter(Boolean))
    );

    return {
      id: watch.id || `watch-${index + 1}`,
      name: watch.name || "",
      query: watch.query || (watch.keywords || []).join(" "),
      keywordsCsv: (watch.keywords || []).join(", "),
      excludeKeywordsCsv: (watch.excludeKeywords || []).join(", "),
      marketplaces
    };
  });
}

function adminModelToConfig(modelWatches, notificationEmail, existingConfig = {}) {
  const usedIds = new Set();

  const watches = (modelWatches || [])
    .map((watch, index) => {
      const name = String(watch.name || "").trim();
      const query = String(watch.query || "").trim();
      const marketplaces = Array.isArray(watch.marketplaces)
        ? watch.marketplaces.filter((m) => ["sbazar", "bazos"].includes(m))
        : [];

      if (!name || !query || marketplaces.length === 0) return null;

      const baseId = slugify(watch.id || name) || `watch-${index + 1}`;
      let id = baseId;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);

      return {
        id,
        name,
        query,
        keywords: splitCsv(watch.keywordsCsv),
        excludeKeywords: splitCsv(watch.excludeKeywordsCsv),
        sources: buildSourcesForQuery(query, marketplaces)
      };
    })
    .filter(Boolean);

  const notifications = {
    ...(existingConfig.notifications || {}),
    emailTo: String(notificationEmail || "").trim()
  };

  return {
    ...existingConfig,
    watches,
    notifications
  };
}

function isAuthorized(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return true;
  const provided = req.headers.get("x-admin-token");
  return provided && provided === expected;
}

export async function GET(req) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const config = await readConfig();
    return Response.json({
      watches: configToAdminModel(config),
      marketplaces: listSupportedMarketplaces(),
      notificationEmail:
        config.notifications?.emailTo || process.env.EMAIL_TO || "jan.kostalek@gmail.com"
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load config" },
      { status: 500 }
    );
  }
}

export async function PUT(req) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const current = await readConfig();
    const config = adminModelToConfig(
      body.watches || [],
      body.notificationEmail,
      current
    );
    await writeConfig(config, "web-admin");

    return Response.json({
      ok: true,
      watches: configToAdminModel(config),
      marketplaces: listSupportedMarketplaces(),
      notificationEmail:
        config.notifications?.emailTo || process.env.EMAIL_TO || "jan.kostalek@gmail.com"
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to save config" },
      { status: 500 }
    );
  }
}
