# Security Concept

This document describes the protective measures implemented in Ansimate, the deliberately accepted trade-offs, and the process for reporting vulnerabilities.

## Table of Contents

- [Encryption of Sensitive Data](#encryption-of-sensitive-data)
- [Authentication & Sessions](#authentication--sessions)
- [Two-Factor Authentication (2FA)](#two-factor-authentication-2fa)
- [API Tokens](#api-tokens)
- [Sandboxing of Playbook Execution](#sandboxing-of-playbook-execution)
- [Abuse Protection](#abuse-protection)
- [Transport & HTTP Hardening](#transport--http-hardening)
- [GDPR & Data Protection](#gdpr--data-protection)
- [Audit Log](#audit-log)
- [Deliberate Trade-offs](#deliberate-trade-offs)
- [Reporting Vulnerabilities (Vulnerability Disclosure)](#reporting-vulnerabilities-vulnerability-disclosure)

## Encryption of Sensitive Data

- **SSH credentials** (passwords and private keys) are encrypted **before** being stored in
  PostgreSQL: **AES-256-GCM** with a random 12-byte nonce; the 256-bit key is derived via
  SHA-256 from `ENCRYPTION_KEY` (or `SECRET_KEY`). The ciphertext is stored base64-encoded with
  the prefix `aesgcm:`. A Fernet fallback exists for legacy data. *(`backend/crypto.py`)*
- **Fail-closed:** Without a configured `ENCRYPTION_KEY`/`SECRET_KEY`, the backend refuses to
  encrypt credentials; an insecure development fallback is only possible via an explicit flag,
  and in production an error is raised.
- **Passwords** are hashed with **bcrypt** (automatic salt). *(`backend/auth.py`)*
- For execution, credentials are only written briefly to **temporary inventory files** and are
  **masked** in logs (`mask_secrets`).

## Authentication & Sessions

- Login by username **or** email; sessions as an **HttpOnly** cookie, `SameSite=strict`,
  `Secure` via `COOKIE_SECURE` (default `true`), with a default lifetime of 14 days
  (`SESSION_EXPIRY_DAYS`).
- **Session invalidation:** on logout (individually) or "sign out everywhere" (all sessions);
  a **password change** invalidates all *other* sessions (the current one stays active);
  a **password reset** as well as a **deletion request** invalidate **all** sessions.
- **Roles:** `admin`, `user`, `guest`. Protected endpoints enforce login
  (`get_authenticated_user`) or admin privileges (`get_admin_user`).
- **Guest accounts** are bound to a primary account; if the primary account is deactivated
  or deleted, the guests immediately lose access (cascaded deactivation including session
  invalidation).

## Two-Factor Authentication (2FA)

- Optional per user (`two_factor_enabled`). With 2FA enabled, login does not return a session
  cookie but instead sends a **6-digit OTP code** by email.
- OTP validity is 10 minutes by default (`OTP_EXPIRE_SECONDS`, default 600), with verification
  via `/api/auth/verify-2fa`.
- **Brute-force protection:** at most 10 verification attempts per 10 minutes per email.

## API Tokens

- Generated with `secrets.token_hex(32)` and the prefix `asm_tok_`; only the **SHA-256 hash**
  is stored in the database. The plaintext token is shown **only once**, at creation time.
- **Scopes:** `run_playbook` and `read_logs`. Tokens are restricted via a **path gate** to
  `/api/run` and `/api/jobs` — other endpoints cannot be reached with a token.
- Before access is granted, the user's `is_active` status is checked (deactivated/banned users
  lose token access).
- The number of active tokens per account is limited (`max_active_api_tokens`, default 5).

## Sandboxing of Playbook Execution

Custom playbooks run in an **isolated, short-lived Docker container**:

- `--cap-drop ALL`, `--security-opt no-new-privileges`
- Resource limits: `--memory 512m`, `--cpus 1.0`, `--pids-limit 512`
- **tmpfs** for `/playbooks/tmp` and `/playbooks/custom` with `noexec,nosuid`
- **Read-only** mounts: the standard `/playbooks` directory, the **owner's own**
  custom directory, and the job-specific inventory/key material — each `:ro`
- **Fail-closed:** without a determinable owner (`user_id`) or without `HOST_PLAYBOOKS_DIR`,
  the run is **aborted** instead of executed insecurely.

Thanks to the tmpfs overlay, a container sees **only** its own custom playbooks and its own
job inventory — no other tenants' playbooks or credentials (tenant-isolated).
*(`backend/main.py`, run_playbook_background)*

In addition, an **execution timeout** applies (configurable, default 1 h, SIGTERM→SIGKILL
or `docker kill`) along with **path validation** against directory traversal
(`os.path.abspath`, prefix check against `/playbooks`).

### Docker Socket Hardening

The backend no longer has a **direct mount of `/var/run/docker.sock`** (an RWX mount would
effectively be equivalent to host root). Instead:

- **`docker-socket-proxy`** (`tecnativa/docker-socket-proxy`) sits between the backend and the
  Docker daemon; the backend only talks to the daemon via `DOCKER_HOST=tcp://docker-proxy:2375`.
  The proxy exposes **only** the API areas needed for the sandbox lifecycle:
  `Containers` (create/start/wait/remove/kill) and `Images` (inspect), with `POST=1`
  **only** on those areas. All other endpoints (e.g. `/networks`, `/volumes`, `/exec`,
  `/info`) are answered by the proxy with **403**. The host socket is mounted **read-only** in the proxy.
- **Traefik** also reads container discovery through a **read-only** proxy
  (`docker-proxy-traefik`, `POST` disabled) rather than through the host socket (defense in depth).
- **Bind-mount guard (fail-closed):** Before every start, the sandbox launcher enforces that no
  privileged flags (`--privileged`, `--volumes-from`, `--cap-add`, `--device`, host `--pid`/
  `--ipc`/`--net` …) are set and that **every** bind-mount source lies strictly within
  `HOST_PLAYBOOKS_DIR`. Any attempt to mount host root (`/`) or a path outside the
  playbook tree aborts the run. *(The socket proxy filters API endpoints,
  not mount contents — the guard closes that gap.)*

### Threat Model & Phased Plan for Strong Isolation (Cloud, Future Milestone)

**Residual risk:** In a multi-tenant cloud, the platform potentially runs untrusted third-party
code (custom playbooks). The socket proxy reduces the Docker API attack surface but does
**not** eliminate any kernel/container escape (shared host kernel). The current sandbox is
appropriate for single-tenant/on-premise; untrusted multi-tenant deployments require stronger
layers. Recommended phased plan:

1. **Rootless Docker / Sysbox** — sandbox containers run without real host root privileges;
   an escape lands in an unprivileged user namespace.
2. **Short-lived strong-isolation runtimes** — a **gVisor** (`runsc`) or **Kata** sandbox per
   job (its own kernel/micro-VM) instead of the shared host kernel.
3. **seccomp/AppArmor profiles** per sandbox + **no** host bind mounts (playbooks/inventory
   via short-lived volumes or a copy-in mechanism instead of host paths).
4. **Network egress policy** — restrict the sandbox's outbound traffic to the target hosts.

> These items should be tracked as a **future "Strong Isolation (gVisor/Kata) for Cloud"
> milestone** (follow-up work).

## Abuse Protection

- **Math captcha** (simple addition, 10-minute validity), optional via `CAPTCHA_REQUIRED`,
  on registration and password reset.
- **Rate limiting** (in-memory, per process): global default 60 req/min, 120 req/min per
  authenticated user; configurable via the settings `rate_limit_global_ip` /
  `rate_limit_user_ip`.
- **Dynamic IP bans:** after 5 violations within 10 minutes the IP is banned
  (default 24 h, `ip_ban_duration`); only valid IPs are persisted. Manual blacklist
  via `IP_BLACKLIST`, whitelist via `RATE_LIMIT_WHITELIST`.
- **Login lockout:** 5 failed attempts → 15-minute lockout (per email; generic
  error messages prevent user enumeration).
- **Token-based auth artifacts** (reset/verify tokens) are single-use and expire;
  expired captchas/OTPs/sessions are cleaned up by the cron worker.

## Transport & HTTP Hardening

- **TLS** is terminated at the Traefik edge (Let's Encrypt, ACME); **HSTS** is set there.
- **Content-Security-Policy** (nginx, main application): `default-src 'self'`,
  `script-src 'self'` (now WITHOUT `'unsafe-inline'` — no more inline scripts/handlers),
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: https:`, `font-src 'self' data:`, `connect-src 'self'`,
  `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`.
  For the API docs (`/docs`, `/redoc`), a relaxed CSP applies that additionally allows
  `https://cdn.jsdelivr.net` (Swagger UI/ReDoc scripts/styles),
  `img-src … https://fastapi.tiangolo.com`, and `worker-src 'self' blob:`.
- Additional headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer-when-downgrade`.
- Only **Traefik** exposes ports (80/443); the database, backend, and frontend are not directly
  reachable from outside.

## GDPR & Data Protection

- **Self-hosted fonts** — no requests to Google Fonts (no IP transmission to third parties).
- **Data export** (`GET /api/profile/export`) provides all personal data.
- **Right to erasure:** a deletion request marks the account with a 24-hour grace period; a
  background worker then **completely** removes sessions, devices, API tokens,
  device groups, jobs, job log files, the custom playbook directory, and associated
  guest accounts (`_purge_user_data`).
- Legal pages (legal notice/terms/privacy policy) and a data processing agreement (DPA)
  download (PDF) are integrated.

## Audit Log

Security-relevant admin actions are logged with actor, action, target, detail, IP, and
timestamp (`write_audit`) and can be viewed via `GET /api/admin/audit-log`
(last 200 entries).

## Deliberate Trade-offs

These points are known and accepted as a compromise:

- **SSH host key checking: TOFU:** Instead of `StrictHostKeyChecking=no`,
  `accept-new` is used together with a persisted `known_hosts`. New (first-seen) hosts are
  accepted automatically, while **changed** keys cause an abort — this protects the credentials
  passed in the inventory from silent MITM on subsequent connections. The first
  connection to an unknown host remains, by design, unprotected (inherent to the SaaS model).
- **CSP `unsafe-inline`** (now only `style-src`): The frontend no longer uses
  inline `onclick` handlers (switched to `data-*` + event delegation), so `script-src`
  has been tightened to `'self'`. `style-src` keeps `'unsafe-inline'` for the
  numerous inline styles in the SPA — a remaining hardening step.
- **Rate-limit state in-memory/per process:** in a multi-instance setup, a shared
  cache (e.g. Redis) would be required so that limits apply across instances.
- **`X-Forwarded-For`/`X-Real-IP`** are taken from the upstream proxy; in an untrusted
  network they can be spoofed (only valid IPs are persisted for bans).

## Reporting Vulnerabilities (Vulnerability Disclosure)

Please report security vulnerabilities **confidentially** and **not** via public issues:

1. Contact: the security/contact address listed in the legal notice/by the operator
   (e.g. `security@<your-domain>`).
2. Report contents: affected component/version, reproduction steps, potential
   impact, and — if available — a PoC.
3. Please grant us a reasonable period to remediate before details are published
   (coordinated disclosure).

We will confirm receipt, assess the finding, keep you informed of progress, and credit you
in the release notes if you wish.

> Note: This is the *template* for the disclosure policy. Before production use, enter
> a real, monitored contact address.
