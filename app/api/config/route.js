import fs from "node:fs/promises";
import path from "node:path";
import { buildSourcesForQuery, listSupportedMarketplaces } from "../../../lib/marketplaces";

const CONFIG_PATH = path.join(process.cwd(), "config", "watches.json");
const CONFIG_REPO_PATH = "config/watches.json";
const WORKFLOW_PATH = path.join(
  process.cwd(),
  ".github",
  "workflows",
  "market-watch.yml"
);
const WORKFLOW_REPO_PATH = ".github/workflows/market-watch.yml";
const DEFAULT_SCHEDULE = {
  startHour: 0,
  intervalHours: 2,
  cronExpression: "0 */2 * * *"
};

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
  return readJsonFromFile(CONFIG_PATH, CONFIG_REPO_PATH);
}

async function writeConfig(config, actor = "admin") {
  const output = JSON.stringify(config, null, 2) + "\n";
  await writeTextToFile(output, CONFIG_PATH, CONFIG_REPO_PATH, `chore: update watches config (${actor})`);
}

async function readJsonFromFile(localPath, repoPath) {
  const raw = await readTextFromFile(localPath, repoPath);
  return JSON.parse(raw);
}

async function readTextFromFile(localPath, repoPath) {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (repo && token) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${repoPath}?ref=${encodeURIComponent(
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
    return Buffer.from(payload.content, "base64").toString("utf8");
  }

  return fs.readFile(localPath, "utf8");
}

async function writeTextToFile(output, localPath, repoPath, commitMessage) {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (repo && token) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentResponse = await fetch(
        `https://api.github.com/repos/${repo}/contents/${repoPath}?ref=${encodeURIComponent(
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
        `https://api.github.com/repos/${repo}/contents/${repoPath}`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "user-agent": "hlidacka-admin"
          },
          body: JSON.stringify({
            message: commitMessage,
            content: Buffer.from(output, "utf8").toString("base64"),
            sha: currentPayload.sha,
            branch
          })
        }
      );
      if (updateResponse.ok) {
        return;
      }
      if (updateResponse.status !== 409 || attempt === 2) {
        throw new Error(`GitHub write failed: ${updateResponse.status}`);
      }
    }
  }

  await fs.writeFile(localPath, output, "utf8");
}

function parseScheduleFromWorkflow(workflowText) {
  const cronMatch = workflowText.match(/-\s*cron:\s*"([^"]+)"/);
  const cronExpression = cronMatch?.[1] || DEFAULT_SCHEDULE.cronExpression;
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { ...DEFAULT_SCHEDULE, cronExpression };
  }

  const minute = Number(parts[0]);
  const hourField = parts[1] || "";
  if (!Number.isInteger(minute) || minute !== 0) {
    return { ...DEFAULT_SCHEDULE, cronExpression };
  }

  let startHour = null;
  let intervalHours = null;

  const everyMatch = hourField.match(/^\*\/(\d+)$/);
  if (everyMatch) {
    startHour = 0;
    intervalHours = Number(everyMatch[1]);
  }

  const rangeMatch = hourField.match(/^(\d+)-23\/(\d+)$/);
  if (rangeMatch) {
    startHour = Number(rangeMatch[1]);
    intervalHours = Number(rangeMatch[2]);
  }

  if (hourField.includes(",")) {
    const hours = hourField
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23);
    if (hours.length >= 2) {
      const diffs = [];
      for (let i = 0; i < hours.length; i += 1) {
        const current = hours[i];
        const next = hours[(i + 1) % hours.length];
        let diff = next - current;
        if (diff <= 0) diff += 24;
        diffs.push(diff);
      }
      const firstDiff = diffs[0];
      const isConstant = diffs.every((diff) => diff === firstDiff);
      if (isConstant) {
        startHour = hours[0];
        intervalHours = firstDiff;
      }
    }
  }

  if (
    !Number.isInteger(startHour) ||
    startHour < 0 ||
    startHour > 23 ||
    !Number.isInteger(intervalHours) ||
    intervalHours < 2 ||
    intervalHours > 24
  ) {
    return { ...DEFAULT_SCHEDULE, cronExpression };
  }

  return {
    startHour,
    intervalHours,
    cronExpression
  };
}

