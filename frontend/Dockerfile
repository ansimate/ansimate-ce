# ---- Stage 1: Vite-Build ----
# Buendelt app.js per Vite und stellt die statischen Assets fuer das nginx-Image bereit.
FROM node:20-alpine AS build
WORKDIR /build
# Build-Deps aus package.json (vite fuer das Bundling).
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
# Web-Root zusammenstellen (frontend/src + repo-images).
COPY frontend/src ./src
COPY images ./src/images
COPY frontend/strip-html-comments.cjs ./strip-html-comments.cjs
COPY frontend/strip-cloud-only.cjs ./strip-cloud-only.cjs
COPY frontend/vite.config.js ./vite.config.js
#: ALLE HTML-Kommentare aus den ausgelieferten Seiten entfernen (interne Notizen/
# Ticket-Referenzen/Pfade duerfen nicht in Produktion landen) — vor dem dist-Bau, fuer ALLE
# Editionen, fail-closed (das Skript bricht ab, falls danach noch ein Kommentar verbleibt).
RUN node strip-html-comments.cjs ./src
# : Edition = Build-Zeit-Konstante (VITE_EDITION aus dem EDITION-Build-Arg).
ARG EDITION=community
# (Security): In der Community-Edition (oeffentlicher Quellcode) duerfen cloud-exklusive/
# proprietaere Elemente (Billing/Pricing/Tarife/Gutscheine/GoBD/Stripe-Banner, Klassen
# `cloud-only`/`cloud-only-tab`/`premium-only`) NICHT nur CSS-versteckt, sondern gar nicht im
# ausgelieferten HTML enthalten sein (per Inspektor sonst einsehbar). Build-zeitlich strippen,
# fail-closed (bricht ab, falls danach noch ein Token verbleibt). Cloud/On-Premise unveraendert.
RUN if [ "$EDITION" = "community" ]; then node strip-cloud-only.cjs ./src; fi
# Statische Assets nach dist/ uebernehmen, ABER die JS-Quellen (app.js/billing.js) NICHT -
# die liefert Vite als Bundle. So enthaelt das community/onprem-dist KEINEN Billing-Quellcode
#. Vite baut editionsabhaengig: nur cloud bezieht das Billing-Modul ins Bundle (sonst
# Dead-Code-Elimination des dynamischen Imports).
RUN mkdir -p dist && cp -a src/. dist/ && rm -f dist/*.js \
    && VITE_EDITION="${EDITION}" npx vite build

# ---- Stage 2: nginx ----
# CVE-Reduktion: Bump nginx:1.27-alpine (Alpine 3.21) -> nginx:1.29-alpine (Alpine 3.23).
# Der libexpat-Fix (2.8.1-r0, CVE-2026-45186 HIGH) ist NICHT im Alpine-3.21-Branch verfuegbar,
# d. h. `apk upgrade` allein konnte ihn auf der alten Basis nicht ziehen -> Basis-Bump noetig.
FROM nginx:1.29-alpine

#: Alpine-Pakete der Basis auf gepatchte Staende heben (Trivy meldete u. a. libssl3/
# libcrypto3, libpng, libxml2, musl, zlib, nghttp2-libs, libexpat) -> `apk upgrade` zieht die
# verfuegbaren Sicherheitsupdates des Basis-Branches nach.
RUN apk upgrade --no-cache

# Copy nginx configuration
COPY frontend/nginx.conf /etc/nginx/nginx.conf

# Vorverarbeitete statische Assets + gebundeltes app.js (inkl. gebrandetem Logo/Favicon/Theme)
COPY --from=build /build/dist /usr/share/nginx/html

# Edition zur Build-Zeit als statisches config.json einbacken. Default "cloud";
# per `--build-arg EDITION=onpremise|community` ueberschreibbar. Das Frontend nutzt
# primaer GET /api/version; config.json dient als statischer Build-Nachweis/Fallback.
ARG EDITION=community
RUN printf '{"edition": "%s"}\n' "${EDITION}" > /usr/share/nginx/html/config.json

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
