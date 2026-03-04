import fs from "node:fs/promises";
import path from "node:path";
import HistoryRunsTable from "./components/history-runs-table";
import AdminPopupLink from "./components/admin-popup-link";

async function loadResults() {
  const resultsPath = path.join(process.cwd(), "data", "latest-results.json");
  const historyPath = path.join(process.cwd(), "data", "run-history.json");
  const [resultsRaw, historyRaw] = await Promise.all([
    fs.readFile(resultsPath, "utf8"),
    fs.readFile(historyPath, "utf8").catch(() => JSON.stringify({ runs: [] }))
  ]);

  return {
    results: JSON.parse(resultsRaw),
    history: JSON.parse(historyRaw)
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
  const { results, history } = await loadResults();
  const runs = (history.runs || []).slice(0, 20);
  const errorsCount = Number(results.summary?.errorCount ?? 0);
  const healthState = errorsCount > 0 ? "Pozor: chyby" : "Stabilní běh";
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
          <a className="heroActionBtn" href="#nove-inzeraty">
            Nové inzeráty
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
        {results.newItemsByWatch?.length ? (
          results.newItemsByWatch.map((group) => (
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

      <section className="panel dashboardPanel" id="historie">
        <h2>Historie vyhledávání</h2>
        <HistoryRunsTable runs={runs} />
      </section>
    </main>
  );
}
