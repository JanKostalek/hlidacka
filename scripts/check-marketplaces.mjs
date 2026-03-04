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

function formatPriceCzk(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return `${new Intl.NumberFormat("cs-CZ").format(Math.round(value))} Kč`;
}

function extractPriceFromText(input) {
  const text = normalizeWhitespace(String(input || "").replace(/\u00a0/g, " "));
  if (!text) return "";

  const normalized = normalizeForMatch(text);
  if (
    normalized.includes("dohodou") ||
    normalized.includes("na dotaz") ||
    normalized.includes("nabidnete")
  ) {
    return "";
  }

  const match = text.match(/(\d{1,3}(?:[ .]\d{3})+|\d{3,})\s*(kč|kc|czk)\b/i);
  if (!match) return "";

  const digits = match[1].replace(/[^\d]/g, "");
  if (!digits) return "";

  const amount = Number.parseInt(digits, 10);
  return Number.isFinite(amount) ? formatPriceCzk(amount) : "";
}

function formatSbazarPrice(item) {
  if (!item || item.price_by_agreement) return "";

  const numericCandidates = [
    item.price,
    item.price_czk,
    item.price_amount,
    item?.price?.amount
  ];

  for (const candidate of numericCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return formatPriceCzk(candidate);
    }
    if (typeof candidate === "string" && /^\d+(?:[.,]\d+)?$/.test(candidate.trim())) {
      const asNumber = Number(candidate.replace(",", "."));
      if (Number.isFinite(asNumber)) return formatPriceCzk(asNumber);
    }
  }

  const textCandidates = [item.price_text, item.price_label, item.price_display];
  for (const candidate of textCandidates) {
    const parsed = extractPriceFromText(candidate);
    if (parsed) return parsed;
  }

  return "";
}

function mapSbazarItemToCandidate(item) {
  const title = normalizeWhitespace(item?.name || "");
  const seoName = String(item?.seo_name || item?.id || "").trim();
  const link = seoName ? `https://www.sbazar.cz/inzerat/${seoName}` : "";
  const price = formatSbazarPrice(item);
  const matchText = `${title} ${price}`;
  return { title, link, price, matchText };
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
  const priceFromSelector = priceSelector
    ? normalizeWhitespace($card.find(priceSelector).first().text())
    : "";
  const matchText = normalizeWhitespace($card.text());
  const price = extractPriceFromText(priceFromSelector) || extractPriceFromText(matchText);

  return { title, link, price, matchText };
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
      const containerText = normalizeWhitespace(
        $(el)
          .closest("article, li, tr, .inzeraty, .inzeratyflex, .item, .advert")
          .first()
          .text()
      );
      const matchText = containerText || title;
      const price = extractPriceFromText(matchText);
      items.push({ title, link, price, matchText });
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
      const containerText = normalizeWhitespace(
        $(el)
          .closest("article, li, tr, .inzeraty, .inzeratyflex, .item, .advert")
          .first()
          .text()
      );
      const matchText = containerText || title;
      const price = extractPriceFromText(matchText);
      items.push({ title, link, price, matchText });
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
    } else if (parsed.hostname.includes("paladix.cz") && parsed.pathname.startsWith("/bazar")) {
      const base = `${parsed.protocol}//${parsed.host}`;
      const phrase = parsed.searchParams.get("s") || parsed.searchParams.get("_sf_search[]") || "";

      // Stable fallback for cases where filtered URL returns HTTP 500.
      urlsToTry.push(`${base}/bazar/`);
      urlsToTry.push(`${base}/bazar`);

      if (phrase) {
        const paramsS = new URLSearchParams();
        paramsS.set("s", phrase);
        urlsToTry.push(`${base}/bazar/?${paramsS.toString()}`);

        const paramsSf = new URLSearchParams();
        paramsSf.set("_sf_search[]", phrase);
        urlsToTry.push(`${base}/bazar/?${paramsSf.toString()}`);
      }
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
  lines.push(`# Hlídačka bazarů - ${results.runAt}`);
  lines.push("");
  lines.push(`- Kontrolováno dotazů: **${results.summary.totalWatches}**`);
  lines.push(`- Kontrolováno zdrojů: **${results.summary.totalSources}**`);
  lines.push(`- Nalezeno nových inzerátů: **${results.summary.totalNewItems}**`);
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

async function sendDiscordNotification(config, results) {
  const webhook = config.notifications?.discordWebhook || process.env.DISCORD_WEBHOOK_URL;
  const enabled =
    typeof config.notifications?.discordEnabled === "boolean"
      ? config.notifications.discordEnabled
      : String(process.env.DISCORD_ENABLED || "true") !== "false";
  const discordOnlyWhenNew =
    typeof config.notifications?.discordOnlyWhenNew === "boolean"
      ? config.notifications.discordOnlyWhenNew
      : String(process.env.DISCORD_ONLY_WHEN_NEW || "true") === "true";

  if (!enabled) {
    console.log("Discord notification skipped: disabled by configuration.");
    return;
  }
  if (!webhook) {
    console.log("Discord notification skipped: DISCORD_WEBHOOK_URL is empty");
    return;
  }
  if (discordOnlyWhenNew && results.summary.totalNewItems === 0) {
    console.log(
      "Discord notification skipped: configured to send only when new listings are found."
    );
    return;
  }

  const entries = results.newItemsByWatch.flatMap((g) =>
    g.items.map((item) => {
      const pricePart = item.price ? ` | ${item.price}` : "";
      return `* ${item.title} (${item.sourceName}${pricePart})\n${item.link}`;
    })
  );

  if (entries.length === 0) {
    const lines = [
      "Kontrola dokončena: žádné nové inzeráty.",
      `Dotazy: ${results.summary.totalWatches} | Zdroje: ${results.summary.totalSources} | Chyby: ${results.summary.errorCount}`,
      `Čas: ${results.runAt}`
    ];
    if (Array.isArray(results.errors) && results.errors.length > 0) {
      lines.push("");
      lines.push("Chyby:");
      for (const err of results.errors.slice(0, 5)) {
        lines.push(`- ${err.watchName} / ${err.sourceName}: ${err.message}`);
      }
      if (results.errors.length > 5) {
        lines.push(`- ... a dalších ${results.errors.length - 5}`);
      }
    }

    console.log("Sending Discord notification...");
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: lines.join("\n") })
    });
    console.log("Discord notification sent.");
    return;
  }

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

  console.log("Sending Discord notification...");
  for (let i = 0; i < chunks.length; i++) {
    const payload = {
      content:
        i === 0
          ? `Nové inzeráty (${results.summary.totalNewItems})\n${chunks[i]}`
          : chunks[i]
    };
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
  console.log("Discord notification sent.");
}