function buildCronExpression(startHour, intervalHours) {
  const hours = [];
  for (let hour = startHour; hour < startHour + 24; hour += intervalHours) {
    hours.push(hour % 24);
  }
  return `0 ${hours.join(",")} * * *`;
}

function updateWorkflowCron(workflowText, cronExpression) {
  const pattern = /(-\s*cron:\s*")([^"]+)(")/;
  if (!pattern.test(workflowText)) {
    throw new Error("Cron schedule was not found in workflow file.");
  }
  return workflowText.replace(pattern, `$1${cronExpression}$3`);
}

async function readWorkflowSchedule() {
  const workflowText = await readTextFromFile(WORKFLOW_PATH, WORKFLOW_REPO_PATH);
  return parseScheduleFromWorkflow(workflowText);
}

async function writeWorkflowSchedule(schedule, actor = "admin") {
  const workflowText = await readTextFromFile(WORKFLOW_PATH, WORKFLOW_REPO_PATH);
  const cronExpression = buildCronExpression(schedule.startHour, schedule.intervalHours);
  const nextWorkflowText = updateWorkflowCron(workflowText, cronExpression);
  await writeTextToFile(
    nextWorkflowText,
    WORKFLOW_PATH,
    WORKFLOW_REPO_PATH,
    `chore: update market watch schedule (${actor})`
  );
  return { ...schedule, cronExpression };
}

function normalizeScheduleInput(scheduleInput, fallbackSchedule = DEFAULT_SCHEDULE) {
  const startHour = Number(scheduleInput?.startHour);
  const intervalHours = Number(scheduleInput?.intervalHours);

  const safeStartHour = Number.isInteger(startHour) && startHour >= 0 && startHour <= 23
    ? startHour
    : fallbackSchedule.startHour;
  const safeInterval = Number.isInteger(intervalHours) && intervalHours >= 2 && intervalHours <= 24
    ? intervalHours
    : fallbackSchedule.intervalHours;

  return {
    startHour: safeStartHour,
    intervalHours: safeInterval
  };
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

function adminModelToConfig(
  modelWatches,
  notificationEmail,
  emailOnlyWhenNew,
  existingConfig = {}
) {
  const usedIds = new Set();

  const watches = (modelWatches || [])
    .map((watch, index) => {
      const name = String(watch.name || "").trim();
      const query = String(watch.query || "").trim();
      const marketplaces = Array.isArray(watch.marketplaces)
        ? watch.marketplaces.filter((m) => ["sbazar", "bazos", "paladix"].includes(m))
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
    emailTo: String(notificationEmail || "").trim(),
    emailOnlyWhenNew: Boolean(emailOnlyWhenNew)
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
    const [config, schedule] = await Promise.all([readConfig(), readWorkflowSchedule()]);
    return Response.json({
      watches: configToAdminModel(config),
      marketplaces: listSupportedMarketplaces(),
      notificationEmail:
        config.notifications?.emailTo || process.env.EMAIL_TO || "jan.kostalek@gmail.com",
      emailOnlyWhenNew:
        typeof config.notifications?.emailOnlyWhenNew === "boolean"
          ? config.notifications.emailOnlyWhenNew
          : String(process.env.EMAIL_ONLY_WHEN_NEW || "false") === "true",
      schedule
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
    const [current, currentSchedule] = await Promise.all([readConfig(), readWorkflowSchedule()]);
    const config = adminModelToConfig(
      body.watches || [],
      body.notificationEmail,
      body.emailOnlyWhenNew,
      current
    );
    const nextSchedule = normalizeScheduleInput(body.schedule, currentSchedule);
    // Two GitHub content updates to the same branch in parallel can cause 409 conflicts.
    await writeConfig(config, "web-admin");
    await writeWorkflowSchedule(nextSchedule, "web-admin");

    return Response.json({
      ok: true,
      watches: configToAdminModel(config),
      marketplaces: listSupportedMarketplaces(),
      notificationEmail:
        config.notifications?.emailTo || process.env.EMAIL_TO || "jan.kostalek@gmail.com",
      emailOnlyWhenNew: Boolean(config.notifications?.emailOnlyWhenNew),
      schedule: {
        ...nextSchedule,
        cronExpression: buildCronExpression(nextSchedule.startHour, nextSchedule.intervalHours)
      }
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to save config" },
      { status: 500 }
    );
  }
}
