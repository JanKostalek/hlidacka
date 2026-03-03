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
const FOUND_HISTORY_PATH = path.join(ROOT, "data", "found-history.json");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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

function buildSbazarSearchUrl(query) {
  return `https://www.sbazar.cz/hledej/${encodeURIComponent(
    String(query || "").toLowerCase().trim()
  )}`;
}

function formatSbazarPrice(item) {
  if (!item || item.price_by_agreement) return "";
  if (typeof item.price !== "number" || !Number.isFinite(item.price)) return "";
  return `${new Intl.NumberFormat("cs-CZ").format(item.price)} Kč`;
}

function mapSbazarItemToCandidate(item) {
  const title = normalizeWhitespace(item?.name || "");
  const seoName = String(item?.seo_name || item?.id || "").trim();
  const link = seoName ? `https://www.sbazar.cz/inzerat/${seoName}` : "";
  const price = formatSbazarPrice(item);
  return { title, link, price };
}

async function fetchSbazarItems(query, limit = 80) {
  const phrase = String(query || "").trim();
  const url = new URL("https://www.sbazar.cz/api/v1/items/search");
  url.searchParams.set("phrase", phrase);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", "0");

  const res = await fetch(url.toString(), {
    headers: {
      ...buildRequestHeaders(url.toString()),
      accept: "application/json"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} (${url.toString()})`);
  }

  const payload = await res.json();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map(mapSbazarItemToCandidate).filter((item) => item.title || item.link);
}

function normalizeSourceForRuntime(source, watch) {
  if (!source || source.id !== "sbazar") return source;

  return {
    ...source,
    // Keep search URL for display/debug, but runtime fetch uses Sbazar JSON API.
    url: buildSbazarSearchUrl(watch?.query || ""),
    itemSelector: "",
    titleSelector: "",
    linkSelector: "",
    priceSelector: ""
  };
}

function makeKey(sourceId, link, title) {
  return `${sourceId}|${link || title.toLowerCase()}`;
}

function includesKeywords(text, required = [], excluded = []) {
  const haystack = normalizeForMatch(text);
  const hasRequired =
    required.length === 0 ||
    required.every((kw) => haystack.includes(normalizeForMatch(kw)));
  const hasExcluded = excluded.some((kw) => haystack.includes(normalizeForMatch(kw)));
  return hasRequired && !hasExcluded;
}

function normalizeForMatch(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  let usedCardExtraction = false;

  if (source.itemSelector) {
    $(source.itemSelector).each((_, card) => {
      const item = extractFromCard($, card, source, sourceUrl);
      if (item.title || item.link) {
        usedCardExtraction = true;
        items.push(item);
      }
    });
  } else {
    $("a[href]").each((_, el) => {
      const title = normalizeWhitespace($(el).text());
      const link = normalizeLink($(el).attr("href"), sourceUrl);
      if (title.length < 8 || !link) return;
      items.push({ title, link, price: "" });
    });
  }

  // Fallback if marketplace selector changed and no cards were extracted.
  if (source.itemSelector && !usedCardExtraction) {
    if (source.id === "sbazar") {
      return [];
    }
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRequestHeaders(url) {
  const u = new URL(url);
  const isSbazar = u.hostname.includes("sbazar.cz");
  return {
    "user-agent": USER_AGENT,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "cs-CZ,cs;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    pragma: "no-cache",
    referer: `${u.protocol}//${u.hostname}/`,
    ...(isSbazar
      ? {
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
          "upgrade-insecure-requests": "1"
        }
      : {})
  };
}

function describeFetchError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const causeCode = err?.cause?.code ? ` | cause: ${err.cause.code}` : "";
  return `${message}${causeCode}`;
}

