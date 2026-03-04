import fs from "node:fs/promises";
import path from "node:path";
import HistoryRunsTable from "./components/history-runs-table";
import AdminPopupLink from "./components/admin-popup-link";

async function loadResults() {
  const resultsPath = path.join(process.cwd(), "data", "latest-results.json");
  const historyPath = path.join(process.cwd(), "data", "run-history.json");
  const foundHistoryPath = path.join(process.cwd(), "data", "found-history.json");
  const [resultsRaw, historyRaw, foundHistoryRaw] = await Promise.all([
    fs.readFile(resultsPath, "utf8"),
    fs.readFile(historyPath, "utf8").catch(() => JSON.stringify({ runs: [] })),
    fs.readFile(foundHistoryPath, "utf8").catch(() => JSON.stringify({ byWatch: {} }))
  ]);

  return {
    results: JSON.parse(resultsRaw),
    history: JSON.parse(historyRaw),
    foundHistory: JSON.parse(foundHistoryRaw)
  };
}

export const dynamic = "force-dynamic";

function formatRunTime(iso) {
  if (!iso) return "zatím žádný";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export default async function Home() {
  const { results, history, foundHistory } = await loadResults();
  const runs = (history.runs || []).slice(0, 20);
  const errorsCount = Number(results.summary?.errorCount ?? 0);
  const healthState = errorsCount > 0 ? "Pozor: chyby" : "Stabilní běh";
  const latestRunWatchStats = runs[0]?.watchStats || [];
  const watchMeta = new Map();
  for (const stat of latestRunWatchStats) {
    watchMeta.set(stat.watchId, stat.watchName || stat.watchId);
  }
  for (const group of results.activeItemsByWatch || []) {
    watchMeta.set(group.watchId, group.watchName || watchMeta.get(group.watchId) || group.watchId);
  }
  for (const group of results.newItemsByWatch || []) {
    watchMeta.set(group.watchId, group.watchName || watchMeta.get(group.watchId) || group.watchId);
  }
  for (const watchId of Object.keys(foundHistory?.byWatch || {})) {
    watchMeta.set(watchId, watchMeta.get(watchId) || watchId);
  }
  const watchList = Array.from(watchMeta.entries()).map(([watchId, watchName]) => ({
    watchId,
    watchName
  }));

  const newByWatchId = new Map(
    (results.newItemsByWatch || []).map((group) => [group.watchId, group.items || []])
  );
  const activeByWatchId = new Map(
    (results.activeItemsByWatch || []).map((group) => [group.watchId, group.items || []])
  );
  const olderActiveByWatch = watchList.map((watch) => {
    const currentlyNewLinks = new Set((newByWatchId.get(watch.watchId) || []).map((item) => item.link));
    const activeLinks = new Set(
      (activeByWatchId.get(watch.watchId) || []).map((item) => item.link)
    );
    const olderFromHistory = (foundHistory?.byWatch?.[watch.watchId] || []).filter(
      (item) => activeLinks.has(item.link) && !currentlyNewLinks.has(item.link)
    );
    return {
      watchId: watch.watchId,
      watchName: watch.watchName,
      items: olderFromHistory
    };
  });
  const hasOlderActive = olderActiveByWatch.some((group) => group.items.length > 0);

  const statCards = [
    {
      label: "Poslední běh",
      value: formatRunTime(results.runAt)
    },
    {
      label: "Dotazy",
      value: String(results.summary?.totalWatches ?? 0)
    },
    {
      label: "Zdroje",
      value: String(results.summary?.totalSources ?? 0)
    },
    {
      label: "Nálezy celkem",
      value: String(results.summary?.totalFoundItems ?? results.summary?.totalNewItems ?? 0)
    },
    {
      label: "Nové inzeráty",
      value: String(results.summary?.totalNewItems ?? 0)
    }
  ];

  return (
    <main className="page dashboardPage">
      <section className="panel dashboardPanel heroPanel">
        <AdminPopupLink />
        <div className="heroEyebrow">Live Monitoring</div>
        <h1>Hlídačka bazarů</h1>
        <p className="heroSubtitle">Pravidelná kontrola inzerátů na vybraných bazarech</p>
        <div className="heroMeta">
          <span className="heroChip">{healthState}</span>
          <span className="heroChip">Aktualizace: {formatRunTime(results.runAt)}</span>
        </div>
        <div className="heroActions">
          <a className="heroActionBtn heroActionBtnSecondary" href="#starsi-inzeraty">
            Starší inzeráty
          </a>
          <a className="heroActionBtn heroActionBtnSecondary" href="/admin">
            Otevřít administraci
          </a>
        </div>
        <div className="stats dashboardStats">
          {statCards.map((card) => (
            <article key={card.label} className="statCard">
              <div className="statLabel">{card.label}</div>
              <div className="statValue">{card.value}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel dashboardPanel" id="nove-inzeraty">
        <h2>Nové inzeráty</h2>
        {(results.newItemsByWatch || []).length ? (
          (results.newItemsByWatch || []).map((group) => (
            <div key={group.watchId} className="group dashboardGroup">
              <div className="groupHead">
                <h3>{group.watchName}</h3>
                <span className="groupBadge">{group.items.length} nových</span>
              </div>
              <ul>
                {group.items.map((item) => (
                  <li key={`${item.sourceId}-${item.link}`}>
                    <a href={item.link} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                    <span>
                      {" "}
                      | {item.sourceName}
                      {item.price ? ` | ${item.price}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p>Zatím nic nového.</p>
        )}
      </section>

      <section className="panel dashboardPanel" id="starsi-inzeraty">
        <h2>Starší inzeráty (stále aktivní)</h2>
        {hasOlderActive ? (
          olderActiveByWatch.map((group) =>
            group.items.length ? (
              <div key={group.watchId} className="group dashboardGroup">
                <div className="groupHead">
                  <h3>{group.watchName}</h3>
                  <span className="groupBadge">{group.items.length} starších</span>
                </div>
                <ul>
                  {group.items.map((item) => (
                    <li key={`${item.sourceName}-${item.link}`}>
                      <a href={item.link} target="_blank" rel="noreferrer">
                        {item.title}
                      </a>
                      <span>
                        {" "}
                        | {item.sourceName}
                        {item.price ? ` | ${item.price}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          )
        ) : (
          <p>Žádné starší aktivní inzeráty (nebo zatím nejsou data po novém běhu).</p>
        )}
      </section>

      <section className="panel dashboardPanel" id="historie">
        <h2>Historie vyhledávání</h2>
        <HistoryRunsTable runs={runs} />
      </section>
    </main>
  );
}
