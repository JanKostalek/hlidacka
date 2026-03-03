import fs from "node:fs/promises";
import path from "node:path";
import HistoryRunsTable from "./components/history-runs-table";

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
  if (!iso) return "zatim zadny";
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

  return (
    <main className="page">
      <section className="panel">
        <h1>Hlidacka bazaru</h1>
        <p>Kontrola bezi podle planu nastaveneho v administraci (GitHub Actions).</p>
        <p>
          <a href="/admin">Otevrit administraci</a>
        </p>
        <ul className="stats">
          <li>Posledni beh: {formatRunTime(results.runAt)}</li>
          <li>Dotazy: {results.summary?.totalWatches ?? 0}</li>
          <li>Zdroje: {results.summary?.totalSources ?? 0}</li>
          <li>Nalezy celkem: {results.summary?.totalFoundItems ?? results.summary?.totalNewItems ?? 0}</li>
          <li>Nove inzeraty: {results.summary?.totalNewItems ?? 0}</li>
        </ul>
      </section>

      <section className="panel">
        <h2>Nove inzeraty</h2>
        {results.newItemsByWatch?.length ? (
          results.newItemsByWatch.map((group) => (
            <div key={group.watchId} className="group">
              <h3>{group.watchName}</h3>
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
          <p>Zatim nic noveho.</p>
        )}
      </section>

      <section className="panel">
        <h2>Historie vyhledavani</h2>
        <HistoryRunsTable runs={runs} />
      </section>
    </main>
  );
}
