# ---- Stage 1: Docker-CLI from-source bauen (Wegwerf-Stage) ----
# Die Docker-CLI (wird benoetigt, um die Sandbox zu starten) wird hier FROM-SOURCE mit einer
# gepatchten Go-Toolchain gebaut und als statisches Binary (CGO=0) ins Laufzeit-Image kopiert;
# weder der Go-Compiler noch curl landen im Runtime-Image (curls Transitiv-CVEs entfallen weiter).
# WARUM from-source statt Static-Download (lud es zuvor von download.docker.com): das
# offizielle Static-Binary ist (Stand 2026-07-11) noch mit Go 1.26.4 gebaut und traegt
# CVE-2026-39822 (HIGH, Go os.Root Symlink-Following) — auch die neueste Version 29.6.1; es gibt
# aktuell KEIN gefixtes Docker-Static-Release. Wir bauen docker/cli daher selbst mit Go >= 1.26.5
# (Fix enthalten) -> das Binary ist CVE-frei (Trivy 0 behebbare CRITICAL/HIGH).
# ZURUECK auf den simplen Static-Download wechseln, sobald Docker mit Go >= 1.26.5 released.
ARG BASE_IMAGE=python:3.11-slim-trixie
ARG GO_BUILDER_IMAGE=golang:1.26.5-bookworm

FROM ${GO_BUILDER_IMAGE} AS dockercli
# docker/cli-Version als Git-Tag. Die Abhaengigkeiten sind im docker/cli-Repo committet vendored
# (vendor.mod + vendor/) -> der Build laeuft offline (-mod=vendor); nur der flache Clone braucht Netz.
ARG DOCKER_CLI_VERSION=v29.6.1
RUN git clone --depth 1 --branch "${DOCKER_CLI_VERSION}" https://github.com/docker/cli.git /src \
    && cd /src \
    && ln -sf vendor.mod go.mod && ln -sf vendor.sum go.sum \
    && CGO_ENABLED=0 go build -mod=vendor -trimpath \
       -ldflags "-s -w -X github.com/docker/cli/cli/version.Version=${DOCKER_CLI_VERSION#v}" \
       -o /usr/local/bin/docker ./cmd/docker \
    && /usr/local/bin/docker --version

# ---- Stage 1b: Standard-Playbooks vorbereiten (editions-bewusst, LEAK-SICHER) ----
# Die Free-Tier-Playbooks werden ins Image gebacken, damit ein minimales Deployment OHNE
# gemountetes ./playbooks die Standard-Playbooks trotzdem im Katalog (GET /api/playbooks)
# anzeigt. WICHTIG: Premium-Playbooks (proprietaer) UND echte User-/Runtime-Daten (PII)
# werden HIER – in einer spaeter VERWORFENEN Stage – entfernt, BEVOR das bereinigte
# Verzeichnis ins finale Image kopiert wird. So landen Premium-/User-Inhalte in KEINER
# Layer des (oeffentlichen) Community-Images.
FROM ${BASE_IMAGE} AS playbooks-prep
ARG EDITION=community
WORKDIR /pbstage
COPY playbooks/ ./
# custom/ = echte User-Playbooks (PII), tmp/ + logs/ = Lauf-Artefakte -> NIE einbacken.
# Community (oeffentliches Image): zusaetzlich Premium-Dateien raus + Premium-Eintraege
# aus index.yml strippen. cloud/onpremise (private Images) behalten Premium.
RUN rm -rf custom tmp logs \
    && rm -rf premium  # Community: Premium-Playbooks raus (index.yml bereits premium-frei)

# ---- Stage 2: Laufzeit-Image ----
FROM ${BASE_IMAGE}

# Install system dependencies for SSH connection
#: Zusaetzlich `apt-get upgrade`, damit die Basis-Pakete auf die gepatchten Debian-Staende
# gehoben werden.
# CVE-Reduktion: Basis von python:3.11-slim-bookworm (Debian 12) auf python:3.11-slim-trixie
# (Debian 13) gehoben — trixie hat deutlich weniger offene (unfixed) OS-CVEs (Trivy CRITICAL 4->2,
# HIGH 15->9, Gesamt 206->137). `curl` ist NICHT mehr im Laufzeit-Image (Docker-CLI kommt aus der
# dockercli-Stage, der Healthcheck laeuft ueber Python) -> die curl-Transitiv-CVEs entfallen.
RUN apt-get update && apt-get -y upgrade && apt-get install -y --no-install-recommends \
    openssh-client \
    sshpass \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Docker-CLI aus der Downloader-Stage uebernehmen (kein curl/libcurl4 im Laufzeit-Image).
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app

