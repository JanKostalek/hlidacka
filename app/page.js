import fs from "node:fs/promises";
import path from "node:path";

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

export default async function Home() {
  const { results, history } = await loadResults();
  const runs = (history.runs || []).slice(0, 20);

  return (
    <main className="page">
      <section className="panel">
        <h1>Hlidacka bazaru</h1>
        <p>Kontrola kazde 2 hodiny bezi pres GitHub Actions.</p>
        <p>
          <a href="/admin">Otevrit administraci</a>
        </p>
        <ul className="stats">
          <li>Posledni beh: {results.runAt || "zatim zadny"}</li>
          <li>Dotazy: {results.summary?.totalWatches ?? 0}</li>
          <li>Zdroje: {results.summary?.totalSources ?? 0}</li>
          <li>Nove inzeraty: {results.summary?.totalNewItems ?? 0}</li>
          <li>Chyby: {results.summary?.errorCount ?? 0}</li>
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
        <h2>Chyby pri poslednim behu</h2>
        {results.errors?.length ? (
          <ul>
            {results.errors.map((err, idx) => (
              <li key={`${err.watchId}-${idx}`}>
                {err.watchName} / {err.sourceName}: {err.message}
              </li>
            ))}
          </ul>
        ) : (
          <p>Bez chyb.</p>
        )}
      </section>

      <section className="panel">
        <h2>Historie behu</h2>
        {runs.length === 0 ? (
          <p>Zatim bez historie.</p>
        ) : (
          <>
            <div className="historyTableWrap">
              <table className="historyTable">
                <thead>
                  <tr>
                    <th>Cas</th>
                    <th>Dotazy</th>
                    <th>Zdroje</th>
                    <th>Nalezy</th>
                    <th>Chyby</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.runAt}>
                      <td>{run.runAt}</td>
                      <td>{run.summary?.totalWatches ?? 0}</td>
                      <td>{run.summary?.totalSources ?? 0}</td>
                      <td>{run.summary?.totalNewItems ?? 0}</td>
                      <td>{run.summary?.errorCount ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>Posledni beh - detail dotazu</h3>
            {runs[0]?.watchStats?.length ? (
              <ul>
                {runs[0].watchStats.map((item) => (
                  <li key={item.watchId}>
                    {item.watchName}: hledano "{item.query || item.keywords.join(" ")}" | zdroje{" "}
                    {item.sourcesChecked} | nove {item.newItems} | chyby {item.errorCount} |{" "}
                    {item.found ? "nalezeno" : "nenalezeno"}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Bez detailu dotazu.</p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
