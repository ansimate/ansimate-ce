# Configuration Architecture for Complex & Combined Playbook Executions

> Design concept for combined playbook execution configuration. Describes how input
> variables for (potentially combined) playbook executions are collected, validated, and
> passed to Ansible — the current state, the problems, and the proposed architecture.

## Table of Contents

- [Current State](#current-state)
- [Problems with Combined Executions](#problems-with-combined-executions)
- [Concept 1: Variable Namespacing](#concept-1-variable-namespacing)
- [Concept 2: Per-Playbook Metadata Schema](#concept-2-per-playbook-metadata-schema)
- [Concept 3: Dynamic UI Form](#concept-3-dynamic-ui-form)
- [Concept 4: Shared Resources & Dependencies](#concept-4-shared-resources--dependencies)
- [Validation & Precedence](#validation--precedence)
- [Migration Path](#migration-path)

## Current State

How variables flow today:

1. **Collection (frontend):** `showCredentialsModal()` in `frontend/src/app.js` builds a
   form. Which fields appear is defined in a **hardcoded JS object**
   `playbookDomainConfigs` (filename → `[{label, variable, placeholder, type, required}]`).
   Default values come from the `variables` dicts of active presets (`presets.yml`), merged
   via `Object.assign`.
2. **Handoff (backend):** `POST /api/run` accepts `variables` (dict, validated: max 50,
   names `[a-zA-Z0-9_]{1,64}`, no `ansible` prefix, types string/int/float/bool/null).
   `run_playbook_background()` writes them as **inventory host variables** (`key='val'`
   per host line in `/tmp/inv_<job_id>`).
3. **Execution:** **A single** `ansible-playbook -i <inv> pb1.yml pb2.yml …` call with
   all selected playbooks as positional arguments. All playbooks share **one** host list
   and **one global variable namespace**.

**Present:** variable handoff, preset defaults, job history, server-side validation.
**Missing:** namespacing, a machine-readable variable schema *per playbook*, dynamic form
generation from that schema, a concept for shared resources.

## Problems with Combined Executions

When a user selects multiple playbooks (e.g. Ghost + PostgreSQL + Authelia):

- **Name collision:** Two playbooks expect `db_password` → one value overwrites the other
  (a single global namespace).
- **Shared resources:** Ghost and Authelia may want the *same* Postgres instance — today a
  variable cannot express a "reference to resource X".
- **Static form:** New playbooks require manual work in `playbookDomainConfigs`
  (JS) instead of being derived from the playbook metadata.
- **Port/network conflicts:** Multiple stacks that want the same host port are not
  detected.

## Concept 1: Variable Namespacing

**Rule:** Every input variable of a playbook is named with the **stack prefix**:
`{{stack}}_<name>` — e.g. `vaultwarden_domain`, `ghost_db_password`, `postgres_password`.

- Eliminates collisions without changing today's mechanism (global inventory namespace) —
  it is a **naming convention**, usable immediately.
- The pilot playbooks already follow it (`vaultwarden_*`, `postgres_*`).
- Generic variables without a prefix remain deliberately shared globally: `base_dir`,
  `timezone`, `use_traefik`, `ssh_user` (infrastructure, identical for all playbooks).

## Concept 2: Per-Playbook Metadata Schema

Instead of the hardcoded JS configuration, **each playbook declares its inputs in
`index.yml`** (already provided as a reference in the pilot entries):

```yaml
- file: create-stack-postgresql.yml
  name: "PostgreSQL"
  category: "System"
  requires: [install-docker.yml]
  variables:
    - name: postgres_user        # always stack-prefixed (Concept 1)
      label: "DB user"
      type: string               # string | secret | domain | port | bool | int | enum
      default: "appuser"
      required: false
    - name: postgres_password
      label: "DB password (empty = randomly generated)"
      type: secret               # -> password field, masked in logs
      required: false
```

**Field definitions:**

| Field | Meaning |
|---|---|
| `name` | Variable name (stack-prefixed) |
| `label` | Display name in the form |
| `type` | `string`/`secret`/`domain`/`port`/`bool`/`int`/`enum` → determines UI widget + validation |
| `default` | Prefilled value (overridable by presets) |
| `required` | Required field? |
| `options` | (`enum` only) allowed values |
| `depends_on` | (optional) show field only when a condition is met (e.g. `use_traefik=true`) |

The schema is delivered alongside `GET /api/playbooks` (the backend simply passes through
the `variables` field from `index.yml`).

## Concept 3: Dynamic UI Form

`showCredentialsModal()` generates the form **from the schema** instead of from
`playbookDomainConfigs`:

1. For each selected playbook, collect its `variables` schema.
2. Render the matching widget per entry (`secret`→password field, `bool`→checkbox,
   `enum`→select, `port`→numeric …).
3. Defaults: schema `default` < preset `variables` < most recently used job values < user input.
4. `depends_on` dynamically shows/hides dependent fields.
5. Validation client-side by `type`, still server-side in `RunRequest`.

`playbookDomainConfigs` is thereby removed (transition phase: the schema takes precedence,
with the JS object as a fallback for playbooks not yet migrated).

## Concept 4: Shared Resources & Dependencies

For cases like "multiple apps, one Postgres instance":

- **Explicit reference instead of duplication:** An app playbook declares a dependency on
  a *resource*, not on concrete credentials:
  ```yaml
  variables:
    - name: ghost_db_host
      type: string
      default: "postgres"          # container/service name of the shared DB
    - name: ghost_db_password
      type: secret
  ```
- **Execution order:** Since all playbooks run in **one** Ansible run in the chosen order,
  the resource (Postgres) is placed **before** its consumers. Recommendation: an optional
  `provides:`/`requires:` (resource tags) in `index.yml`, from which the frontend derives a
  **topological order** and enforces it at startup.
- **Shared Docker network:** Apps and DB on the same external network (`local`, as with
  `use_traefik`), so the DB is reachable via its service name.
- **Port-collision check:** From the `port` variables of the selected playbooks the
  frontend can detect duplicate host ports and warn before the job starts.

## Validation & Precedence

Value origins (from low to high):

```
Playbook default  <  Preset variables  <  last job values  <  user input in the form
```

- **Type validation:** client-side by `type`; server-side, the existing `RunRequest`
  validation remains authoritative (lengths, names, allowed types).
- **Secrets:** `type: secret` → password field; values are masked in the execution logs
  (cf. `mask_secrets`) and should be handled in playbooks with `no_log: true`
  (see `create-stack-postgresql.yml`).
- **Limits of masking:** `no_log`/`mask_secrets` only protects the **Ansible/UI logs**.
  As a container environment variable (e.g. `POSTGRES_PASSWORD`), a password remains visible
  via `docker inspect` on the target host. For stricter requirements, use Docker secrets or
  a secret store (e.g. Vault).

## Migration Path

1. **Now:** Namespacing convention established; example `variables` schema provided on the
   pilot playbooks (`index.yml`); this document as a guideline.
2. **Backend (implemented):** `GET /api/playbooks` passes through the `variables` field from
   `index.yml` (empty if not declared) — the data foundation for schema-driven forms is thus
   in place.
3. **Frontend (follow-up):** rebuild `showCredentialsModal()` to be schema-driven; phase out
   `playbookDomainConfigs` step by step.
4. **Extended (follow-up):** `provides`/`depends_on`, topological ordering, port-collision
   check.

Steps 2–4 are independent follow-up tasks; the current work delivers the concept and the
convention-compliant pilot playbooks as validation of the architecture.
