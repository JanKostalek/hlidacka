diff --git a/c:\-_WeB_-\Hlidacka\scripts/check-marketplaces.mjs b/c:\-_WeB_-\Hlidacka\scripts/check-marketplaces.mjs
--- a/c:\-_WeB_-\Hlidacka\scripts/check-marketplaces.mjs
+++ b/c:\-_WeB_-\Hlidacka\scripts/check-marketplaces.mjs
@@ -289,2 +289,113 @@
 
+function escapeHtml(input) {
+  return String(input || "")
+    .replace(/&/g, "&amp;")
+    .replace(/</g, "&lt;")
+    .replace(/>/g, "&gt;")
+    .replace(/"/g, "&quot;")
+    .replace(/'/g, "&#39;");
+}
+
+function buildEmailHtml(config, results) {
+  const watches = config.watches || [];
+  const newItemsByWatchId = new Map(
+    (results.newItemsByWatch || []).map((group) => [group.watchId, group.items || []])
+  );
+
+  const watchCards = watches
+    .map((watch) => {
+      const sources = Array.from(
+        new Set((watch.sources || []).map((source) => source.name || source.id).filter(Boolean))
+      );
+      const errorsForWatch = (results.errors || []).filter((err) => err.watchId === watch.id);
+      const newItems = newItemsByWatchId.get(watch.id) || [];
+      const keywords = (watch.keywords || []).join(", ") || "(zadna)";
+      const excluded = (watch.excludeKeywords || []).join(", ") || "(zadna)";
+      const sourceList = sources.join(", ") || "(zadny)";
+
+      const itemList =
+        newItems.length === 0
+          ? `<div class="muted">Zadne nove inzeraty pro tento dotaz.</div>`
+          : `<ul class="item-list">${newItems
+              .map((item) => {
+                const pricePart = item.price ? ` | ${escapeHtml(item.price)}` : "";
+                return `<li><a href="${escapeHtml(item.link)}">${escapeHtml(
+                  item.title
+                )}</a><span class="muted"> (${escapeHtml(item.sourceName)}${pricePart})</span></li>`;
+              })
+              .join("")}</ul>`;
+
+      const errorList =
+        errorsForWatch.length === 0
+          ? `<div class="muted">Bez chyb.</div>`
+          : `<ul class="error-list">${errorsForWatch
+              .map(
+                (err) =>
+                  `<li>${escapeHtml(err.sourceName)}: ${escapeHtml(err.message)}</li>`
+              )
+              .join("")}</ul>`;
+
+      return `
+        <section class="card">
+          <h3>${escapeHtml(watch.name || watch.id)}</h3>
+          <div class="meta"><b>Co hledat:</b> ${escapeHtml(watch.query || "(prazdne)")}</div>
+          <div class="meta"><b>Klicova slova:</b> ${escapeHtml(keywords)}</div>
+          <div class="meta"><b>Vyloucit slova:</b> ${escapeHtml(excluded)}</div>
+          <div class="meta"><b>Bazary:</b> ${escapeHtml(sourceList)}</div>
+          <div class="meta"><b>Vysledek:</b> nove ${newItems.length}, chyby ${errorsForWatch.length}</div>
+          <h4>Nove inzeraty</h4>
+          ${itemList}
+          <h4>Chyby</h4>
+          ${errorList}
+        </section>
+      `;
+    })
+    .join("");
+
+  return `<!doctype html>
+<html>
+  <body style="margin:0;padding:0;background:#eef2f7;font-family:Segoe UI,Arial,sans-serif;color:#102033;">
+    <div style="max-width:760px;margin:0 auto;padding:20px 12px;">
+      <div style="background:linear-gradient(120deg,#0f6bcf,#0ea5a8);color:white;border-radius:14px;padding:20px 18px;">
+        <div style="font-size:13px;opacity:.9;margin-bottom:6px;">Hlidacka bazaru</div>
+        <div style="font-size:24px;font-weight:700;line-height:1.2;">Vysledek behu</div>
+        <div style="margin-top:10px;font-size:14px;opacity:.95;">Cas behu: ${escapeHtml(
+          results.runAt
+        )}</div>
+      </div>
+
+      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
+        <div style="background:white;border:1px solid #dbe5f0;border-radius:12px;padding:12px 14px;min-width:120px;">
+          <div style="font-size:12px;color:#49627c;">Nove inzeraty</div>
+          <div style="font-size:22px;font-weight:700;">${results.summary.totalNewItems}</div>
+        </div>
+        <div style="background:white;border:1px solid #dbe5f0;border-radius:12px;padding:12px 14px;min-width:120px;">
+          <div style="font-size:12px;color:#49627c;">Chyby</div>
+          <div style="font-size:22px;font-weight:700;">${results.summary.errorCount}</div>
+        </div>
+        <div style="background:white;border:1px solid #dbe5f0;border-radius:12px;padding:12px 14px;min-width:120px;">
+          <div style="font-size:12px;color:#49627c;">Dotazy</div>
+          <div style="font-size:22px;font-weight:700;">${results.summary.totalWatches}</div>
+        </div>
+      </div>
+
+      <div style="margin-top:12px;">
+        ${watchCards || '<div style="background:white;border:1px solid #dbe5f0;border-radius:12px;padding:14px;">Zadne aktivni dotazy.</div>'}
+      </div>
+
+      <style>
+        .card { background:white;border:1px solid #dbe5f0;border-radius:12px;padding:14px 14px;margin-bottom:10px; }
+        h3 { margin:0 0 8px;font-size:18px; }
+        h4 { margin:12px 0 6px;font-size:14px; }
+        .meta { font-size:13px; margin:3px 0; }
+        .muted { color:#5c748e;font-size:13px; }
+        .item-list, .error-list { margin:6px 0 0; padding-left:18px; font-size:13px; }
+        .item-list li, .error-list li { margin:4px 0; }
+        a { color:#0f6bcf; text-decoration:none; }
+      </style>
+    </div>
+  </body>
+</html>`;
+}
+
 async function sendEmailNotification(config, results) {
@@ -327,3 +438,4 @@
     subject: buildEmailSubject(config, results),
-    text: buildEmailText(config, results)
+    text: buildEmailText(config, results),
+    html: buildEmailHtml(config, results)
   });
