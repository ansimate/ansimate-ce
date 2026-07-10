# Contributing to Ansimate

These guidelines apply to **all** contributions – whether from humans or AI agents.
The goal is a traceable, clean history and a reliable review process.

## Table of Contents

- [Branching Model](#branching-model)
- [Branch Naming Conventions](#branch-naming-conventions)
- [Commit Conventions](#commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Issues & Milestones](#issues--milestones)
- [Code Quality](#code-quality)
- [Architecture (Open Core)](#architecture-open-core)
- [Local Development & Tests](#local-development--tests)

## Branching Model

We work with a two-tier model based on Git-Flow:

- **`main`** – stable, releasable state. Development does **not** happen directly on `main`.
  Only reviewed, tested changes reach it via pull request.
- **`develop`** – integration/development branch. Features and bugfixes converge here
  and are tested together.
- **Feature/bugfix branches** – short-lived branches that branch off `develop` and
  flow back into `develop` via PR.

Flow: `feature/*` ▶ `develop` ▶ (release PR) ▶ `main`.

> Small, clearly scoped changes are also committed and pushed directly to `develop`
> during day-to-day work; larger or riskier work belongs in its own branch with a
> subsequent PR.

## Branch Naming Conventions

| Prefix | Usage | Example |
|---|---|---|
| `feature/` | new feature | `feature/device-groups` |
| `bugfix/` | bug fix | `bugfix/logout-catalog-refresh` |
| `docs/` | documentation | `docs/api-reference` |
| `chore/` | maintenance, build, dependencies | `chore/bump-traefik` |
| `security/` | security fixes | `security/sandbox-isolation` |

Short, descriptive, kebab-case names; when it relates to an issue, the number may be
included (e.g. `bugfix/164-legal-console`).

## Commit Conventions

We use **Conventional Commits**:

```
<type>(<scope>): <short description in the imperative mood>

<optional body: what and why, optionally issue references (#123)>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `security`.
Examples from the commit history:

```
fix(ui): logout catalog refresh, history-poll redirect loop, legal-page console
fix(gdpr): self-host Google Fonts, remove external CDN requests
feat(jobs): persist jobs in the database instead of jobs.json
```

Guidelines:

- **One logical change per commit.** Multiple issues in a single commit only if they
  affect the same file/topic; otherwise split into logical groups.
- Reference the affected issues in the body or subject (`#123`).
- Do **not** rewrite pushed commits via `--amend`/force-push once others might be
  building on them.
- Contributions from AI agents mark the co-author at the end of the commit message
  (`Co-Authored-By: ...`).

## Pull Request Process

1. Branch off `develop`, implement the change, test locally.
2. Open the PR **against `develop`** (release PRs `develop` ▶ `main` separately).
3. The PR description includes: what/why, linked issues (`Closes #123`), test evidence
   (which checks/tests ran, with what result).
4. Review: at least a second pair of eyes; for security-relevant changes, review
   adversarially. CI/build must be green.
5. After merge: close the associated issues and – if applicable – update the milestone.

## Issues & Milestones

- Every notable change has an **issue** (bug, feature, docs, security).
- Issues are grouped thematically into **milestones**.
- On completion: comment the issue with a **commit reference** and close it; once all
  issues of a milestone are done, close the milestone.
- Deliberately unimplemented points (accepted trade-offs) are **commented and left open**
  rather than silently closed.

## Code Quality

**General**

- New code reads like the surrounding code: same naming, same comment density, same
  idioms.
- No unused imports/variables; no commented-out dead code.
- Errors are logged server-side; clients receive **generic** error messages
  (no internal stack traces/path leaks).

**Backend (Python / FastAPI)**

- Validate inputs via **Pydantic v2 schemas** with `field_validator`.
- Line endings **LF** (see `.gitattributes`).
- Syntax check before committing, e.g. in a throwaway container
  (`backend/` is not mounted into the image – changes require `--build`):
  ```bash
  docker run --rm -v "$PWD/backend:/src" -w /src python:3.11-slim \
    python -m py_compile main.py auth.py models.py middleware.py crypto.py \
      extensions.py entitlements.py limits.py
  ```

**Frontend (Vanilla JS / CSS / HTML)**

- **Escape** user inputs/server-side strings before inserting them into the DOM (`escapeHtml`).
- `node --check frontend/src/app.js` before committing.
- No build step; assets live statically under `frontend/src/` (including self-hosted
  fonts – do **not** introduce external CDN/Google Fonts requests).

## Architecture (Open Core)

Ansimate follows an open-core model: an open-source core (community/on-premise) and
proprietary cloud extensions that plug in through defined seams. Anyone working on the
backend follows the **edition rules** – in particular: **no proprietary import
(`stripe`, billing) in the core**; edition features plug in via the `ExtensionRegistry`
(router/startup/maintenance/provider). The full edition contract is documented in
[docs/ARCHITECTURE_OPEN_CORE.md](docs/ARCHITECTURE_OPEN_CORE.md).

**OSS mirror & backmerge:** Development happens in the **private monorepo**; the public
community repo is a **read-only artifact** that CI generates and overwrites on `main` via
`scripts/community-export.sh` (+ leak guard). External PRs on the mirror are NOT merged
there but instead manually **merged back** into the monorepo (backmerge into `develop`).
Edition model (package-based, entry points) + publishing:
[docs/OPEN_CORE_PUBLISHING.md](docs/OPEN_CORE_PUBLISHING.md); release process:
[docs/RELEASE_RUNBOOK.md](docs/RELEASE_RUNBOOK.md).

## Local Development & Tests

```bash
cp .env.example .env          # fill in the required fields
docker compose up -d --build  # start the stack

# Backend changes only take effect after a rebuild:
docker compose up -d --build backend

# Integration tests
node tests/run.js
```

The backend has **no** host port mapping (reachable only internally via Traefik/nginx),
and Traefik redirects HTTP→HTTPS (308). API tests therefore run most easily
**inside the backend container** against `http://127.0.0.1:8000`, e.g.:

```bash
docker exec ansible_backend python /tmp/test.py   # BASE = http://127.0.0.1:8000
```

Alternatively via the full stack at `https://<APP_DOMAIN>`. When testing with
`COOKIE_SECURE=true` set, the session cookie is not sent over plain HTTP – in such cases,
take the `session_id` manually from the `Set-Cookie` header.
