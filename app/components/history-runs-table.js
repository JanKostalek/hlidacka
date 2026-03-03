"use client";

import { useMemo, useState } from "react";
import RunEmailPreview from "./run-email-preview";

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

export default function HistoryRunsTable({ runs }) {
  const [visibleCount, setVisibleCount] = useState(10);
  const visibleRuns = useMemo(() => (runs || []).slice(0, visibleCount), [runs, visibleCount]);
  const hasMore = (runs || []).length > visibleCount;

  if (!runs?.length) {
    return <p>Zatim bez historie.</p>;
  }

  return (
    <>
      <div className="historyTableWrap">
        <table className="historyTable">
          <thead>
            <tr>
              <th>Cas</th>
              <th>Dotazy</th>
              <th>Zdroje</th>
              <th>Nalezy</th>
              <th>Nove</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {visibleRuns.map((run) => (
              <tr key={run.runAt}>
                <td title={run.runAt}>{formatRunTime(run.runAt)}</td>
                <td>{run.summary?.totalWatches ?? 0}</td>
                <td>{run.summary?.totalSources ?? 0}</td>
                <td>{run.summary?.totalFoundItems ?? run.summary?.totalNewItems ?? 0}</td>
                <td>{run.summary?.totalNewItems ?? 0}</td>
                <td>
                  <details className="runDetails">
                    <summary>Otevrit</summary>
                    <div className="runDetailsBody">
                      <div>
                        <b>Predmet:</b> {run.emailSubject || "neuvedeno"}
                      </div>
                      <RunEmailPreview
                        text={run.emailText || "Text e-mailu neni u tohoto behu ulozen."}
                      />
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore ? (
        <div className="historyLoadMore">
          <button type="button" onClick={() => setVisibleCount((count) => count + 10)}>
            Nacist dalsich 10
          </button>
        </div>
      ) : null}

      <h3>Posledni beh - detail dotazu</h3>
      {runs[0]?.watchStats?.length ? (
        <ul>
          {runs[0].watchStats.map((item) => (
            <li key={item.watchId}>
              {item.watchName}: hledano "{item.query || item.keywords.join(" ")}" | zdroje{" "}
              {item.sourcesChecked} | nalezy {item.foundItems ?? item.newItems} | nove {item.newItems} |{" "}
              {item.found ? "nalezeno" : "nenalezeno"}
            </li>
          ))}
        </ul>
      ) : (
        <p>Bez detailu dotazu.</p>
      )}
    </>
  );
}
