#!/usr/bin/env node
/*
 * strip-cloud-only.cjs — (Security, Community-Edition)
 * =========================================================
 * Entfernt build-zeitlich ALLE cloud-exklusiven / proprietaeren HTML-Elemente aus den
 * ausgelieferten Seiten der Community-Edition. Bisher wurden solche Elemente lediglich per
 * CSS-Klasse (`cloud-only` etc.) im Browser versteckt — da der Community-Quellcode oeffentlich
 * ist und das DOM per Inspektor einsehbar, duerfen sie gar nicht erst im ausgelieferten
 * HTML-Bundle existieren.
 *
 * Wird im Dockerfile NUR fuer EDITION=community aufgerufen (nach strip-html-comments.cjs,
 * vor `cp -a src/. dist/`). Fuer cloud/onpremise bleibt das HTML unveraendert.
 *
 * Dependency-frei (bewusst): der Community-Frontend-Build soll keine zusaetzliche npm-Dependency
 * ziehen (Mirror bleibt schlank, kein extra uncached npm-install). Vorgehen byte-erhaltend:
 * es werden ausschliesslich die betroffenen Element-Spans (inkl. verschachtelter Kinder) exakt
 * aus dem Quelltext herausgeschnitten, alles uebrige bleibt Byte-fuer-Byte identisch.
 * Fail-closed: verbleibt danach noch ein Klassen-Token, bricht der Build ab.
 *
 * Aufruf:  node strip-cloud-only.cjs <src-dir>
 */
"use strict";
const fs = require("fs");
const path = require("path");

// Klassen, die cloud-exklusive/proprietaere Inhalte kennzeichnen (Billing/Pricing/Tarife/
// Gutscheine/GoBD/Stripe-Banner ...). `premium-only` ist vorsorglich mit erfasst.
//: `legal-only` markiert die rechtlichen Footer-Links (Impressum/AGB/Datenschutz), die
// in der Community-Edition nicht ausgeliefert werden (die zugehoerigen Seiten werden unten
// zusaetzlich als Datei entfernt).
//: `community-strip` markiert Elemente, die es in der Community-Edition nicht geben soll,
// die aber KEINE cloud-exklusiven Inhalte sind (z. B. das Wartungs-Overlay/-Banner — der
// Wartungsmodus existiert in cloud UND onpremise, nur in community nicht,). Eigene Klasse,
// damit die Semantik von `cloud-only` (= wirklich nur cloud) unberuehrt bleibt.
const STRIP_CLASSES = ["cloud-only", "cloud-only-tab", "premium-only", "legal-only", "community-strip"];
//: rechtliche Seiten der Community-Edition komplett aus dem Bundle entfernen (nicht nur
// die Links). Diese .html-Dateien werden im Dockerfile ansonsten unveraendert nach dist/ kopiert.
const REMOVE_FILES = ["impressum.html", "tos.html", "privacy.html"];
// Void-Elemente haben kein schliessendes Tag.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);

// Findet das Ende des oeffnenden Tags ab Position `lt` (zeigt auf '<'). Liefert
// { openEnd, selfClose } — openEnd = Index direkt hinter '>'.
function scanOpenTag(html, lt) {
  let i = lt + 1;
  while (i < html.length) {
    const c = html[i];
    if (c === '"' || c === "'") { // Attributwert ueberspringen (kann > enthalten)
      const q = c; i++;
      while (i < html.length && html[i] !== q) i++;
      i++; continue;
    }
    if (c === ">") return { openEnd: i + 1, selfClose: html[i - 1] === "/" };
    i++;
  }
  return { openEnd: html.length, selfClose: false };
}

// Ermittelt den Namen des Tags ab '<' (klein geschrieben) oder null.
function tagNameAt(html, lt) {
  const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 40));
  return m ? m[1].toLowerCase() : null;
}

// Liefert den End-Offset (exklusiv) des Elements, dessen oeffnendes Tag bei `lt` beginnt —
// inklusive verschachtelter gleichnamiger Elemente und des schliessenden Tags.
function elementEnd(html, lt) {
  const tag = tagNameAt(html, lt);
  const { openEnd, selfClose } = scanOpenTag(html, lt);
  if (!tag || selfClose || VOID.has(tag)) return openEnd;
  let depth = 1;
  let j = openEnd;
  while (j < html.length && depth > 0) {
    const next = html.indexOf("<", j);
    if (next === -1) return html.length;
    if (html.startsWith("<!--", next)) { // Kommentar ueberspringen
      const ce = html.indexOf("-->", next);
      j = ce === -1 ? html.length : ce + 3;
      continue;
    }
    const rest = html.slice(next, next + tag.length + 3);
    if (new RegExp("^</" + tag + "\\s*>", "i").test(html.slice(next))) {
      const cm = new RegExp("^</" + tag + "\\s*>", "i").exec(html.slice(next));
      depth--;
      j = next + cm[0].length;
    } else if (new RegExp("^<" + tag + "(?=[\\s/>])", "i").test(rest)) {
      const inner = scanOpenTag(html, next);
      if (!inner.selfClose) depth++;
      j = inner.openEnd;
    } else {
      j = next + 1;
    }
  }
  return j;
}

