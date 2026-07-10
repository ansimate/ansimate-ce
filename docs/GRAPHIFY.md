# Graphify Knowledge Graph

[Graphify](https://graphify.net/) ([GitHub](https://github.com/safishamsi/graphify), PyPI `graphifyy`)
turns the repository into a **queryable knowledge graph** (code, SQL, scripts, docs) and
provides it as context to AI coding agents (Claude, Qwen, Gemini, Antigravity, Cursor, Windsurf, Cline, Copilot …).
Instead of searching blindly, agents query the graph: "What depends on `create_app()`?",
"Which routes does the billing provider use?".

> ### ⚠️ Token / Cost Warning
> A **full / deep** build (`./graphify_rebuild.sh`) runs the **semantic
> LLM extraction across the entire repo** and can consume **a lot of tokens (= money)**.
> Only run it **deliberately**, by a developer with a **high token limit**.
> **Never automatically/accidentally** (not in CI, not by an agent without explicit
> approval). Day-to-day work goes through the **cheap** incremental path (`graphify update .`,
> code = AST, no LLM).

## Architecture / Workflow

| Step | Who | Cost | How |
|---|---|---|---|
| **Create baseline** (full build) | deliberate, developer with high token limit | **expensive** (LLM) | `./graphify_rebuild.sh` |
| **Share baseline** | committed to the repo | – | `docs/graphify.zip` |
| **Consume baseline** (unpack locally) | any developer/agent | free | `./graphify_update.sh` |
| **Keep up to date** (on commit) | any developer/agent | cheap (AST/cache) | `graphify update .` |

- **`docs/graphify.zip`** is the **shared, versioned baseline** of the graph. It is refreshed **only**
  via a full rebuild (see warning), so that the repo is not bloated by binary diffs.
- **`graphify-out/`** is the local working state (contains `graph.json`, `GRAPH_REPORT.md`,
  `graph.html`, `cache/`) and is **gitignored**.
- Incremental updates on commit only keep the **local** `graphify-out/` up to date — the shared
  zip is **not** re-committed in the process.

## Installation

```bash
uv tool install graphifyy        # recommended
# alternatively: pipx install graphifyy   |   pip install --user graphifyy
graphify install                 # register the skill with the installed agents
```

A pure **code** graph runs **offline without an API key**. Deep semantic extraction of **docs/images**
requires an LLM key (`ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY`).

## Usage in this repo

```bash
# 1) Make the shared baseline available locally (free, no tokens):
./graphify_update.sh            # unpacks docs/graphify.zip -> graphify-out/

# 2) Pick up your own changes while working (cheap, no LLM for code):
graphify update .

# 3a) Rebuild the free code base (AST, no LLM/key) and commit:
./graphify_rebuild.sh --code-only

# 3b) ONLY deliberately & rarely: rebuild the DEEP semantic baseline (TOKEN-INTENSIVE) and commit:
./graphify_rebuild.sh           # = --deep; asks for confirmation ('ja') before the expensive run
git add docs/graphify.zip && git commit -m "chore(graphify): update baseline"
```

`./graphify_rebuild.sh` builds **`--deep`** by default (semantic LLM extraction, **token-intensive**,
requires an API key) and demands an explicit confirmation beforehand (`--yes` skips it only
for deliberate, non-interactive runs). **`--code-only`** builds the pure code graph for free.

> **Note on the checked-in baseline:** The currently committed `docs/graphify.zip` is a
> **code-only baseline** (AST, ~1100 nodes). The deep semantic enrichment (docs/images, LLM)
> is the deliberate high-token step: run `./graphify_rebuild.sh` with an API key set and re-commit the
> zip.

## Rules (Agents)

The generic graphify rules (mandatory use when `graphify_*.sh` is present, incremental
update on commit, the rebuild token guard) live in the **portable guardrails ruleset**
(`rules/graphify.md` + a mirrored MANDATORY line in all agent entrypoints) and are propagated
centrally across projects — not duplicated in this repo.
