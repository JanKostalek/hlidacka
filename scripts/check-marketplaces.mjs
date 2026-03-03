import fs from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import nodemailer from "nodemailer";

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, "config", "watches.json");
const STATE_PATH = path.join(ROOT, "data", "state.json");
const RESULTS_PATH = path.join(ROOT, "data", "latest-results.json");
const REPORT_PATH = path.join(ROOT, "data", "last-run.md");
const RUN_HISTORY_PATH = path.join(ROOT, "data", "run-history.json");

const USER_AGENT =
  "Mozilla/5.0 (compatible; HlidackaBazaru/1.0; +https://github.com/)";

const nowIso = new Date().toISOString();

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function normalizeWhitespace(input) {
  return (input || "").replace(/\s+/g, " ").trim();
}

function normalizeLink(rawHref, pageUrl) {
  if (!rawHref) return "";
  try {
    const full = new URL(rawHref, pageUrl);
    full.searchParams.delete("utm_source");
    full.searchParams.delete("utm_medium");
    full.searchParams.delete("utm_campaign");
    return full.toString();
  } catch {
    return "";
  }
}

function makeKey(sourceId, link, title) {
  return `${sourceId}|${link || title.toLowerCase()}`;
}

function includesKeywords(text, required = [], excluded = []) {
  const haystack = text.toLowerCase();
  const hasRequired =
    required.length === 0 ||
    required.every((kw) => haystack.includes(String(kw).toLowerCase()));
  const hasExcluded = excluded.some((kw) =>
    haystack.includes(String(kw).toLowerCase())
  );
  return hasRequired && !hasExcluded;
}

function extractFromCard($, card, source, sourceUrl) {
  const $card = $(card);
  const titleSelector = source.titleSelector || "a";
  const linkSelector = source.linkSelector || "a[href]";
  const priceSelector = source.priceSelector || "";

  const title = normalizeWhitespace($card.find(titleSelector).first().text());
  const hrefRaw = $card.find(linkSelector).first().attr("href");
  const link = normalizeLink(hrefRaw, sourceUrl);
  const price = priceSelector
    ? normalizeWhitespace($card.find(priceSelector).first().text())
    : "";

  return { title, link, price };
}

