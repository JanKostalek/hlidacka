"use client";

import { useMemo, useState } from "react";
import RunEmailPreview from "./run-email-preview";

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

function normalizeMojibakeText(input) {
  const text = String(input || "");
  // Repair common UTF-8 -> Latin-1 mojibake (e.g. "VÃ½sledek" -> "Výsledek")
  if (!/[ÃÄÅ]/.test(text)) return text;
  try {
    return decodeURIComponent(escape(text));
  } catch {
    return text;
  }
}

export default function HistoryRunsTable({ runs }) {
  const [visibleCount, setVisibleCount] = useState(10);
  const visibleRuns = useMemo(() => (runs || []).slice(0, visibleCount), [runs, visibleCount]);
  const hasMore = (runs || []).length > visibleCount;

  if (!runs?.length) {
    return <p>Zatím bez historie.</p>;
  }

  return (
    <>
      <div className="historyTableWrap">
        <table className="historyTable">
          <thead>
            <tr>
              <th>Čas</th>
              <th>Dotazy</th>
              <th>Zdroje</th>
              <th>Nálezy</th>
              <th>Nové</th>
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
                    <summary>Otevřít</summary>
                    <div className="runDetailsBody">
                      <div>
                        <b>Předmět:</b> {normalizeMojibakeText(run.emailSubject || "neuvedeno")}
                      </div>
                      <RunEmailPreview
                        text={normalizeMojibakeText(
                          run.emailText || "Text e-mailu není u tohoto běhu uložen."
                        )}
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
            Načíst dalších 10
          </button>
        </div>
      ) : null}

      <h3>Poslední běh - detail dotazů</h3>
      {runs[0]?.watchStats?.length ? (
        <ul>
          {runs[0].watchStats.map((item) => (
            <li key={item.watchId}>
              {item.watchName}: hledáno "{item.query || item.keywords.join(" ")}" | zdroje{" "}
              {item.sourcesChecked} | nálezy {item.foundItems ?? item.newItems} | nové{" "}
              {item.newItems} | {item.found ? "nalezeno" : "nenalezeno"}
            </li>
          ))}
        </ul>
      ) : (
        <p>Bez detailu dotazů.</p>
      )}
    </>
  );
}