// Sucht alle oeffnenden Tags, deren class-Attribut eines der STRIP_CLASSES als eigenstaendiges
// Wort enthaelt. Liefert Liste von [start, end]-Spans (aeusserste, nicht ueberlappend).
function findStripSpans(html) {
  const spans = [];
  // Jedes class="..."-Attribut finden; auf das zugehoerige '<' zurueckgehen.
  const attrRe = /class\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(html)) !== null) {
    const tokens = m[1].split(/\s+/);
    if (!STRIP_CLASSES.some((c) => tokens.includes(c))) continue;
    const lt = html.lastIndexOf("<", m.index);
    if (lt === -1) continue;
    // Sicherstellen, dass zwischen '<' und dem class-Attribut kein '>' liegt (sonst gehoert
    // das class-Attribut nicht zu diesem Tag).
    if (html.slice(lt, m.index).includes(">")) continue;
    spans.push([lt, elementEnd(html, lt)]);
  }
  // Nach Start sortieren, in anderen Spans enthaltene entfernen (aeusserste behalten).
  spans.sort((a, b) => a[0] - b[0]);
  const outer = [];
  for (const s of spans) {
    const last = outer[outer.length - 1];
    if (last && s[0] >= last[0] && s[1] <= last[1]) continue;
    outer.push(s);
  }
  return outer;
}

// Prueft, ob eine HTML-Datei noch ein class="..."-Attribut mit dem Token als eigenstaendiges
// Wort enthaelt (fail-closed-Pruefung nach dem Strippen).
function hasClassToken(html, cls) {
  const re = /class\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].split(/\s+/).includes(cls)) return true;
  }
  return false;
}

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) {
  console.error("[strip-cloud-only] FEHLER: Quellverzeichnis fehlt/existiert nicht:", SRC);
  process.exit(1);
}

//: Rechtliche Seiten (Impressum/AGB/Datenschutz) in der Community-Edition gar nicht erst
// ausliefern — VOR dem HTML-Scan entfernen, damit sie nicht mehr in der Dateiliste auftauchen.
for (const rf of REMOVE_FILES) {
  const rp = path.join(SRC, rf);
  if (fs.existsSync(rp)) {
    fs.unlinkSync(rp);
    console.log(`[strip-cloud-only] Rechtsseite entfernt: ${rf}`);
  }
}

let totalRemoved = 0;
const htmlFiles = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith(".html"));

for (const file of htmlFiles) {
  const full = path.join(SRC, file);
  const original = fs.readFileSync(full, "utf8");
  const spans = findStripSpans(original);
  if (spans.length === 0) continue;

  // Von hinten nach vorne herausschneiden (Offsets bleiben stabil). Fuehrende Einrueckung
  // (Tabs/Spaces) und genau einen folgenden Zeilenumbruch mit-entfernen -> keine Leerzeilen.
  let out = original;
  for (let i = spans.length - 1; i >= 0; i--) {
    let [start, end] = spans[i];
    let s = start;
    while (s > 0 && (out[s - 1] === " " || out[s - 1] === "\t")) s--;
    let e = end;
    if (out[e] === "\n") e++;
    out = out.slice(0, s) + out.slice(e);
  }

  // Fail-closed: keines der Tokens darf uebrig bleiben.
  for (const cls of STRIP_CLASSES) {
    if (hasClassToken(out, cls)) {
      console.error(`[strip-cloud-only] FEHLER: Klasse '${cls}' nach dem Strippen noch in ${file} vorhanden.`);
      process.exit(2);
    }
  }

  fs.writeFileSync(full, out);
  totalRemoved += spans.length;
  console.log(`[strip-cloud-only] ${file}: ${spans.length} cloud-exklusive(s) Element(e) entfernt.`);
}

console.log(`[strip-cloud-only] fertig — ${totalRemoved} Element(e) aus ${htmlFiles.length} HTML-Datei(en) entfernt (Klassen: ${STRIP_CLASSES.join(", ")}).`);