function extractItemsFromPage(html, source) {
  const $ = load(html);
  const sourceUrl = source.url;
  const items = [];

  if (source.itemSelector) {
    $(source.itemSelector).each((_, card) => {
      const item = extractFromCard($, card, source, sourceUrl);
      if (item.title || item.link) items.push(item);
    });
  } else {
    $("a[href]").each((_, el) => {
      const title = normalizeWhitespace($(el).text());
      const link = normalizeLink($(el).attr("href"), sourceUrl);
      if (title.length < 8 || !link) return;
      items.push({ title, link, price: "" });
    });
  }

  const uniq = new Map();
  for (const item of items) {
    const k = item.link || item.title;
    if (!uniq.has(k)) uniq.set(k, item);
  }
  return Array.from(uniq.values());
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} (${url})`);
  }
  return await res.text();
}

function pruneSeen(seenMap, maxAgeDays = 90, maxCount = 10000) {
  const cutMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const entries = Object.entries(seenMap).filter(([, iso]) => {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && Date.now() - t < cutMs;
  });
  entries.sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime());
  return Object.fromEntries(entries.slice(0, maxCount));
}

function buildReport(results) {
  const lines = [];
  lines.push(`# Hlidacka bazaru - ${results.runAt}`);
  lines.push("");
  lines.push(`- Kontrolovano dotazu: **${results.summary.totalWatches}**`);
  lines.push(`- Kontrolovano zdroju: **${results.summary.totalSources}**`);
  lines.push(`- Nalezeno novych inzeratu: **${results.summary.totalNewItems}**`);
  lines.push(`- Chyby: **${results.summary.errorCount}**`);
  lines.push("");

  for (const group of results.newItemsByWatch) {
    lines.push(`## ${group.watchName} (${group.items.length})`);
    lines.push("");
    for (const item of group.items) {
      const pricePart = item.price ? ` | ${item.price}` : "";
      lines.push(`- [${item.title}](${item.link})${pricePart} | ${item.sourceName}`);
    }
    lines.push("");
  }

  if (results.errors.length > 0) {
    lines.push("## Chyby");
    lines.push("");
    for (const err of results.errors) {
      lines.push(`- ${err.watchName} / ${err.sourceName}: ${err.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function sendDiscordNotification(results) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || results.summary.totalNewItems === 0) return;

  const entries = results.newItemsByWatch.flatMap((g) =>
    g.items.map((item) => `* ${item.title}\n${item.link}`)
  );

  const chunks = [];
  let current = "";
  for (const line of entries) {
    if ((current + "\n" + line).length > 1800) {
      chunks.push(current.trim());
      current = line;
    } else {
      current += `\n${line}`;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  for (let i = 0; i < chunks.length; i++) {
    const payload = {
      content:
        i === 0
          ? `Nove inzeraty (${results.summary.totalNewItems})\n${chunks[i]}`
          : chunks[i]
    };
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
}

function buildEmailText(config, results) {
  const watches = config.watches || [];
  const newItemsByWatchId = new Map(
    (results.newItemsByWatch || []).map((group) => [group.watchId, group.items.length])
  );

  const lines = [];
  lines.push(`Hlidacka bazaru - vysledek behu`);
  lines.push(`Cas behu: ${results.runAt}`);
  lines.push(`Nove inzeraty: ${results.summary.totalNewItems}`);
  lines.push(`Chyby: ${results.summary.errorCount}`);
  lines.push("");
  lines.push("Aktivni dotazy:");
  lines.push("");

  for (const watch of watches) {
    const sources = Array.from(
      new Set((watch.sources || []).map((source) => source.name || source.id).filter(Boolean))
    );
    const errCount = (results.errors || []).filter((err) => err.watchId === watch.id).length;
    const newCount = newItemsByWatchId.get(watch.id) || 0;
    const keywords = (watch.keywords || []).join(", ") || "(zadna)";
    const excluded = (watch.excludeKeywords || []).join(", ") || "(zadna)";
    const sourceList = sources.join(", ") || "(zadny)";

    lines.push(`- ${watch.name || watch.id}`);
    lines.push(`  co hledat: ${watch.query || "(prazdne)"}`);
    lines.push(`  klicova slova: ${keywords}`);
    lines.push(`  vyloucit slova: ${excluded}`);
    lines.push(`  bazary: ${sourceList}`);
    lines.push(`  vysledek: nove ${newCount}, chyby ${errCount}`);
    lines.push("");
  }

  if (watches.length === 0) {
    lines.push("(zadne dotazy)");
    lines.push("");
  }

  if (results.summary.totalNewItems === 0) {
    lines.push("Zadne nove inzeraty.");
    lines.push("");
  } else {
    lines.push("Nove inzeraty:");
    lines.push("");
    for (const group of results.newItemsByWatch) {
      lines.push(`${group.watchName} (${group.items.length})`);
      for (const item of group.items) {
        const pricePart = item.price ? ` | ${item.price}` : "";
        lines.push(`- ${item.title}${pricePart} | ${item.sourceName}`);
        lines.push(`  ${item.link}`);
      }
      lines.push("");
    }
  }

  if (results.errors.length === 0) {
    lines.push("Chyby: zadne");
    lines.push("");
  } else {
    lines.push("Chyby:");
    for (const err of results.errors) {
      lines.push(`- ${err.watchName} / ${err.sourceName}: ${err.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildEmailSubject(config, results) {
  const firstName = config.watches?.[0]?.name || "dotaz";
  const extraCount = Math.max((config.watches?.length || 1) - 1, 0);
  const scope = extraCount > 0 ? `${firstName} +${extraCount}` : firstName;
  return results.summary.totalNewItems > 0
    ? `Hlidacka (${scope}): ${results.summary.totalNewItems} novych inzeratu`
    : `Hlidacka (${scope}): zadne nove inzeraty`;
}

async function sendEmailNotification(config, results) {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || "true") !== "false";
  const user = process.env.SMTP_USER || "hlidacka1@gmail.com";
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || "hlidacka1@gmail.com";
  const to =
    config.notifications?.emailTo ||
    process.env.EMAIL_TO ||
    "jan.kostalek@gmail.com";
  const enabled = String(process.env.EMAIL_ENABLED || "true") !== "false";

  if (!enabled) {
    console.log("Email notification skipped: EMAIL_ENABLED=false");
    return;
  }
  if (!pass) {
    console.log("Email notification skipped: SMTP_PASS is empty");
    return;
  }
  if (!to) {
    console.log("Email notification skipped: target e-mail is empty");
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });

  console.log(`Sending email notification to ${to}...`);
  await transporter.sendMail({
    from,
    to,
    subject: buildEmailSubject(config, results),
    text: buildEmailText(config, results)
  });
  console.log("Email notification sent.");
}

async function main() {
  await ensureDir(path.join(ROOT, "data"));
  const config = await readJson(CONFIG_PATH, { watches: [] });
  const state = await readJson(STATE_PATH, { seen: {} });
  const runHistory = await readJson(RUN_HISTORY_PATH, { runs: [] });
  const seen = { ...(state.seen || {}) };

  const newItemsByWatch = [];
  const errors = [];
  let totalSources = 0;
  const watchStats = [];

  for (const watch of config.watches || []) {
    const itemsForWatch = [];
    const watchSources = watch.sources || [];
    let watchErrors = 0;

    for (const source of watchSources) {
      totalSources += 1;
      try {
        const html = await fetchHtml(source.url);
        const extracted = extractItemsFromPage(html, source);

        for (const candidate of extracted) {
          const text = `${candidate.title} ${candidate.price}`;
          if (
            !includesKeywords(text, watch.keywords || [], watch.excludeKeywords || [])
          ) {
            continue;
          }

          const key = makeKey(source.id || source.name || source.url, candidate.link, candidate.title);
          if (seen[key]) continue;

          seen[key] = nowIso;
          itemsForWatch.push({
            watchId: watch.id,
            watchName: watch.name,
            sourceId: source.id || source.url,
            sourceName: source.name || source.id || source.url,
            title: candidate.title || "(bez nazvu)",
            price: candidate.price || "",
            link: candidate.link || source.url,
            foundAt: nowIso
          });
        }
      } catch (err) {
        watchErrors += 1;
        errors.push({
          watchId: watch.id,
          watchName: watch.name,
          sourceName: source.name || source.id || source.url,
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }

    if (itemsForWatch.length > 0) {
      newItemsByWatch.push({
        watchId: watch.id,
        watchName: watch.name,
        items: itemsForWatch
      });
    }

    watchStats.push({
      watchId: watch.id,
      watchName: watch.name,
      query: watch.query || "",
      keywords: watch.keywords || [],
      excludeKeywords: watch.excludeKeywords || [],
      sourcesChecked: watchSources.length,
      newItems: itemsForWatch.length,
      found: itemsForWatch.length > 0,
      errorCount: watchErrors
    });
  }

  const results = {
    runAt: nowIso,
    summary: {
      totalWatches: (config.watches || []).length,
      totalSources,
      totalNewItems: newItemsByWatch.reduce((sum, g) => sum + g.items.length, 0),
      errorCount: errors.length
    },
    newItemsByWatch,
    errors
  };

  const nextRuns = [
    {
      runAt: nowIso,
      summary: results.summary,
      watchStats
    },
    ...(runHistory.runs || [])
  ].slice(0, 200);

  const prunedSeen = pruneSeen(seen);
  await writeJson(STATE_PATH, { updatedAt: nowIso, seen: prunedSeen });
  await writeJson(RESULTS_PATH, results);
  await writeJson(RUN_HISTORY_PATH, { runs: nextRuns });
  await fs.writeFile(REPORT_PATH, buildReport(results), "utf8");
  try {
    await sendDiscordNotification(results);
  } catch (err) {
    console.error("Discord notification failed:", err);
  }
  try {
    await sendEmailNotification(config, results);
  } catch (err) {
    console.error("Email notification failed:", err);
  }

  console.log(
    `Done. New items: ${results.summary.totalNewItems}, errors: ${results.summary.errorCount}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

