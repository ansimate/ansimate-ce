# Community Edition

The **Community Edition** is the open-source (AGPL-3.0) single-user variant of Ansimate for
private use (e.g. on a home network) – no paywall, minimal onboarding, and published as a
hardened public mirror with ready-made container images.

## Table of Contents

- [Vision](#vision)
- [Sign-in & Users](#sign-in--users)
- [What's Included](#whats-included)
- [My Vault in the Community Edition](#my-vault-in-the-community-edition)
- [Installation](#installation)
- [Configuration](#configuration)

## Vision

- One person runs Ansimate locally for their own devices.
- Open source (AGPL-3.0), self-hostable, transparent.

## Sign-in & Users

The Community Edition has **exactly one user: the system admin.** It is created on first startup
from `ADMIN_USERNAME`/`ADMIN_PASSWORD` (Docker Compose/`.env`); `ADMIN_PASSWORD` is mandatory –
without this value the edition deliberately does not boot.

- **No self-registration** and no email verification (the corresponding routes return `404`).
- **No teams/guest accounts** – the Community Edition is intentionally single-admin.
- Login is required; anonymous playbook execution can be enabled via `ALLOW_ANONYMOUS_RUN`.

## What's Included

**Included:** standard playbook catalog (free tier, baked into the image), device management with
encrypted SSH credentials, job queue with live logs/history (including job cancellation), scenarios
for 1-click deployments, admin panel (dashboard, IP bans, logs, settings), API tokens, optional 2FA.

## My Vault in the Community Edition

"My Vault" is available to the system admin, but is limited to the areas that make sense in the
single-admin edition:

- **Scenarios** and **devices** can be created, edited, and deleted.
- The **"Share" button is omitted** – with no other users/teams there is nothing to share.

## Installation

The Community Edition ships in two variants – **"Full"** (its own Traefik,
`docker-compose.yml`) and **"Homelab"** (existing reverse proxy, `docker-compose.homelab.yml`).
The step-by-step guide with required values and update commands is in the
project [README.md](../README.md).

## Configuration

Minimal `.env` for local single-user operation:

```dotenv
APP_DOMAIN=localhost
APP_BASE_URL=https://localhost
COOKIE_SECURE=false           # if run without TLS on the LAN

# Required fields
POSTGRES_PASSWORD=...
ENCRYPTION_KEY=...            # openssl rand -base64 32
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...            # required – without this value the Community Edition does not boot

# Optional: your own/executable playbooks (the free-tier catalog is baked into the image and
# visible in the catalog even without this mount)
# HOST_PLAYBOOKS_DIR=/opt/ansimate/playbooks
```

> When run without TLS on a home network, `COOKIE_SECURE=false` must be set, otherwise the browser
> will not send the session cookie (login not possible). For external access, TLS is still strongly
> recommended.

See also: [README.md](../README.md)
