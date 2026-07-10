# Ansimate Operator — Agent Skill

A **vendor-neutral agent skill** that lets an AI agent operate an [Ansimate](../../README.md)
instance (the self-hosted Ansible-Playbook web platform) over its REST API: manage devices,
list/upload/delete playbooks, create and run scenarios, trigger playbook runs, and read or
cancel jobs.

It is designed to be used by **any tool-using agent** — Claude (Claude Code, the Agent SDK,
claude.ai Skills), Google Gemini, and others — through a **self-contained, dependency-free
Python CLI**, with a plain `curl` / PowerShell fallback for environments without Python.

## Contents

```
skills/ansimate/
├── SKILL.md                 # Agent-facing instructions (frontmatter: name + description)
├── scripts/ansimate_cli.py  # Zero-dependency CLI (Python 3 standard library only)
└── README.md                # This file — human/integrator documentation
```

- **`SKILL.md`** is what the *agent* reads: the operating procedure, validation rules, the CLI
  command reference (Method A) and a direct-HTTP fallback (Method B).
- **`ansimate_cli.py`** is the *tool*: a small `urllib`-based client, no `pip install` required.
- **`README.md`** (this file) is for the *human/integrator* wiring the skill into an agent.

## Requirements

- **Python 3.8+** — standard library only (uses `urllib`; nothing to install), **or**
- any HTTP client (`curl`, PowerShell `Invoke-RestMethod`) if Python is unavailable
  (see *Method B* in `SKILL.md`).
- Network access to your Ansimate instance and a valid **API token** (or an authenticated
  browser session — see *Authentication & scopes*).

## Configuration

The skill reads two settings from environment variables (or a project `.env` file):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ANSIMATE_URL` | no | `http://ansimate.eu` | Base URL of your Ansimate instance |
| `ANSIMATE_API_TOKEN` | yes¹ | – | Bearer token, format `asm_tok_…` |

Create a token in the Ansimate web UI under **Profil → API-Token** and grant it the scopes your
agent needs (see below). Example `.env`:

```env
ANSIMATE_URL=https://ansimate.example.com
ANSIMATE_API_TOKEN=asm_tok_your_token_here
```

¹ A few operations require a browser **session** instead of a token — see below.

## Authentication & scopes

All requests send `Authorization: Bearer <token>`. Access is **scope-gated on the server** — an
out-of-scope call returns **`403`**. Give the token the union of scopes for the commands your
agent will use:

| Scope | Grants access to | CLI commands |
|---|---|---|
| `run_playbook` | `POST /api/run` | `run` |
| `read_logs` | `/api/jobs`, `/api/jobs/**` | `jobs`, `job-logs`, `cancel-job` |
| `manage_devices` | `/api/devices**`, device-groups | `list-devices`, `create-device`, `delete-device` |
| `manage_scenarios` | `/api/profile/scenarios`, presets, `GET /api/playbooks` | `list-scenarios`, `create-scenario`, `delete-scenario`, `list-playbooks` |

- **`version`** (`GET /api/version`) is **public** — it always works (useful as a connectivity check).
- **Session-only** (no token scope covers these — run them from an authenticated **browser
  session / cookie**, not a pure API token):
  - `upload-playbook` → `POST /api/playbooks/upload`
  - `delete-playbook` → `DELETE /api/playbooks/custom/…`
  - the automatic tier pre-check → `GET /api/profile`
- Playbook **upload is additionally gated by edition/tier** (see *Safety rules*): unavailable in
  the Community Edition and on the Free tier.

## Capabilities (CLI overview)

Preferred usage is `python scripts/ansimate_cli.py <command>`. Full examples with every flag are
in [`SKILL.md`](SKILL.md).

| Area | Commands |
|---|---|
| Connectivity | `version` |
| Devices | `list-devices`, `create-device`, `delete-device` |
| Playbooks | `list-playbooks`, `upload-playbook`¹, `delete-playbook`¹ |
| Scenarios | `list-scenarios`, `create-scenario`, `delete-scenario` |
| Execution | `run` (playbook **or** scenario) |
| Jobs / logs | `jobs`, `job-logs`, `cancel-job` |

¹ Session-only (see *Authentication & scopes*).

Global flags: `--url` and `--token` override `ANSIMATE_URL` / `ANSIMATE_API_TOKEN` per call.

## Safety rules (enforced by the CLI)

Before an `upload-playbook` the CLI performs three guardrail checks and aborts with a clear
message on failure:

1. **Edition check** — refuses on the Community Edition (custom uploads unsupported).
2. **Tier check** — refuses on the Free tier (uploads are a premium feature).
3. **Duplicate check** — refuses if a playbook with the same name or filename already exists.

## Installing the skill into an agent

### Claude (Claude Code · Agent SDK · claude.ai)

Agent Skills are folders containing a `SKILL.md` with `name` + `description` frontmatter (already
present here). Make this folder discoverable by your agent:

- **Claude Code:** copy or symlink `skills/ansimate/` into `~/.claude/skills/` (personal) or
  `<project>/.claude/skills/` (project-scoped). Claude auto-selects the skill from its
  `name`/`description` when a task matches.
- **claude.ai / Agent SDK:** register the skill folder per the Agent Skills documentation.

### Google Gemini & other agents

There is no cross-vendor skill standard yet, so wire it up manually:

- Provide **`SKILL.md`** to the agent as system/developer instructions (or as a Gemini CLI
  extension / tool definition).
- Ensure the agent can **execute shell commands** and has `ANSIMATE_URL` / `ANSIMATE_API_TOKEN`
  in its environment.
- Any agent that can run `python scripts/ansimate_cli.py …` (or `curl`) can then operate Ansimate.

### Generic / framework-agnostic

The skill is transport-agnostic: **`SKILL.md`** is the *procedure* (what to do, in what order,
with which safety checks), and **`ansimate_cli.py`** is the *tool*. Point any framework
(LangChain, a custom loop, an MCP host, …) at both.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 Unauthorized` | Token missing or invalid — check `ANSIMATE_API_TOKEN`. |
| `403 Forbidden` | Token lacks the scope for that endpoint, or the endpoint is session-only (upload/delete-playbook, profile). |
| `422 Unprocessable Entity` | Invalid payload — verify `--vars` JSON and required fields. |
| `429 Too Many Requests` | Rate-limited — back off and retry. |
| `Connection failed` | Wrong `ANSIMATE_URL` or the instance is unreachable. |

## See also

- [`SKILL.md`](SKILL.md) — agent instructions and the full command reference with examples.
- [`../../docs/API.md`](../../docs/API.md) — Ansimate REST API reference.
- [`../../README.md`](../../README.md) → *Agenten- & Automatisierungs-Kompatibilität*.
