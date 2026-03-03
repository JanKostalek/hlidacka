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
  const [marketplaces, setMarketplaces] = useState([]);
  const [notificationEmail, setNotificationEmail] = useState("");
  const [status, setStatus] = useState("Nacitani...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const localToken = window.localStorage.getItem("adminToken") || "";
    if (localToken) setToken(localToken);
  }, []);

  async function loadConfig(currentToken = token) {
    setStatus("Nacitani...");
    const res = await fetch("/api/config", {
      headers: currentToken ? { "x-admin-token": currentToken } : {}
    });

    if (res.status === 401) {
      setStatus("Neplatny token. Zadej ADMIN_TOKEN.");
      return;
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setStatus(`Nepodarilo se nacist konfiguraci. ${error.error || ""}`.trim());
      return;
    }

    const data = await res.json();
    setWatches(data.watches || []);
    setMarketplaces(data.marketplaces || []);
    setNotificationEmail(data.notificationEmail || "");
    setStatus("Konfigurace nactena.");
  }

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateWatch(index, patch) {
    setWatches((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
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
  }

  async function saveConfig() {
    setSaving(true);
    setStatus("Ukladam...");
    const headers = { "content-type": "application/json" };
    if (token) headers["x-admin-token"] = token;

    const res = await fetch("/api/config", {
      method: "PUT",
      headers,
      body: JSON.stringify({ watches, notificationEmail })
    });

    if (res.status === 401) {
      setStatus("Neplatny token. Ulozeni zamitnuto.");
      setSaving(false);
      return;
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setStatus(`Nepodarilo se ulozit konfiguraci. ${error.error || ""}`.trim());
      setSaving(false);
      return;
    }

    const data = await res.json();
    setWatches(data.watches || []);
    setNotificationEmail(data.notificationEmail || "");
    setStatus("Ulozeno.");
    setSaving(false);
  }

  function removeWatch(index) {
    setWatches((prev) => prev.filter((_, idx) => idx !== index));
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>Administrace hlidacky</h1>
        <p>Vyber bazary, zadej co hledat a uloz konfiguraci.</p>
        <div className="adminRow">
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
            placeholder="volitelne, pokud je nastaven ADMIN_TOKEN"
          />
          <button type="button" onClick={() => loadConfig(token)}>
            Nacist znovu
          </button>
        </div>
        <div className="adminRow">
          <label htmlFor="email_to">Cilovy e-mail</label>
          <input
            id="email_to"
            type="email"
            value={notificationEmail}
            onChange={(e) => setNotificationEmail(e.target.value)}
            placeholder="kam se posilaji nalezy"
          />
          <span className="helpText">Pouzije se pri dalsim behu workflow.</span>
        </div>
        <p className="status">{status}</p>
      </section>

      <section className="panel">
        <div className="adminHead">
          <h2>Hlidane dotazy</h2>
          <button type="button" onClick={() => setWatches((prev) => [...prev, emptyWatch()])}>
            + Pridat dotaz
          </button>
        </div>

        {watches.length === 0 ? <p>Zatim zadny dotaz.</p> : null}

        {watches.map((watch, index) => (
          <article key={`${watch.id || "new"}-${index}`} className="watchCard">
            <div className="adminGrid">
              <label>
                Nazev dotazu
                <input
                  value={watch.name}
                  onChange={(e) => updateWatch(index, { name: e.target.value })}
                  placeholder="napr. iPhone 13"
                />
              </label>
              <label>
                Co hledat (text)
                <input
                  value={watch.query}
                  onChange={(e) => updateWatch(index, { query: e.target.value })}
                  placeholder="napr. iphone 13 128gb"
                />
              </label>
              <label>
                Klicova slova (CSV)
                <input
                  value={watch.keywordsCsv}
                  onChange={(e) => updateWatch(index, { keywordsCsv: e.target.value })}
                  placeholder="iphone, 13, 128gb"
                />
              </label>
              <label>
                Vyloucit slova (CSV)
                <input
                  value={watch.excludeKeywordsCsv}
                  onChange={(e) =>
                    updateWatch(index, { excludeKeywordsCsv: e.target.value })
                  }
                  placeholder="rezervace, prodano"
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

            <button type="button" className="dangerBtn" onClick={() => removeWatch(index)}>
              Smazat dotaz
            </button>
          </article>
        ))}
      </section>

      <section className="panel">
        <button type="button" onClick={saveConfig} disabled={saving}>
          {saving ? "Ukladam..." : "Ulozit konfiguraci"}
        </button>
      </section>
    </main>
  );
}
