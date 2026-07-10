# Ansimate – Community Edition

**Ansimate** is a self-hosted web platform for the controlled execution of
[Ansible](https://www.ansible.com/) playbooks against remote hosts – with user and
device management, encrypted SSH credentials and sandboxed execution of your own
playbooks.

This repository is the **public community mirror** of the open-core codebase. The
backend is a FastAPI monolith, the frontend a lean vanilla-JavaScript SPA;
the stack is shipped via Docker Compose behind a Traefik reverse proxy with
automatic Let's Encrypt TLS.

---

## Table of Contents

- [Who is the Community Edition for?](#who-is-the-community-edition-for)
- [Feature Highlights](#feature-highlights)
- [System Requirements](#system-requirements)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Available Playbooks](#available-playbooks)
- [Security](#security)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Who is the Community Edition for?

The Community Edition is aimed at **self-hosted single-user or homelab operation**:
one person runs Ansimate as the sole system administrator, locally, for their own devices. Typical
use cases:

- **Homelab/self-hosting:** roll out standard stacks (Pi-hole, Traefik, Prometheus, Node-RED, …) to
  your own devices with a single click.
- **Recurring setup:** make server setups accessible through a web interface,
  without having to deal directly with inventories or SSH keys on the command line.

Every execution is persisted as a **job** (status, progress, live logs) and survives
a restart of the backend.

## Feature Highlights

- **Playbook execution** against a single host or **multiple devices at once** (selected per
  checkbox in a scenario or preset), with live log streaming and a persistent job history in the database.
- **Asynchronous task queue** with a configurable concurrency limit (`MAX_CONCURRENT_RUNS`):
  excess runs wait with the status "Queued" and are processed as soon as a
  worker becomes free.
- **Standard playbook catalog** (free tier, baked into the image) plus **presets** and
  **scenarios** for one-click deployments. (Uploading your own custom playbooks is part of the
  Cloud/On-Premise editions, not the Community Edition.)
- **Hardened architecture:** only Traefik exposes ports to the outside; the Docker daemon is
  accessed exclusively through a **docker-socket-proxy** (no direct
  host `docker.sock` mount) – see [SECURITY.md](../SECURITY.md).
- **Device management** with **AES-256-GCM-encrypted** SSH credentials (password or
  key) in PostgreSQL.
- **My Vault:** create, edit and delete scenarios and devices (one-click deployments).
  In the single-admin Community Edition without team sharing.
- **Notifications:** email on start/success/failure of a run, as well as optional
  **webhooks** (JSON payload to Slack/Teams/Discord or similar).
- **API tokens** (bearer, SHA-256-hashed) with scopes `run_playbook` / `read_logs` for
  automation (bots/CI) – limited to `/api/run` and `/api/jobs`; available to the system admin as well.
- **Agent-/automation-friendly:** built-in OpenAPI docs (`/openapi.json`, `/docs`),
  API discovery tags in the HTML `<head>` and a version/health endpoint `GET /api/version`.
- **Security & abuse protection:** bcrypt passwords, HttpOnly/Secure/SameSite sessions,
  rate limiting, dynamic IP bans and brute-force login lockout.

## System Requirements

- Linux host with **Docker** and **Docker Compose v2**.
- A reachable DNS name or local hostname for the reverse proxy (recommended for TLS).
- Outbound SSH access (port 22) to the target devices to be managed.

## Quick Start

Common preparation:

```bash
git clone https://github.com/ansimate/ansimate-ce ansimate
cd ansimate

# Derive .env from the template and set the required values (see Configuration)
cp .env.example .env
# Generate ENCRYPTION_KEY:  openssl rand -base64 32
```

There are two deployment variants – pick one:

### "Full" variant (standalone) — `docker-compose.yml`

Brings **everything with it** (including its own Traefik reverse proxy + Let's Encrypt) and **builds the images
from source**. Ideal if the host does not yet have a reverse proxy or you want to customize things.

```bash
docker compose up -d --build
```

### "Homelab" variant (existing reverse proxy) — `docker-compose.homelab.yml`

Uses **prebuilt public images** ([`ansimate/ce-*` on Docker Hub](https://hub.docker.com/u/ansimate),
no build) and hooks into an **already existing** reverse proxy (e.g. your Traefik) on an external
Docker network – without its own Traefik/ACME. db/backend run on an internal network that is not
reachable from the outside.

```bash
# Additionally set in .env: PROXY_NETWORK (name of your existing proxy network),
# APP_DOMAIN, TRAEFIK_ENTRYPOINT (web|websecure); for plain HTTP also COOKIE_SECURE=false.
docker compose -f docker-compose.homelab.yml up -d
# Update:  docker compose -f docker-compose.homelab.yml pull && docker compose -f docker-compose.homelab.yml up -d
```

> TLS is terminated here by your upstream proxy. The standard free-tier playbooks are baked into the
> image; a `./playbooks` mount (as included in the variant) is only needed for running/your own
> playbooks.

After startup, the interface is reachable via the hostname configured in the `.env`.
Log in with `ADMIN_USERNAME`/`ADMIN_PASSWORD`; this account has unrestricted access.

## Configuration

A commented template is available in [`.env.example`](../.env.example). A minimal example for
local single-user operation as well as all Community-specific notes are in
[docs/COMMUNITY.md](COMMUNITY.md). Important required values:

| Variable             | Meaning                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `POSTGRES_PASSWORD`  | Password of the bundled PostgreSQL database                     |
| `ENCRYPTION_KEY`     | Key for SSH credential encryption (`openssl rand -base64 32`)   |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Initial admin account                            |
| `HOST_PLAYBOOKS_DIR` | Host path under which playbooks/logs are persisted              |

> When operated without TLS on a home network, `COOKIE_SECURE=false` must be set, otherwise
> the browser will not send the session cookie. For access from the outside, TLS is strongly recommended.

## Available Playbooks

The bundled catalog is located under [`playbooks/`](../playbooks) and is described via
`playbooks/index.yml`. Your own playbooks can be uploaded as YAML; the
supported variables are documented in [docs/PLAYBOOKS_VARIABLES.md](PLAYBOOKS_VARIABLES.md).

## Security

The architecture and hardening measures (sandbox, docker-socket-proxy, credential encryption,
session handling) are described in [SECURITY.md](../SECURITY.md). Please report
security-relevant findings according to the guidance given there.

## Documentation

- [docs/COMMUNITY.md](COMMUNITY.md) – Community operation, configuration, limitations
- [docs/PLAYBOOKS_VARIABLES.md](PLAYBOOKS_VARIABLES.md) – Variables for (custom) playbooks
- [docs/ACCESSIBILITY.md](ACCESSIBILITY.md) – Accessibility
- [SECURITY.md](../SECURITY.md) – Security model

## Contributing

Contributions are welcome – see [CONTRIBUTING.md](../CONTRIBUTING.md) for setup,
code style and the pull request process.

## License

See [LICENSE](../LICENSE).
