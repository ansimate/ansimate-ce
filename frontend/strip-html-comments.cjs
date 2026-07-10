#!/usr/bin/env node
/*
 *: HTML-Kommentar-Stripper + Leakage-Check fuer den Frontend-Build.
 *
 * Entfernt ALLE HTML-Kommentare (<!-- ... -->) aus den *.html-Dateien im uebergebenen Web-Root,
 * damit interne Entwickler-Kommentare, Ticket-/Meilenstein-Referenzen oder Pfade NICHT in den in
 * Produktion ausgelieferten Seiten landen. Laeuft im frontend/Dockerfile VOR dem dist-Bau, fuer
 * ALLE Editionen (cloud/onpremise/community) -> auch das gepushte Image ist kommentar-frei.
 *
 * Nach dem Strippen wird verifiziert, dass kein vollstaendiger Kommentar verblieben ist; sonst
 * Exit 1 (fail-closed -> der Build bricht ab, es entsteht kein leakendes Image).
 *
 * Aufruf:  node strip-html-comments.cjs <web-root>
 */
const fs = require("fs");
const path = require("path");

const dir = process.argv[2] || ".";
const COMMENT_G = /<!--[\s\S]*?-->/g;   // zum Entfernen (global)
const COMMENT_1 = /<!--[\s\S]*?-->/;    // zum Pruefen (ein Treffer reicht)

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
let strippedCount = 0;
for (const f of files) {
  const p = path.join(dir, f);
  const t = fs.readFileSync(p, "utf8");
  const t2 = t.replace(COMMENT_G, "");
  if (t2 !== t) {
    fs.writeFileSync(p, t2);
    strippedCount++;
  }
}

// Leakage-Check: nach dem Strippen darf kein vollstaendiger HTML-Kommentar mehr vorhanden sein.
const leaked = files.filter((f) => COMMENT_1.test(fs.readFileSync(path.join(dir, f), "utf8")));
if (leaked.length) {
  console.error(`[strip-html-comments] FEHLER: HTML-Kommentare verblieben in: ${leaked.join(", ")}`);
  process.exit(1);
}
console.log(`[strip-html-comments] ${files.length} HTML-Datei(en) geprueft, ${strippedCount} bereinigt, 0 Kommentare verblieben.`);