function buildEmailText(config, results, alreadyDisplayedByWatch = {}) {
  const watches = config.watches || [];
  const newItemsByWatchId = new Map(
    (results.newItemsByWatch || []).map((group) => [group.watchId, group.items.length])
  );

  const lines = [];
  lines.push(`Hlídačka bazarů - Výsledek vyhledávání`);
  lines.push(`Čas vyhledávání: ${results.runAt}`);
  lines.push(`Nové inzeráty: ${results.summary.totalNewItems}`);
  lines.push(`Chyby: ${results.summary.errorCount}`);
  lines.push("");
  lines.push("Aktivní dotazy:");
  lines.push("");

  for (const watch of watches) {
    const sources = Array.from(
      new Set((watch.sources || []).map((source) => source.name || source.id).filter(Boolean))
    );
    const errCount = (results.errors || []).filter((err) => err.watchId === watch.id).length;
    const newCount = newItemsByWatchId.get(watch.id) || 0;
    const keywords = (watch.keywords || []).join(", ") || "(žádná)";
    const excluded = (watch.excludeKeywords || []).join(", ") || "(žádná)";
    const sourceList = sources.join(", ") || "(žádný)";
    const shownCount = (alreadyDisplayedByWatch[watch.id] || []).length;

    lines.push(`- ${watch.name || watch.id}`);
    lines.push(`  co hledat: ${watch.query || "(prázdné)"}`);
    lines.push(`  klíčová slova: ${keywords}`);
    lines.push(`  vyloučit slova: ${excluded}`);
    lines.push(`  bazary: ${sourceList}`);
    lines.push(`  výsledek: nové ${newCount}, již zobrazené ${shownCount}, chyby ${errCount}`);
    lines.push("");
  }

  if (watches.length === 0) {
    lines.push("(žádné dotazy)");
    lines.push("");
  }

  if (results.summary.totalNewItems === 0) {
    lines.push("Žádné nové inzeráty.");
    lines.push("");
  } else {
    lines.push("Nové inzeráty:");
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

  lines.push("Již zobrazené inzeráty:");
  lines.push("");
  for (const watch of watches) {
    const shown = alreadyDisplayedByWatch[watch.id] || [];
    lines.push(`${watch.name || watch.id} (${shown.length})`);
    if (shown.length === 0) {
      lines.push("- žádné");
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
    lines.push("Chyby: žádné");
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
    ? `Hlídačka (${scope}): ${results.summary.totalNewItems} nových inzerátů`
    : `Hlídačka (${scope}): žádné nové inzeráty`;
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
      const keywords = (watch.keywords || []).join(', ') || '(žádná)';
      const excluded = (watch.excludeKeywords || []).join(', ') || '(žádná)';
      const sourceList = sources.join(', ') || '(žádný)';
      const shownItems = alreadyDisplayedByWatch[watch.id] || [];
      const shownCount = shownItems.length;

      const itemList =
        newItems.length === 0
          ? `<div style="color:#607089;font-size:13px;">Žádné nové inzeráty pro tento dotaz.</div>`
          : `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.45;">${newItems
              .map((item) => {
                const pricePart = item.price ? ` | ${escapeHtml(item.price)}` : '';
                return `<li style="margin:5px 0;"><a style="color:#1f4de1;text-decoration:none;" href="${escapeHtml(item.link)}">${escapeHtml(
                  item.title
                )}</a><span style="color:#607089;font-size:13px;"> (${escapeHtml(item.sourceName)}${pricePart})</span></li>`;
              })
              .join('')}</ul>`;

      const errorList =
        errorsForWatch.length === 0
          ? `<div style="color:#607089;font-size:13px;">Bez chyb.</div>`
          : `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.45;">${errorsForWatch
              .map(
                (err) =>
                  `<li style="margin:5px 0;">${escapeHtml(err.sourceName)}: ${escapeHtml(err.message)}</li>`
              )
              .join('')}</ul>`;

      const shownList =
        shownItems.length === 0
          ? `<div style="color:#607089;font-size:13px;">Žádné dříve zobrazené inzeráty.</div>`
          : `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.45;">${shownItems
              .map((item) => {
                const pricePart = item.price ? ` | ${escapeHtml(item.price)}` : '';
                return `<li style="margin:5px 0;"><a style="color:#1f4de1;text-decoration:none;" href="${escapeHtml(item.link)}">${escapeHtml(
                  item.title
                )}</a><span style="color:#607089;font-size:13px;"> (${escapeHtml(item.sourceName)}${pricePart})</span></li>`;
              })
              .join('')}</ul>`;

      return `
        <section style="background:linear-gradient(165deg,rgba(255,255,255,0.97),rgba(246,251,255,0.97));border:1px solid #d4dfee;border-radius:16px;padding:15px;margin-bottom:14px;box-shadow:0 10px 24px rgba(15,23,42,0.08);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
            <h3 style="margin:0;font-size:19px;line-height:1.2;color:#0f172a;">${escapeHtml(watch.name || watch.id)}</h3>
          </div>

          <div style="background:#f7fbff;border:1px solid #dbe7f6;border-radius:12px;padding:11px;margin-top:10px;">
            <h4 style="margin:0 0 7px;color:#1f3653;">Vyhledávání</h4>
            <div style="font-size:13px;margin:3px 0;"><b>Co hledat:</b> ${escapeHtml(watch.query || '(prázdné)')}</div>
            <div style="font-size:13px;margin:3px 0;"><b>Klíčová slova:</b> ${escapeHtml(keywords)}</div>
            <div style="font-size:13px;margin:3px 0;"><b>Vyloučit slova:</b> ${escapeHtml(excluded)}</div>
            <div style="font-size:13px;margin:3px 0;"><b>Bazary:</b> ${escapeHtml(sourceList)}</div>
            <div style="font-size:13px;margin:3px 0;"><b>Výsledek:</b> nové ${newItems.length}, již zobrazené ${shownCount}, chyby ${errorsForWatch.length}</div>
          </div>

          <div style="background:#f7fbff;border:1px solid #dbe7f6;border-radius:12px;padding:11px;margin-top:10px;">
            <h4 style="margin:0 0 7px;color:#1f3653;">Nové inzeráty</h4>
            ${itemList}
          </div>

          <div style="background:#f7fbff;border:1px solid #dbe7f6;border-radius:12px;padding:11px;margin-top:10px;">
            <h4 style="margin:0 0 7px;color:#1f3653;">Již zobrazené inzeráty</h4>
            ${shownList}
          </div>

          <div style="background:#f7fbff;border:1px solid #dbe7f6;border-radius:12px;padding:11px;margin-top:10px;">
            <h4 style="margin:0 0 7px;color:#1f3653;">Chyby</h4>
            ${errorList}
          </div>
        </section>
      `;
    })
    .join('');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:radial-gradient(1200px 600px at 85% -10%,rgba(14,165,168,0.16) 0%,transparent 60%),radial-gradient(1000px 520px at -10% 5%,rgba(37,99,235,0.14) 0%,transparent 60%),linear-gradient(170deg,#f6fbff 0%,#e9f2ff 100%);font-family:'DM Sans','Segoe UI',Arial,sans-serif;color:#0f172a;">
    <div style="max-width:820px;margin:0 auto;padding:20px 12px;">
      <div style="background:linear-gradient(125deg,#2563eb,#2456dd 52%,#0ea5a8);color:white;border-radius:18px;padding:22px 19px;box-shadow:0 14px 32px rgba(37,99,235,0.28);">
        <div style="font-size:13px;opacity:.9;margin-bottom:7px;letter-spacing:.02em;">Hlídačka bazarů</div>
        <div style="font-size:30px;font-weight:700;line-height:1.15;letter-spacing:-0.02em;">Výsledek vyhledávání</div>
        <div style="margin-top:11px;font-size:14px;opacity:.95;">Čas vyhledávání: ${escapeHtml(results.runAt)}</div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
        <div style="background:linear-gradient(170deg,rgba(255,255,255,0.97),rgba(245,251,255,0.97));border:1px solid #d4dfee;border-radius:14px;padding:12px 14px;min-width:140px;box-shadow:0 8px 18px rgba(15,23,42,0.08);">
          <div style="font-size:12px;color:#607089;">Nové inzeráty</div>
          <div style="font-size:24px;font-weight:700;">${results.summary.totalNewItems}</div>
        </div>
        <div style="background:linear-gradient(170deg,rgba(255,255,255,0.97),rgba(245,251,255,0.97));border:1px solid #d4dfee;border-radius:14px;padding:12px 14px;min-width:140px;box-shadow:0 8px 18px rgba(15,23,42,0.08);">
          <div style="font-size:12px;color:#607089;">Celkem inzerátů</div>
          <div style="font-size:24px;font-weight:700;">${results.summary.totalFoundItems ?? results.summary.totalNewItems}</div>
        </div>
        <div style="background:linear-gradient(170deg,rgba(255,255,255,0.97),rgba(245,251,255,0.97));border:1px solid #d4dfee;border-radius:14px;padding:12px 14px;min-width:140px;box-shadow:0 8px 18px rgba(15,23,42,0.08);">
          <div style="font-size:12px;color:#607089;">Dotazy</div>
          <div style="font-size:24px;font-weight:700;">${results.summary.totalWatches}</div>
        </div>
      </div>

      <div style="margin-top:12px;">
        ${watchCards || '<div style="background:linear-gradient(170deg,rgba(255,255,255,0.97),rgba(245,251,255,0.97));border:1px solid #d4dfee;border-radius:14px;padding:14px;">Žádné aktivní dotazy.</div>'}
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
  const enabled =
    typeof config.notifications?.emailEnabled === "boolean"
      ? config.notifications.emailEnabled
      : String(process.env.EMAIL_ENABLED || "true") !== "false";
  const emailOnlyWhenNew =
    typeof config.notifications?.emailOnlyWhenNew === "boolean"
      ? config.notifications.emailOnlyWhenNew
      : String(process.env.EMAIL_ONLY_WHEN_NEW || "false") === "true";

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
  if (emailOnlyWhenNew && results.summary.totalNewItems === 0) {
    console.log(
      "Email notification skipped: configured to send only when new listings are found."
    );
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
  let totalFoundItems = 0;
  const watchStats = [];

  for (const watch of config.watches || []) {
    const itemsForWatch = [];
    const watchSources = watch.sources || [];
    let watchErrors = 0;
    let foundItemsForWatch = 0;

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
          const text = candidate.matchText || `${candidate.title} ${candidate.price}`;
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
            title: candidate.title || "(bez názvu)",
            price: candidate.price || "",
            link: candidate.link || sourceForRun.url,
            foundAt: nowIso
          });
        }
        foundItemsForWatch += matchedForSource;
        totalFoundItems += matchedForSource;
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
      foundItems: foundItemsForWatch,
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
      totalFoundItems,
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
  ].slice(0, 20);

  const prunedSeen = pruneSeen(seen);
  await writeJson(STATE_PATH, { updatedAt: nowIso, seen: prunedSeen });
  await writeJson(RESULTS_PATH, results);
  await writeJson(RUN_HISTORY_PATH, { runs: nextRuns });
  await writeJson(FOUND_HISTORY_PATH, nextFoundHistory);
  await fs.writeFile(REPORT_PATH, buildReport(results), "utf8");
  try {
    await sendDiscordNotification(config, results);
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




