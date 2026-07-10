# ---- Stage 1: Docker-CLI-Downloader (Wegwerf-Stage) ----
# CVE-Reduktion: Das Docker-CLI-Binary wird in einer separaten Build-Stage geladen, damit
# `curl` (und seine Transitiv-Deps libcurl4/libssh2-1/libldap-2.5-0) NICHT ins Laufzeit-Image
# gelangen. Das entfernt ~6 HIGH-CVEs aus dem Backend-Image (Trivy).
ARG BASE_IMAGE=python:3.11-slim-trixie

FROM ${BASE_IMAGE} AS dockercli
# Install Docker CLI static binary (wird benoetigt, um die Sandbox zu starten).
# Optionale Integritaetspruefung: beim Build  --build-arg DOCKER_SHA256=<sha256>  setzen.
# Die offizielle Checksumme steht unter:
#   https://download.docker.com/linux/static/stable/x86_64/  (Datei .sha256)
#: Bump 24.0.7 -> 29.5.3. Das alte static-Binary war mit Go 1.20.10 gebaut und schleppte
# 19 Go-stdlib-CVEs (CRITICAL/HIGH) ins Backend-Image; die aktuelle Version ist mit neuem Go gebaut.
ARG DOCKER_VERSION=29.5.3
ARG DOCKER_SHA256=
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" -o docker.tgz \
    && if [ -n "$DOCKER_SHA256" ]; then echo "${DOCKER_SHA256}  docker.tgz" | sha256sum -c -; \
       else echo "WARNUNG: Keine DOCKER_SHA256 gesetzt - Integritaet des Docker-CLI-Downloads nicht geprueft."; fi \
    && tar -xzf docker.tgz --strip-components=1 docker/docker \
    && mv docker /usr/local/bin/ \
    && rm docker.tgz

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

# : statisches GDPdU-DTD-Asset fuer den GoBD-Steuerexport einbacken.
COPY backend/gdpdu/ ./gdpdu/

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
