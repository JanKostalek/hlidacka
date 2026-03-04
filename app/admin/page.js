"use client";

import { useEffect, useState } from "react";

function emptyWatch() {
  return {
    id: "",
    name: "",
    query: "",
    keywordsCsv: "",
    excludeKeywordsCsv: "",
    marketplaces: []
  };
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [watches, setWatches] = useState([]);
  const [watchValidationErrors, setWatchValidationErrors] = useState({});
  const [marketplaces, setMarketplaces] = useState([]);
  const [notificationEmail, setNotificationEmail] = useState("");
  const [emailOnlyWhenNew, setEmailOnlyWhenNew] = useState(false);
  const [scheduleStartHour, setScheduleStartHour] = useState(0);
  const [scheduleIntervalHours, setScheduleIntervalHours] = useState(2);
  const [status, setStatus] = useState("Načítání...");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

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
    setEmailOnlyWhenNew(Boolean(data.emailOnlyWhenNew));
    setScheduleStartHour(Number.isInteger(data.schedule?.startHour) ? data.schedule.startHour : 0);
    setScheduleIntervalHours(
      Number.isInteger(data.schedule?.intervalHours) ? data.schedule.intervalHours : 2
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
        emailOnlyWhenNew,
        schedule: {
          startHour: scheduleStartHour,
          intervalHours: scheduleIntervalHours
        }
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
    setEmailOnlyWhenNew(Boolean(data.emailOnlyWhenNew));
    setScheduleStartHour(Number.isInteger(data.schedule?.startHour) ? data.schedule.startHour : 0);
    setScheduleIntervalHours(
      Number.isInteger(data.schedule?.intervalHours) ? data.schedule.intervalHours : 2
    );
    setStatus("Uloženo.");
    setSaving(false);
  }

  async function clearHistory() {
    const confirmed = window.confirm(
      "Opravdu chceš vyčistit historii? (běhy, již zobrazené inzeráty, stav)"
    );
    if (!confirmed) return;

    setClearing(true);
    setStatus("Čistím historii...");
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
      setStatus(`Nepodařilo se vyčistit historii. ${error.error || ""}`.trim());
      setClearing(false);
      return;
    }

    setStatus("Historie vyčištěna.");
    setClearing(false);
  }

  function removeWatch(index) {
    setWatches((prev) => prev.filter((_, idx) => idx !== index));
    setWatchValidationErrors({});
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>Administrace hlídačky</h1>
        <p>Vyber bazary, zadej co hledat a ulož konfiguraci.</p>
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
          <label htmlFor="email_only_when_new">Režim informačního e-mailu</label>
          <label className="checkboxLabel" htmlFor="email_send_always">
            <input
              id="email_send_always"
              type="checkbox"
              checked={!emailOnlyWhenNew}
              onChange={() => setEmailOnlyWhenNew(false)}
            />
            Odesílat vždy
          </label>
          <label className="checkboxLabel" htmlFor="email_only_when_new">
            <input
              id="email_only_when_new"
              type="checkbox"
              checked={emailOnlyWhenNew}
              onChange={() => setEmailOnlyWhenNew(true)}
            />
            Jen nové nálezy
          </label>
          <span className="helpText">
            {emailOnlyWhenNew
              ? "Aktuálně: odesílat jen při nalezení nových inzerátů."
              : "Aktuálně: odesílat informační e-mail vždy."}
          </span>
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
        <p className="status">{status}</p>
      </section>

      <section className="panel">
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
                Název dotazu
                <input
                  value={watch.name}
                  onChange={(e) => updateWatch(index, { name: e.target.value })}
                  placeholder="např. iPhone 13"
                />
              </label>
              <label>
                Co hledat (text)
                <input
                  value={watch.query}
                  onChange={(e) => updateWatch(index, { query: e.target.value })}
                  placeholder="např. iphone 13 128gb"
                />
              </label>
              <label>
                Klíčová slova (CSV)
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

      <section className="panel">
        <div className="adminActions">
          <button type="button" onClick={saveConfig} disabled={saving || clearing}>
            {saving ? "Ukládám..." : "Uložit konfiguraci"}
          </button>
          <button
            type="button"
            className="dangerBtn"
            onClick={clearHistory}
            disabled={saving || clearing}
          >
            {clearing ? "Čistím..." : "Vyčistit historii"}
          </button>
        </div>
      </section>
    </main>
  );
}
