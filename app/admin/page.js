"use client";

import { useEffect, useState } from "react";

const PRICE_SLIDER_MAX = 50000;
const PRICE_SLIDER_STEP = 10;

function emptyWatch() {
  return {
    id: "",
    name: "",
    query: "",
    keywordsCsv: "",
    excludeKeywordsCsv: "",
    usePriceFilter: false,
    priceMin: 0,
    priceMax: PRICE_SLIDER_MAX,
    marketplaces: []
  };
}

function modeFromFlags(enabled, onlyWhenNew) {
  if (!enabled) return "off";
  return onlyWhenNew ? "new" : "always";
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [watches, setWatches] = useState([]);
  const [watchValidationErrors, setWatchValidationErrors] = useState({});
  const [marketplaces, setMarketplaces] = useState([]);
  const [notificationEmail, setNotificationEmail] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [emailOnlyWhenNew, setEmailOnlyWhenNew] = useState(false);
  const [notificationDiscordWebhook, setNotificationDiscordWebhook] = useState("");
  const [discordEnabled, setDiscordEnabled] = useState(true);
  const [discordOnlyWhenNew, setDiscordOnlyWhenNew] = useState(true);
  const [scheduleStartHour, setScheduleStartHour] = useState(0);
  const [scheduleIntervalHours, setScheduleIntervalHours] = useState(2);
  const [uiTheme, setUiTheme] = useState("glass-dark");
  const [uiThemes, setUiThemes] = useState(["glass-dark", "glass-light", "classic"]);
  const [status, setStatus] = useState("Načítání...");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [runningNow, setRunningNow] = useState(false);

  useEffect(() => {
    const localToken = window.localStorage.getItem("adminToken") || "";
    if (localToken) setToken(localToken);
  }, []);

  async function loadConfig(currentToken = token) {
    setStatus("Načítání...");
    const res = await fetch("/api/config", {
      headers: currentToken ? { "x-admin-token": currentToken } : {}
    });

    if (res.status === 401) {
      setStatus("Neplatný token. Zadej ADMIN_TOKEN.");
      return;
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setStatus(`Nepodařilo se načíst konfiguraci. ${error.error || ""}`.trim());
      return;
    }

    const data = await res.json();
    setWatches(data.watches || []);
    setWatchValidationErrors({});
    setMarketplaces(data.marketplaces || []);
    setNotificationEmail(data.notificationEmail || "");
    setEmailEnabled(Boolean(data.emailEnabled));
    setEmailOnlyWhenNew(Boolean(data.emailOnlyWhenNew));
    setNotificationDiscordWebhook(data.notificationDiscordWebhook || "");
    setDiscordEnabled(Boolean(data.discordEnabled));
    setDiscordOnlyWhenNew(Boolean(data.discordOnlyWhenNew));
    setScheduleStartHour(Number.isInteger(data.schedule?.startHour) ? data.schedule.startHour : 0);
    setScheduleIntervalHours(
      Number.isInteger(data.schedule?.intervalHours) ? data.schedule.intervalHours : 2
    );
    setUiTheme(data.uiTheme || "glass-dark");
    setUiThemes(
      Array.isArray(data.uiThemes) && data.uiThemes.length > 0
        ? data.uiThemes
        : ["glass-dark", "glass-light", "classic"]
    );
    setStatus("Konfigurace načtena.");
  }

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateWatch(index, patch) {
    setWatches((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
    setWatchValidationErrors((prev) => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function toggleMarketplace(index, marketplaceId) {
    setWatches((prev) =>
      prev.map((watch, idx) => {
        if (idx !== index) return watch;
        const hasItem = watch.marketplaces.includes(marketplaceId);
        return {
          ...watch,
          marketplaces: hasItem
            ? watch.marketplaces.filter((item) => item !== marketplaceId)
            : [...watch.marketplaces, marketplaceId]
        };
      })
    );
    setWatchValidationErrors((prev) => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function validateWatchesForSave(currentWatches) {
    const errors = {};
    currentWatches.forEach((watch, index) => {
      if (!Array.isArray(watch.marketplaces) || watch.marketplaces.length === 0) {
        errors[index] = "Vyber aspoň jeden bazar (Sbazar nebo Bazoš).";
      }
    });
    return errors;
  }

  async function saveConfig() {
    const validationErrors = validateWatchesForSave(watches);
    setWatchValidationErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setStatus("Nelze uložit konfiguraci. U každého dotazu vyber aspoň jeden bazar.");
      return;
    }
    if (
      !Number.isInteger(scheduleStartHour) ||
      scheduleStartHour < 0 ||
      scheduleStartHour > 23
    ) {
      setStatus("Neplatná startovní hodina. Povolený rozsah je 0-23.");
      return;
    }
    if (
      !Number.isInteger(scheduleIntervalHours) ||
      scheduleIntervalHours < 2 ||
      scheduleIntervalHours > 24
    ) {
      setStatus("Neplatný interval opakování. Povolený rozsah je 2-24 hodin.");
      return;
    }

    setSaving(true);
    setStatus("Ukládám...");
    const headers = { "content-type": "application/json" };
    if (token) headers["x-admin-token"] = token;

    const res = await fetch("/api/config", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        watches,
        notificationEmail,
        emailEnabled,
        emailOnlyWhenNew,
        notificationDiscordWebhook,
        discordEnabled,
        discordOnlyWhenNew,
        schedule: {
          startHour: scheduleStartHour,
          intervalHours: scheduleIntervalHours
        },
        uiTheme
      })
    });

    if (res.status === 401) {
      setStatus("Neplatný token. Uložení zamítnuto.");
      setSaving(false);
      return;
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setStatus(`Nepodařilo se uložit konfiguraci. ${error.error || ""}`.trim());
      setSaving(false);
      return;
    }

    const data = await res.json();
    setWatches(data.watches || []);
    setWatchValidationErrors({});
    setNotificationEmail(data.notificationEmail || "");
    setEmailEnabled(Boolean(data.emailEnabled));
    setEmailOnlyWhenNew(Boolean(data.emailOnlyWhenNew));
    setNotificationDiscordWebhook(data.notificationDiscordWebhook || "");
    setDiscordEnabled(Boolean(data.discordEnabled));
    setDiscordOnlyWhenNew(Boolean(data.discordOnlyWhenNew));
    setScheduleStartHour(Number.isInteger(data.schedule?.startHour) ? data.schedule.startHour : 0);
    setScheduleIntervalHours(
      Number.isInteger(data.schedule?.intervalHours) ? data.schedule.intervalHours : 2
    );
    setUiTheme(data.uiTheme || "glass-dark");
    setUiThemes(
      Array.isArray(data.uiThemes) && data.uiThemes.length > 0
        ? data.uiThemes
        : ["glass-dark", "glass-light", "classic"]
    );
    setStatus("Uloženo.");
    setSaving(false);
  }

  async function runWorkflowNow() {
    setRunningNow(true);
    setStatus("Spouštím GitHub Actions běh...");

    const headers = { "content-type": "application/json" };
    if (token) headers["x-admin-token"] = token;

    const res = await fetch("/api/run", {
      method: "POST",
      headers
    });

    if (res.status === 401) {
      setStatus("Neplatný token. Spuštění zamítnuto.");
      setRunningNow(false);
      return;
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setStatus(`Nepodařilo se spustit workflow. ${error.error || ""}`.trim());
      setRunningNow(false);
      return;
    }

    setStatus("Workflow spuštěn. Výsledek sleduj v GitHub Actions.");
    setRunningNow(false);
  }

  async function clearHistory() {
    const confirmed = window.confirm(
      "Opravdu chceš vyčistit cache/historii? (běhy, již zobrazené inzeráty, stav)"
    );
    if (!confirmed) return;

    setClearing(true);
    setStatus("Čistím cache/historii...");
    const headers = { "content-type": "application/json" };
    if (token) headers["x-admin-token"] = token;

    const res = await fetch("/api/history", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "clear" })
    });

    if (res.status === 401) {
      setStatus("Neplatný token. Čištění zamítnuto.");
      setClearing(false);
      return;
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setStatus(`Nepodařilo se vyčistit cache/historii. ${error.error || ""}`.trim());
      setClearing(false);
      return;
    }

    setStatus("Cache/historie vyčištěna.");
    setClearing(false);
  }

  function formatPriceRangeLabel(min, max) {
    const safeMin = Math.min(PRICE_SLIDER_MAX, Math.max(0, Number(min) || 0));
    const safeMax = Math.min(
      PRICE_SLIDER_MAX,
      Math.max(safeMin, Number(max) || safeMin)
    );
    return `${new Intl.NumberFormat("cs-CZ").format(safeMin)} Kč - ${new Intl.NumberFormat("cs-CZ").format(safeMax)} Kč`;
  }

  function themeLabel(theme) {
    if (theme === "glass-dark") return "Sklo (Dark)";
    if (theme === "glass-light") return "Sklo (Light)";
    if (theme === "classic") return "Klasický";
    return theme;
  }

  function removeWatch(index) {
    setWatches((prev) => prev.filter((_, idx) => idx !== index));
    setWatchValidationErrors({});
  }

  function toggleEmailMode(mode) {
    const currentMode = modeFromFlags(emailEnabled, emailOnlyWhenNew);
    if (currentMode === mode) {
      setEmailEnabled(false);
      return;
    }
    setEmailEnabled(true);
    setEmailOnlyWhenNew(mode === "new");
  }

  function toggleDiscordMode(mode) {
    const currentMode = modeFromFlags(discordEnabled, discordOnlyWhenNew);
    if (currentMode === mode) {
      setDiscordEnabled(false);
      return;
    }
    setDiscordEnabled(true);
    setDiscordOnlyWhenNew(mode === "new");
  }

  const emailMode = modeFromFlags(emailEnabled, emailOnlyWhenNew);
  const discordMode = modeFromFlags(discordEnabled, discordOnlyWhenNew);
  const emailSummary =
    emailMode === "off"
      ? "E-mail: neodesílá se."
      : emailMode === "new"
        ? "E-mail: odesílá se jen při nových inzerátech."
        : "E-mail: odesílá se vždy.";
  const discordSummary =
    discordMode === "off"
      ? "Discord: neodesílá se."
      : discordMode === "new"
        ? "Discord: odesílá se jen při nových inzerátech."
        : "Discord: odesílá se vždy.";

  return (
    <main
      className={`page dashboardPage adminPage ${
        uiTheme === "classic"
          ? "themeClassic"
          : uiTheme === "glass-light"
            ? "themeGlassLight"
            : "themeGlass"
      }`}
    >
      <section className="panel dashboardPanel heroPanel adminHeroPanel">
        <h1>Administrace hlídačky</h1>
        <p>Vyber bazary, zadej co hledat a ulož konfiguraci.</p>
        <div className="heroMeta">
          <span className="heroChip">Dotazy: {watches.length}</span>
          <span className="heroChip">
            Tržiště: {marketplaces.length}
          </span>
        </div>
        <div className="adminRow adminRowToken">
          <label htmlFor="token">Admin token</label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(e) => {
              const next = e.target.value;
              setToken(next);
              window.localStorage.setItem("adminToken", next);
            }}
            placeholder="volitelně, pokud je nastaven ADMIN_TOKEN"
          />
          <button type="button" onClick={() => loadConfig(token)}>
            Načíst znovu
          </button>
        </div>
        <div className="adminRow adminRowEmail">
          <label htmlFor="email_to">Cílový e-mail</label>
          <input
            id="email_to"
            type="email"
            value={notificationEmail}
            onChange={(e) => setNotificationEmail(e.target.value)}
            placeholder="kam se posílají nálezy"
          />
          <span className="helpText">Použije se při dalším běhu workflow.</span>
        </div>
        <div className="adminRow adminRowEmail">
          <label htmlFor="discord_webhook">Discord webhook URL</label>
          <input
            id="discord_webhook"
            type="text"
            value={notificationDiscordWebhook}
            onChange={(e) => setNotificationDiscordWebhook(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
          />
          <span className="helpText">Použije se při dalším běhu workflow.</span>
        </div>
        <div className="adminRow adminRowEmail">
          <label htmlFor="email_only_when_new">Režim informačního e-mailu</label>
          <div className="emailModeOptions" role="group" aria-label="Režim informačního e-mailu">
            <label className="emailModeOption" htmlFor="email_send_always">
              <input
                id="email_send_always"
                type="checkbox"
                checked={emailMode === "always"}
                onChange={() => toggleEmailMode("always")}
              />
              Odesílat vždy
            </label>
            <label className="emailModeOption" htmlFor="email_only_when_new">
              <input
                id="email_only_when_new"
                type="checkbox"
                checked={emailMode === "new"}
                onChange={() => toggleEmailMode("new")}
              />
              Jen nové nálezy
            </label>
          </div>
          <span className="helpText">
            Nezaškrtnuto = neodesílat.
          </span>
        </div>
        <div className="adminRow adminRowEmail">
          <label htmlFor="discord_only_when_new">Režim Discord notifikace</label>
          <div className="emailModeOptions" role="group" aria-label="Režim Discord notifikace">
            <label className="emailModeOption" htmlFor="discord_send_always">
              <input
                id="discord_send_always"
                type="checkbox"
                checked={discordMode === "always"}
                onChange={() => toggleDiscordMode("always")}
              />
              Odesílat vždy
            </label>
            <label className="emailModeOption" htmlFor="discord_only_when_new">
              <input
                id="discord_only_when_new"
                type="checkbox"
                checked={discordMode === "new"}
                onChange={() => toggleDiscordMode("new")}
              />
              Jen nové nálezy
            </label>
          </div>
          <div className="helpText notifySummary" aria-live="polite">
            <div>{emailSummary}</div>
            <div>{discordSummary}</div>
          </div>
        </div>
        <div className="adminRow adminRowNumber">
          <label htmlFor="schedule_start">Automatika od (hodina)</label>
          <input
            className="numberInput"
            id="schedule_start"
            type="number"
            min={0}
            max={23}
            step={1}
            value={scheduleStartHour}
            onChange={(e) => setScheduleStartHour(Number(e.target.value))}
          />
          <span className="helpText">0-23, např. 8 = první běh v 08:00.</span>
        </div>
        <div className="adminRow adminRowNumber">
          <label htmlFor="schedule_interval">Opakovat každých (hodin)</label>
          <input
            className="numberInput"
            id="schedule_interval"
            type="number"
            min={2}
            max={24}
            step={1}
            value={scheduleIntervalHours}
            onChange={(e) => setScheduleIntervalHours(Number(e.target.value))}
          />
          <span className="helpText">Minimum je 2 hodiny.</span>
        </div>
        <p className="status adminStatus">{status}</p>
      </section>

      <section className="panel dashboardPanel adminPanel">
        <div className="adminHead">
          <h2>Hlídané dotazy</h2>
          <button
            type="button"
            onClick={() => {
              setWatches((prev) => [...prev, emptyWatch()]);
              setWatchValidationErrors({});
            }}
          >
            + Přidat dotaz
          </button>
        </div>

        {watches.length === 0 ? <p>Zatím žádný dotaz.</p> : null}

        {watches.map((watch, index) => (
          <article key={`${watch.id || "new"}-${index}`} className="watchCard">
            <div className="adminGrid">
              <label>
                Název dotazu (Nemá vliv na vyhledávání)
                <input
                  value={watch.name}
                  onChange={(e) => updateWatch(index, { name: e.target.value })}
                  placeholder="např. iPhone 13"
                />
              </label>
              <label>
                Co hledat (Hrubý filtr)
                <input
                  value={watch.query}
                  onChange={(e) => updateWatch(index, { query: e.target.value })}
                  placeholder="např. iphone 13 128gb"
                />
              </label>
              <label>
                Klíčová slova (Upřesnění vyhledávání. Odděluj pomocí čárky řetězce k vyhledávání)
                <input
                  value={watch.keywordsCsv}
                  onChange={(e) => updateWatch(index, { keywordsCsv: e.target.value })}
                  placeholder="iphone, 13, 128gb"
                />
              </label>
              <label>
                Vyloučit slova (CSV)
                <input
                  value={watch.excludeKeywordsCsv}
                  onChange={(e) =>
                    updateWatch(index, { excludeKeywordsCsv: e.target.value })
                  }
                  placeholder="rezervace, prodáno"
                />
              </label>
            </div>

            <div className="priceFilterWrap">
              <label>Cenový filtr</label>
              <div className="priceFilterValue">
                {watch.usePriceFilter
                  ? formatPriceRangeLabel(watch.priceMin ?? 0, watch.priceMax ?? PRICE_SLIDER_MAX)
                  : "Filtr je vypnutý"}
              </div>
              <label className="checkboxLabel">
                <input
                  type="checkbox"
                  checked={Boolean(watch.usePriceFilter)}
                  onChange={(e) => updateWatch(index, { usePriceFilter: e.target.checked })}
                />
                Použít filtr
              </label>
              <div className="priceSliders">
                <div className="priceSliderRow">
                  <span>Od</span>
                  <input
                    type="range"
                    min={0}
                    max={PRICE_SLIDER_MAX}
                    step={PRICE_SLIDER_STEP}
                    value={Math.min(
                      Math.min(Number(watch.priceMin) || 0, Number(watch.priceMax) || PRICE_SLIDER_MAX),
                      PRICE_SLIDER_MAX
                    )}
                    disabled={!watch.usePriceFilter}
                    onChange={(e) => {
                      const nextMin = Number(e.target.value);
                      const currentMax = Number(watch.priceMax) || PRICE_SLIDER_MAX;
                      updateWatch(index, {
                        priceMin: Math.min(nextMin, currentMax),
                        priceMax: Math.max(currentMax, nextMin)
                      });
                    }}
                  />
                </div>
                <div className="priceSliderRow">
                  <span>Do</span>
                  <input
                    type="range"
                    min={0}
                    max={PRICE_SLIDER_MAX}
                    step={PRICE_SLIDER_STEP}
                    value={Math.min(
                      PRICE_SLIDER_MAX,
                      Math.max(Number(watch.priceMax) || PRICE_SLIDER_MAX, Number(watch.priceMin) || 0)
                    )}
                    disabled={!watch.usePriceFilter}
                    onChange={(e) => {
                      const nextMax = Number(e.target.value);
                      const currentMin = Number(watch.priceMin) || 0;
                      updateWatch(index, {
                        priceMin: Math.min(currentMin, nextMax),
                        priceMax: Math.max(nextMax, currentMin)
                      });
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="marketplaces">
              <span>Bazary:</span>
              {marketplaces.map((marketplace) => (
                <label key={marketplace.id} className="checkboxLabel">
                  <input
                    type="checkbox"
                    checked={watch.marketplaces.includes(marketplace.id)}
                    onChange={() => toggleMarketplace(index, marketplace.id)}
                  />
                  {marketplace.name}
                </label>
              ))}
            </div>
            {watchValidationErrors[index] ? (
              <p style={{ color: "#b42318", marginTop: "8px" }}>{watchValidationErrors[index]}</p>
            ) : null}

            <button type="button" className="dangerBtn" onClick={() => removeWatch(index)}>
              Smazat dotaz
            </button>
          </article>
        ))}
      </section>

      <section className="panel dashboardPanel adminPanel">
        <div className="adminActions">
          <button type="button" onClick={saveConfig} disabled={saving || clearing || runningNow}>
            {saving ? "Ukládám..." : "Uložit konfiguraci"}
          </button>
          <button
            type="button"
            onClick={runWorkflowNow}
            disabled={saving || clearing || runningNow}
          >
            {runningNow ? "Spouštím..." : "Spustit kontrolu teď"}
          </button>
          <button
            type="button"
            className="dangerBtn inlineDangerBtn"
            onClick={clearHistory}
            disabled={saving || clearing || runningNow}
          >
            {clearing ? "Čistím..." : "Vyčistit cache"}
          </button>
          <label className="themeSelectWrap">
            <span>Styl:</span>
            <select
              value={uiTheme}
              onChange={(e) => setUiTheme(e.target.value)}
              disabled={saving || clearing || runningNow}
            >
              {uiThemes.map((theme) => (
                <option key={theme} value={theme}>
                  {themeLabel(theme)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
    </main>
  );
}
