---
name: ansimate_operator
description: Controls the Ansimate Ansible Playbook SaaS to manage devices, upload/delete playbooks, execute playbooks, manage scenarios, and read logs.
---
# Ansimate Operator Skill

This skill enables the agent to interact with the **Ansimate** web service (Ansible Playbook SaaS) to manage devices, upload/manage playbooks, trigger playbook runs, manage scenarios, and monitor logs.

## Initial Configuration

When this skill is activated in a project/workspace for the first time, check for the configuration:
1. Look for a `.env` file in the workspace or check active environment variables for:
   * `ANSIMATE_URL` (Defaults to `http://ansimate.eu` if not specified)
   * `ANSIMATE_API_TOKEN` (Required; format `asm_tok_...`)
2. If `ANSIMATE_API_TOKEN` is missing, you **must ask the user** to provide it.
3. Save these configurations to the project's `.env` file:
   ```env
   ANSIMATE_URL=http://ansimate.eu
   ANSIMATE_API_TOKEN=asm_tok_your_token_here
   ```
4. Verify connectivity by calling the Edition endpoint (`GET /api/version`).

## Authentication & Scopes (Important)

API tokens are **scope-gated** on the server; an out-of-scope call returns `403`. Available scopes:
- `run_playbook` → `POST /api/run`
- `read_logs` → `/api/jobs` (list, logs, cancel)
- `manage_devices` → `/api/devices` (list/create/delete, device-groups)
- `manage_scenarios` → `/api/profile/scenarios`, presets, `GET /api/playbooks`

Grant the token the scopes for the commands you will use. `GET /api/version` is public.

**Session-only — NOT reachable with an API token (they return `403`); use a logged-in browser
session (cookie) instead:** `upload-playbook` (`POST /api/playbooks/upload`), `delete-playbook`
(`DELETE /api/playbooks/custom/…`), and the tier pre-check (`GET /api/profile`).

---

## Playbook Upload Validation (Critical Rules)

Before attempting to upload a playbook:
1. **Edition Check**: Query the server edition (`GET /api/version`).
   - If the edition is `"community"`, **do not upload**. Print an error: *"Playbook upload is not supported in the Community Edition."*
2. **Subscription Tier Check**:
   - If the edition is a SaaS/commercial tier (e.g. `"saas"`), query the user profile (`GET /api/profile`).
   - Check the `abo_tier` or `tier` field. If it is `"Free"`, abort and warn: *"Custom playbook uploads are not allowed on the Free tier."*
3. **Duplicate Check**:
   - Query all existing playbooks (`GET /api/playbooks`).
   - If any playbook already has the same target name or filename, abort and warn: *"Playbook with name '<name>' or filename '<filename>' already exists."*

---

## Method A: Python CLI Helper (Preferred)

If Python is installed on the system, run the helper script `scripts/ansimate_cli.py` located inside this skill's directory. 

### CLI Commands:

#### 1. Connection & Version Check
```bash
python scripts/ansimate_cli.py version
```

#### 2. Manage Devices
* **List Devices**: `python scripts/ansimate_cli.py list-devices`
* **Create Device**:
  ```bash
  python scripts/ansimate_cli.py create-device --name "MyServer" --host "192.168.1.50" --username "root" --port 22 --credential "password_or_ssh_key_content" --credential-type "password"
  ```
* **Delete Device**: `python scripts/ansimate_cli.py delete-device --id "<device_id>"`

#### 3. Manage Playbooks (Includes validations)
* **List Playbooks**: `python scripts/ansimate_cli.py list-playbooks`
* **Upload Playbook**:
  ```bash
  python scripts/ansimate_cli.py upload-playbook --file "/path/to/playbook.yml" --name "Install Nginx" --desc "Installs nginx on host"
  ```
* **Delete Playbook**: `python scripts/ansimate_cli.py delete-playbook --filename "playbook.yml"`

#### 4. Manage Scenarios
* **List Scenarios**:
  ```bash
  python scripts/ansimate_cli.py list-scenarios
  ```
* **Create Scenario**:
  ```bash
  python scripts/ansimate_cli.py create-scenario --name "Deploy Webapp" --preset-id "<preset_id>" --device-group-id "<device_group_id>"
  ```
* **Delete Scenario**:
  ```bash
  python scripts/ansimate_cli.py delete-scenario --id "<scenario_id>"
  ```

#### 5. Run Playbook or Scenario
* **Run custom run**:
  ```bash
  python scripts/ansimate_cli.py run --playbook "Install Nginx" --device-id "<device_id>" --vars '{"port": 80}'
  ```
* **Run Scenario**:
  ```bash
  python scripts/ansimate_cli.py run --playbook "Install Nginx" --scenario-id "<scenario_id>"
  ```
  *(Note: --playbook is always required by the API schema, but scenario-id maps target and preset)*

#### 6. Jobs and Logs
* **List Jobs**: `python scripts/ansimate_cli.py jobs`
* **Get Job Logs**: `python scripts/ansimate_cli.py job-logs --job-id "<job_id>"`
* **Cancel Job**: `python scripts/ansimate_cli.py cancel-job --job-id "<job_id>"`

---

## Method B: Direct API via HTTP (Fallback)

If Python is not available, perform HTTP requests directly. All requests require `Authorization: Bearer <API_TOKEN>`.

### Common Operations:

#### 1. Version Check
* **curl**:
  ```bash
  curl -s -H "Authorization: Bearer $ANSIMATE_API_TOKEN" $ANSIMATE_URL/api/version
  ```
* **PowerShell**:
  ```powershell
  Invoke-RestMethod -Uri "$env:ANSIMATE_URL/api/version" -Headers @{ Authorization = "Bearer $env:ANSIMATE_API_TOKEN" } -Method Get
  ```

#### 2. Manage Scenarios
* **List Scenarios**:
  * **curl**:
    ```bash
    curl -s -H "Authorization: Bearer $ANSIMATE_API_TOKEN" $ANSIMATE_URL/api/profile/scenarios
    ```
  * **PowerShell**:
    ```powershell
    Invoke-RestMethod -Uri "$env:ANSIMATE_URL/api/profile/scenarios" -Headers @{ Authorization = "Bearer $env:ANSIMATE_API_TOKEN" } -Method Get
    ```
* **Create Scenario**:
  * **curl**:
    ```bash
    curl -s -X POST -H "Authorization: Bearer $ANSIMATE_API_TOKEN" -H "Content-Type: application/json" \
      -d '{"name": "Deploy Scenario", "preset_id": "PRESET_ID_HERE"}' \
      $ANSIMATE_URL/api/profile/scenarios
    ```

#### 3. Run Playbook / Scenario
* **curl**:
  ```bash
  curl -s -X POST -H "Authorization: Bearer $ANSIMATE_API_TOKEN" -H "Content-Type: application/json" \
    -d '{"playbooks": ["playbook_name_or_filename"], "scenario_id": "SCENARIO_ID_HERE"}' \
    $ANSIMATE_URL/api/run
  ```

---

## Error Handling
* **401 Unauthorized**: Check if your `ANSIMATE_API_TOKEN` is correct.
* **422 Unprocessable Entity**: The JSON payload was invalid. Verify variables format or required fields.
* **Rate Limits / 429 Too Many Requests**: Back off and wait before retrying.