async function fetchHtml(url) {
  const attempts = [0, 1000, 2500];
  const urlsToTry = [url];
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("sbazar.cz") && parsed.pathname.startsWith("/hledej/")) {
      const rawQuery = decodeURIComponent(parsed.pathname.replace(/^\/hledej\//, ""));
      urlsToTry.push(
        `${parsed.protocol}//${parsed.host}/hledej/${encodeURIComponent(rawQuery.toLowerCase())}`
      );
      urlsToTry.push(`${parsed.protocol}//${parsed.host}/?q=${encodeURIComponent(rawQuery)}`);
    } else if (parsed.hostname.includes("sbazar.cz") && parsed.searchParams.get("q")) {
      const rawQuery = parsed.searchParams.get("q") || "";
      urlsToTry.push(
        `${parsed.protocol}//${parsed.host}/hledej/${encodeURIComponent(rawQuery.toLowerCase())}`
      );
    }
  } catch {
    // Keep the original URL only.
  }
  const uniqueUrlsToTry = Array.from(new Set(urlsToTry));

  let lastErr = null;

  for (const candidateUrl of uniqueUrlsToTry) {
    for (let i = 0; i < attempts.length; i++) {
      if (attempts[i] > 0) {
        await wait(attempts[i]);
      }

      try {
        const res = await fetch(candidateUrl, {
          headers: buildRequestHeaders(candidateUrl),
          redirect: "follow",
          signal: AbortSignal.timeout(20000)
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} (${candidateUrl})`);
        }

        return await res.text();
      } catch (err) {
        lastErr = err;
      }
    }
  }

  throw new Error(`Fetch failed (${url}): ${describeFetchError(lastErr)}`);
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

function updateFoundHistory(existing, newItemsByWatch, runAt, maxPerWatch = 60) {
  const nextByWatch = {};
  const currentByWatch = existing?.byWatch || {};

  for (const [watchId, items] of Object.entries(currentByWatch)) {
    nextByWatch[watchId] = Array.isArray(items) ? [...items] : [];
  }

  for (const group of newItemsByWatch || []) {
    const watchId = group.watchId;
    const merged = nextByWatch[watchId] || [];

    for (const item of group.items || []) {
      if (!merged.some((entry) => entry.link === item.link)) {
        merged.unshift({
          watchId: item.watchId,
          watchName: item.watchName,
          sourceName: item.sourceName,
          title: item.title,
          price: item.price,
          link: item.link,
          firstSeenAt: runAt
        });
      }
    }
    nextByWatch[watchId] = merged.slice(0, maxPerWatch);
  }

  return {
    updatedAt: runAt,
    byWatch: nextByWatch
  };
}

function getAlreadyDisplayedByWatch(foundHistory, newItemsByWatch) {
  const newLinksByWatch = new Map(
    (newItemsByWatch || []).map((group) => [
      group.watchId,
      new Set((group.items || []).map((item) => item.link))
    ])
  );

  const output = {};
  for (const [watchId, items] of Object.entries(foundHistory?.byWatch || {})) {
    const newLinks = newLinksByWatch.get(watchId) || new Set();
    output[watchId] = (items || []).filter((item) => !newLinks.has(item.link));
  }
  return output;
}

function getAlreadyDisplayedByWatchWithFilters(foundHistory, newItemsByWatch, watches = []) {
  const base = getAlreadyDisplayedByWatch(foundHistory, newItemsByWatch);
  const watchById = new Map((watches || []).map((watch) => [watch.id, watch]));

  const filtered = {};
  for (const [watchId, items] of Object.entries(base)) {
    const watch = watchById.get(watchId);
    if (!watch) {
      filtered[watchId] = items;
      continue;
    }

    filtered[watchId] = (items || []).filter((item) =>
      includesKeywords(
        `${item.title || ""} ${item.price || ""}`,
        watch.keywords || [],
        watch.excludeKeywords || []
      )
    );
  }
  return filtered;
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

function buildEmailText(config, results, alreadyDisplayedByWatch = {}) {
  const watches = config.watches || [];
  const newItemsByWatchId = new Map(
    (results.newItemsByWatch || []).map((group) => [group.watchId, group.items.length])
  );

  const lines = [];
  lines.push(`Hlidacka bazaru - Výsledek vyhledávání`);
  lines.push(`Čas vyhledávání: ${results.runAt}`);
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
    const shownCount = (alreadyDisplayedByWatch[watch.id] || []).length;

    lines.push(`- ${watch.name || watch.id}`);
    lines.push(`  co hledat: ${watch.query || "(prazdne)"}`);
    lines.push(`  klicova slova: ${keywords}`);
    lines.push(`  vyloucit slova: ${excluded}`);
    lines.push(`  bazary: ${sourceList}`);
    lines.push(`  vysledek: nove ${newCount}, jiz zobrazene ${shownCount}, chyby ${errCount}`);
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

  lines.push("Jiz zobrazene inzeraty:");
  lines.push("");
  for (const watch of watches) {
    const shown = alreadyDisplayedByWatch[watch.id] || [];
    lines.push(`${watch.name || watch.id} (${shown.length})`);
    if (shown.length === 0) {
      lines.push("- zadne");
    } else {
      for (const item of shown) {
        const pricePart = item.price ? ` | ${item.price}` : "";
        lines.push(`- ${item.title}${pricePart} | ${item.sourceName}`);
        lines.push(`  ${item.link}`);
      }
    }
    lines.push("");
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

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHtml(config, results, alreadyDisplayedByWatch = {}) {
  const watches = config.watches || [];
  const newItemsByWatchId = new Map(
    (results.newItemsByWatch || []).map((group) => [group.watchId, group.items || []])
  );

  const watchCards = watches
    .map((watch) => {
      const sources = Array.from(
        new Set((watch.sources || []).map((source) => source.name || source.id).filter(Boolean))
      );
      const errorsForWatch = (results.errors || []).filter((err) => err.watchId === watch.id);
      const newItems = newItemsByWatchId.get(watch.id) || [];
      const keywords = (watch.keywords || []).join(", ") || "(zadna)";
      const excluded = (watch.excludeKeywords || []).join(", ") || "(zadna)";
      const sourceList = sources.join(", ") || "(zadny)";
      const shownItems = alreadyDisplayedByWatch[watch.id] || [];
      const shownCount = shownItems.length;

      const itemList =
        newItems.length === 0
          ? `<div style="color:#5c748e;font-size:13px;">Zadne nove inzeraty pro tento dotaz.</div>`
          : `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;">${newItems
              .map((item) => {
                const pricePart = item.price ? ` | ${escapeHtml(item.price)}` : "";
                return `<li style="margin:4px 0;"><a style="color:#0f6bcf;text-decoration:none;" href="${escapeHtml(item.link)}">${escapeHtml(
                  item.title
                )}</a><span style="color:#5c748e;font-size:13px;"> (${escapeHtml(item.sourceName)}${pricePart})</span></li>`;
              })
              .join("")}</ul>`;

      const errorList =
        errorsForWatch.length === 0
          ? `<div style="color:#5c748e;font-size:13px;">Bez chyb.</div>`
          : `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;">${errorsForWatch
              .map(
                (err) =>
                  `<li style="margin:4px 0;">${escapeHtml(err.sourceName)}: ${escapeHtml(err.message)}</li>`
              )
              .join("")}</ul>`;
      const shownList =
        shownItems.length === 0
          ? `<div style="color:#5c748e;font-size:13px;">Zadne drive zobrazene inzeraty.</div>`
          : `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;">${shownItems
              .map((item) => {
                const pricePart = item.price ? ` | ${escapeHtml(item.price)}` : "";
                return `<li style="margin:4px 0;"><a style="color:#0f6bcf;text-decoration:none;" href="${escapeHtml(item.link)}">${escapeHtml(
                  item.title
                )}</a><span style="color:#5c748e;font-size:13px;"> (${escapeHtml(item.sourceName)}${pricePart})</span></li>`;
              })
              .join("")}</ul>`;

      return `
        <section style="background:#ffffff;border:1px solid #dbe5f0;border-radius:14px;padding:14px;margin-bottom:14px;box-shadow:0 4px 14px rgba(16,32,51,0.04);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
            <h3>${escapeHtml(watch.name || watch.id)}</h3>
          </div>

          <div style="background:#f9fcff;border:1px solid #e2edf8;border-radius:10px;padding:10px;margin-top:10px;">
            <h4>Vyhledavani</h4>
            <div style="font-size:13px;margin:3px 0;"><b>Co hledat:</b> ${escapeHtml(watch.query || "(prazdne)")}</div>
            <div style="font-size:13px;margin:3px 0;"><b>Klicova slova:</b> ${escapeHtml(keywords)}</div>
            <div style="font-size:13px;margin:3px 0;"><b>Vyloucit slova:</b> ${escapeHtml(excluded)}</div>
            <div style="font-size:13px;margin:3px 0;"><b>Bazary:</b> ${escapeHtml(sourceList)}</div>
            <div style="font-size:13px;margin:3px 0;"><b>Vysledek:</b> nove ${newItems.length}, jiz zobrazene ${shownCount}, chyby ${errorsForWatch.length}</div>
          </div>

          <div style="background:#f9fcff;border:1px solid #e2edf8;border-radius:10px;padding:10px;margin-top:10px;">
            <h4>Nove inzeraty</h4>
            ${itemList}
          </div>

          <div style="background:#f9fcff;border:1px solid #e2edf8;border-radius:10px;padding:10px;margin-top:10px;">
            <h4>Jiz zobrazene inzeraty</h4>
            ${shownList}
          </div>

          <div style="background:#f9fcff;border:1px solid #e2edf8;border-radius:10px;padding:10px;margin-top:10px;">
            <h4>Chyby</h4>
            ${errorList}
          </div>
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef2f7;font-family:Segoe UI,Arial,sans-serif;color:#102033;">
    <div style="max-width:760px;margin:0 auto;padding:20px 12px;">
      <div style="background:linear-gradient(120deg,#0f6bcf,#0ea5a8);color:white;border-radius:14px;padding:20px 18px;">
        <div style="font-size:13px;opacity:.9;margin-bottom:6px;">Hlidacka bazaru</div>
        <div style="font-size:24px;font-weight:700;line-height:1.2;">Výsledek vyhledávání</div>
        <div style="margin-top:10px;font-size:14px;opacity:.95;">Čas vyhledávání: ${escapeHtml(
          results.runAt
        )}</div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
        <div style="background:white;border:1px solid #dbe5f0;border-radius:12px;padding:12px 14px;min-width:120px;">
          <div style="font-size:12px;color:#49627c;">Nove inzeraty</div>
          <div style="font-size:22px;font-weight:700;">${results.summary.totalNewItems}</div>
        </div>
        <div style="background:white;border:1px solid #dbe5f0;border-radius:12px;padding:12px 14px;min-width:120px;">
          <div style="font-size:12px;color:#49627c;">Chyby</div>
          <div style="font-size:22px;font-weight:700;">${results.summary.errorCount}</div>
        </div>
        <div style="background:white;border:1px solid #dbe5f0;border-radius:12px;padding:12px 14px;min-width:120px;">
          <div style="font-size:12px;color:#49627c;">Dotazy</div>
          <div style="font-size:22px;font-weight:700;">${results.summary.totalWatches}</div>
        </div>
      </div>

      <div style="margin-top:12px;">
        ${watchCards || '<div style="background:white;border:1px solid #dbe5f0;border-radius:12px;padding:14px;">Zadne aktivni dotazy.</div>'}
      </div>
    </div>
  </body>
</html>`;
}

async function sendEmailNotification(config, results, alreadyDisplayedByWatch) {
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
    text: buildEmailText(config, results, alreadyDisplayedByWatch),
    html: buildEmailHtml(config, results, alreadyDisplayedByWatch)
  });
  console.log("Email notification sent.");
}

async function main() {
  await ensureDir(path.join(ROOT, "data"));
  const config = await readJson(CONFIG_PATH, { watches: [] });
  const state = await readJson(STATE_PATH, { seen: {} });
  const runHistory = await readJson(RUN_HISTORY_PATH, { runs: [] });
  const foundHistory = await readJson(FOUND_HISTORY_PATH, { byWatch: {} });
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
      const sourceForRun = normalizeSourceForRuntime(source, watch);
      totalSources += 1;
      try {
        const extracted =
          sourceForRun.id === "sbazar"
            ? await fetchSbazarItems(watch.query || "")
            : extractItemsFromPage(await fetchHtml(sourceForRun.url), sourceForRun);

        let matchedForSource = 0;
        for (const candidate of extracted) {
          // Match only human-readable content; URL IDs were causing false positives.
          const text = `${candidate.title} ${candidate.price}`;
          if (
            !includesKeywords(text, watch.keywords || [], watch.excludeKeywords || [])
          ) {
            continue;
          }
          matchedForSource += 1;

          const key = makeKey(
            `${watch.id}|${sourceForRun.id || sourceForRun.name || sourceForRun.url}`,
            candidate.link,
            candidate.title
          );
          if (seen[key]) continue;

          seen[key] = nowIso;
          itemsForWatch.push({
            watchId: watch.id,
            watchName: watch.name,
            sourceId: sourceForRun.id || sourceForRun.url,
            sourceName: sourceForRun.name || sourceForRun.id || sourceForRun.url,
            title: candidate.title || "(bez nazvu)",
            price: candidate.price || "",
            link: candidate.link || sourceForRun.url,
            foundAt: nowIso
          });
        }
      } catch (err) {
        watchErrors += 1;
        errors.push({
          watchId: watch.id,
          watchName: watch.name,
          sourceName: sourceForRun.name || sourceForRun.id || sourceForRun.url,
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

  const filteredAlreadyDisplayedByWatch = getAlreadyDisplayedByWatchWithFilters(
    foundHistory,
    results.newItemsByWatch,
    config.watches || []
  );
  const emailTextForRun = buildEmailText(config, results, filteredAlreadyDisplayedByWatch);
  const emailSubjectForRun = buildEmailSubject(config, results);
  const nextFoundHistory = updateFoundHistory(
    foundHistory,
    results.newItemsByWatch,
    nowIso
  );

  const nextRuns = [
    {
      runAt: nowIso,
      summary: results.summary,
      watchStats,
      emailSubject: emailSubjectForRun,
      emailText: emailTextForRun
    },
    ...(runHistory.runs || [])
  ].slice(0, 200);

  const prunedSeen = pruneSeen(seen);
  await writeJson(STATE_PATH, { updatedAt: nowIso, seen: prunedSeen });
  await writeJson(RESULTS_PATH, results);
  await writeJson(RUN_HISTORY_PATH, { runs: nextRuns });
  await writeJson(FOUND_HISTORY_PATH, nextFoundHistory);
  await fs.writeFile(REPORT_PATH, buildReport(results), "utf8");
  try {
    await sendDiscordNotification(results);
  } catch (err) {
    console.error("Discord notification failed:", err);
  }
  try {
    await sendEmailNotification(config, results, filteredAlreadyDisplayedByWatch);
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