# Hinweis: Der Build-Context ist das Repo-Root (siehe docker-compose.yml).

#: Build-/Packaging-Tools auf gepatchte Staende heben (Trivy: wheel CVE-2026-24049 ->
# 0.46.2, jaraco.context CVE-2026-23949 -> via aktuellem setuptools-Vendor).
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Copy requirements and install
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install ansible-core (Version gebunden, um unbemerkte Breaking Changes zu vermeiden)
RUN pip install --no-cache-dir "ansible-core>=2.16,<2.17"

# Copy application files
COPY backend/*.py ./
#: gevendortes sudo-Become-Plugin (sudo-rs-Prompt-Support, Ubuntu 25.10+); via
# ANSIBLE_BECOME_PLUGINS geladen. Liegt in einem Unterordner -> eigener COPY (backend/*.py greift nicht).
COPY backend/ansible_plugins/ ./ansible_plugins/

# : Backend als installierbares Paket registrieren. Edition = Paket-
# Installation: NUR die cloud-Edition erhaelt das editions/billing-Paket UND das Stripe-SDK;
# community/onpremise enthalten weder stripe noch Billing-Module -> kein proprietaerer Code
# im Core-Image. Laufzeit-Deps kommen aus requirements.txt -> --no-deps.
COPY backend/pyproject.toml ./
RUN pip install -e . --no-deps
# editions/ (cloud) ist ueber den Arbeitsordner importierbar.
ENV PYTHONPATH=/app

#: der frueher hier eingebackene Ordner backend/gdpdu/ ist entfernt (lokale GDPdU-Test-
# Exporte, die nie ins Repo gehoerten). Die GoBD/GDPdU-Logik liest ihr DTD ausschliesslich aus
# backend/editions/billing/gdpdu/ (cloud-only) und degradiert grazioes, wenn es fehlt
# (dtd_content bleibt leer -> DTD wird der Export-ZIP einfach nicht beigelegt). Der frueher nach
# /app/gdpdu/ kopierte Ordner wurde von keinem Code-Pfad gelesen -> ersatzlos entfernt.

# Edition zur Build-Zeit einbacken. Default "cloud"; per
# `docker build --build-arg EDITION=onpremise|community` ueberschreibbar.
# Ueberschreibt die eingecheckte backend/edition.py -> zur Laufzeit nicht aenderbar.
ARG EDITION=community
RUN echo "EDITION = \"${EDITION}\"" > edition.py

# Community-Edition: keine Rechtstexte eingebacken (externe Projekt-Verlinkung).
# -> get_legal_text liefert 404, das Frontend blendet die Footer-Links aus.
RUN mkdir -p ./legal

# Free-Tier-Standard-Playbooks aus der leak-sicheren Prep-Stage ins Image backen.
# Ohne gemountetes ./playbooks (minimal deployment) sind die Standard-Playbooks dadurch
# als Fallback unter /playbooks vorhanden und erscheinen im Katalog (GET /api/playbooks);
# ist ./playbooks gemountet, ueberlagert (gewinnt) weiterhin der Host. Das Community-Image
# enthaelt hier KEINE Premium-Playbooks (in der Prep-Stage entfernt). Hinweis: das AUSFUEHREN
# in einem mount-losen Deployment erfordert weiterhin HOST_PLAYBOOKS_DIR (gehaertete Sandbox).
COPY --from=playbooks-prep /pbstage/ /playbooks/

EXPOSE 8000

# Hinweis: Der Backend-Container laeuft derzeit als root, da er den docker.sock ansprechen
# und in die gemounteten Host-Volumes (/playbooks, /logs) schreiben muss. Ein Wechsel auf
# einen non-root-User erfordert das Mappen der docker-Group-GID des Hosts
# (stat -c '%g' /var/run/docker.sock) sowie passende Schreibrechte auf den Volumes -> separat testen.

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
