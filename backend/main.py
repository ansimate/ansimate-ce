import os
import uuid
import json
import threading
import queue
import subprocess
import asyncio
import yaml
import re
import random
import io
import zipfile
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict
from sqlalchemy.orm import Session as DBSession
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Cookie, File, UploadFile, Form, Body
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, field_validator

from database import engine, Base, get_db, SessionLocal
from models import Setting, User, Session, OTP, LoginAttempt, Device, IPBlock, IPBlockHistory, APIToken, Captcha, CustomPreset, Scenario, AuditLog, TeamAuditLog, Job, StatsSnapshot
from middleware import SecurityMiddleware, SessionAuthMiddleware
from auth import verify_session, get_password_hash, verify_password, create_user_session, delete_session
from crypto import encrypt_credential, decrypt_credential
from edition import EDITION
from version import APP_VERSION
from extensions import ExtensionRegistry
import entitlements
import limits

# Guard the edition against allowed values (unknown/empty build arg -> 'cloud').
# IMPORTANT: EDITION is set exclusively at BUILD TIME (backend/edition.py,
# generated from `--build-arg EDITION`). It must NEVER be read from os.environ,
# otherwise the edition would be manipulable at runtime.
EDITION = EDITION if EDITION in ("cloud", "onpremise", "community") else "cloud"
print(f"[edition] Aktive Edition (build-time): {EDITION}")
# Community-Edition: The application runs exclusively as ONE local
# system administrator. Their username is configured via the Compose variable
# ADMIN_USERNAME (default "admin"); password via ADMIN_PASSWORD.
COMMUNITY_ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")


def ensure_system_admin(db: DBSession) -> Optional[User]:
    """Idempotent, edition-wide upsert of the system administrator.

    The system admin configured via ADMIN_USERNAME/ADMIN_PASSWORD is created/healed
    consistently ONCE in EVERY edition. The unique username prevents duplicates.
      * Community: The admin is mandatory for login (since). If they exist, role
        and active status are healed and the password is resynced from ADMIN_PASSWORD (authoritative
        login source -> no lockout). If ADMIN_PASSWORD is missing, a warning is emitted (no admin login).
      * Cloud/On-Premise: The env-provisioned admin is OPTIONAL -> only act if
        ADMIN_PASSWORD is set (unchanged behavior). The password is NOT
        overwritten (the admin manages it themselves); only role/active status are healed.
    """
    username = COMMUNITY_ADMIN_USERNAME
    pw = os.environ.get("ADMIN_PASSWORD")
    # Cloud/On-Premise without ADMIN_PASSWORD: no env admin -> unchanged behavior (no-op).
    if EDITION != "community" and not pw:
        return None
    admin = db.query(User).filter(User.username == username).first()
    if admin:
        changed = False
        if admin.role != "admin":
            admin.role = "admin"
            changed = True
        if not admin.is_active:
            admin.is_active = True
            changed = True
        # Password resync only in the Community-Edition (ADMIN_PASSWORD = authoritative login source).
        # Cloud/On-Premise manage their admin password themselves and are NOT overwritten.
        if EDITION == "community" and pw and not verify_password(pw, admin.hashed_password):
            admin.hashed_password = get_password_hash(pw)
            changed = True
        if changed:
            db.commit()
        return admin
    if not pw:
        # only reachable in the Community-Edition (Cloud/On-Premise returned above)
        print(f"[community-edition] WARNUNG: ADMIN_PASSWORD ist nicht gesetzt — der System-Admin "
              f"'{username}' wird NICHT angelegt und es ist kein Admin-Login moeglich. Bitte "
              "ADMIN_PASSWORD in der Umgebung (.env / docker-compose) setzen und neu starten.")
        return None
    admin = User(
        username=username,
        email=os.environ.get("ADMIN_EMAIL", f"{username}@local"),
        hashed_password=get_password_hash(pw),
        role="admin",
        tier="pro",
        agb_accepted_at=datetime.utcnow(),
        dsgvo_accepted_at=datetime.utcnow(),
        email_verified=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin

# : No separate DEV_DUMMY_DATA flag anymore. The mock/demo mode is derived
# solely from whether REAL Stripe credentials are stored: only if both
# STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set (not empty) does the
# live mode run; if either/both are missing, mock mode is active (demo invoices, no real
# Stripe calls). Defaults are therefore empty instead of placeholder keys.
# : automatic tax calculation (Stripe Tax) at checkout. Enabled by default;
# requires a tax setting configured in Stripe. Can be disabled via
# STRIPE_AUTOMATIC_TAX=false if needed (e.g. if Stripe Tax is not set up).




# : Result of the Stripe connection test at startup. Shown in the admin panel
# so that a faulty live configuration (wrong/expired key, no network connectivity)
# is immediately visible. status: "mock" | "ok" | "error".


# : _check_stripe_connection() now lives in billing.py (Stripe SDK) and is registered
# as a startup hook of the cloud billing extension. STRIPE_CONNECTION (a pure status dict)
# stays in the core so the admin status display works even without billing installed.

# API docs controllable via ENABLE_API_DOCS (default on). Can be disabled in prod.
_API_DOCS_ENABLED = os.environ.get("ENABLE_API_DOCS", "true").lower() == "true"


def _allow_anonymous_run() -> bool:
    # : Spam protection. If ALLOW_ANONYMOUS_RUN=false, only authenticated
    # users may run playbooks. Default true (behavior unchanged). Read per request
    # so that Compose/env changes take effect without a code change.
    return os.environ.get("ALLOW_ANONYMOUS_RUN", "true").lower() == "true"
app = FastAPI(
    title="Ansible Playbook Runner API",
    version=APP_VERSION,
    docs_url="/docs" if _API_DOCS_ENABLED else None,
    redoc_url="/redoc" if _API_DOCS_ENABLED else None,
    openapi_url="/openapi.json" if _API_DOCS_ENABLED else None,
)

#: In the Community-Edition, hide cloud/onpremise-specific endpoints from the OpenAPI/
# Swagger docs (registration, 2FA/captcha, DPA, billing/webhook, guests,
# administrative user management, presets, legal texts ...). The routes still EXIST
# (some premium-gated), but do not appear in the published OpenAPI schema. Matching
# is done by path prefix so that subpaths (e.g. /api/admin/users/{id}, /api/profile/
# guests/{id}/...) are also captured.
_COMMUNITY_HIDDEN_API_PREFIXES = (
    "/api/maintenance",
    "/api/auth/captcha",
    "/api/legal/text",
    "/api/auth/register",
    "/api/auth/verify-email",
    "/api/auth/resend-verification",
    "/api/profile/delete-request",
    "/api/profile/delete-cancel",
    "/api/profile/webhook",
    "/api/profile/sign-avv",
    "/api/legal/avv-download",
    "/api/profile/guests",
    "/api/profile/presets",
    "/api/admin/users",
    "/api/presets",
    #: Premium/Cloud-only endpoints that are not offered in the Community-Edition
    # must also not appear in its OpenAPI specification (/docs, /openapi.json).
    # "/api/playbooks/custom" also captures /custom/{filename} via prefix.
    "/api/profile/export",
    "/api/playbooks/upload",
    "/api/playbooks/custom-meta",
    "/api/playbooks/custom",
)


def _community_api_hidden(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in _COMMUNITY_HIDDEN_API_PREFIXES)


#: Complete the OpenAPI — (1) auth schemes (session cookie + API-token bearer),
# so Swagger offers an "Authorize" dialog + lock icons; (2) response schemas for
# the most important resources (Devices, Scenarios, Jobs) instead of empty {} objects. Purely ADDITIVE
# on the generated schema — NO response_model is set, so the
# runtime/serialization behavior of the endpoints stays unchanged.
_OPENAPI_COMPONENT_SCHEMAS = {
    "Device": {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "name": {"type": "string"},
            "host": {"type": "string"},
            "username": {"type": "string", "nullable": True},
            "port": {"type": "integer", "example": 22},
            "has_credential": {"type": "boolean"},
            "credential_type": {"type": "string", "enum": ["password", "key"], "nullable": True},
            "created_at": {"type": "string", "format": "date-time"},
        },
    },
    "Job": {
        "type": "object",
        "properties": {
            "job_id": {"type": "string"},
            "status": {"type": "string", "example": "running"},
            "playbooks": {"type": "array", "items": {"type": "string"}},
            "target_host": {"type": "string", "nullable": True},
            "username": {"type": "string", "nullable": True},
            "created_at": {"type": "string", "format": "date-time"},
            "finished_at": {"type": "string", "format": "date-time", "nullable": True},
            "session_id": {"type": "string", "nullable": True},
            "user_id": {"type": "string", "nullable": True},
            "variables": {"type": "object", "additionalProperties": True, "nullable": True},
            "progress": {"type": "object", "additionalProperties": True},
        },
    },
    "Scenario": {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "name": {"type": "string"},
            "owner_id": {"type": "string"},
            "is_owner": {"type": "boolean"},
            "preset_id": {"type": "string"},
            "device_ids": {"type": "array", "items": {"type": "string"}},
            "preset_name": {"type": "string", "nullable": True},
            "device_name": {"type": "string", "nullable": True},
            "device_optional": {"type": "boolean"},
            "playbook_count": {"type": "integer"},
            "device_count": {"type": "integer"},
            "valid": {"type": "boolean"},
            "created_at": {"type": "string", "format": "date-time", "nullable": True},
            "permission": {"type": "string", "nullable": True},
            "shares": {"type": "array", "items": {"type": "object", "additionalProperties": True},
                       "description": "Nur fuer den Besitzer enthalten."},
            "shared_count": {"type": "integer", "description": "Nur fuer den Besitzer enthalten."},
        },
    },
}

# (path, method) -> (wrapper, schema name). "array" = list of the schema, "object" = single object.
_OPENAPI_RESPONSE_REFS = {
    ("/api/devices", "get"): ("array", "Device"),
    ("/api/devices", "post"): ("object", "Device"),
    ("/api/devices/{device_id}", "put"): ("object", "Device"),
    ("/api/profile/scenarios", "get"): ("array", "Scenario"),
    ("/api/profile/scenarios", "post"): ("object", "Scenario"),
    ("/api/profile/scenarios/{scenario_id}", "post"): ("object", "Scenario"),
    ("/api/jobs", "get"): ("array", "Job"),
    ("/api/jobs/{job_id}", "get"): ("object", "Job"),
}


def _enrich_openapi(schema: dict) -> None:
    components = schema.setdefault("components", {})
    sec = components.setdefault("securitySchemes", {})
    sec["cookieAuth"] = {
        "type": "apiKey", "in": "cookie", "name": "session_id",
        "description": "Session-Cookie aus dem Login (POST /api/auth/login setzt es HttpOnly).",
    }
    sec["bearerAuth"] = {
        "type": "http", "scheme": "bearer",
        "description": "API-Token (Format asm_tok_…) aus 'Profil → API-Token'. "
                       "Header: 'Authorization: Bearer <token>'. Scopes: run_playbook, read_logs.",
    }
    # Both schemes accepted globally -> Swagger shows "Authorize" and marks operations.
    schema.setdefault("security", [{"cookieAuth": []}, {"bearerAuth": []}])
    comp_schemas = components.setdefault("schemas", {})
    for _name, _defn in _OPENAPI_COMPONENT_SCHEMAS.items():
        comp_schemas.setdefault(_name, _defn)
    paths = schema.get("paths", {})
    for (_path, _method), (_kind, _model) in _OPENAPI_RESPONSE_REFS.items():
        op = paths.get(_path, {}).get(_method)
        if not op:
            continue
        ref = {"$ref": f"#/components/schemas/{_model}"}
        content_schema = {"type": "array", "items": ref} if _kind == "array" else ref
        resp = op.setdefault("responses", {}).setdefault("200", {"description": "Erfolgreiche Antwort"})
        resp.setdefault("content", {})["application/json"] = {"schema": content_schema}


_orig_openapi = app.openapi


def _custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = _orig_openapi()  # builds + caches app.openapi_schema (same dict object)
    _enrich_openapi(schema)
    #: In the Community-Edition, hide cloud/onpremise-specific endpoints.
    if EDITION == "community":
        paths = schema.get("paths", {})
        for _p in [p for p in list(paths) if _community_api_hidden(p)]:
            paths.pop(_p, None)
    app.openapi_schema = schema
    return schema


app.openapi = _custom_openapi

# Open-Core extension registry: central seam where editions
# (e.g. cloud billing) dock in. Populated with the active edition at module end
# (register_extensions) and read at exactly three places: app construction (router),
# startup event and cron maintenance. Community/On-Premise run with an empty registry,
# so the behavior is unchanged (no-op).
registry = ExtensionRegistry()

# : The entire cloud billing (Stripe SDK, billing router, data models,
# helpers, tariff-driven LimitsProvider, admin status report) lives in the package
# editions/billing and is loaded ONLY in the cloud edition (register_extensions).
# Community/On-Premise contain no billing code -> billing paths return 404 (not
# registered), no stripe import, no billing tables.

# Rate Limit Dictionaries and Helper (in-memory)
guest_creation_limits = {}  # key: (client_ip, user_id), value: [datetime, ...]
token_generation_limits = {}  # key: (client_ip, user_id), value: [datetime, ...]
otp_attempt_limits = {}  # key: email, value: [datetime, ...] - 2FA brute-force protection
reset_request_limits = {}  # key: client_ip, value: [datetime, ...] - password-reset flood protection
verification_resend_limits = {}  # key: client_ip, value: [datetime, ...] - resend flood protection

def check_rate_limit(limits_dict, key, max_requests, period_seconds=60):
    now = datetime.utcnow()
    cutoff = now - timedelta(seconds=period_seconds)
    timestamps = limits_dict.get(key, [])
    # Filter expired timestamps
    timestamps = [t for t in timestamps if t > cutoff]
    if len(timestamps) >= max_requests:
        return False
    timestamps.append(now)
    limits_dict[key] = timestamps
    return True







# Cron background maintenance thread worker
def cron_maintenance_worker():
    import time
    from database import SessionLocal
    from sqlalchemy import text
    while True:
        try:
            print("Cron Worker: Starting maintenance cycle...")
            with SessionLocal() as db:
                now = datetime.utcnow()

                # : Edition-specific maintenance hooks run at the end of the cycle
                # via registry.run_maintenance(db, now) (a no-op in the Community-Edition).
                # The core cron (IP release, auth cleanup, log rotation) contains no
                # edition-specific logic.

                # 2. IP Block auto-release
                expired_blocks = db.query(IPBlock).filter(
                    IPBlock.expires_at != None,
                    IPBlock.expires_at <= now
                ).all()
                for b in expired_blocks:
                    print(f"Cron Worker: Auto-releasing expired IP block for {b.ip}...")
                    history_entry = IPBlockHistory(
                        ip=b.ip,
                        reason=b.reason,
                        blocked_at=b.blocked_at,
                        expires_at=b.expires_at,
                        released_at=now,
                        release_method="auto"
                    )
                    db.add(history_entry)
                    db.delete(b)
                db.commit()

                # 2b. Cleanup of expired auth artifacts (prevents DB growth)
                try:
                    c_del = db.query(Captcha).filter(Captcha.expires_at <= now).delete()
                    o_del = db.query(OTP).filter(OTP.expires_at <= now).delete()
                    s_del = db.query(Session).filter(Session.expires_at <= now).delete()
                    db.commit()
                    if (c_del or o_del or s_del):
                        print(f"Cron Worker: Cleanup - Captchas:{c_del} OTPs:{o_del} Sessions:{s_del}")
                except Exception as e:
                    db.rollback()
                    print(f"Cron Worker: Auth-Cleanup-Fehler: {e}")

                # 3. Log Rotation and History Cleanups
                def get_limit(key, default_val):
                    setting = db.query(Setting).filter(Setting.key == key).first()
                    return int(setting.value) if setting else default_val

                max_count = get_limit("max_history_count", 50)
                max_age_days = get_limit("max_history_age", 30)

                jobs = load_jobs()
                if jobs:
                    jobs_by_user = {}
                    for j_id, job in list(jobs.items()):
                        u_id = job.get("user_id", "anonymous")
                        if u_id not in jobs_by_user:
                            jobs_by_user[u_id] = []
                        jobs_by_user[u_id].append(job)

                    #: only delete explicitly selected IDs (no delete-missing).
                    # This way jobs created after the load_jobs() snapshot survive.
                    ids_to_prune = []
                    for u_id, user_jobs in jobs_by_user.items():
                        user_jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
                        age_cutoff = (datetime.now() - timedelta(days=max_age_days)).isoformat()
                        keep_count = max_count

                        for idx, job in enumerate(user_jobs):
                            j_id = job.get("job_id")
                            # Never prune running/pending jobs (even if old/over the limit)
                            if job.get("status") in ("pending", "running"):
                                continue
                            should_delete = False
                            if idx >= keep_count:
                                should_delete = True
                            elif job.get("created_at", "") < age_cutoff:
                                should_delete = True

                            if should_delete:
                                print(f"Cron Worker: Pruning job log {j_id} for user {u_id}...")
                                log_path = os.path.join(LOGS_DIR, f"{j_id}.log")
                                if os.path.exists(log_path):
                                    try:
                                        os.remove(log_path)
                                    except Exception as e:
                                        print(f"Error removing log file {log_path}: {e}")
                                ids_to_prune.append(j_id)
                    if ids_to_prune:
                        delete_jobs(ids_to_prune)

                # : hourly statistics snapshot for the dashboard history graphs.
                try:
                    capture_stats_snapshot(db)
                except Exception as _se:
                    print(f"Stats-Snapshot fehlgeschlagen: {_se}")

                # : run the maintenance hooks of the active edition
                # (e.g. subscription downgrade). Empty in Community/On-Premise -> no billing
                # in the core cron. Order-independent from the core tasks above.
                registry.run_maintenance(db, now)

        except Exception as e:
            print(f"Error in cron_maintenance_worker: {e}")

        time.sleep(3600)  # Check every hour

# Database initialization on startup
@app.on_event("startup")
def startup_event():
    Base.metadata.create_all(bind=engine)
    try:
        with SessionLocal() as db:
            # Check and run database migrations
            from sqlalchemy import text
            db.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT FALSE NOT NULL"))
            db.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS associated_user_id VARCHAR(255) NULL"))
            # Subscription/trial metrics (active_paid/active_trial) existed in ALL editions before the
            # trial/fingerprint cleanup. In the stripped community mirror the StatsSnapshot
            # model no longer knows these columns -> drop the NOT-NULL legacy columns, otherwise
            # snapshot inserts (which omit them) fail on an existing NOT-NULL column (NotNullViolation).
            #: only drop if the active model really does not know the columns (anymore). If the
            # Community-Edition is built from the UNSTRIPPED monorepo (local CE test), the
            # model still declares them (column default 0) -> an insert then includes them, and a drop would
            # lead to 'column active_paid does not exist'. Idempotent (IF EXISTS); cloud/onprem keep
            # the columns anyway. NO marker: the block MUST run in Community (markers would strip it
            # precisely there).
            if EDITION == "community" and not hasattr(StatsSnapshot, "active_paid"):
                db.execute(text("ALTER TABLE stats_snapshots DROP COLUMN IF EXISTS active_paid"))
                db.execute(text("ALTER TABLE stats_snapshots DROP COLUMN IF EXISTS active_trial"))
            # : webhook URL for playbook status notifications.
            db.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_url VARCHAR NULL"))
            # : preferred UI language per user (de|en|NULL=automatic). Core feature,
            # community-safe (NO marker, runs before the optional tariffs block + commit below,
            # does not abort the startup tx/the admin seeding).
            db.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5) NULL"))
            #: optional sudo/become password per device (privilege escalation).
            db.execute(text("ALTER TABLE devices ADD COLUMN IF NOT EXISTS encrypted_become_credential VARCHAR NULL"))
            # (Device-Flatten): device share + run context (base_dir/timezone) directly on the
            # Device (moving away from the former single DeviceGroup) + target devices as a JSON list
            # on Scenario/Preset (multi-host via checkbox selection).
            db.execute(text("ALTER TABLE devices ADD COLUMN IF NOT EXISTS guest_access TEXT DEFAULT '[]' NOT NULL"))
            db.execute(text("ALTER TABLE devices ADD COLUMN IF NOT EXISTS base_directory VARCHAR NULL"))
            db.execute(text("ALTER TABLE devices ADD COLUMN IF NOT EXISTS timezone VARCHAR NULL"))
            db.execute(text("ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS device_ids TEXT DEFAULT '[]' NOT NULL"))
            db.execute(text("ALTER TABLE custom_presets ADD COLUMN IF NOT EXISTS device_ids TEXT DEFAULT '[]' NOT NULL"))
            # : scenarios shareable like presets (shares column; the table existed without it).
            # : commit the previous migrations FIRST. Otherwise an error in the
            # optional tariff block (the tariffs table exists only in the billing/cloud
            # edition; in Community/On-Premise PostgreSQL aborts the entire transaction) swallows ALL
            # subsequent statements including the admin seeding (-> no admin, no login).
            db.commit()
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_users_associated_user_id ON users(associated_user_id)"))
            db.commit()

            # ( Device-Flatten): one-time, idempotent migration from the DeviceGroup
            # wrapper era to the flat Device model. Target selection of scenarios/presets moves
            # from the single DeviceGroup (or a real multi-group) to a device_ids list;
            # device shares (guest_access) move from the solo wrapper onto the Device. Afterwards the
            # device_groups table is inert (no longer written to, the model is dropped).
            # Raw SQL so that the migration runs independently of the removed DeviceGroup ORM, and
            # robust against missing legacy tables/columns (fresh community installations
            # have neither device_groups nor device_group_id). Idempotent: writes device_ids only
            # while it is still empty; guest_access only while still empty on the device.
            try:
                from sqlalchemy import inspect as _sa_inspect
                _insp = _sa_inspect(engine)
                _tables = set(_insp.get_table_names())
                def _cols(_t):
                    try:
                        return {_c["name"] for _c in _insp.get_columns(_t)}
                    except Exception:
                        return set()
                if "device_groups" in _tables:
                    _grp_devids = {}
                    _rows = db.execute(text(
                        "SELECT id, device_ids, guest_access, default_variables, "
                        "default_base_directory, default_timezone FROM device_groups"
                    )).fetchall()
                    for _r in _rows:
                        _gid, _dids_raw, _ga_raw, _dv_raw = _r[0], _r[1], _r[2], _r[3]
                        _bd_raw, _tz_raw = _r[4], _r[5]
                        _dids = _safe_json_list(_dids_raw)
                        _grp_devids[_gid] = _dids
                        # Solo wrapper (sentinel + exactly 1 device): move shares + run context
                        # (base_dir/timezone) onto the device. Only set while still
                        # empty on the device (idempotent).
                        if MANAGED_DEVICE_SENTINEL in _safe_json_obj(_dv_raw) and len(_dids) == 1:
                            if _ga_raw and _ga_raw not in ("[]", ""):
                                db.execute(text(
                                    "UPDATE devices SET guest_access = :ga "
                                    "WHERE id = :did AND (guest_access IS NULL OR guest_access = '[]')"
                                ), {"ga": _ga_raw, "did": _dids[0]})
                            if _bd_raw:
                                db.execute(text(
                                    "UPDATE devices SET base_directory = :bd "
                                    "WHERE id = :did AND base_directory IS NULL"
                                ), {"bd": _bd_raw, "did": _dids[0]})
                            if _tz_raw:
                                db.execute(text(
                                    "UPDATE devices SET timezone = :tz "
                                    "WHERE id = :did AND timezone IS NULL"
                                ), {"tz": _tz_raw, "did": _dids[0]})
                    _migrated = 0
                    for _tbl in ("scenarios", "custom_presets"):
                        if _tbl in _tables and "device_group_id" in _cols(_tbl):
                            _refs = db.execute(text(
                                f"SELECT id, device_group_id FROM {_tbl} WHERE device_group_id IS NOT NULL"
                            )).fetchall()
                            for _eid, _dgid in _refs:
                                _target = json.dumps(_grp_devids.get(_dgid, []))
                                _res = db.execute(text(
                                    f"UPDATE {_tbl} SET device_ids = :d "
                                    f"WHERE id = :i AND (device_ids IS NULL OR device_ids = '[]')"
                                ), {"d": _target, "i": _eid})
                                _migrated += (_res.rowcount or 0)
                    db.commit()
                    if _migrated:
                        print(f"#1070 Device-Flatten: {_migrated} Szenario/Preset-Zielauswahl(en) auf device_ids migriert.")
            except Exception as _flatten_err:
                db.rollback()
                print(f"#1070 Device-Flatten-Migration uebersprungen: {_flatten_err}")


            default_settings = {
                "rate_limit_global_ip": "60",
                "rate_limit_user_ip": "120",
                "ip_ban_duration": "86400",
                "max_active_api_tokens": "5",
                "max_guest_accounts": "3",
                "max_history_count": "50",
                "max_history_age": "30",
                "storage_quota_mb": "100",
                "max_custom_playbooks": "50",
                #: Ansible connection timeout in seconds (sudo/become prompt wait time).
                "default_connection_timeout": "30",
            }
            for key, value in default_settings.items():
                exists = db.query(Setting).filter(Setting.key == key).first()
                if not exists:
                    setting = Setting(key=key, value=value)
                    db.add(setting)
            db.commit()

            # : capture a statistics snapshot at startup so that the history
            # graphs immediately have at least one data point (then hourly via cron).
            try:
                capture_stats_snapshot(db)
            except Exception as _snap_err:
                #: clean up the aborted transaction, otherwise every further
                # statement fails ("current transaction is aborted") -> ensure_system_admin() could
                # not create an admin and the Community-Edition login would fail.
                db.rollback()
                print(f"Initialer Stats-Snapshot fehlgeschlagen: {_snap_err}")

            #: create/heal the system admin (ADMIN_USERNAME/ADMIN_PASSWORD) idempotently
            # ONCE across all editions — no duplicates, consistent identity in all
            # editions. For details + edition nuances see ensure_system_admin().
            ensure_system_admin(db)

            # Clean up orphaned jobs: after a restart the in-memory queue is empty,
            # so 'running'/'pending' jobs cannot be resumed -> mark them as interrupted.
            try:
                from sqlalchemy import text as _text
                db.execute(_text(
                    "UPDATE jobs SET status='failed', finished_at=:ts "
                    "WHERE status IN ('running','pending')"
                ), {"ts": datetime.now().isoformat()})
                db.commit()
            except Exception as _e:
                print(f"Job-Cleanup beim Start fehlgeschlagen: {_e}")
    except Exception as e:
        print(f"Error during database startup initialization: {e}")



    # : The Stripe connection test is now a startup hook of the cloud billing
    # extension and runs via registry.run_startup() (below). Community/On-Premise do not
    # execute it (no billing loaded).

    
    # Start Cron background maintenance worker thread
    threading.Thread(target=cron_maintenance_worker, daemon=True).start()

# CORS Middleware setup
allowed_origins_str = os.environ.get("ALLOWED_ORIGINS", "http://localhost,http://127.0.0.1")
origins = [o.strip() for o in allowed_origins_str.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Trusted Host Middleware setup
allowed_hosts_str = os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1,backend")
hosts = [h.strip() for h in allowed_hosts_str.split(",") if h.strip()]
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=hosts
)

# Custom Middlewares (mounted in reverse order of execution)
# 1. Security check and rate limiting (executed second)
app.add_middleware(SecurityMiddleware)
# 2. Authentication cookie check (executed first)
app.add_middleware(SessionAuthMiddleware)


def _edition_blocks_path(path: str) -> bool:
    """Edition-dependent route blocking.

    - Community: real login for the admin + team members created by the admin
      via Teams. Only the self-registration/email-verification
      routes (/api/auth/register, /verify-email, /resend-verification) and the custom
      playbook upload remain blocked. Login/logout/profile/teams/devices are open.

    Billing/pricing routes are NO longer blocked via denylist: they hang
    off the billing_router, which is only mounted in the cloud edition -> in Community/On-Premise
    they are simply not registered and therefore return 404.
    """
    if EDITION == "community":
        #: custom playbook upload/management disabled in Community
        # (only the templates baked into the image are runnable).
        if (path.startswith("/api/playbooks/upload")
                or path.startswith("/api/playbooks/custom-meta")
                or path.startswith("/api/playbooks/custom")):
            return True
        # : no self-registration -> block registration/verification/reset routes
        # (Community usually has no SMTP).
        if (path.startswith("/api/auth/register")
                or path.startswith("/api/auth/verify-email")
                or path.startswith("/api/auth/resend-verification")
                or path.startswith("/api/auth/reset-password")):
            return True
        # Community = ONLY the system admin: no team members/guest accounts -> block Teams endpoints.
        if path.startswith("/api/profile/guests"):
            return True
    return False


@app.middleware("http")
async def edition_route_guard(request: Request, call_next):
    # Blocked routes behave as if not present (404) before auth/logic kicks in.
    # request.url.path is exactly the same (already decoded) path that routing
    # uses for dispatch -> guard and router cannot diverge (no encoding/
    # trailing-slash bypass onto a blocked route). '..' is not resolved.
    if _edition_blocks_path(request.url.path):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    return await call_next(request)


# ---------------------------------------------------------------------------
# : maintenance mode. Persisted as settings (maintenance_mode/maintenance_note).
# When active, only admins may use the API/app; everyone else gets a 503 with the
# configured maintenance note. Auth/edition/maintenance endpoints stay open so that
# admins can log in and the frontend can show the maintenance page including the note.
# ---------------------------------------------------------------------------
def _get_setting(db: DBSession, key: str, default=None):
    s = db.query(Setting).filter(Setting.key == key).first()
    return s.value if s else default

#: maintenance-mode helpers remain in ALL editions. _maintenance_active/_registration_enabled
# are used by retained community code (get_edition, admin_stats); guard/endpoint are inert in
# Community (EDITION=="community" -> active=False, bypass=True) and serve /api/maintenance.
def _maintenance_active(db: DBSession) -> bool:
    #: Maintenance mode is not a feature in the Community-Edition -> always inactive,
    # regardless of a possibly persisted setting. This way it stays ineffective everywhere (guard, banner,
    # stats, /api/maintenance).
    if EDITION == "community":
        return False
    return (_get_setting(db, "maintenance_mode", "false") or "false").lower() == "true"

def _registration_enabled(db: DBSession) -> bool:
    # : administrators can enable/disable self-registration in the admin panel.
    # Default true. Applies in addition to the edition/env control.
    return (_get_setting(db, "registration_enabled", "true") or "true").lower() == "true"


_MAINTENANCE_EXEMPT_PREFIXES = ("/api/auth/", "/api/maintenance", "/api/version")


def _maintenance_exempt(path: str) -> bool:
    return any(path == p or path.startswith(p) for p in _MAINTENANCE_EXEMPT_PREFIXES)


def _maintenance_user(request: Request, db: DBSession):
    # Cookie session only (for the admin login). API tokens/anonymous count as non-admin.
    try:
        sid = request.cookies.get("session_id")
        if sid:
            return verify_session(db, sid)
    except Exception:
        return None
    return None


@app.middleware("http")
async def maintenance_guard(request: Request, call_next):
    path = request.url.path
    # Only check API requests (nginx serves static SPA assets). Community = single admin,
    # therefore never blocked. Auth/edition/maintenance stay reachable for everyone.
    if EDITION != "community" and path.startswith("/api/") and not _maintenance_exempt(path):
        with SessionLocal() as db:
            if _maintenance_active(db):
                user = _maintenance_user(request, db)
                if not (user and user.role == "admin"):
                    note = _get_setting(db, "maintenance_note", "") or "Die Anwendung befindet sich derzeit im Wartungsmodus."
                    return JSONResponse(status_code=503, content={"detail": note, "maintenance": True})
    return await call_next(request)


@app.get("/api/maintenance")
def get_maintenance_status(request: Request, db: DBSession = Depends(get_db)):
    # Public: the frontend decides based on this response whether the maintenance page is shown.
    # `bypass` (admin/community) is resolved server-side so that the frontend can make the
    # decision BEFORE the full auth/edition boot (no FOUC).
    active = _maintenance_active(db)
    user = _maintenance_user(request, db)
    bypass = bool(EDITION == "community" or (user and user.role == "admin"))
    return {
        "active": active,
        "note": (_get_setting(db, "maintenance_note", "") or "") if active else "",
        "bypass": bypass,
    }


# : dynamic password rules from the settings (ENV/defaults overridable via settings).
# Defaults: minimum length 8, no requirement for special char/upper-lower/digit. Enforced on registration,
# admin creation, password change and reset.
def validate_password_policy(db: DBSession, password: str):
    password = password or ""
    try:
        min_len = int(_get_setting(db, "password_min_length", "8") or "8")
    except Exception:
        min_len = 8
    min_len = max(1, min_len)
    if len(password) > 72:
        raise HTTPException(status_code=400, detail="Passwort darf maximal 72 Zeichen lang sein.")
    if len(password) < min_len:
        raise HTTPException(status_code=400, detail=f"Passwort muss mindestens {min_len} Zeichen lang sein.")
    def _on(key):
        return (_get_setting(db, key, "false") or "false").lower() == "true"
    if _on("password_require_special") and not re.search(r"[^A-Za-z0-9]", password):
        raise HTTPException(status_code=400, detail="Passwort muss mindestens ein Sonderzeichen enthalten.")
    if _on("password_require_case") and not (re.search(r"[a-z]", password) and re.search(r"[A-Z]", password)):
        raise HTTPException(status_code=400, detail="Passwort muss Groß- und Kleinbuchstaben enthalten.")
    if _on("password_require_digit") and not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Passwort muss mindestens eine Ziffer enthalten.")


@app.get("/api/version")
def get_edition():
    # Active edition baked in at build time. Used by the frontend for
    # dynamic UI adjustment.
    # : allow_anonymous_run controls whether the frontend offers the run button
    # for unauthenticated visitors.
    # : registration_enabled controls whether the frontend shows the register button.
    from database import SessionLocal
    reg_enabled = True
    if EDITION == "community":
        # : there is no self-registration in the Community-Edition.
        reg_enabled = False
    else:
        try:
            with SessionLocal() as _db:
                reg_enabled = _registration_enabled(_db)
        except Exception:
            reg_enabled = True
    return {
        #: version number in ALL editions (diagnostics/monitoring/deployment validation).
        "version": APP_VERSION,
        "edition": EDITION,
        "allow_anonymous_run": _allow_anonymous_run(),
    }



# Configure Logging Paths dynamically
LOG_HISTORY = os.environ.get("LOG_HISTORY", "false").lower() == "true"
if LOG_HISTORY and os.path.isdir("/logs"):
    LOGS_DIR = "/logs"
else:
    LOGS_DIR = "/playbooks/logs"

os.makedirs(LOGS_DIR, exist_ok=True)
JOBS_FILE = os.path.join(LOGS_DIR, "jobs.json")

#: directory with the vendored `sudo` become plugin. It shadows the built-in
# ansible sudo plugin and extends the prompt detection with the sudo-rs format
# ("[sudo: <prompt>] Password:", Ubuntu 25.10+) without breaking classic sudo. Made known to both
# execution paths (normal + custom sandbox) via ANSIBLE_BECOME_PLUGINS.
BECOME_PLUGINS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ansible_plugins", "become")

# In-memory lock for jobs.json updates
jobs_lock = threading.Lock()

# Serializes concurrency check + job insert, closing the TOCTOU gap
job_create_lock = threading.Lock()

# Thread-safe worker queue
execution_queue = queue.Queue()

# : registry of running Ansible processes so that POST /api/jobs/{id}/cancel can stop them.
# job_id -> {"process": Popen, "is_custom": bool}. cancel_requested covers the queue/spawn case
# (the job is not yet – or just now – registered as a process).
active_runs = {}
active_runs_lock = threading.Lock()
cancel_requested = set()

def _terminate_run_process(job_id: str, process, is_custom: bool):
    # : cleanly terminate the running Ansible process (+ custom sandbox container) –
    # identical logic to the timeout path in run_playbook_background.
    try:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    except Exception as e:
        print(f"Error terminating process for job {job_id}: {e}")
    if is_custom:
        try:
            subprocess.run(["docker", "kill", f"ansible-sandbox-{job_id}"], capture_output=True)
        except Exception as e:
            print(f"Error killing sandbox container for job {job_id}: {e}")

def _job_row_to_dict(j) -> dict:
    d = {
        "job_id": j.job_id,
        "status": j.status,
        "playbooks": json.loads(j.playbooks) if j.playbooks else [],
        "target_host": j.target_host,
        "username": j.username,
        "created_at": j.created_at,
        "finished_at": j.finished_at,
        "session_id": j.session_id,
        "user_id": j.user_id,
        "variables": json.loads(j.variables) if j.variables else None,
    }
    if j.progress:
        try:
            d["progress"] = json.loads(j.progress)
        except Exception:
            pass
    return d

def load_jobs() -> dict:
    # Jobs now live in the DB (survive restarts). The interface stays a dict.
    from database import SessionLocal
    with jobs_lock:
        try:
            with SessionLocal() as db:
                return {j.job_id: _job_row_to_dict(j) for j in db.query(Job).all()}
        except Exception as e:
            print(f"Error loading jobs: {e}")
            return {}

def _apply_job_dict(row: Job, jd: dict):
    row.status = jd.get("status", "pending")
    row.playbooks = json.dumps(jd.get("playbooks", []))
    row.target_host = jd.get("target_host")
    row.username = jd.get("username")
    row.created_at = jd.get("created_at")
    row.finished_at = jd.get("finished_at")
    row.session_id = jd.get("session_id")
    row.user_id = jd.get("user_id")
    row.variables = json.dumps(jd.get("variables")) if jd.get("variables") is not None else None
    row.progress = json.dumps(jd.get("progress")) if jd.get("progress") is not None else None

def save_jobs(jobs: dict):
    #: pure upsert - no longer deletes rows missing from the passed dict.
    # Pruning now runs exclusively via delete_jobs() with an explicit ID list.
    from database import SessionLocal
    with jobs_lock:
        try:
            with SessionLocal() as db:
                existing = {j.job_id: j for j in db.query(Job).all()}
                for jid, jd in jobs.items():
                    row = existing.get(jid)
                    if not row:
                        row = Job(job_id=jid)
                        db.add(row)
                    _apply_job_dict(row, jd)
                db.commit()
        except Exception as e:
            print(f"Error saving jobs: {e}")

def save_job(jd: dict):
    #: atomic single-row upsert without full scan/delete-missing.
    from database import SessionLocal
    jid = jd.get("job_id")
    if not jid:
        return
    with jobs_lock:
        try:
            with SessionLocal() as db:
                row = db.query(Job).filter(Job.job_id == jid).first()
                if not row:
                    row = Job(job_id=jid)
                    db.add(row)
                _apply_job_dict(row, jd)
                db.commit()
        except Exception as e:
            print(f"Error saving job {jid}: {e}")

def delete_jobs(job_ids):
    #: only delete explicitly named jobs (no more delete-missing).
    from database import SessionLocal
    ids = [j for j in job_ids if j]
    if not ids:
        return
    with jobs_lock:
        try:
            with SessionLocal() as db:
                db.query(Job).filter(Job.job_id.in_(ids)).delete(synchronize_session=False)
                db.commit()
        except Exception as e:
            print(f"Error deleting jobs {ids}: {e}")

def get_job_progress(job: dict) -> dict:
    if "progress" in job and job.get("status") not in ["running", "pending"]:
        return job["progress"]

    status = job.get("status", "pending")
    playbooks = job.get("playbooks", [])
    total = len(playbooks)
    if total == 0:
        return {"finished": 0, "total": 0, "percent": 0}

    if status == "success":
        return {"finished": total, "total": total, "percent": 100}
    elif status == "pending":
        return {"finished": 0, "total": total, "percent": 0}

    job_id = job.get("job_id")
    log_file_path = os.path.join(LOGS_DIR, f"{job_id}.log")
    play_count = 0
    if os.path.isfile(log_file_path):
        try:
            with open(log_file_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.startswith("PLAY ["):
                        play_count += 1
        except Exception:
            pass

    finished = max(0, play_count - 1)
    finished = min(finished, total)
    percent = int((finished / total) * 100) if total > 0 else 0
    return {"finished": finished, "total": total, "percent": percent}

_TERMINAL_STATUS = ("success", "failed", "canceled")

def update_job_status(job_id: str, status: str, finished_at: str = None):
    #: targeted single-row update under lock, no load-all/save-all window.
    from database import SessionLocal
    with jobs_lock:
        try:
            with SessionLocal() as db:
                row = db.query(Job).filter(Job.job_id == job_id).first()
                if not row:
                    return None
                # : terminal states are FINAL. An already-set terminal state (e.g. a
                # parallel cancellation vs. natural end) is NOT overwritten by another terminal
                # state ("first terminal wins"). Returns the actually persisted status
                # so that mail/webhook follow it (no status/notification mismatch).
                if row.status in _TERMINAL_STATUS and status != row.status:
                    return row.status
                row.status = status
                if finished_at:
                    row.finished_at = finished_at
                # Compute and persist progress for terminal states
                if status in _TERMINAL_STATUS:
                    job_dict = _job_row_to_dict(row)
                    job_dict["status"] = status
                    row.progress = json.dumps(get_job_progress(job_dict))
                db.commit()
                return status
        except Exception as e:
            print(f"Error updating job status {job_id}: {e}")
            return None

class RunRequest(BaseModel):
    playbooks: List[str]
    target_host: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    session_id: Optional[str] = None
    variables: Optional[dict] = None
    device_id: Optional[str] = None
    # (Device-Flatten): multi-host target as a list of device IDs (replaces device_group_id).
    # Set from scenario/preset or chosen in the run dialog. device_id (single) is
    # normalized to this list below; both flow through the same device branch.
    device_ids: Optional[List[str]] = None
    # : execution of a custom preset (resolves playbooks + variables +
    # target devices; premium-gated; permission strict/flexible).
    custom_preset_id: Optional[str] = None
    # : execution of a scenario (preset + fixed target device); analogous to preset, shareable.
    scenario_id: Optional[str] = None
    # : one-time SSH private key for deviceless (ad-hoc) runs — used only for this
    # run and NOT stored. Only relevant in the else branch (request.target_host).
    ssh_key: Optional[str] = None
    #: optional sudo/become password for this run (overrides one stored on the
    # device). NOT persisted; used only for the Ansible execution.
    become_password: Optional[str] = None

    @field_validator("ssh_key")
    @classmethod
    def validate_ssh_key(cls, v):
        if v is None:
            return v
        # Treat empty input like "not set" (frontend sends "" when the key is removed again).
        if v.strip() == "":
            return None
        # Sanity limit against abuse; real private keys are far below this.
        if len(v) > 32768:
            raise ValueError("SSH-Key ist zu lang (maximal 32768 Zeichen).")
        # Forbid control characters except line break/tab (inventory/file injection protection).
        if any(ord(ch) < 32 and ch not in "\r\n\t" for ch in v):
            raise ValueError("SSH-Key enthaelt unzulaessige Steuerzeichen.")
        return v

    @field_validator("target_host")
    @classmethod
    def validate_target_host(cls, v):
        if v is None:
            return v
        v = v.strip()
        if v == "":
            return v
        # Allow IPv4, IPv6, or domain name format
        if not re.match(r"^[a-zA-Z0-9.:_-]+$", v):
            raise ValueError("Ungueltiges Host-Format. Nur Alphanumerisch, Punkte, Doppelpunkte, Unterstriche und Bindestriche erlaubt.")
        if len(v) > 253:
            raise ValueError("Host-Name ist zu lang (maximal 253 Zeichen).")
        return v


    @field_validator("username")
    @classmethod
    def validate_username(cls, v):
        if v is None:
            return v
        v = v.strip()
        # SSH username of the TARGET host: do not enforce a minimum length (valid
        # logins like "pi" or single letters exist). The regex enforces >=1
        # valid character (injection protection), max 32 = Linux convention.
        if not re.match(r"^[a-zA-Z0-9._-]+$", v):
            raise ValueError("Ungueltiger Benutzername. Nur Alphanumerisch, Punkte, Unterstriche und Bindestriche erlaubt.")
        if len(v) > 32:
            raise ValueError("SSH-Benutzername ist zu lang (maximal 32 Zeichen).")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        if v is None:
            return v
        # This is the SSH password of the TARGET host (no account creation) - therefore do NOT
        # enforce a minimum length; the target host determines the password. Max 72 as a sanity
        # limit; forbid control characters (inventory injection protection).
        if len(v) > 72:
            raise ValueError("Passwort ist zu lang (maximal 72 Zeichen).")
        if any(ord(ch) < 32 for ch in v):
            raise ValueError("Passwort enthaelt unzulaessige Steuerzeichen.")
        return v

    @field_validator("variables")
    @classmethod
    def validate_variables(cls, v):
        if v is None:
            return v
        if not isinstance(v, dict):
            raise ValueError("variables muss ein Objekt (Key/Value) sein.")
        if len(v) > 50:
            raise ValueError("Zu viele Variablen (maximal 50).")
        cleaned = {}
        for key, val in v.items():
            if not isinstance(key, str) or not re.match(r"^[a-zA-Z0-9_]{1,64}$", key):
                raise ValueError(f"Ungueltiger Variablen-Name: {key!r}.")
            if key.lower().startswith("ansible"):
                raise ValueError(f"Variablen-Name '{key}' ist nicht erlaubt (reservierter Ansible-Namespace).")
            if isinstance(val, bool) or val is None:
                cleaned[key] = val
                continue
            if isinstance(val, (int, float)):
                cleaned[key] = val
                continue
            if not isinstance(val, str):
                raise ValueError(f"Variable '{key}' hat einen ungueltigen Typ. Erlaubt: Text, Zahl, Boolean.")
            if len(val) > 1024:
                raise ValueError(f"Wert von '{key}' ist zu lang (maximal 1024 Zeichen).")
            if any(ord(ch) < 32 for ch in val):
                raise ValueError(f"Wert von '{key}' enthaelt unzulaessige Steuerzeichen.")
            cleaned[key] = val
        return cleaned

def _send_status_webhook(webhook_url: Optional[str], job_id: str, status: str,
                         target_host: str, playbooks: List[str], error: Optional[str] = None):
    """: Sends a JSON payload to the configured webhook URL after a run finishes
    (e.g. Slack/Teams/Discord incoming webhooks). Best-effort, with a short timeout;
    errors are only logged and do not abort the run."""
    if not webhook_url:
        return
    try:
        import json as _json
        import urllib.request
        # 'text' is the field most broadly supported by Slack/Mattermost/Discord; the
        # structured fields allow custom integrations.
        emoji = "✅" if status == "success" else "❌"
        text = f"{emoji} Ansimate Playbook-Lauf {job_id}: {status.upper()} (Ziel: {target_host})"
        payload = {
            "text": text,
            "job_id": job_id,
            "status": status,
            "target_host": target_host,
            "playbooks": list(playbooks or []),
            "finished_at": datetime.now().isoformat(),
        }
        if error:
            payload["error"] = str(error)[:1000]
        data = _json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(webhook_url, data=data,
                                     headers={"Content-Type": "application/json",
                                              "User-Agent": "Ansimate-Webhook/1.0"},
                                     method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read(1)
    except Exception as wh_err:
        print(f"Webhook-Versand fuer Job {job_id} fehlgeschlagen: {wh_err}")

def run_playbook_background(
    job_id: str,
    playbooks: List[str],
    target_host: str,
    username: Optional[str],
    password: Optional[str],
    variables: Optional[dict] = None,
    ssh_key: Optional[str] = None,
    user_email: Optional[str] = None,
    send_notifications: bool = False,
    hosts: Optional[list] = None,
    webhook_url: Optional[str] = None,
    become_password: Optional[str] = None
):
    # : if the job was already canceled in the queue, do not even start it.
    with active_runs_lock:
        precanceled = job_id in cancel_requested
        if precanceled:
            cancel_requested.discard(job_id)
    if precanceled:
        update_job_status(job_id, "canceled", datetime.now().isoformat())
        return

    # : read the default timeout (seconds) from the dynamic settings (default 3600).
    # Robust against missing/invalid values -> fallback to 3600.
    job_timeout = 3600
    try:
        with SessionLocal() as _db:
            raw = _get_setting(_db, "default_job_timeout", "3600")
        val = int(str(raw).strip())
        if val > 0:
            job_timeout = val
    except Exception:
        job_timeout = 3600

    #: connection timeout (seconds) from the dynamic settings (default 30).
    # Controls ANSIBLE_TIMEOUT and thus, among other things, the wait time for the sudo/become prompt. Some
    # targets (slow PAM/network auth, LDAP/SSSD/DNS) show the prompt only after >10s; Ansible's
    # default (~10s) then expires -> "Timeout waiting for privilege escalation prompt", although
    # the password is correct. Higher value = more robust against slow targets, but unreachable
    # hosts only report as "unreachable" after this time. Robust against garbage -> fallback 30.
    connection_timeout = 30
    try:
        with SessionLocal() as _db:
            raw_ct = _get_setting(_db, "default_connection_timeout", "30")
        val_ct = int(str(raw_ct).strip())
        if val_ct > 0:
            connection_timeout = val_ct
    except Exception:
        connection_timeout = 30

    # Normalize hosts: either a list (device group) or a single host.
    if hosts:
        host_entries = hosts
    else:
        host_entries = [{"host": target_host, "username": username, "password": password, "ssh_key": ssh_key, "become_password": become_password}]

    # Determine if we are running any custom playbooks and extract user_id
    is_custom = any(pb.startswith("custom/") or pb.startswith("/playbooks/custom/") for pb in playbooks)
    user_id = None
    if is_custom:
        for pb in playbooks:
            if pb.startswith("custom/"):
                parts = pb.split("/")
                if len(parts) >= 2:
                    user_id = parts[1]
                    break
            elif pb.startswith("/playbooks/custom/"):
                parts = pb.split("/")
                if len(parts) >= 4:
                    user_id = parts[3]
                    break

    # 1. Create a temporary inventory file to store host, auth and variables
    # For custom playbooks, write inventory/key to a shared volume path `/playbooks/tmp`
    # so they can be read by the sandbox docker container.
    inv_dir = "/playbooks/tmp" if is_custom else "/tmp"
    os.makedirs(inv_dir, exist_ok=True)
    inv_path = f"{inv_dir}/inv_{job_id}"
    key_path = f"{inv_dir}/key_{job_id}"  # base for cleanup/sandbox error path
    key_paths = []  # all written key files (per host)
    #: TOFU PER JOB instead of a persistent known_hosts. StrictHostKeyChecking=accept-new
    # accepts NEW hosts automatically (dominant case: first-time connection) and detects a
    # key changed MID-run -> protects credentials against silent MITM within
    # a job. But the known_hosts is EPHEMERAL per job: a host key changed after an OS reinstall
    # (new fingerprint) therefore no longer blocks ANY later execution -
    # previously the known_hosts persisted in LOGS_DIR and rejected the changed key.
    # Sandbox (custom): tmpfs path, fresh anyway per container run. Host run: own
    # known_hosts file per job under inv_dir (removed again in the finally).
    if is_custom:
        known_hosts_file = "/playbooks/tmp/known_hosts"
    else:
        known_hosts_file = os.path.join(inv_dir, f"known_hosts_{job_id}")
        try:
            if not os.path.exists(known_hosts_file):
                open(known_hosts_file, "a").close()
        except Exception as _kh_e:
            print(f"known_hosts konnte nicht vorbereitet werden: {_kh_e}")
    try:
        # Prepare variables once (they apply to all hosts)
        var_suffix = ""
        # base_dir is set separately PER HOST (with a home-directory fallback), so it is
        # excluded here. A non-empty base_dir explicitly set by the user/preset/group
        # takes precedence; an empty string counts as "not specified" and triggers the fallback.
        provided_base_dir = None
        if variables:
            raw_bd = variables.get("base_dir")
            if raw_bd is not None and str(raw_bd).strip():
                provided_base_dir = str(raw_bd).strip()
            for key, val in variables.items():
                if not re.match(r"^[a-zA-Z0-9_]{1,64}$", str(key)):
                    continue
                if str(key).lower().startswith("ansible"):
                    continue
                if str(key) == "base_dir":
                    continue
                val_str = str(val).lower() if isinstance(val, bool) else str(val)
                val_str = "".join(ch for ch in val_str if ord(ch) >= 32)
                safe_val = val_str.replace("'", "'\"'\"'")
                var_suffix += f" {key}='{safe_val}'"

        with open(inv_path, "w") as inv_file:
            inv_file.write("[all]\n")
            for idx, he in enumerate(host_entries):
                h_host = (he.get("host") or "").strip()
                if not h_host:
                    continue
                h_user = he.get("username")
                h_pass = he.get("password")
                h_key = he.get("ssh_key")
                line = f"{h_host}"
                if h_user:
                    # Defense-in-depth: remove control characters + single-quote-escape
                    safe_user = "".join(ch for ch in str(h_user) if ord(ch) >= 32).replace("'", "'\"'\"'")
                    line += f" ansible_user='{safe_user}' ssh_user='{safe_user}'"
                if h_pass:
                    safe_pass = "".join(ch for ch in str(h_pass) if ord(ch) >= 32).replace("'", "'\"'\"'")
                    line += f" ansible_password='{safe_pass}'"
                #: sudo/become password. Priority: an explicitly stored/provided become
                # password (also works with key auth) -> otherwise fallback to the SSH password
                # (previous behavior: the SSH password also serves as the sudo password). Fixes the
                # privilege-escalation timeout on systems without passwordless sudo.
                h_become = he.get("become_password") or (h_pass if h_pass else None)
                if h_become:
                    safe_become = "".join(ch for ch in str(h_become) if ord(ch) >= 32).replace("'", "'\"'\"'")
                    line += f" ansible_become_password='{safe_become}'"
                if h_key:
                    kp = f"{inv_dir}/key_{job_id}_{idx}"
                    with open(kp, "w") as key_file:
                        key_file.write(h_key.strip() + "\n")
                    os.chmod(kp, 0o600)
                    key_paths.append(kp)
                    line += f" ansible_ssh_private_key_file='{kp}'"
                line += f" ansible_ssh_common_args='-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile={known_hosts_file}'"
                # base_dir: use the explicit value; otherwise fall back to the SSH user's
                # home directory (root -> /root, otherwise /home/<user>). Mirrors the
                # former frontend rule server-side so that EVERY run (ad-hoc, device, group,
                # preset, scenario) has a set base_dir instead of an empty/missing value.
                #: per-host base_dir (from the device) takes precedence over the global value.
                bd_value = he.get("base_dir") or provided_base_dir
                if bd_value is None and h_user:
                    bd_user = "".join(ch for ch in str(h_user) if ord(ch) >= 32)
                    bd_value = "/root" if bd_user == "root" else f"/home/{bd_user}"
                if bd_value:
                    safe_bd = "".join(ch for ch in str(bd_value) if ord(ch) >= 32).replace("'", "'\"'\"'")
                    line += f" base_dir='{safe_bd}'"
                line += var_suffix
                inv_file.write(line + "\n")
    except Exception as e:
        update_job_status(job_id, "failed", datetime.now().isoformat())
        log_file_path = os.path.join(LOGS_DIR, f"{job_id}.log")
        with open(log_file_path, "w") as lf:
            lf.write(f"Failed to generate temporary inventory file: {e}\n")

        # Send fail email
        if send_notifications and user_email:
            try:
                from email_helper import send_email_sync
                subject = f"Ansimate - Ausführung fehlgeschlagen: {job_id}"
                html_body = f"""
                <h3>Ansimate Playbook-Ausführung fehlgeschlagen</h3>
                <p>Die Ausführung des Jobs <b>{job_id}</b> konnte nicht gestartet werden.</p>
                <p><b>Fehler bei der Inventarerstellung:</b> {e}</p>
                """
                send_email_sync(user_email, subject, html_body, f"Ansimate Playbook-Ausführung fehlgeschlagen: Job ID {job_id}. Fehler: {e}")
            except Exception:
                pass
        return

    # 2. Build the ansible-playbook command and prevent directory traversal
    #: add missing `requires` dependencies server-side (prerequisite playbooks
    # like install-flatpak/install-docker) so that presets/scenarios/API runs that list only the app
    # also install the package manager. Ordering follows below via _playbook_order_rank.
    effective_playbooks = _expand_playbook_requires(playbooks)
    playbook_paths = []
    for pb in effective_playbooks:
        resolved_path = _resolve_std_playbook_path(pb)   # incl. premium/ subfolder; traversal-safe
        if resolved_path:
            playbook_paths.append(resolved_path)

    #: enforce dependency ordering. Scenarios/presets bundle multiple playbooks;
    # their order (from the preset playbook_ids/the selection) is arbitrary and can, for example,
    # push `create-stack-*` BEFORE `install-docker.yml` -> fails because Docker is still missing.
    # Sort stably by basename prefix: prerequisites first, create-stack-* last,
    # everything else in between (original order per group is preserved by the stable sort).
    #: package-manager prerequisites (Docker, Flatpak) are themselves install-* playbooks, but must
    # run BEFORE the other install-* (install-flatpak before the Flatpak apps) -> their own stage 0.
    def _playbook_order_rank(p):
        base = os.path.basename(p)
        if base in ("install-docker.yml", "install-flatpak.yml"):
            return 0
        if base.startswith("install-"):
            return 1
        if base.startswith("create-stack-"):
            return 3
        return 2
    playbook_paths.sort(key=_playbook_order_rank)

    if not playbook_paths:
        update_job_status(job_id, "failed", datetime.now().isoformat())
        log_file_path = os.path.join(LOGS_DIR, f"{job_id}.log")
        with open(log_file_path, "w") as lf:
            lf.write("No valid playbooks found to execute.\n")
        if os.path.exists(inv_path):
            os.remove(inv_path)
        #: also remove the ephemeral per-job known_hosts (host run) on early abort.
        if not is_custom and os.path.exists(known_hosts_file):
            try:
                os.remove(known_hosts_file)
            except Exception:
                pass

        # Send fail email
        if send_notifications and user_email:
            try:
                from email_helper import send_email_sync
                subject = f"Ansimate - Ausführung fehlgeschlagen: {job_id}"
                html_body = f"""
                <h3>Ansimate Playbook-Ausführung fehlgeschlagen</h3>
                <p>Die Ausführung des Jobs <b>{job_id}</b> konnte nicht gestartet werden.</p>
                <p><b>Fehler:</b> Keine gültigen Playbooks gefunden.</p>
                """
                send_email_sync(user_email, subject, html_body, f"Ansimate Playbook-Ausführung fehlgeschlagen: Job ID {job_id}. Keine Playbooks gefunden.")
            except Exception:
                pass
        return

    # Set up environment variables. Force plain text logs (no ANSI colors) for the file.
    env = os.environ.copy()
    #: keep host-key checking active so that ansible does NOT inject StrictHostKeyChecking=no
    # and our accept-new/known_hosts args from the inventory take effect (TOFU).
    env["ANSIBLE_HOST_KEY_CHECKING"] = "True"
    env["ANSIBLE_NOCOLOR"] = "1"
    #: live log flow. ansible-playbook is a Python process; if Python detects that stdout
    # is NOT a TTY but a pipe, it switches to block buffering (~4-8 KB) -> output
    # only appears at job end (the GUI stays empty during the run). PYTHONUNBUFFERED=1 forces
    # unbuffered stdout so that each line is flushed to the pipe/log file immediately.
    env["PYTHONUNBUFFERED"] = "1"
    #: Ansible connection timeout (seconds). Determines, among other things, how long ansible waits for the
    # target's sudo/become password prompt. The default (~10s) is too short for targets with slow
    # PAM -> admin-configurable here (default_connection_timeout, default 30).
    env["ANSIBLE_TIMEOUT"] = str(connection_timeout)
    #: load the vendored sudo become plugin with sudo-rs prompt support (Ubuntu 25.10+).
    if os.path.isdir(BECOME_PLUGINS_DIR):
        env["ANSIBLE_BECOME_PLUGINS"] = BECOME_PLUGINS_DIR

    cmd = ["ansible-playbook", "-i", inv_path] + playbook_paths

    # Construct execution command (sandbox docker container vs host command)
    if is_custom:
        # SECURITY: no --volumes-from (would inherit docker.sock = host root/sandbox escape).
        # FAIL-CLOSED: without a determinable owner OR without HOST_PLAYBOOKS_DIR it does NOT run on the
        # host path (issue).
        host_playbooks_dir = os.environ.get("HOST_PLAYBOOKS_DIR")
        if not user_id or not host_playbooks_dir:
            update_job_status(job_id, "failed", datetime.now().isoformat())
            err_log = os.path.join(LOGS_DIR, f"{job_id}.log")
            with open(err_log, "w") as lf:
                if not host_playbooks_dir:
                    lf.write("Sandbox nicht konfiguriert: HOST_PLAYBOOKS_DIR ist nicht gesetzt.\n")
                else:
                    lf.write("Sandbox: Eigentuemer des Custom-Playbooks konnte nicht ermittelt werden.\n")
                lf.write("Custom-Playbooks werden aus Sicherheitsgruenden nicht ausgefuehrt.\n")
            for _p in ([inv_path] + key_paths):
                if os.path.exists(_p):
                    try:
                        os.remove(_p)
                    except Exception:
                        pass
            return
        # SECURITY (issue): do NOT make the entire /playbooks tree visible.
        # tmpfs hides all other users' custom playbooks and all other users' job inventories/keys;
        # after that only the OWN custom directory and the job's own inventory/key file
        # are remounted read-only in a targeted way. Standard playbooks under /playbooks stay readable.
        sandbox_cmd = [
            "docker", "run", "--rm",
            "--name", f"ansible-sandbox-{job_id}",
            "-v", f"{host_playbooks_dir}:/playbooks:ro",
            "--tmpfs", "/playbooks/tmp:rw,noexec,nosuid",
            "--tmpfs", "/playbooks/custom:rw,noexec,nosuid",
            "-v", f"{host_playbooks_dir}/custom/{user_id}:/playbooks/custom/{user_id}:ro",
            "-v", f"{host_playbooks_dir}/tmp/inv_{job_id}:{inv_path}:ro",
            "--memory", "512m",
            "--cpus", "1.0",
            "--pids-limit", "512",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "-e", "ANSIBLE_HOST_KEY_CHECKING=True",
            "-e", "ANSIBLE_NOCOLOR=1",
            #: unbuffered stdout in the sandbox container too (ansible runs inside it).
            "-e", "PYTHONUNBUFFERED=1",
            #: connection timeout + sudo-rs-capable become plugin in the sandbox too
            # (same backend image -> the plugin lives at the same path).
            "-e", f"ANSIBLE_TIMEOUT={connection_timeout}",
            "-e", f"ANSIBLE_BECOME_PLUGINS={BECOME_PLUGINS_DIR}",
        ]
        for _kp in key_paths:
            _kname = os.path.basename(_kp)
            sandbox_cmd += ["-v", f"{host_playbooks_dir}/tmp/{_kname}:{_kp}:ro"]

        # : defense-in-depth. The socket proxy filters API endpoints, but NOT
        # the contents of bind mounts. Therefore enforce fail-closed here that
        #   (a) no privileged/host-root-capable flags are set and
        #   (b) every host source of a bind mount lies strictly INSIDE host_playbooks_dir.
        # This way no run can accidentally mount host root (/) or a path outside the
        # playbook tree into the sandbox.
        _forbidden_flags = {"--privileged", "--volumes-from", "--pid", "--ipc", "--userns",
                            "--cap-add", "--device", "--net=host", "--network=host"}
        _hp_real = os.path.realpath(host_playbooks_dir)
        _mount_violation = None
        for _i, _tok in enumerate(sandbox_cmd):
            if _tok in _forbidden_flags or _tok.startswith("--privileged"):
                _mount_violation = f"Unzulaessiges Sandbox-Flag: {_tok}"
                break
            if _tok == "-v" and _i + 1 < len(sandbox_cmd):
                _src = sandbox_cmd[_i + 1].split(":", 1)[0]
                _src_real = os.path.realpath(_src)
                if _src_real != _hp_real and not _src_real.startswith(_hp_real + os.sep):
                    _mount_violation = f"Bind-Mount-Quelle ausserhalb des Playbook-Baums: {_src}"
                    break
        if _mount_violation:
            update_job_status(job_id, "failed", datetime.now().isoformat())
            with open(os.path.join(LOGS_DIR, f"{job_id}.log"), "w") as lf:
                lf.write(f"Sandbox aus Sicherheitsgruenden abgebrochen: {_mount_violation}\n")
            for _p in ([inv_path] + key_paths):
                if os.path.exists(_p):
                    try:
                        os.remove(_p)
                    except Exception:
                        pass
            return

        sandbox_cmd += ["devnet-ansible-webui-backend"] + cmd
        cmd_to_run = sandbox_cmd
    else:
        cmd_to_run = cmd

    log_file_path = os.path.join(LOGS_DIR, f"{job_id}.log")
    update_job_status(job_id, "running")
    #: actual execution start (not the enqueue time created_at) as the basis for
    # the total runtime in the completion/error mail.
    run_started = datetime.now()

    # Send start email notification if requested
    if send_notifications and user_email:
        try:
            from email_helper import send_email_sync
            subject = f"Ansimate - Ausführung gestartet: {job_id}"
            html_body = f"""
            <h3>Ansimate Playbook-Ausführung gestartet</h3>
            <p>Die Ausführung des Jobs <b>{job_id}</b> wurde gestartet.</p>
            <ul>
                <li><b>Zielgerät:</b> {target_host}</li>
                <li><b>SSH-Benutzer:</b> {username or 'Standard'}</li>
                <li><b>Playbooks:</b> {', '.join(playbooks)}</li>
                <li><b>Startzeit:</b> {datetime.now().isoformat()}</li>
            </ul>
            <p>Sie können die Ausführung im WebUI überwachen.</p>
            """
            text_body = f"Ansimate Playbook-Ausführung gestartet: Job ID {job_id}, Zielgerät {target_host}, Playbooks {', '.join(playbooks)}."
            send_email_sync(user_email, subject, html_body, text_body)
        except Exception as email_err:
            print(f"Failed to send start notification: {email_err}")

    try:
        with open(log_file_path, "w") as log_file:
            log_file.write(f"=== Starting Playbook Execution at {datetime.now().isoformat()} ===\n")
            log_file.write(f"Command: {' '.join(cmd_to_run)}\n")
            log_file.write(f"Target: {target_host}\n")
            if username:
                log_file.write(f"SSH User: {username}\n")
            if variables:
                log_file.write("Variables:\n")
                for key, val in variables.items():
                    log_file.write(f"  {key}: {val}\n")
            log_file.write("=========================================================\n\n")
            log_file.flush()

            # Execute subprocess
            process = subprocess.Popen(
                cmd_to_run,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                #: bufsize=1 = line-buffered reading on the parent side (text mode only),
                # so that each line flushed by the child arrives immediately instead of lingering
                # in a read buffer.
                bufsize=1,
                env=env if not is_custom else None
            )

            # : register the process for cancellation; if the cancellation arrived in the spawn
            # window, terminate immediately (the streaming/wait below then returns promptly).
            with active_runs_lock:
                active_runs[job_id] = {"process": process, "is_custom": is_custom}
                _cancel_now = job_id in cancel_requested
            if _cancel_now:
                _terminate_run_process(job_id, process, is_custom)

            # Scrub secrets function
            # Masking list from ALL host entries (device group) + top-level creds
            _mask_creds = []
            if password:
                _mask_creds.append(password)
            _mask_keys = []
            if ssh_key:
                _mask_keys.append(ssh_key)
            for _he in (host_entries or []):
                if _he.get("password"):
                    _mask_creds.append(_he.get("password"))
                if _he.get("ssh_key"):
                    _mask_keys.append(_he.get("ssh_key"))

            def mask_secrets(text_line: str) -> str:
                secrets_to_mask = list(_mask_creds)
                for _k in _mask_keys:
                    for part in _k.strip().split("\n"):
                        clean_part = part.strip()
                        if clean_part and len(clean_part) > 10 and "PRIVATE KEY" not in clean_part:
                            secrets_to_mask.append(clean_part)

                masked = text_line
                for sec in secrets_to_mask:
                    if sec and sec in masked:
                        masked = masked.replace(sec, "********")
                return masked

            # Stream output directly to the log file and enforce timeout
            #: marks whether Ansible failed at privilege escalation (sudo/become).
            become_prompt_error = False
            try:
                #: readline iterator instead of `for line in process.stdout` so that NO
                # additional read-ahead buffer of the file iterator holds lines back — each
                # line is delivered immediately at the newline and (with flush) written live to the log file
                # that get_job_logs streams.
                for line in iter(process.stdout.readline, ""):
                    masked_line = mask_secrets(line)
                    log_file.write(masked_line)
                    log_file.flush()
                    #: detect typical sudo/become error signatures (timeout at the prompt,
                    # missing/wrong password) in order to append a clear message at the end.
                    _ll = masked_line.lower()
                    if ("privilege escalation prompt" in _ll
                            or "missing sudo password" in _ll
                            or "a password is required" in _ll
                            or "incorrect sudo password" in _ll):
                        become_prompt_error = True

                # : configurable timeout (default 3600s) instead of a fixed 5 minutes.
                return_code = process.wait(timeout=job_timeout)
            except subprocess.TimeoutExpired:
                print(f"Job {job_id} timed out. Terminating...")
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()

                if is_custom:
                    subprocess.run(["docker", "kill", f"ansible-sandbox-{job_id}"], capture_output=True)

                log_file.write(f"\n=== ERROR: Execution timed out (Max {job_timeout} seconds allowed) ===\n")
                log_file.flush()
                return_code = -99

            log_file.write(f"\n=========================================================\n")
            log_file.write(f"=== Playbook Execution finished at {datetime.now().isoformat()} with code {return_code} ===\n")
            #: clear, actionable message instead of a silent sudo timeout.
            if become_prompt_error and return_code != 0:
                log_file.write(
                    "\n=== FEHLER: Rechteausweitung (sudo/become) fehlgeschlagen ===\n"
                    "Das Zielsystem verlangt ein Sudo-Passwort, es wurde aber keins oder ein falsches uebergeben.\n"
                    "-> Hinterlege ein Sudo-/Become-Passwort am Geraet (My Vault) oder gib es im Ausfuehren-Dialog an.\n"
                    "-> Alternativ passwortloses Sudo (NOPASSWD) fuer den SSH-Benutzer auf dem Zielsystem konfigurieren.\n"
                )
            log_file.flush()

        # : determine the final status. update_job_status is terminal-state-safe (does NOT
        # overwrite an already-set terminal state – e.g. a parallel cancellation) and returns the
        # actually persisted status; mail/webhook follow it (no mismatch).
        with active_runs_lock:
            was_canceled = job_id in cancel_requested
        intended = "canceled" if was_canceled else ("success" if return_code == 0 else "failed")
        final_status = update_job_status(job_id, intended, datetime.now().isoformat())

        # Send completion email notification if requested.: notify on EVERY terminal state
        # (success/failed/canceled) and include the total runtime.
        if send_notifications and user_email and final_status:
            try:
                from email_helper import send_email_sync
                status_text = {"success": "Erfolgreich", "failed": "Fehlgeschlagen",
                               "canceled": "Abgebrochen"}.get(final_status, final_status)
                _secs = max(0, int((datetime.now() - run_started).total_seconds()))
                runtime_str = f"{_secs // 3600}:{(_secs % 3600) // 60:02d}:{_secs % 60:02d}"
                subject = f"Ansimate - Ausführung beendet: {job_id} ({status_text})"
                html_body = f"""
                <h3>Ansimate Playbook-Ausführung beendet</h3>
                <p>Die Ausführung des Jobs <b>{job_id}</b> wurde beendet mit Status: <b>{status_text}</b>.</p>
                <ul>
                    <li><b>Zielgerät:</b> {target_host}</li>
                    <li><b>SSH-Benutzer:</b> {username or 'Standard'}</li>
                    <li><b>Playbooks:</b> {', '.join(playbooks)}</li>
                    <li><b>Laufzeit:</b> {runtime_str}</li>
                    <li><b>Beendet um:</b> {datetime.now().isoformat()}</li>
                </ul>
                <p>Die Logs können im WebUI eingesehen werden.</p>
                """
                text_body = (f"Ansimate Playbook-Ausführung beendet: Job ID {job_id}, "
                             f"Status: {status_text}, Laufzeit: {runtime_str}.")
                send_email_sync(user_email, subject, html_body, text_body)
            except Exception as email_err:
                print(f"Failed to send completion notification: {email_err}")

        # : webhook after completion (success/failure/cancellation) – actually
        # persisted status (terminal-state-safe against parallel cancellation).
        _send_status_webhook(webhook_url, job_id, final_status or intended, target_host, playbooks)

    except Exception as e:
        # : terminal-state-safe – a parallel cancellation is not overwritten to "failed".
        final_status = update_job_status(job_id, "failed", datetime.now().isoformat())
        try:
            with open(log_file_path, "a") as log_file:
                log_file.write(f"\nError running playbook: {e}\n")
        except Exception:
            pass

        # Send fail email notification if requested (only if it actually failed)
        if send_notifications and user_email and final_status == "failed":
            try:
                from email_helper import send_email_sync
                _secs = max(0, int((datetime.now() - run_started).total_seconds()))
                runtime_str = f"{_secs // 3600}:{(_secs % 3600) // 60:02d}:{_secs % 60:02d}"
                subject = f"Ansimate - Ausführung fehlgeschlagen: {job_id}"
                html_body = f"""
                <h3>Ansimate Playbook-Ausführung fehlgeschlagen</h3>
                <p>Die Ausführung des Jobs <b>{job_id}</b> ist fehlgeschlagen.</p>
                <p><b>Fehler:</b> {e}</p>
                <ul><li><b>Laufzeit:</b> {runtime_str}</li></ul>
                <p>Die Logs können im WebUI eingesehen werden.</p>
                """
                text_body = f"Ansimate Playbook-Ausführung fehlgeschlagen: Job ID {job_id}. Laufzeit: {runtime_str}. Fehler: {e}."
                send_email_sync(user_email, subject, html_body, text_body)
            except Exception as email_err:
                print(f"Failed to send error notification: {email_err}")

        # : webhook on failure (exception during execution) – actually
        # persisted status (does not overwrite a parallel cancellation).
        _send_status_webhook(webhook_url, job_id, final_status or "failed", target_host, playbooks,
                             error=str(e) if final_status == "failed" else None)
    finally:
        # : release this job's process registry + cancellation flag.
        with active_runs_lock:
            active_runs.pop(job_id, None)
            cancel_requested.discard(job_id)
        # Clean up temporary inventory file
        if os.path.exists(inv_path):
            try:
                os.remove(inv_path)
            except Exception as e:
                print(f"Error removing temporary inventory {inv_path}: {e}")
        # Clean up temporary key files (one per host)
        for _kp in key_paths:
            if os.path.exists(_kp):
                try:
                    os.remove(_kp)
                except Exception as e:
                    print(f"Error removing temporary key {_kp}: {e}")
        #: remove the ephemeral per-job known_hosts of the host run (sandbox uses tmpfs,
        # the path does not exist there on the host -> os.path.exists filters it out).
        if not is_custom and os.path.exists(known_hosts_file):
            try:
                os.remove(known_hosts_file)
            except Exception as e:
                print(f"Error removing temporary known_hosts {known_hosts_file}: {e}")

def queue_worker():
    while True:
        item = execution_queue.get()
        if item is None:
            break
        job_id, playbooks, target_host, username, password, variables, ssh_key, user_email, send_notifications, hosts, webhook_url, become_password = item
        try:
            run_playbook_background(
                job_id, playbooks, target_host, username, password, variables,
                ssh_key=ssh_key, user_email=user_email, send_notifications=send_notifications, hosts=hosts,
                webhook_url=webhook_url, become_password=become_password
            )
        except Exception as e:
            print(f"Error in queue worker processing job {job_id}: {e}")
        finally:
            execution_queue.task_done()


# : task queue with a configurable concurrency limit. MAX_CONCURRENT_RUNS
# controls how many Ansible executions may run in parallel (default 2). Excess
# requests stay in the queue with status "pending" and are processed as soon as
# a worker becomes free. Previously there was only one worker (de-facto limit 1).
def _max_concurrent_runs() -> int:
    try:
        n = int(os.environ.get("MAX_CONCURRENT_RUNS", "2"))
    except (TypeError, ValueError):
        n = 2
    return max(1, n)


# Start background queue execution thread pool
_worker_threads = []
for _i in range(_max_concurrent_runs()):
    _wt = threading.Thread(target=queue_worker, daemon=True, name=f"ansible-worker-{_i}")
    _wt.start()
    _worker_threads.append(_wt)

def load_index_metadata() -> list:
    index_path = "/playbooks/index.yml"
    if os.path.isfile(index_path):
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                metadata = yaml.safe_load(f)
                if isinstance(metadata, list):
                    return metadata
        except Exception as e:
            print(f"Error parsing index.yml: {e}")
    return []

def _expand_playbook_requires(playbook_files: list) -> list:
    """: Add missing `requires` dependencies (recursively, from index.yml) to a run selection.
    Unlike the frontend auto-selection, this applies server-side for EVERY run path
    (direct selection, presets, scenarios, API/token) – so prerequisite playbooks
    (install-flatpak before the Flatpak apps, install-docker before the stacks) run even when the
    stored/passed list contains only the app. The EXECUTION order is then ensured
    by `_playbook_order_rank`; here only the SET (deduplicated) is extended.
    `seen` (by basename) also protects against cycles in the requires entries."""
    try:
        requires_map = {
            e["file"]: [r for r in (e.get("requires") or []) if isinstance(r, str)]
            for e in load_index_metadata() if isinstance(e, dict) and e.get("file")
        }
    except Exception:
        return list(playbook_files or [])
    result, seen = [], set()
    queue = list(playbook_files or [])
    while queue:
        pb = queue.pop(0)
        base = os.path.basename(str(pb))
        if base in seen:
            continue
        seen.add(base)
        result.append(pb)
        queue.extend(requires_map.get(base, []))
    return result

# : i18n-capable metadata fields in index.yml. A field may carry a language dict
# instead of a plain string, e.g.  description: { de: "...", en: "..." }. `_localize` picks
# from it the value of the active UI language (fallback chain: desired language -> en -> de -> first
# non-empty value). Plain strings (the normal case for 161 playbooks) are passed through
# unchanged -> fully backward-compatible; a playbook can become bilingual step by step
# without touching the others. `lang` comes from the `?lang=` query of the
# catalog endpoints (the source of truth is the language active in the frontend).
def _localize(value, lang):
    if isinstance(value, dict):
        for cand in (lang, "en", "de"):
            if cand and value.get(cand):
                return value[cand]
        for v in value.values():
            if v:
                return v
        return ""
    return value

def resolve_playbook_metadata(file_path: str, index_metadata: list, lang: Optional[str] = None) -> dict:
    base_file = os.path.basename(file_path)
    metadata_entry = None
    if index_metadata:
        for entry in index_metadata:
            if isinstance(entry, dict) and entry.get("file") == base_file:
                metadata_entry = entry
                break

    full_path = os.path.join("/playbooks", file_path)
    size = os.path.getsize(full_path) if os.path.isfile(full_path) else 0

    if metadata_entry:
        return {
            "file": file_path,
            "name": metadata_entry.get("name", base_file),
            "icon": metadata_entry.get("icon", "description"),
            "description": _localize(metadata_entry.get("description", "Keine Beschreibung verfügbar."), lang),
            "size": size,
            "requires": metadata_entry.get("requires", []),
            "category": metadata_entry.get("category", ""),
            # : vendor/author URLs (legal transparency). Default empty.
            "vendor_urls": metadata_entry.get("vendor_urls", []),
            #: configurable variables from index.yml so the run dialog can render
            # input fields for playbooks that have no hardcoded playbookDomainConfigs
            # entry (game servers etc.). Empty list when the catalog entry defines none.
            "variables": metadata_entry.get("variables", [])
        }
    else:
        return {
            "file": file_path,
            "name": base_file,
            "icon": "description",
            "description": "Lokales Ansible Playbook.",
            "size": size,
            "requires": [],
            "category": "",
            "vendor_urls": []
        }


class LoginSchema(BaseModel):
    # "identifier" accepts username OR email. "email" is kept as a
    # backward-compatible alias (older clients / tests).
    identifier: Optional[str] = None
    email: Optional[str] = None
    password: str


class ProfileUpdateSchema(BaseModel):
    username: str
    email: str
    # Optional: identity/2FA change happens session-authenticated; no
    # separate 'current password' field needed in the profile anymore.
    current_password: Optional[str] = None
    # : optional UI language ("de"|"en"|""/None=automatic). Consistency with the
    # dedicated language setter so that "save profile" can carry the language along.
    language: Optional[str] = None

# : dedicated body for the lightweight language setter (header switcher/
# profile select) that should NOT send the whole profile (username+email required).
class ProfileLanguageSchema(BaseModel):
    language: Optional[str] = None  # "de" | "en" | None/"" = automatic (browser detection)

class ChangePasswordSchema(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v):
        # : the dynamic minimum length is checked in the handler (validate_password_policy).
        if len(v) > 72:
            raise ValueError("Passwort darf maximal 72 Zeichen lang sein.")
        return v


class TokenCreateSchema(BaseModel):
    name: str
    scopes: List[str]
    expires_in_days: Optional[int] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Name darf nicht leer sein.")
        if len(v) > 100:
            raise ValueError("Name darf maximal 100 Zeichen lang sein.")
        return v

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, v):
        #: granular scopes. run_playbook/read_logs (existing) + manage_devices/
        # manage_scenarios (agent enablement: device/scenario management via token).
        allowed = TOKEN_SCOPES
        cleaned = []
        for s in (v or []):
            if s not in allowed:
                raise ValueError(f"Ungueltiger Scope: {s!r}. Erlaubt: {', '.join(sorted(allowed))}.")
            if s not in cleaned:
                cleaned.append(s)
        if not cleaned:
            raise ValueError("Mindestens ein gueltiger Scope ist erforderlich.")
        return cleaned


class PasswordResetRequestSchema(BaseModel):
    identifier: Optional[str] = None
    email: Optional[str] = None
    captcha_id: Optional[str] = None
    captcha_answer: Optional[str] = None


class PasswordResetSchema(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v):
        # : the dynamic minimum length is checked in the handler (validate_password_policy).
        if len(v) > 72:
            raise ValueError("Passwort darf maximal 72 Zeichen lang sein.")
        return v

class PasswordConfirmSchema(BaseModel):
    current_password: str

class DeviceCreateSchema(BaseModel):
    name: str
    host: str
    username: Optional[str] = None
    port: Optional[int] = 22
    credential: Optional[str] = None
    credential_type: Optional[str] = None
    #: optional sudo/become password (separate from the SSH credential).
    become_password: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        v = v.strip()
        if not re.match(r"^[a-zA-Z0-9 _-]+$", v):
            raise ValueError("Ungueltiger Geraete-Name. Nur Alphanumerisch, Leerzeichen, Unterstriche und Bindestriche erlaubt.")
        if len(v) < 3 or len(v) > 50:
            raise ValueError("Geraete-Name muss zwischen 3 und 50 Zeichen lang sein.")
        return v

    @field_validator("host")
    @classmethod
    def validate_host(cls, v):
        v = v.strip()
        if not re.match(r"^[a-zA-Z0-9.:_-]+$", v):
            raise ValueError("Ungueltiges Host-Format. Nur Alphanumerisch, Punkte, Doppelpunkte, Unterstriche und Bindestriche erlaubt.")
        if len(v) > 253:
            raise ValueError("Host-Name ist zu lang (maximal 253 Zeichen).")
        return v

    @field_validator("username")
    @classmethod
    def validate_username(cls, v):
        if v is None:
            return v
        v = v.strip()
        if v == "":
            return None
        if not re.match(r"^[a-zA-Z0-9._-]+$", v):
            raise ValueError("Ungueltiger SSH-Benutzername. Nur Alphanumerisch, Punkte, Unterstriche und Bindestriche erlaubt.")
        if len(v) > 32:
            raise ValueError("SSH-Benutzername ist zu lang (maximal 32 Zeichen).")
        return v

    @field_validator("port")
    @classmethod
    def validate_port(cls, v):
        if v is not None and (v < 1 or v > 65535):
            raise ValueError("Port muss zwischen 1 und 65535 liegen.")
        return v

    @field_validator("credential_type")
    @classmethod
    def validate_cred_type(cls, v):
        if v is not None and v not in ["password", "key"]:
            raise ValueError("credential_type muss 'password' oder 'key' sein.")
        return v

class DeviceUpdateSchema(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    username: Optional[str] = None
    port: Optional[int] = None
    credential: Optional[str] = None
    credential_type: Optional[str] = None
    #: optional sudo/become password. None = leave unchanged, "" = delete.
    become_password: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not re.match(r"^[a-zA-Z0-9 _-]+$", v):
            raise ValueError("Ungueltiger Geraete-Name. Nur Alphanumerisch, Leerzeichen, Unterstriche und Bindestriche erlaubt.")
        if len(v) < 3 or len(v) > 50:
            raise ValueError("Geraete-Name muss zwischen 3 und 50 Zeichen lang sein.")
        return v

    @field_validator("host")
    @classmethod
    def validate_host(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not re.match(r"^[a-zA-Z0-9.:_-]+$", v):
            raise ValueError("Ungueltiges Host-Format. Nur Alphanumerisch, Punkte, Doppelpunkte, Unterstriche und Bindestriche erlaubt.")
        if len(v) > 253:
            raise ValueError("Host-Name ist zu lang (maximal 253 Zeichen).")
        return v

    @field_validator("username")
    @classmethod
    def validate_username(cls, v):
        if v is None:
            return v
        v = v.strip()
        if v == "":
            return None
        if not re.match(r"^[a-zA-Z0-9._-]+$", v):
            raise ValueError("Ungueltiger SSH-Benutzername. Nur Alphanumerisch, Punkte, Unterstriche und Bindestriche erlaubt.")
        if len(v) > 32:
            raise ValueError("SSH-Benutzername ist zu lang (maximal 32 Zeichen).")
        return v

    @field_validator("port")
    @classmethod
    def validate_port(cls, v):
        if v is not None and (v < 1 or v > 65535):
            raise ValueError("Port muss zwischen 1 und 65535 liegen.")
        return v

    @field_validator("credential_type")
    @classmethod
    def validate_cred_type(cls, v):
        if v is not None and v not in ["password", "key"]:
            raise ValueError("credential_type muss 'password' oder 'key' sein.")
        return v

class ToggleNotificationSchema(BaseModel):
    enabled: bool

# : webhook URL for status notifications (Slack/Teams/Discord etc.).
class WebhookUpdateSchema(BaseModel):
    webhook_url: str = ""

    @field_validator("webhook_url")
    @classmethod
    def _v_webhook(cls, v):
        v = (v or "").strip()
        if not v:
            return ""
        if not re.match(r"^https?://[^\s]{3,2000}$", v):
            raise ValueError("Ungueltige Webhook-URL. Erlaubt sind http(s)-URLs.")
        return v



#: AdminSettingsUpdateSchema remains in ALL editions - admin_update_settings
# (admin panel settings) is available in Community too.
class AdminSettingsUpdateSchema(BaseModel):
    rate_limit_global_ip: str
    rate_limit_user_ip: str
    ip_ban_duration: str
    max_history_count: str
    max_history_age: str
    #: In the Community-Edition the quota/limit and fingerprint-alert fields are
    # hidden and not sent along -> optional (only updated when sent),
    # otherwise 422 on missing values.
    max_active_api_tokens: Optional[str] = None
    max_guest_accounts: Optional[str] = None
    storage_quota_mb: Optional[str] = None
    max_custom_playbooks: Optional[str] = None
    # : default timeout (seconds) for playbook executions.
    default_job_timeout: str
    #: Ansible connection timeout (seconds) = sudo/become prompt wait time. Optional,
    # so that older clients/Community-Edition without the field do not trigger a 422 (default 30).
    default_connection_timeout: Optional[str] = None
    # : maintenance mode (no numeric validator -> optional + its own check).
    maintenance_mode: Optional[str] = None
    maintenance_note: Optional[str] = None
    # : enable/disable self-registration (optional; only updated when sent).
    registration_enabled: Optional[str] = None
    # : dynamic password rules (optional; only updated when sent).
    password_min_length: Optional[str] = None
    password_require_special: Optional[str] = None
    password_require_case: Optional[str] = None
    password_require_digit: Optional[str] = None
    #: enterprise/custom tariff on the pricing page (cloud-only). Title/description/
    # contact address and on/off switch (optional; only updated when sent).
    enterprise_tier_enabled: Optional[str] = None
    enterprise_tier_title: Optional[str] = None
    enterprise_tier_description: Optional[str] = None
    enterprise_contact_email: Optional[str] = None

    @field_validator("password_min_length")
    @classmethod
    def validate_password_min_length(cls, v):
        if v is None:
            return v
        s = str(v).strip()
        if not s.isdigit():
            raise ValueError("Mindestlänge muss eine nicht-negative Ganzzahl sein.")
        return s

    @field_validator(
        "rate_limit_global_ip", "rate_limit_user_ip", "ip_ban_duration",
        "max_active_api_tokens", "max_guest_accounts", "max_history_count",
        "max_history_age", "storage_quota_mb", "max_custom_playbooks",
        "default_job_timeout", "default_connection_timeout",
    )
    @classmethod
    def validate_numeric_setting(cls, v):
        #: all settings are non-negative integers. Prevents a
        # non-numeric value from being persisted and later crashing the middleware.
        #: optional fields may be missing (Community does not send them along).
        if v is None:
            return v
        s = str(v).strip()
        if not s.isdigit():
            raise ValueError("Wert muss eine nicht-negative Ganzzahl sein.")
        return s

    @field_validator("maintenance_note")
    @classmethod
    def validate_maintenance_note(cls, v):
        if v is None:
            return v
        if len(v) > 500:
            raise ValueError("Die Wartungsnotiz darf maximal 500 Zeichen lang sein.")
        return v

class AdminIPBlockCreateSchema(BaseModel):
    ip: str
    reason: str
    duration_seconds: Optional[int] = None


#: granular API-token scopes. Each scope allows certain (method, path prefix)
# combinations; "*" = any method. A token may use a path if ANY of its
# scopes provides a rule for it. The prefix match is boundary-safe (path == pref OR
# path.startswith(pref + "/")): manage_devices/manage_scenarios thus NEVER reach sensitive
# neighboring paths like /api/profile/tokens, /api/profile/guests or /api/profile/export
# (no privilege-escalation path via prefix overlap).
_TOKEN_SCOPE_RULES = {
    "run_playbook":     [("*", "/api/run")],
    "read_logs":        [("*", "/api/jobs")],
    "manage_devices":   [("*", "/api/devices"),
                         ("*", "/api/profile/devices-unified")],
    "manage_scenarios": [("*", "/api/profile/scenarios"),
                         ("*", "/api/profile/presets"),
                         ("GET", "/api/playbooks")],
}
TOKEN_SCOPES = set(_TOKEN_SCOPE_RULES.keys())


def _token_may_access(scopes, method: str, path: str) -> bool:
    method = (method or "").upper()
    for sc in (scopes or []):
        for _m, _pref in _TOKEN_SCOPE_RULES.get(sc, ()):
            if _m != "*" and _m != method:
                continue
            if path == _pref or path.startswith(_pref + "/"):
                return True
    return False


# Dependency helpers
def get_current_user(request: Request, db: DBSession = Depends(get_db)) -> Optional[User]:
    # : Community now evaluates real sessions (login for the admin + team members created by
    # the admin via Teams). Previously this function in the Community-Edition returned the local
    # system admin unconditionally and ignored cookies/tokens; that is gone,
    # so that a logged-out visitor is a real guest (None).

    # 1. Bearer Token Auth
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token_str = auth_header[7:].strip()
        if token_str:
            import hashlib
            token_hash = hashlib.sha256(token_str.encode("utf-8")).hexdigest()
            api_token = db.query(APIToken).filter(APIToken.token_hash == token_hash).first()
            if api_token:
                if api_token.expires_at is None or api_token.expires_at > datetime.utcnow():
                    user = db.query(User).filter(User.id == api_token.user_id).first()
                    #: deactivated/blocked users must not access via their token
                    if user and user.is_active:
                        request.state.api_token_scopes = [s.strip() for s in api_token.scopes.split(",") if s.strip()]
                        request.state.is_api_token = True
                        #: central API-token access gate (also applies to endpoints with
                        # get_current_user). Scope-based instead of a fixed run/jobs whitelist.
                        if not _token_may_access(request.state.api_token_scopes, request.method, request.url.path):
                            raise HTTPException(status_code=403, detail="API-Token hat keinen Zugriff auf diesen Endpunkt.")
                        return user
            # If token auth failed, return None
            return None

    # 2. Cookie session fallback
    session_id = request.cookies.get("session_id")
    request.state.api_token_scopes = []
    request.state.is_api_token = False
    if not session_id:
        return None
    return verify_session(db, session_id)

def get_authenticated_user(request: Request, current_user: Optional[User] = Depends(get_current_user)) -> User:
    if not current_user:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert. Bitte melden Sie sich an.")

    #: API token only on the endpoints allowed by its scopes (scope-based gate).
    if getattr(request.state, "is_api_token", False):
        if not _token_may_access(getattr(request.state, "api_token_scopes", []), request.method, request.url.path):
            raise HTTPException(status_code=403, detail="API-Token hat keinen Zugriff auf diesen Endpunkt.")

    return current_user

def get_admin_user(current_user: User = Depends(get_authenticated_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Zugriff verweigert. Nur Administratoren erlaubt.")
    return current_user


@app.post("/api/auth/login")
async def login_user(data: LoginSchema, request: Request, response: Response, db: DBSession = Depends(get_db)):
    ident_raw = (data.identifier or data.email or "").strip()
    if not ident_raw:
        raise HTTPException(status_code=422, detail="Benutzername oder E-Mail ist erforderlich.")
    ident_lower = ident_raw.lower()

    # Login by email (stored lowercased) OR username (exact).
    user = db.query(User).filter(
        (User.email == ident_lower) | (User.username == ident_raw)
    ).first()

    # Anchor the brute-force lock to the user's real email; if the
    # identifier is unknown, to the entered value (prevents user enumeration via lockout).
    lockout_key = user.email if user else ident_lower
    attempt = db.query(LoginAttempt).filter(LoginAttempt.email == lockout_key).first()
    now = datetime.utcnow()
    if attempt and attempt.locked_until and attempt.locked_until > now:
        remaining = int((attempt.locked_until - now).total_seconds())
        raise HTTPException(status_code=403, detail=f"Konto voruebergehend gesperrt. Bitte versuchen Sie es in {remaining // 60 + 1} Minuten erneut.")

    if not user or not verify_password(data.password, user.hashed_password):
        if not attempt:
            attempt = LoginAttempt(email=lockout_key, failed_attempts=1, last_attempt_at=now)
            db.add(attempt)
        else:
            attempt.failed_attempts += 1
            attempt.last_attempt_at = now
            if attempt.failed_attempts >= 5:
                attempt.locked_until = now + timedelta(minutes=15)
        db.commit()
        raise HTTPException(status_code=401, detail="Ungueltige Anmeldedaten.")

    if attempt:
        attempt.failed_attempts = 0
        attempt.locked_until = None
        db.commit()

    email = user.email

    # Enforce email verification if enabled (double opt-in)
    if os.environ.get("EMAIL_VERIFICATION_REQUIRED", "false").lower() == "true" and not user.email_verified:
        raise HTTPException(status_code=403, detail="Bitte bestaetigen Sie zuerst Ihre E-Mail-Adresse. Wir haben Ihnen einen Bestaetigungslink gesendet.")

    if not user.two_factor_enabled:
        ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "127.0.0.1").split(",")[0].strip()
        ua = request.headers.get("User-Agent")
        session = create_user_session(db, user.id, ip, ua)
        cookie_secure = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
        response.set_cookie(key="session_id", value=session.id, httponly=True, secure=cookie_secure, samesite="strict", max_age=14 * 86400)
        #: JS-readable companion cookie (not a token) - the frontend uses it to detect an
        # existing session and saves the superfluous /api/profile call for anonymous visitors.
        response.set_cookie(key="as_auth", value="1", httponly=False, secure=cookie_secure, samesite="strict", max_age=14 * 86400)
        return {"status": "logged_in", "username": user.username, "role": user.role, "tier": user.tier, "email": email}



@app.post("/api/auth/logout")
def logout(request: Request, response: Response, db: DBSession = Depends(get_db)):
    session_id = request.cookies.get("session_id")
    if session_id:
        delete_session(db, session_id)
    response.delete_cookie("session_id")
    response.delete_cookie("as_auth")  #
    return {"message": "Abgemeldet."}

@app.post("/api/auth/logout-all")
def logout_all(response: Response, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    db.query(Session).filter(Session.user_id == user.id).delete()
    db.commit()
    response.delete_cookie("session_id")
    response.delete_cookie("as_auth")  #
    return {"message": "Erfolgreich von allen Geraeten abgemeldet."}

@app.get("/api/profile/sessions")
def list_sessions(request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    current_sid = request.cookies.get("session_id")
    sessions = db.query(Session).filter(Session.user_id == user.id).order_by(Session.created_at.desc()).all()
    return [{
        "id": s.id,
        "ip_address": s.ip_address,
        "user_agent": s.user_agent,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "expires_at": s.expires_at.isoformat() if s.expires_at else None,
        "current": s.id == current_sid
    } for s in sessions]

@app.delete("/api/profile/sessions/{session_id}")
def revoke_session(session_id: str, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    session = db.query(Session).filter(Session.id == session_id, Session.user_id == user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sitzung nicht gefunden.")
    db.delete(session)
    db.commit()
    return {"message": "Sitzung erfolgreich beendet."}

#: remains in ALL editions - reset-password-request (Community) calls it; no-op if
# CAPTCHA_REQUIRED is not set.
def verify_captcha_if_required(db: DBSession, captcha_id: Optional[str], captcha_answer: Optional[str]):
    """Checks the captcha if CAPTCHA_REQUIRED=true is set; otherwise no-op."""
    captcha_required = os.environ.get("CAPTCHA_REQUIRED", "false").lower() == "true"
    if not captcha_required:
        return
    if not captcha_id or not captcha_answer:
        raise HTTPException(status_code=400, detail="Bitte loesen Sie die Captcha-Aufgabe.")
    now = datetime.utcnow()
    entry = db.query(Captcha).filter(Captcha.id == captcha_id, Captcha.expires_at > now).first()
    if not entry or entry.answer != captcha_answer.strip():
        raise HTTPException(status_code=400, detail="Falsche oder abgelaufene Captcha-Antwort.")
    db.delete(entry)
    db.commit()


@app.post("/api/auth/reset-password-request")
async def reset_password_request(data: PasswordResetRequestSchema, request: Request, db: DBSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(reset_request_limits, client_ip, max_requests=5, period_seconds=600):
        raise HTTPException(status_code=429, detail="Zu viele Anfragen. Bitte versuchen Sie es spaeter erneut.")
    ident_raw = (data.identifier or data.email or "").strip()
    if not ident_raw:
        raise HTTPException(status_code=422, detail="Benutzername oder E-Mail ist erforderlich.")

    # Check the captcha if enabled server-side
    verify_captcha_if_required(db, data.captcha_id, data.captcha_answer)

    ident_lower = ident_raw.lower()
    is_email_input = "@" in ident_raw
    user = db.query(User).filter(
        (User.email == ident_lower) | (User.username == ident_raw)
    ).first()

    # When requesting via the username, point to the linked email.
    if is_email_input:
        generic_message = "Wenn die E-Mail registriert ist, wurde ein Link gesendet."
    else:
        generic_message = "Eine E-Mail mit Link zur Passwortwiederherstellung wurde an die verknuepfte E-Mail Adresse geschickt."

    if not user:
        return {"message": generic_message}

    email = user.email
    token = str(uuid.uuid4())
    expiry = datetime.utcnow() + timedelta(hours=1)

    db.query(OTP).filter(OTP.email == email, OTP.otp_code.like("reset-%")).delete()
    otp_entry = OTP(email=email, otp_code=f"reset-{token}", expires_at=expiry)
    db.add(otp_entry)
    db.commit()

    # Send email
    from email_helper import send_email
    base_url = os.environ.get("APP_BASE_URL", "http://localhost").rstrip("/")
    reset_link = f"{base_url}/reset-password?token={token}"
    email_sent = await send_email(
        to_email=email,
        subject="Ansimate - Passwort zuruecksetzen",
        html_content=f"<p>Hallo {user.username},</p><p>Klicken Sie auf den folgenden Link, um Ihr Passwort zurueckzusetzen:</p><p><a href='{reset_link}'>{reset_link}</a></p><p>Der Link ist 1 Stunde gueltig.</p>",
        text_content=f"Hallo {user.username}, setzen Sie Ihr Passwort hier zurueck: {reset_link}. Der Link ist 1 Stunde gueltig."
    )

    if not email_sent:
        print(f"Password reset token for {email}: {token} (SMTP failed to send)")

    return {"message": generic_message}

@app.post("/api/auth/reset-password")
def reset_password(data: PasswordResetSchema, db: DBSession = Depends(get_db)):
    token = data.token.strip()
    now = datetime.utcnow()

    otp_entry = db.query(OTP).filter(
        OTP.otp_code == f"reset-{token}",
        OTP.expires_at > now,
        OTP.is_verified == False
    ).first()

    if not otp_entry:
        raise HTTPException(status_code=400, detail="Ungueltiger oder abgelaufener Reset-Token.")

    user = db.query(User).filter(User.email == otp_entry.email).first()
    if not user:
        raise HTTPException(status_code=400, detail="Benutzer nicht gefunden.")

    validate_password_policy(db, data.new_password)  # 
    user.hashed_password = get_password_hash(data.new_password)
    otp_entry.is_verified = True
    #: invalidate all existing sessions (reset = fend off potential account takeover)
    db.query(Session).filter(Session.user_id == user.id).delete()
    db.commit()

    return {"message": "Passwort erfolgreich zurueckgesetzt."}


@app.get("/api/profile")
def get_profile(user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "tier": user.tier,
        "created_at": user.created_at.isoformat(),
        "deletion_pending_at": user.deletion_pending_at.isoformat() if user.deletion_pending_at else None,
        "email_notifications_enabled": user.email_notifications_enabled,
        "webhook_url": user.webhook_url or "",
        # : server-side language preference (de|en|null=automatic). Core field, Community too.
        "language": user.language,
        "two_factor_enabled": user.two_factor_enabled,
        "associated_user_id": user.associated_user_id,
    }

@app.post("/api/profile/update")
def update_profile(data: ProfileUpdateSchema, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    # Only check the password if (optionally) sent along; session auth is sufficient.
    if data.current_password and not verify_password(data.current_password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Aktuelles Passwort ist ungueltig.")

    username = data.username.strip()
    email = data.email.strip().lower()

    if not re.match(r"^[a-zA-Z0-9._-]+$", username) or len(username) < 3 or len(username) > 30:
        raise HTTPException(status_code=400, detail="Ungueltiger Benutzername.")
    if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", email) or len(email) > 254:
        raise HTTPException(status_code=400, detail="Ungueltige E-Mail-Adresse.")

    # Guest accounts may not change username/email (only 2FA toggle/password).
    if user.role == "guest" and (username != user.username or email != user.email):
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen Benutzername und E-Mail nicht aendern.")

    # : the username is immutable after registration. Exception:
    # system admins may change their own name; other people's names are corrected
    # exclusively via the admin panel (its own endpoint).
    if username != user.username and user.role != "admin":
        raise HTTPException(status_code=403, detail="Der Benutzername kann nach der Registrierung nicht mehr geaendert werden.")

    exists = db.query(User).filter(
        ((User.username == username) | (User.email == email)) & (User.id != user.id)
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="Benutzername oder E-Mail bereits vergeben.")

    user.username = username
    user.email = email
    # : optionally carry the language along (empty/None -> automatic).
    if data.language is not None:
        lang = (data.language or "").strip().lower() or None
        if lang not in (None, "de", "en"):
            raise HTTPException(status_code=400, detail="Ungueltige Sprache (erlaubt: de, en oder leer/automatisch).")
        user.language = lang
    db.commit()

    return {"message": "Profil erfolgreich aktualisiert."}

@app.post("/api/profile/language")
def update_profile_language(data: ProfileLanguageSchema, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    # : lightweight, session/token-capable language setter for the header
    # switcher and the profile select. Guest accounts may set their own language.
    lang = (data.language or "").strip().lower() or None
    if lang not in (None, "de", "en"):
        raise HTTPException(status_code=400, detail="Ungueltige Sprache (erlaubt: de, en oder leer/automatisch).")
    user.language = lang
    db.commit()
    return {"language": user.language}

@app.post("/api/profile/change-password")
def change_password(data: ChangePasswordSchema, request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if not verify_password(data.current_password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Aktuelles Passwort ist ungueltig.")
    validate_password_policy(db, data.new_password)  # 
    user.hashed_password = get_password_hash(data.new_password)
    #: invalidate other sessions, keep the current session
    current_sid = request.cookies.get("session_id")
    q = db.query(Session).filter(Session.user_id == user.id)
    if current_sid:
        q = q.filter(Session.id != current_sid)
    q.delete(synchronize_session=False)
    db.commit()
    return {"message": "Passwort erfolgreich geaendert."}


@app.post("/api/profile/notifications")
def toggle_notifications(data: ToggleNotificationSchema, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    user.email_notifications_enabled = data.enabled
    db.commit()
    return {"message": "E-Mail-Benachrichtigungen erfolgreich aktualisiert.", "enabled": user.email_notifications_enabled}

@app.post("/api/profile/webhook")
def update_webhook(data: WebhookUpdateSchema, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    # : set/delete webhook URL. Empty = disabled.
    user.webhook_url = data.webhook_url or None
    db.commit()
    return {"message": "Webhook erfolgreich gespeichert." if user.webhook_url else "Webhook entfernt.",
            "webhook_url": user.webhook_url or ""}


def _clean_playbook_list(v):
    if not isinstance(v, list) or len(v) > 500:
        raise ValueError("Ungueltige Playbook-Liste.")
    cleaned = []
    for p in v:
        if isinstance(p, str) and 0 < len(p) <= 256:
            cleaned.append(p)
    return cleaned


def _clean_playbook_ids(raw):
    """: cleans the playbook ID list of a scenario template. IDs are
    paths relative to /playbooks (index.yml "file" or "custom/<owner>/<file>"). Only
    format/security is checked (no path traversal, sensible characters, lengths) -
    the actual existence/access check is done by the run endpoint."""
    if not raw:
        return []
    if len(raw) > 100:
        raise HTTPException(status_code=400, detail="Zu viele Playbooks in der Vorlage (max. 100).")
    out = []
    seen = set()
    for item in raw:
        pb = (item or "").strip()
        if not pb or pb in seen:
            continue
        if len(pb) > 200 or ".." in pb or pb.startswith("/") or pb.startswith("\\"):
            raise HTTPException(status_code=400, detail=f"Ungueltige Playbook-Kennung: {pb}")
        if not re.match(r"^[a-zA-Z0-9._/-]+$", pb):
            raise HTTPException(status_code=400, detail=f"Ungueltige Playbook-Kennung: {pb}")
        seen.add(pb)
        out.append(pb)
    return out

def _serialize_device(d: Device):
    """ (Device-Flatten): unified device representation for /api/devices and
    /api/profile/devices-unified. Plaintext credentials/become passwords are NEVER
    returned (only has_* flags). The managed/managed_device fields are kept for the
    existing vault UI (every device is now a managed single device)."""
    return {
        "id": d.id,
        "name": d.name,
        "host": d.host,
        "username": d.username,
        "port": d.port,
        "has_credential": d.encrypted_credential is not None,
        "credential_type": d.credential_type,
        #: is a sudo/become password stored? (plaintext is NEVER returned)
        "has_become_credential": d.encrypted_become_credential is not None,
        "base_directory": d.base_directory,
        "timezone": d.timezone,
        "guest_access": _safe_json_list(d.guest_access),
        # Compat with the existing vault UI (editManagedDevice reads managed_device.*).
        "managed": True,
        "managed_device": {
            "id": d.id, "host": d.host, "username": d.username,
            "has_credential": d.encrypted_credential is not None,
            "credential_type": d.credential_type,
            "has_become_credential": d.encrypted_become_credential is not None,
        },
    }

def _safe_json_obj(value):
    try:
        d = json.loads(value or "{}")
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}

def _safe_json_list(value):
    try:
        d = json.loads(value or "[]")
        return d if isinstance(d, list) else []
    except Exception:
        return []

def _clean_device_defaults(data):
    """ (Device-Flatten): validates a device's run-context fields (SSH user,
    credential type, base_dir, timezone). Duck typing: reads the same field names as
    UnifiedDeviceSchema. Returns a dict without a credential."""
    def _norm(v):
        return v.strip() if isinstance(v, str) else None
    user = _norm(data.default_ssh_user) or None
    if user and (not re.match(r"^[a-zA-Z0-9._-]+$", user) or len(user) > 32):
        raise HTTPException(status_code=400, detail="Ungueltiger SSH-Benutzer.")
    ctype = _norm(data.default_credential_type) or None
    if ctype and ctype not in ("password", "key"):
        raise HTTPException(status_code=400, detail="default_credential_type muss 'password' oder 'key' sein.")
    base_dir = _norm(data.default_base_directory) or None
    if base_dir and (len(base_dir) > 255 or any(ord(c) < 32 for c in base_dir)):
        raise HTTPException(status_code=400, detail="Ungueltiges Basis-Verzeichnis.")
    tz = _norm(data.default_timezone) or None
    if tz and (not re.match(r"^[A-Za-z0-9/_+-]+$", tz) or len(tz) > 64):
        raise HTTPException(status_code=400, detail="Ungueltige Zeitzone.")
    return {"user": user, "ctype": ctype, "base_dir": base_dir, "tz": tz}

# ---- (Device-Flatten): managed single devices ----
# A "device" = exactly ONE Device (one host). Connection data (host/user/credential/become),
# run context (base_dir/timezone) and the guest share (guest_access) live directly on the Device.
# The former single/multi DeviceGroup wrappers are gone; multi-host runs via the
# device_ids selection on Scenario/Preset (see /api/run).
MANAGED_DEVICE_SENTINEL = "__managed_device__"  # only for the one-time flatten migration

class UnifiedDeviceSchema(BaseModel):
    name: str
    host: str
    default_ssh_user: Optional[str] = None
    default_credential: Optional[str] = None        # plaintext; "" deletes, None leaves unchanged
    default_credential_type: Optional[str] = None   # "password" | "key"
    #: optional sudo/become password of the managed device (stored on the single device).
    # Contract like default_credential: plaintext; "" deletes, None leaves unchanged. If missing,
    # the SSH password continues to serve as the sudo password during the run (fallback in run_playbook_background).
    default_become_password: Optional[str] = None
    default_base_directory: Optional[str] = None
    default_timezone: Optional[str] = None
    default_variables: Optional[Dict[str, str]] = None

    @field_validator("name")
    @classmethod
    def _v_name(cls, v):
        v = (v or "").strip()
        if not re.match(r"^[a-zA-Z0-9 _-]+$", v):
            raise ValueError("Ungueltiger Geraete-Name. Nur Alphanumerisch, Leerzeichen, Unterstriche und Bindestriche erlaubt.")
        if len(v) < 3 or len(v) > 50:
            raise ValueError("Geraete-Name muss zwischen 3 und 50 Zeichen lang sein.")
        return v

    @field_validator("host")
    @classmethod
    def _v_host(cls, v):
        v = (v or "").strip()
        if not re.match(r"^[a-zA-Z0-9.:_-]+$", v):
            raise ValueError("Ungueltiges Host-Format. Nur Alphanumerisch, Punkte, Doppelpunkte, Unterstriche und Bindestriche erlaubt.")
        if len(v) > 253:
            raise ValueError("Host-Name ist zu lang (maximal 253 Zeichen).")
        return v

    @field_validator("default_ssh_user")
    @classmethod
    def _v_user(cls, v):
        if v is None:
            return v
        v = v.strip()
        if v == "":
            return None
        if not re.match(r"^[a-zA-Z0-9._-]+$", v) or len(v) > 32:
            raise ValueError("Ungueltiger SSH-Benutzername. Nur Alphanumerisch, Punkte, Unterstriche und Bindestriche erlaubt.")
        return v

    @field_validator("default_credential_type")
    @classmethod
    def _v_ctype(cls, v):
        if v is not None and v not in ("password", "key"):
            raise ValueError("default_credential_type muss 'password' oder 'key' sein.")
        return v

class ManagedDeviceShareSchema(BaseModel):
    guest_access: List[str] = []

def _load_device(device_id: str, user: User, db: DBSession):
    """: loads a device of the owner. 404 if it is missing or does not belong to them."""
    dev = db.query(Device).filter(Device.id == device_id, Device.user_id == user.id).first()
    if not dev:
        raise HTTPException(status_code=404, detail="Gerät nicht gefunden.")
    return dev

@app.get("/api/profile/devices-unified")
def list_managed_devices(user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    #: the owner sees all their own devices; a guest only those shared with them.
    if user.role == "guest":
        owner_id = user.associated_user_id
        if not owner_id:
            return []
        devs = db.query(Device).filter(Device.user_id == owner_id).order_by(Device.created_at.desc()).all()
        return [_serialize_device(d) for d in devs if user.id in _safe_json_list(d.guest_access)]
    devs = db.query(Device).filter(Device.user_id == user.id).order_by(Device.created_at.desc()).all()
    return [_serialize_device(d) for d in devs]

@app.post("/api/profile/devices-unified")
def create_managed_device(data: UnifiedDeviceSchema, request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen keine Geraete erstellen.")
    if not user.is_subscription_active(db):
        raise HTTPException(status_code=403, detail="Abonnement inaktiv. Bitte reaktivieren Sie Ihr Abonnement, um Geraete zu verwalten.")
    # : device limit (counts real Device records, including managed ones).
    device_limit = effective_max_devices(user, db)
    if device_limit is not None:
        current = db.query(Device).filter(Device.user_id == user.id).count()
        if current >= device_limit:
            raise HTTPException(status_code=403, detail=f"Geraete-Limit Ihres Tarifs erreicht ({device_limit}).")
    defaults = _clean_device_defaults(data)
    encrypted = None
    ctype = None
    if data.default_credential:
        encrypted = encrypt_credential(data.default_credential)
        ctype = defaults["ctype"] or "password"
    #: store the optional sudo/become password on the device (the run path already reads it).
    encrypted_become = encrypt_credential(data.default_become_password) if (data.default_become_password or "").strip() else None
    dev = Device(
        user_id=user.id, name=data.name.strip(), host=data.host.strip(),
        username=defaults["user"], port=22,
        encrypted_credential=encrypted, credential_type=ctype,
        encrypted_become_credential=encrypted_become,
        base_directory=defaults["base_dir"], timezone=defaults["tz"],
        guest_access=json.dumps([]),
    )
    db.add(dev)
    db.commit()
    db.refresh(dev)
    write_team_audit(db, user, "managed_device.create", dev.name,
                     {"device_id": dev.id}, _client_ip(request))
    return _serialize_device(dev)

@app.put("/api/profile/devices-unified/{device_id}")
def update_managed_device(device_id: str, data: UnifiedDeviceSchema, request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen keine Geraete bearbeiten.")
    if not user.is_subscription_active(db):
        raise HTTPException(status_code=403, detail="Abonnement inaktiv. Bitte reaktivieren Sie Ihr Abonnement, um Geraete zu verwalten.")
    dev = _load_device(device_id, user, db)
    defaults = _clean_device_defaults(data)
    # Credential contract: None=keep, ""=delete, otherwise re-encrypt.
    dev.name = data.name.strip()
    dev.host = data.host.strip()
    dev.username = defaults["user"]
    dev.base_directory = defaults["base_dir"]
    dev.timezone = defaults["tz"]
    if data.default_credential is not None:
        if data.default_credential == "":
            dev.encrypted_credential = None
            dev.credential_type = None
        else:
            dev.encrypted_credential = encrypt_credential(data.default_credential)
            dev.credential_type = defaults["ctype"] or dev.credential_type or "password"
    #: sudo/become password (same contract: None=keep, ""=delete, otherwise set anew).
    if data.default_become_password is not None:
        if data.default_become_password == "":
            dev.encrypted_become_credential = None
        else:
            dev.encrypted_become_credential = encrypt_credential(data.default_become_password)
    db.commit()
    db.refresh(dev)
    write_team_audit(db, user, "managed_device.update", dev.name,
                     {"device_id": dev.id}, _client_ip(request))
    return _serialize_device(dev)

@app.delete("/api/profile/devices-unified/{device_id}")
def delete_managed_device(device_id: str, request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen keine Geraete loeschen.")
    dev = _load_device(device_id, user, db)
    name = dev.name
    db.delete(dev)
    db.commit()
    write_team_audit(db, user, "managed_device.delete", name, {"device_id": device_id}, _client_ip(request))
    return {"message": "Gerät gelöscht."}

@app.post("/api/profile/devices-unified/{device_id}/share")
def share_managed_device(device_id: str, data: ManagedDeviceShareSchema, request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen Geraete nicht freigeben.")
    dev = _load_device(device_id, user, db)
    valid_guests = {gg.id for gg in db.query(User).filter(User.associated_user_id == user.id).all()}
    guest_ids = [x for x in data.guest_access if x in valid_guests]
    dev.guest_access = json.dumps(guest_ids)
    db.commit()
    db.refresh(dev)
    write_team_audit(db, user, "managed_device.share", dev.name,
                     {"device_id": dev.id, "guests": len(guest_ids)}, _client_ip(request))
    return _serialize_device(dev)

# ---- : custom presets ----
class CustomPresetShare(BaseModel):
    guest_id: str
    permission: str = "strict"  # "strict" | "flexible"

class CustomPresetSchema(BaseModel):
    name: str
    playbook_ids: List[str] = []
    variables: Optional[Dict[str, str]] = None
    # (Device-Flatten): target devices as a list (multi-host via checkbox). Empty = deviceless.
    device_ids: List[str] = []
    shares: Optional[List[CustomPresetShare]] = None


# : Scenario = preset (recipe) + target devices for 1-click deployment.
# : shareable like presets (shares: strict/flexible per guest).
class ScenarioSchema(BaseModel):
    name: str
    preset_id: str
    # (Device-Flatten): optional target devices (multi-host via checkbox). Empty -> deviceless
    # scenario (the device is entered once at run time).
    device_ids: List[str] = []
    shares: Optional[List[CustomPresetShare]] = None

def _clean_preset_variables(raw):
    """Validates preset default variables (keys like variable names, short values)."""
    out = {}
    if not raw:
        return out
    if len(raw) > 100:
        raise HTTPException(status_code=400, detail="Zu viele Variablen (max. 100).")
    for k, v in raw.items():
        key = (k or "").strip()
        val = (v if isinstance(v, str) else str(v)).strip()
        if not key:
            continue
        if not re.match(r"^[a-zA-Z0-9_]+$", key) or len(key) > 64:
            raise HTTPException(status_code=400, detail=f"Ungueltiger Variablenname: {key}")
        if len(val) > 512 or any(ord(c) < 32 for c in val):
            raise HTTPException(status_code=400, detail=f"Ungueltiger Wert fuer {key}.")
        out[key] = val
    return out

def _clean_preset_shares(raw, owner_id, db):
    if not raw:
        return []
    valid_guests = {g.id for g in db.query(User).filter(User.associated_user_id == owner_id, User.role == "guest").all()}
    out, seen = [], set()
    for sh in raw:
        gid = (sh.guest_id or "").strip()
        perm = (sh.permission or "strict").strip()
        if gid not in valid_guests or gid in seen:
            continue
        if perm not in ("strict", "flexible"):
            perm = "strict"
        seen.add(gid)
        out.append({"guest_id": gid, "permission": perm})
    return out

def _clean_device_ids(raw, owner_id: str, db: DBSession):
    """ (Device-Flatten): filters a device selection down to the owner's existing devices
    (order preserved, deduplicated). Empty/unknown IDs are discarded."""
    if not raw:
        return []
    valid = {d.id for d in db.query(Device).filter(Device.user_id == owner_id).all()}
    out, seen = [], set()
    for i in raw:
        did = (i or "").strip() if isinstance(i, str) else None
        if did and did in valid and did not in seen:
            seen.add(did)
            out.append(did)
    return out

def _clean_preset_input(data: CustomPresetSchema, owner_id: str, db: DBSession):
    name = (data.name or "").strip()
    if not name or len(name) > 80:
        raise HTTPException(status_code=400, detail="Name ist erforderlich (max. 80 Zeichen).")
    # : allow Unicode letters (e.g. umlauts) – otherwise German names like
    # "Geräteloses" fail. \w is unicode-aware; punctuation stays limited to a safe whitelist.
    # Consistent with scenario names, whose name is reused as the preset name.
    if not re.match(r"^[\w ._/&+-]+$", name):
        raise HTTPException(status_code=400, detail="Ungueltiger Preset-Name.")
    playbook_ids = _clean_playbook_ids(data.playbook_ids)
    if not playbook_ids:
        raise HTTPException(status_code=400, detail="Mindestens ein Playbook ist erforderlich.")
    variables = _clean_preset_variables(data.variables)
    dev_ids = _clean_device_ids(data.device_ids, owner_id, db)
    shares = _clean_preset_shares(data.shares, owner_id, db)
    return name, playbook_ids, variables, dev_ids, shares

def _serialize_preset(p: CustomPreset, viewer=None):
    shares = _safe_json_list(p.shares)
    is_owner = bool(viewer and viewer.id == p.user_id)
    data = {
        "id": p.id, "name": p.name, "owner_id": p.user_id, "is_owner": is_owner,
        "playbook_ids": _safe_json_list(p.playbook_ids),
        "variables": _safe_json_obj(p.variables),
        "device_ids": _safe_json_list(p.device_ids),
    }
    if is_owner:
        data["shares"] = shares
        data["permission"] = "flexible"  # the owner may always modify
    else:
        mine = next((s for s in shares if s.get("guest_id") == (viewer.id if viewer else None)), None)
        data["permission"] = (mine or {}).get("permission")
    return data

def _preset_for_viewer(p: CustomPreset, viewer) -> bool:
    """May `viewer` see/run this preset? Owner or shared guest."""
    if viewer is None:
        return False
    if viewer.id == p.user_id:
        return True
    shared_ids = {s.get("guest_id") for s in _safe_json_list(p.shares)}
    return viewer.id in shared_ids

@app.get("/api/profile/presets")
def list_custom_presets(user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        owner_id = user.associated_user_id
        if not owner_id:
            return []
        presets = db.query(CustomPreset).filter(CustomPreset.user_id == owner_id).all()
        return [_serialize_preset(p, user) for p in presets if _preset_for_viewer(p, user)]
    presets = db.query(CustomPreset).filter(CustomPreset.user_id == user.id).order_by(CustomPreset.created_at.desc()).all()
    return [_serialize_preset(p, user) for p in presets]

@app.post("/api/profile/presets")
def create_custom_preset(data: CustomPresetSchema, request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen keine Presets erstellen.")
    #  (#E): preset creation is a premium feature. Admins excepted (no subscription reference);
    # site-wide admin presets ("everyone sees them") are deferred to a follow-up milestone.
    if user.role != "admin" and not user.is_subscription_active(db):
        raise HTTPException(status_code=403, detail="Das Erstellen von Presets erfordert eine aktive Premium-Laufzeit.")
    name, pb_ids, variables, dev_ids, shares = _clean_preset_input(data, user.id, db)
    p = CustomPreset(
        user_id=user.id, name=name,
        playbook_ids=json.dumps(pb_ids), variables=json.dumps(variables),
        device_ids=json.dumps(dev_ids), shares=json.dumps(shares),
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    write_team_audit(db, user, "preset.create", p.name, {"preset_id": p.id, "playbooks": len(pb_ids), "shared": len(shares)}, _client_ip(request))
    return _serialize_preset(p, user)

@app.post("/api/profile/presets/{preset_id}")
def update_custom_preset(preset_id: str, data: CustomPresetSchema, request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen keine Presets bearbeiten.")
    #  (#E): editing is premium-gated like creation (admins excepted).
    if user.role != "admin" and not user.is_subscription_active(db):
        raise HTTPException(status_code=403, detail="Das Bearbeiten von Presets erfordert eine aktive Premium-Laufzeit.")
    p = db.query(CustomPreset).filter(CustomPreset.id == preset_id, CustomPreset.user_id == user.id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Preset nicht gefunden.")
    name, pb_ids, variables, dev_ids, shares = _clean_preset_input(data, user.id, db)
    p.name = name
    p.playbook_ids = json.dumps(pb_ids)
    p.variables = json.dumps(variables)
    p.device_ids = json.dumps(dev_ids)
    p.shares = json.dumps(shares)
    db.commit()
    write_team_audit(db, user, "preset.update", p.name, {"preset_id": p.id, "playbooks": len(pb_ids), "shared": len(shares)}, _client_ip(request))
    return _serialize_preset(p, user)

@app.delete("/api/profile/presets/{preset_id}")
def delete_custom_preset(preset_id: str, request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen keine Presets loeschen.")
    p = db.query(CustomPreset).filter(CustomPreset.id == preset_id, CustomPreset.user_id == user.id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Preset nicht gefunden.")
    name = p.name
    db.delete(p)
    db.commit()
    write_team_audit(db, user, "preset.delete", name, {"preset_id": preset_id}, _client_ip(request))
    return {"message": "Preset geloescht."}

# ---------------------------------------------------------------------------
# : Scenarios = preset (recipe) + target devices, 1-click deployment.
# (Device-Flatten): target devices as a device_ids list (multi-host via checkbox).
# Executed via the existing /api/run path (custom_preset_id + device_ids).
# ---------------------------------------------------------------------------
def _clean_scenario_name(name: str) -> str:
    name = (name or "").strip()
    if not (1 <= len(name) <= 80):
        raise HTTPException(status_code=400, detail="Szenario-Name muss 1–80 Zeichen lang sein.")
    return name


def _serialize_scenario(s: Scenario, preset_map: dict, device_map: dict, viewer: User = None) -> dict:
    preset = preset_map.get(s.preset_id)
    dev_ids = _safe_json_list(s.device_ids)
    devices = [device_map[i] for i in dev_ids if i in device_map]
    is_owner = bool(viewer and viewer.id == s.user_id)
    #: deviceless = no target devices were deliberately stored. Set but no longer
    # findable devices mean "deleted" -> invalid.
    device_optional = not dev_ids
    all_devices_exist = len(devices) == len(dev_ids)
    out = {
        "id": s.id,
        "name": s.name,
        "owner_id": s.user_id,
        "is_owner": is_owner,
        "preset_id": s.preset_id,
        "device_ids": dev_ids,
        "preset_name": preset.name if preset is not None else None,
        # single device -> device name; multiple selection -> count; deviceless -> None.
        "device_name": (devices[0].name if len(devices) == 1 else (f"{len(dev_ids)} Geräte" if dev_ids else None)),
        #: marks a deliberately deviceless scenario (enter the device at run time).
        "device_optional": device_optional,
        # : metadata counters for the list overview. Not sensitive -> always delivered.
        "playbook_count": len(_safe_json_list(preset.playbook_ids)) if preset is not None else 0,
        "device_count": len(dev_ids),
        # valid=False -> the preset (or a fixed device) has since been deleted.
        # Deviceless scenarios are valid without a device.
        "valid": bool(preset is not None and (device_optional or all_devices_exist)),
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
    shares = _safe_json_list(s.shares)
    if is_owner:
        out["shares"] = shares           # only show the share list to the owner
        out["shared_count"] = len(shares)  # : number of user shares (owner only)
        out["permission"] = "flexible"
    else:
        mine = next((sh for sh in shares if sh.get("guest_id") == (viewer.id if viewer else None)), None)
        out["permission"] = mine.get("permission") if mine else None
    return out


def _scenario_for_viewer(s: Scenario, viewer: User) -> bool:
    if viewer and viewer.id == s.user_id:
        return True
    return any(sh.get("guest_id") == (viewer.id if viewer else None) for sh in _safe_json_list(s.shares))


def _scenario_gate(user: User, db: DBSession):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen keine Szenarien verwalten.")
    # Like preset creation: premium feature, admins excepted.
    if user.role != "admin" and not user.is_subscription_active(db):
        raise HTTPException(status_code=403, detail="Szenarien erfordern eine aktive Premium-Laufzeit.")


def _resolve_scenario_refs(data: ScenarioSchema, user: User, db: DBSession):
    preset = db.query(CustomPreset).filter(CustomPreset.id == data.preset_id, CustomPreset.user_id == user.id).first()
    if not preset:
        raise HTTPException(status_code=400, detail="Preset nicht gefunden.")
    #: target devices are optional (deviceless scenario). Set IDs are filtered down to the
    # owner's existing devices.
    dev_ids = _clean_device_ids(data.device_ids, user.id, db)
    return preset, dev_ids


@app.get("/api/profile/scenarios")
def list_scenarios(user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        # Guest: the owner's shared scenarios (analogous to list_custom_presets).
        owner_id = user.associated_user_id
        if not owner_id:
            return []
        scenarios = db.query(Scenario).filter(Scenario.user_id == owner_id).order_by(Scenario.created_at.desc()).all()
        preset_map = {p.id: p for p in db.query(CustomPreset).filter(CustomPreset.user_id == owner_id).all()}
        device_map = {d.id: d for d in db.query(Device).filter(Device.user_id == owner_id).all()}
        return [_serialize_scenario(s, preset_map, device_map, user) for s in scenarios if _scenario_for_viewer(s, user)]
    scenarios = db.query(Scenario).filter(Scenario.user_id == user.id).order_by(Scenario.created_at.desc()).all()
    preset_map = {p.id: p for p in db.query(CustomPreset).filter(CustomPreset.user_id == user.id).all()}
    device_map = {d.id: d for d in db.query(Device).filter(Device.user_id == user.id).all()}
    return [_serialize_scenario(s, preset_map, device_map, user) for s in scenarios]


@app.post("/api/profile/scenarios")
def create_scenario(data: ScenarioSchema, request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    _scenario_gate(user, db)
    name = _clean_scenario_name(data.name)
    preset, dev_ids = _resolve_scenario_refs(data, user, db)
    shares = _clean_preset_shares(data.shares, user.id, db)
    s = Scenario(user_id=user.id, name=name, preset_id=preset.id,
                 device_ids=json.dumps(dev_ids), shares=json.dumps(shares))
    db.add(s)
    db.commit()
    db.refresh(s)
    write_team_audit(db, user, "scenario.create", name, {"scenario_id": s.id}, _client_ip(request))
    device_map = {d.id: d for d in db.query(Device).filter(Device.id.in_(dev_ids), Device.user_id == user.id).all()} if dev_ids else {}
    return _serialize_scenario(s, {preset.id: preset}, device_map, user)


@app.post("/api/profile/scenarios/{scenario_id}")
def update_scenario(scenario_id: str, data: ScenarioSchema, request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    _scenario_gate(user, db)
    s = db.query(Scenario).filter(Scenario.id == scenario_id, Scenario.user_id == user.id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Szenario nicht gefunden.")
    name = _clean_scenario_name(data.name)
    preset, dev_ids = _resolve_scenario_refs(data, user, db)
    s.name = name
    s.preset_id = preset.id
    s.device_ids = json.dumps(dev_ids)  #: optional multi-host selection (empty = deviceless)
    # : only change shares if explicitly sent along (None = unchanged). This way the
    # edit dialog (name/preset/device) can leave the shares untouched; sharing runs via its
    # own share dialog.
    if data.shares is not None:
        s.shares = json.dumps(_clean_preset_shares(data.shares, user.id, db))
    db.commit()
    db.refresh(s)
    write_team_audit(db, user, "scenario.update", name, {"scenario_id": s.id}, _client_ip(request))
    device_map = {d.id: d for d in db.query(Device).filter(Device.id.in_(dev_ids), Device.user_id == user.id).all()} if dev_ids else {}
    return _serialize_scenario(s, {preset.id: preset}, device_map, user)


@app.delete("/api/profile/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str, request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen keine Szenarien loeschen.")
    s = db.query(Scenario).filter(Scenario.id == scenario_id, Scenario.user_id == user.id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Szenario nicht gefunden.")
    name = s.name
    db.delete(s)
    db.commit()
    write_team_audit(db, user, "scenario.delete", name, {"scenario_id": scenario_id}, _client_ip(request))
    return {"message": "Szenario geloescht."}

# Automation (API Tokens) Endpoints
@app.get("/api/profile/tokens")
def list_tokens(user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts haben keinen Zugriff auf diese Funktion.")
    tokens = db.query(APIToken).filter(APIToken.user_id == user.id).order_by(APIToken.created_at.desc()).all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "scopes": [s.strip() for s in t.scopes.split(",") if s.strip()],
            "created_at": t.created_at.isoformat(),
            "expires_at": t.expires_at.isoformat() if t.expires_at else None
        }
        for t in tokens
    ]

@app.post("/api/profile/tokens")
def create_token(
    request: Request,
    data: TokenCreateSchema,
    user: User = Depends(get_authenticated_user),
    db: DBSession = Depends(get_db)
):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen keine API-Tokens erstellen.")

    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(token_generation_limits, (client_ip, user.id), max_requests=5):
        raise HTTPException(status_code=429, detail="Zu viele Anfragen. Sie koennen maximal 5 API-Tokens pro Minute erstellen.")

    #: enforce the total limit of active (non-expired) tokens
    now = datetime.utcnow()
    max_tokens = _global_int_setting(db, "max_active_api_tokens", 5)
    active_tokens = db.query(APIToken).filter(
        APIToken.user_id == user.id,
        ((APIToken.expires_at == None) | (APIToken.expires_at > now))
    ).count()
    #: In the Community-Edition no token limit applies (field hidden).
    if EDITION != "community" and active_tokens >= max_tokens:
        raise HTTPException(status_code=403, detail=f"Maximale Anzahl aktiver API-Tokens erreicht ({max_tokens}).")

    import secrets
    import hashlib

    plain_token = "asm_tok_" + secrets.token_hex(32)
    token_hash = hashlib.sha256(plain_token.encode("utf-8")).hexdigest()

    expires_at = None
    if data.expires_in_days is not None:
        expires_at = datetime.utcnow() + timedelta(days=data.expires_in_days)

    api_token = APIToken(
        user_id=user.id,
        name=data.name,
        token_hash=token_hash,
        scopes=",".join(data.scopes),
        expires_at=expires_at
    )
    db.add(api_token)
    db.commit()
    db.refresh(api_token)

    return {
        "id": api_token.id,
        "name": api_token.name,
        "token": plain_token,
        "scopes": data.scopes,
        "created_at": api_token.created_at.isoformat(),
        "expires_at": api_token.expires_at.isoformat() if api_token.expires_at else None
    }

@app.delete("/api/profile/tokens/{token_id}")
def delete_token(token_id: str, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts koennen keine API-Tokens loeschen.")
    token = db.query(APIToken).filter(APIToken.id == token_id, APIToken.user_id == user.id).first()
    if not token:
        raise HTTPException(status_code=404, detail="API-Token nicht gefunden.")
    db.delete(token)
    db.commit()
    return {"message": "API-Token erfolgreich geloescht."}



def brand_title() -> str:
    """Brand name for export metadata (branding runtime or fallback)."""
    try:
        cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "branding-runtime.json")
        if os.path.isfile(cfg_path):
            with open(cfg_path, "r", encoding="utf-8") as f:
                return (json.load(f).get("title") or "Ansimate")
    except Exception:
        pass
    return "Ansimate"




# : administrators may correct other users' usernames (name correction).
class AdminUsernameUpdateSchema(BaseModel):
    username: str


@app.post("/api/admin/users/{user_id}/username")
def admin_update_username(user_id: str, data: AdminUsernameUpdateSchema, http_req: Request,
                          admin: User = Depends(get_admin_user), db: DBSession = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden.")
    new_username = (data.username or "").strip()
    if not re.match(r"^[a-zA-Z0-9._-]+$", new_username) or len(new_username) < 3 or len(new_username) > 30:
        raise HTTPException(status_code=400, detail="Ungueltiger Benutzername.")
    if new_username == user.username:
        return {"message": "Benutzername unveraendert."}
    exists = db.query(User).filter(User.username == new_username, User.id != user.id).first()
    if exists:
        raise HTTPException(status_code=400, detail="Benutzername bereits vergeben.")
    old_username = user.username
    user.username = new_username
    db.commit()
    write_audit(db, admin, "admin.user.username_change", new_username,
                f"{old_username} -> {new_username}", _client_ip(http_req))
    return {"message": "Benutzername erfolgreich aktualisiert."}

def write_audit(db: DBSession, actor, action: str, target_name: str = None, detail: str = None, ip: str = None):
    """Writes an audit log entry (best effort)."""
    try:
        db.add(AuditLog(
            actor_id=(actor.id if actor else None),
            actor_name=(actor.username if actor else None),
            action=action, target_name=target_name, detail=detail, ip_address=ip
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Audit-Log-Fehler: {e}")

def _client_ip(request) -> str:
    """Client IP from the request (X-Forwarded-For preferred, set behind Traefik)."""
    if request is None:
        return None
    return request.headers.get(
        "X-Forwarded-For",
        request.client.host if request.client else "127.0.0.1"
    ).split(",")[0].strip()

#: team-audit helpers remain in ALL editions - retained endpoints (device groups, presets,
# scenarios) write via write_team_audit (best effort; a silent no-op without the team_audit_logs table).
def _team_owner_id(user) -> str:
    """: team key of an actor - guests belong to the owning account."""
    if user is None:
        return None
    return user.associated_user_id if getattr(user, "role", None) == "guest" else user.id

def write_team_audit(db: DBSession, actor, action: str, target_name: str = None, details=None, ip: str = None):
    """: writes a team-audit entry (best effort, append-only).
    `details` may be a dict/list (converted to JSON) or a str. The team is derived from the
    actor (guests -> owning account)."""
    try:
        team_id = _team_owner_id(actor)
        if not team_id:
            return
        if isinstance(details, (dict, list)):
            details_str = json.dumps(details, ensure_ascii=False)
        else:
            details_str = details
        db.add(TeamAuditLog(
            team_user_id=team_id,
            actor_id=(actor.id if actor else None),
            actor_name=(getattr(actor, "username", None) or getattr(actor, "email", None)),
            action=action, target_name=target_name, details=details_str, ip_address=ip
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Team-Audit-Log-Fehler: {e}")
@app.get("/api/profile/audit-log")
def team_audit_log(request: Request, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db),
                   limit: int = 200, actor_id: Optional[str] = None):
    """: activity log of one's own team. Only team admins (owning,
    regular accounts) - guests and platform admins have no team context.
    : optional actor_id filter -> activities of a single team member."""
    if user.role != "user":
        raise HTTPException(status_code=403, detail="Nur Team-Admins koennen das Aktivitaetsprotokoll einsehen.")
    limit = max(1, min(int(limit or 200), 500))
    q = db.query(TeamAuditLog).filter(TeamAuditLog.team_user_id == user.id)
    if actor_id:
        # Only members of one's own team (or the owner themselves) are permitted as an actor.
        if actor_id != user.id:
            member = db.query(User).filter(User.id == actor_id, User.associated_user_id == user.id).first()
            if not member:
                raise HTTPException(status_code=404, detail="Teammitglied nicht gefunden.")
        q = q.filter(TeamAuditLog.actor_id == actor_id)
    entries = (
        q
        .order_by(TeamAuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    out = []
    for e in entries:
        try:
            details = json.loads(e.details) if e.details else None
        except Exception:
            details = e.details
        out.append({
            "timestamp": e.created_at.isoformat() if e.created_at else None,
            "actor": e.actor_name, "actor_id": e.actor_id,
            "action": e.action, "target": e.target_name,
            "details": details, "ip": e.ip_address,
        })
    return out

@app.get("/api/admin/audit-log")
def admin_audit_log(admin: User = Depends(get_admin_user), db: DBSession = Depends(get_db)):
    entries = db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(200).all()
    return [{
        "timestamp": e.timestamp.isoformat() if e.timestamp else None,
        "actor": e.actor_name, "action": e.action,
        "target": e.target_name, "detail": e.detail, "ip": e.ip_address
    } for e in entries]


# : shared metric calculation (dashboard stats + snapshot capture).
def _account_counts(db: DBSession):
    users = db.query(User).all()
    paid = trial = 0
    inactive = len(users)
    return len(users), paid, trial, inactive


def _playbook_storage_bytes() -> int:
    storage = 0
    custom_root = "/playbooks/custom"
    if os.path.isdir(custom_root):
        for root, _dirs, files in os.walk(custom_root):
            for fn in files:
                try:
                    storage += os.path.getsize(os.path.join(root, fn))
                except Exception:
                    pass
    return storage


def _ip_block_counts(db: DBSession):
    """Active IP blocks by cause: automatic (rate limit) vs. manual (admin)."""
    blocks = db.query(IPBlock).all()
    auto = sum(1 for b in blocks if "rate" in (b.reason or "").lower())
    manual = len(blocks) - auto
    return len(blocks), auto, manual


def capture_stats_snapshot(db: DBSession):
    """: persist the current statistics state as a snapshot (for history graphs)."""
    total, paid, trial, inactive = _account_counts(db)
    ip_total, ip_auto, ip_manual = _ip_block_counts(db)
    snap_kwargs = dict(
        total_users=total,
        inactive=inactive,
        ip_blocks_total=ip_total, ip_blocks_auto=ip_auto, ip_blocks_manual=ip_manual,
        playbook_storage_bytes=_playbook_storage_bytes(),
    )
    db.add(StatsSnapshot(**snap_kwargs))
    db.commit()


@app.get("/api/admin/stats")
def admin_stats(admin: User = Depends(get_admin_user), db: DBSession = Depends(get_db)):
    users_total, paid, trial, inactive = _account_counts(db)
    storage = _playbook_storage_bytes()
    ip_total, ip_auto, ip_manual = _ip_block_counts(db)
    config = {
        "smtp": bool(os.environ.get("SMTP_USERNAME") and os.environ.get("SMTP_PASSWORD")),
        "captcha": os.environ.get("CAPTCHA_REQUIRED", "false").lower() == "true",
        "email_verification": os.environ.get("EMAIL_VERIFICATION_REQUIRED", "false").lower() == "true",
        "api_docs": os.environ.get("ENABLE_API_DOCS", "true").lower() == "true",
        # : maintenance-mode status for the dashboard status light.
        "maintenance_mode": _maintenance_active(db),
    }
    return {
        "total": users_total,
        "inactive": inactive,
        "playbook_storage_bytes": storage,
        # : IP blocks by cause (for the pie chart).
        "ip_blocks": {"total": ip_total, "auto": ip_auto, "manual": ip_manual},
        "config": config
    }

# : time series of the statistics snapshots for the history graphs (24h/7d/30d).
@app.get("/api/admin/stats/timeseries")
def admin_stats_timeseries(range: str = "7d", admin: User = Depends(get_admin_user), db: DBSession = Depends(get_db)):
    hours = {"24h": 24, "7d": 24 * 7, "30d": 24 * 30}.get(range, 24 * 7)
    since = datetime.utcnow() - timedelta(hours=hours)
    rows = db.query(StatsSnapshot).filter(StatsSnapshot.created_at >= since).order_by(StatsSnapshot.created_at.asc()).all()
    return [{
        "t": r.created_at.isoformat(),
        "total": r.total_users,
        "inactive": r.inactive,
        "ip_total": r.ip_blocks_total, "ip_auto": r.ip_blocks_auto, "ip_manual": r.ip_blocks_manual,
        "storage": r.playbook_storage_bytes,
    } for r in rows]



def _global_int_setting(db: DBSession, key: str, default: int) -> int:
    s = db.query(Setting).filter(Setting.key == key).first()
    if s and s.value and str(s.value).strip().isdigit():
        return int(s.value)
    return default

#: effective_* wrappers remain in ALL editions - retained endpoints (e.g. device creation
# via effective_max_devices) use them; they only delegate to the active LimitsProvider
# (On-Premise: CoreLimitsProvider; Community: CommunityLimitsProvider).
# : effective limits via the active LimitsProvider. Core default = user
# override -> global settings (no tariff); cloud uses the TariffLimitsProvider, into which
# _active_tariff is injected as the resolver (see provider wiring at module end).
# Admin overrides (admin_set_user_limits) remain effective unchanged, since the provider
# checks the user override first.
def effective_storage_quota_mb(user: User, db: DBSession) -> int:
    return limits.get_limits_provider().effective_storage_quota_mb(user, db)

def effective_max_custom_playbooks(user: User, db: DBSession) -> int:
    return limits.get_limits_provider().effective_max_custom_playbooks(user, db)

def effective_max_devices(user: User, db: DBSession):
    return limits.get_limits_provider().effective_max_devices(user, db)

def effective_max_guest_accounts(user: User, db: DBSession) -> int:
    return limits.get_limits_provider().effective_max_guest_accounts(user, db)





@app.get("/api/admin/settings")
def admin_get_settings(admin: User = Depends(get_admin_user), db: DBSession = Depends(get_db)):
    settings = db.query(Setting).all()
    return {s.key: s.value for s in settings}

@app.post("/api/admin/settings")
def admin_update_settings(data: AdminSettingsUpdateSchema, admin: User = Depends(get_admin_user), db: DBSession = Depends(get_db)):
    updates = {
        "rate_limit_global_ip": data.rate_limit_global_ip,
        "rate_limit_user_ip": data.rate_limit_user_ip,
        "ip_ban_duration": data.ip_ban_duration,
        "max_history_count": data.max_history_count,
        "max_history_age": data.max_history_age,
        # : default timeout for executions.
        "default_job_timeout": data.default_job_timeout,
    }
    #: The quota/limit and fingerprint-alert fields are hidden in the Community-Edition
    # and not sent along -> only update when explicitly sent
    # (otherwise the existing default is retained).
    for _opt_key in (
        "max_active_api_tokens", "max_guest_accounts", "storage_quota_mb",
        "max_custom_playbooks",
        #: connection timeout (only update when sent; default via seeding/fallback).
        "default_connection_timeout",
    ):
        _opt_val = getattr(data, _opt_key)
        if _opt_val is not None:
            updates[_opt_key] = _opt_val
    # : only update maintenance mode + note when explicitly sent.
    #: In the Community-Edition maintenance mode is not available -> ignore the field
    # server-side (not activatable; the UI hides the switch/note anyway).
    if EDITION != "community":
        if data.maintenance_mode is not None:
            updates["maintenance_mode"] = "true" if str(data.maintenance_mode).lower() == "true" else "false"
        if data.maintenance_note is not None:
            updates["maintenance_note"] = data.maintenance_note.strip()
    # : only update the registration switch when explicitly sent.
    if data.registration_enabled is not None:
        updates["registration_enabled"] = "true" if str(data.registration_enabled).lower() == "true" else "false"
    # : only update password rules when sent.
    if data.password_min_length is not None:
        updates["password_min_length"] = data.password_min_length
    for _pw_key in ("password_require_special", "password_require_case", "password_require_digit"):
        _val = getattr(data, _pw_key)
        if _val is not None:
            updates[_pw_key] = "true" if str(_val).lower() == "true" else "false"
    #: only update the enterprise/custom tariff (cloud-only) when sent.
    if EDITION != "community":
        if data.enterprise_tier_enabled is not None:
            updates["enterprise_tier_enabled"] = "true" if str(data.enterprise_tier_enabled).lower() == "true" else "false"
        if data.enterprise_tier_title is not None:
            updates["enterprise_tier_title"] = data.enterprise_tier_title.strip()
        if data.enterprise_tier_description is not None:
            updates["enterprise_tier_description"] = data.enterprise_tier_description.strip()
        if data.enterprise_contact_email is not None:
            updates["enterprise_contact_email"] = data.enterprise_contact_email.strip()
    for key, value in updates.items():
        setting = db.query(Setting).filter(Setting.key == key).first()
        if setting:
            setting.value = value
        else:
            db.add(Setting(key=key, value=value))
    db.commit()
    # : when maintenance mode is activated, immediately end all non-admin sessions
    # so that affected users land on the maintenance page on their next request (503).
    if updates.get("maintenance_mode") == "true":
        admin_ids = [u.id for u in db.query(User).filter(User.role == "admin").all()]
        q = db.query(Session)
        if admin_ids:
            q = q.filter(~Session.user_id.in_(admin_ids))
        q.delete(synchronize_session=False)
        db.commit()
    return {"message": "Einstellungen erfolgreich gespeichert."}

# : test email for SMTP verification.
class AdminTestEmailSchema(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _v_email(cls, v):
        v = (v or "").strip()
        if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", v):
            raise ValueError("Ungueltige E-Mail-Adresse.")
        return v

@app.post("/api/admin/config/test-email")
async def admin_test_email(data: AdminTestEmailSchema, admin: User = Depends(get_admin_user)):
    if not (os.environ.get("SMTP_USERNAME") and os.environ.get("SMTP_PASSWORD")):
        raise HTTPException(status_code=400, detail="SMTP ist nicht konfiguriert (SMTP_USERNAME/SMTP_PASSWORD fehlen).")
    from email_helper import send_email
    try:
        sent = await send_email(
            to_email=data.email,
            subject="Ansimate – SMTP-Test",
            html_content="<p>Dies ist eine Test-E-Mail von Ansimate. Wenn Sie diese Nachricht erhalten, funktioniert der SMTP-Versand.</p>",
            text_content="Dies ist eine Test-E-Mail von Ansimate. Wenn Sie diese Nachricht erhalten, funktioniert der SMTP-Versand.",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SMTP-Versand fehlgeschlagen: {str(e)[:200]}")
    if not sent:
        raise HTTPException(status_code=502, detail="SMTP-Versand fehlgeschlagen. Bitte SMTP-Einstellungen prüfen.")
    return {"message": f"Test-E-Mail an {data.email} gesendet."}

@app.get("/api/admin/ip-blocks")
def admin_list_ip_blocks(admin: User = Depends(get_admin_user), db: DBSession = Depends(get_db)):
    blocks = db.query(IPBlock).order_by(IPBlock.blocked_at.desc()).all()
    history = db.query(IPBlockHistory).order_by(IPBlockHistory.released_at.desc()).limit(50).all()

    blocks_data = [{
        "ip": b.ip,
        "reason": b.reason,
        "blocked_at": b.blocked_at.isoformat(),
        "expires_at": b.expires_at.isoformat() if b.expires_at else None
    } for b in blocks]

    history_data = [{
        "id": h.id,
        "ip": h.ip,
        "reason": h.reason,
        "blocked_at": h.blocked_at.isoformat(),
        "expires_at": h.expires_at.isoformat() if h.expires_at else None,
        "released_at": h.released_at.isoformat(),
        "release_method": h.release_method
    } for h in history]

    return {"blocks": blocks_data, "history": history_data}

@app.post("/api/admin/ip-blocks")
def admin_block_ip(data: AdminIPBlockCreateSchema, admin: User = Depends(get_admin_user), db: DBSession = Depends(get_db)):
    ip = data.ip.strip()
    if not ip:
        raise HTTPException(status_code=400, detail="Ungueltige IP-Adresse.")

    expires_at = None
    if data.duration_seconds:
        expires_at = datetime.utcnow() + timedelta(seconds=data.duration_seconds)

    block = IPBlock(
        ip=ip,
        reason=data.reason,
        blocked_at=datetime.utcnow(),
        expires_at=expires_at
    )
    db.merge(block)
    db.commit()
    return {"message": f"IP-Adresse {ip} erfolgreich gesperrt."}

@app.delete("/api/admin/ip-blocks/{ip}")
def admin_unblock_ip(ip: str, admin: User = Depends(get_admin_user), db: DBSession = Depends(get_db)):
    block = db.query(IPBlock).filter(IPBlock.ip == ip).first()
    if not block:
        raise HTTPException(status_code=404, detail="Sperre fuer diese IP-Adresse nicht gefunden.")

    # Add history entry
    history = IPBlockHistory(
        ip=block.ip,
        reason=block.reason,
        blocked_at=block.blocked_at,
        expires_at=block.expires_at,
        released_at=datetime.utcnow(),
        release_method="manual"
    )
    db.add(history)
    db.delete(block)
    db.commit()
    return {"message": f"IP-Adresse {ip} erfolgreich freigegeben."}

# Device CRUD Endpoints
@app.post("/api/devices")
def create_device(data: DeviceCreateSchema, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts haben nur Lesezugriff und koennen keine Geraete erstellen.")
    if not user.is_subscription_active(db):
        raise HTTPException(status_code=403, detail="Abonnement inaktiv. Bitte reaktivieren Sie Ihr Abonnement, um Geraete zu verwalten.")

    # : enforce the device limit of the active tariff (None = unlimited).
    device_limit = effective_max_devices(user, db)
    if device_limit is not None:
        current = db.query(Device).filter(Device.user_id == user.id).count()
        if current >= device_limit:
            raise HTTPException(status_code=403, detail=f"Geraete-Limit Ihres Tarifs erreicht ({device_limit}).")

    encrypted = None
    if data.credential:
        if not data.credential_type:
            raise HTTPException(status_code=400, detail="credential_type ist erforderlich, wenn credential angegeben wird.")
        encrypted = encrypt_credential(data.credential)

    #: encrypt the optional sudo/become password (independent of the SSH credential).
    encrypted_become = encrypt_credential(data.become_password) if (data.become_password or "").strip() else None

    device = Device(
        user_id=user.id,
        name=data.name.strip(),
        host=data.host.strip(),
        username=data.username.strip() if data.username else None,
        port=data.port if data.port is not None else 22,
        encrypted_credential=encrypted,
        credential_type=data.credential_type,
        encrypted_become_credential=encrypted_become
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return {
        "id": device.id,
        "name": device.name,
        "host": device.host,
        "username": device.username,
        "port": device.port,
        "has_credential": device.encrypted_credential is not None,
        "has_become_credential": device.encrypted_become_credential is not None,
        "credential_type": device.credential_type,
        "created_at": device.created_at.isoformat()
    }

@app.get("/api/devices")
def list_devices(user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if not user.is_subscription_active(db):
        raise HTTPException(status_code=403, detail="Abonnement inaktiv. Bitte reaktivieren Sie Ihr Abonnement, um auf Geraete zuzugreifen.")

    target_user_id = user.associated_user_id if user.role == "guest" else user.id
    devices = db.query(Device).filter(Device.user_id == target_user_id).order_by(Device.name).all()
    return [
        {
            "id": d.id,
            "name": d.name,
            "host": d.host,
            "username": d.username,
            "port": d.port,
            "has_credential": d.encrypted_credential is not None,
            "has_become_credential": d.encrypted_become_credential is not None,
            "credential_type": d.credential_type,
            "created_at": d.created_at.isoformat()
        }
        for d in devices
    ]

@app.put("/api/devices/{device_id}")
def update_device(device_id: str, data: DeviceUpdateSchema, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts haben nur Lesezugriff und koennen keine Geraete bearbeiten.")
    if not user.is_subscription_active(db):
        raise HTTPException(status_code=403, detail="Abonnement inaktiv. Bitte reaktivieren Sie Ihr Abonnement, um Geraete zu verwalten.")

    device = db.query(Device).filter(Device.id == device_id, Device.user_id == user.id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Gerät nicht gefunden.")

    if data.name is not None:
        device.name = data.name.strip()
    if data.host is not None:
        device.host = data.host.strip()
    if data.username is not None:
        device.username = data.username.strip() if data.username else None
    if data.port is not None:
        device.port = data.port
    if data.credential is not None:
        if data.credential == "": # Clear credential
            device.encrypted_credential = None
            device.credential_type = None
        else:
            cred_type = data.credential_type or device.credential_type
            if not cred_type:
                raise HTTPException(status_code=400, detail="credential_type ist erforderlich.")
            device.encrypted_credential = encrypt_credential(data.credential)
            device.credential_type = cred_type
    elif data.credential_type is not None and device.encrypted_credential is not None:
        device.credential_type = data.credential_type

    #: set/delete sudo/become password. None = leave unchanged, "" = delete.
    if data.become_password is not None:
        if data.become_password == "":
            device.encrypted_become_credential = None
        else:
            device.encrypted_become_credential = encrypt_credential(data.become_password)

    db.commit()
    return {
        "id": device.id,
        "name": device.name,
        "host": device.host,
        "username": device.username,
        "port": device.port,
        "has_credential": device.encrypted_credential is not None,
        "has_become_credential": device.encrypted_become_credential is not None,
        "credential_type": device.credential_type,
        "created_at": device.created_at.isoformat()
    }

@app.delete("/api/devices/{device_id}")
def delete_device(device_id: str, user: User = Depends(get_authenticated_user), db: DBSession = Depends(get_db)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Gast-Accounts haben nur Lesezugriff und koennen keine Geraete loeschen.")
    if not user.is_subscription_active(db):
        raise HTTPException(status_code=403, detail="Abonnement inaktiv. Bitte reaktivieren Sie Ihr Abonnement, um Geraete zu verwalten.")

    device = db.query(Device).filter(Device.id == device_id, Device.user_id == user.id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Gerät nicht gefunden.")
    db.delete(device)
    db.commit()
    return {"message": "Gerät erfolgreich gelöscht."}


@app.get("/api/timezone")
def get_system_timezone():
    tz = os.environ.get("TZ")
    if tz:
        return {"timezone": tz}

    if os.path.isfile("/etc/timezone"):
        try:
            with open("/etc/timezone", "r") as f:
                return {"timezone": f.read().strip()}
        except Exception:
            pass

    try:
        import time
        return {"timezone": time.tzname[0]}
    except Exception:
        pass

    return {"timezone": "Europe/Berlin"}

def get_preset_playbook_files() -> set:
    """Returns all playbook files (full path + basename) that appear in any preset."""
    presets_path = "/playbooks/presets.yml"
    allowed = set()
    if not os.path.isfile(presets_path):
        return allowed
    try:
        with open(presets_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if isinstance(data, list):
            for entry in data:
                if isinstance(entry, dict) and "playbooks" in entry:
                    for pb in entry["playbooks"]:
                        allowed.add(pb)
                        allowed.add(pb.split("/")[-1])
    except Exception:
        pass
    return allowed


@app.get("/api/presets")
def list_presets(lang: Optional[str] = None):  # : pass through the active UI language
    presets_path = "/playbooks/presets.yml"
    if not os.path.isfile(presets_path):
        return []

    try:
        index_metadata = load_index_metadata()
        with open(presets_path, "r", encoding="utf-8") as f:
            presets_data = yaml.safe_load(f)

        presets = []
        if isinstance(presets_data, list):
            for entry in presets_data:
                if isinstance(entry, dict) and "name" in entry and "playbooks" in entry:
                    resolved_playbooks = []
                    for pb_file in entry["playbooks"]:
                        resolved_playbooks.append(resolve_playbook_metadata(pb_file, index_metadata, lang))
                    presets.append({
                        "name": entry["name"],
                        "playbooks": resolved_playbooks,
                        "icon": entry.get("icon", ""),
                        "variables": entry.get("variables", {}),
                        "description": entry.get("description", "")
                    })
        return presets
    except Exception as e:
        print(f"Preset-Lesefehler: {e}")
        raise HTTPException(status_code=500, detail="Presets konnten nicht gelesen werden.")

# ---- Custom playbook metadata (JSON sidecar per owner) ----

#: _custom_meta_path/load_custom_meta/save_custom_meta remain in ALL editions -
# retained community endpoints (playbook list/detail, custom meta) read/write the sidecars.
def _custom_meta_path(owner_id: str) -> str:
    return os.path.join("/playbooks", "custom", owner_id, "_meta.json")

def load_custom_meta(owner_id: str) -> dict:
    p = _custom_meta_path(owner_id)
    if os.path.isfile(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                d = json.load(f)
                return d if isinstance(d, dict) else {}
        except Exception:
            return {}
    return {}

def save_custom_meta(owner_id: str, data: dict):
    os.makedirs(os.path.dirname(_custom_meta_path(owner_id)), exist_ok=True)
    with open(_custom_meta_path(owner_id), "w", encoding="utf-8") as f:
        json.dump(data, f)


@app.get("/api/playbooks")
def list_playbooks(
    current_user: Optional[User] = Depends(get_current_user),
    db: DBSession = Depends(get_db),
    lang: Optional[str] = None,  # : active UI language -> bilingual description
):
    if not os.path.isdir("/playbooks"):
        return []

    playbooks = []
    has_index = False

    # Try parsing index.yml metadata
    index_path = "/playbooks/index.yml"
    if os.path.isfile(index_path):
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                metadata = yaml.safe_load(f)
                if isinstance(metadata, list):
                    for entry in metadata:
                        if isinstance(entry, dict) and "file" in entry:
                            file_name = entry["file"]
                            resolved_path = _resolve_std_playbook_path(file_name)   # incl. premium/
                            if resolved_path:
                                is_premium = bool(entry.get("premium", False))
                                # / : hide premium playbooks edition-independently via
                                # the EntitlementProvider (Community hides them).
                                if is_premium and entitlements.get_entitlement_provider().hides_premium_in_catalog():
                                    continue
                                playbooks.append({
                                    "file": file_name,
                                    "name": entry.get("name", file_name),
                                    "icon": entry.get("icon", "description"),
                                    "description": _localize(entry.get("description", "Keine Beschreibung verfügbar."), lang),
                                    "size": os.path.getsize(resolved_path),
                                    "requires": entry.get("requires", []),
                                    "category": entry.get("category", ""),
                                    # : vendor/author URLs (legal transparency).
                                    "vendor_urls": entry.get("vendor_urls", []),
                                    #: pass through the optional input variable schema
                                    # (used by schema-driven forms; empty if
                                    # not declared).
                                    "variables": entry.get("variables", []),
                                    # : service requires HTTPS (frontend warning)
                                    "requires_https": bool(entry.get("requires_https", False)),
                                    # : service group for the port collision check
                                    # (variants of the same service share a group and
                                    # do not collide with each other). Default: no group.
                                    "service_group": entry.get("service_group") or None,
                                    "custom": False
                                })
                    has_index = True
        except Exception as e:
            print(f"Error parsing index.yml: {e}. Falling back to folder scan.")

    if not has_index:
        # Fallback to folder scanning
        try:
            for entry in os.scandir("/playbooks"):
                if entry.is_file() and (entry.name.endswith(".yml") or entry.name.endswith(".yaml")):
                    if entry.name == "index.yml":
                        continue
                    playbooks.append({
                        "file": entry.name,
                        "name": entry.name,
                        "icon": "description",
                        "description": "Lokales Ansible Playbook.",
                        "size": entry.stat().st_size,
                        "requires": [],
                        "category": "",
                        "custom": False
                    })
        except Exception as e:
            print(f"Playbook-Scan-Fehler: {e}")
            raise HTTPException(status_code=500, detail="Playbook-Verzeichnis konnte nicht gelesen werden.")
        playbooks.sort(key=lambda x: x["name"])

    # Load custom playbooks if premium user is logged in
    if current_user and current_user.is_subscription_active(db):
        owner_id = current_user.associated_user_id if current_user.role == "guest" else current_user.id
        is_guest = current_user.role == "guest"
        custom_dir = os.path.join("/playbooks", "custom", owner_id) if owner_id else None
        if custom_dir and os.path.isdir(custom_dir):
            meta = load_custom_meta(owner_id)
            custom_playbooks = []
            try:
                for entry in os.scandir(custom_dir):
                    if entry.is_file() and (entry.name.endswith(".yml") or entry.name.endswith(".yaml")):
                        m = meta.get(entry.name, {})
                        # Guests only see the custom playbooks shared with them
                        if is_guest and current_user.id not in m.get("guest_access", []):
                            continue
                        custom_playbooks.append({
                            "file": f"custom/{owner_id}/{entry.name}",
                            "filename": entry.name,
                            "name": m.get("name") or entry.name,
                            "icon": "description",
                            "icon_type": m.get("icon_type"),
                            "icon_value": m.get("icon_value"),
                            "description": m.get("description") or "Eigenes Custom Playbook.",
                            "size": entry.stat().st_size,
                            "requires": [],
                            # : no separate "My Playbooks" category -> sort into "Available
                            # Playbooks" (catch-all "Sonstige" together with the catalog).
                            "category": "Sonstige",
                            "custom": True,
                            "guest_access": (None if is_guest else m.get("guest_access", []))
                        })
                custom_playbooks.sort(key=lambda x: x["name"])
                playbooks = playbooks + custom_playbooks
            except Exception as e:
                print(f"Failed to scan custom playbooks: {e}")

    # : hide premium standard playbooks for guest accounts.
    # - Host account WITHOUT active runtime: remove all premium playbooks entirely.
    # - Host account WITH active runtime: show only those explicitly shared with this guest.
    # (Custom playbooks carry no "premium" flag and remain untouched.)
    if current_user and current_user.role == "guest":
        if not current_user.is_subscription_active(db):
            playbooks = [p for p in playbooks if not p.get("premium")]
        else:
            try:
                shared = set(json.loads(current_user.shared_premium_playbooks or "[]"))
            except Exception:
                shared = set()
            playbooks = [p for p in playbooks if (not p.get("premium")) or (p.get("file") in shared)]

    return playbooks

def _resolve_std_playbook_path(pb):
    """Resolves a standard playbook reference (index.yml 'file' or run string) to a
    canonical path under /playbooks. Premium playbooks live in the premium/ subfolder
    (so the community export can exclude them by folder) -> also search
    there. Returns the abspath under /playbooks or None (not found / directory traversal).
    'file' in index.yml stays the bare filename; premium detection still works via
    the basename (canon_base), so NO change to the premium/share checks is needed."""
    for cand in (pb, os.path.join("premium", pb)):
        rp = os.path.abspath(os.path.join("/playbooks", cand))
        if (rp == "/playbooks" or rp.startswith("/playbooks" + os.sep)) and os.path.isfile(rp):
            return rp
    return None

#: remains in ALL editions - Community needs the premium file list to hide premium playbooks
# (CommunityEntitlementProvider.hides_premium_in_catalog / list_playbooks filter).
def _load_premium_playbook_files():
    """Set of standard playbook filenames marked as premium from index.yml."""
    out = set()
    index_path = "/playbooks/index.yml"
    if not os.path.isfile(index_path):
        return out
    try:
        with open(index_path, "r", encoding="utf-8") as f:
            meta = yaml.safe_load(f)
        if isinstance(meta, list):
            for e in meta:
                if isinstance(e, dict) and e.get("file") and e.get("premium"):
                    out.add(e["file"])
    except Exception as e:
        print(f"Premium-Index-Lesefehler: {e}")
    return out

def _index_playbook_files():
    """: (all_files, premium_files) from index.yml for the team share counters."""
    all_files, premium = set(), set()
    index_path = "/playbooks/index.yml"
    if not os.path.isfile(index_path):
        return all_files, premium
    try:
        with open(index_path, "r", encoding="utf-8") as f:
            meta = yaml.safe_load(f)
        if isinstance(meta, list):
            for e in meta:
                if isinstance(e, dict) and e.get("file"):
                    all_files.add(e["file"])
                    if e.get("premium"):
                        premium.add(e["file"])
    except Exception as e:
        print(f"Index-Lesefehler: {e}")
    return all_files, premium


@app.post("/api/run")
def run_playbook(
    request: RunRequest,
    http_req: Request,
    current_user: Optional[User] = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    if getattr(http_req.state, "is_api_token", False):
        if "run_playbook" not in getattr(http_req.state, "api_token_scopes", []):
            raise HTTPException(status_code=403, detail="Fehlender Scope: run_playbook")

    # : resolve the scenario -> preset (recipe) + target devices. Shareable like presets;
    # premium-gated; the strict/flexible permission controls variable overrides. Must run BEFORE
    # preset resolution (sets playbooks/variables/device_ids directly).
    # scenario_authorized_devices: a guest authorized via a scenario share may use the scenario's
    # (server-side fixed) target devices, even without a separate device share.
    scenario_authorized_devices = False
    if request.scenario_id:
        if not current_user:
            raise HTTPException(status_code=401, detail="Nicht authentifiziert. Szenarien erfordern eine Anmeldung.")
        scen_owner_id = current_user.associated_user_id if current_user.role == "guest" else current_user.id
        scenario = db.query(Scenario).filter(
            Scenario.id == request.scenario_id, Scenario.user_id == scen_owner_id
        ).first()
        if not scenario:
            raise HTTPException(status_code=404, detail="Szenario nicht gefunden.")
        permission = "flexible"
        if current_user.role == "guest":
            share = next((s for s in _safe_json_list(scenario.shares) if s.get("guest_id") == current_user.id), None)
            if not share:
                raise HTTPException(status_code=403, detail="Dieses Szenario wurde nicht fuer Sie freigegeben.")
            permission = share.get("permission", "strict")
        if not current_user.is_subscription_active(db):
            raise HTTPException(status_code=403, detail="Das Ausfuehren von Szenarien erfordert eine aktive Premium-Laufzeit.")
        scen_preset = db.query(CustomPreset).filter(
            CustomPreset.id == scenario.preset_id, CustomPreset.user_id == scen_owner_id
        ).first()
        if not scen_preset:
            raise HTTPException(status_code=400, detail="Das Preset des Szenarios existiert nicht mehr.")
        # Playbooks + (optional) fixed target devices from the scenario; variables strict/flexible as with presets.
        request.playbooks = _safe_json_list(scen_preset.playbook_ids)
        request.device_ids = _safe_json_list(scenario.device_ids)
        scen_vars = _safe_json_obj(scen_preset.variables)
        if permission == "strict":
            request.variables = dict(scen_vars)
        else:
            merged = dict(scen_vars)
            merged.update(request.variables or {})
            request.variables = merged
        # : only for firmly bound devices does the scenario share authorize their
        # use. Deviceless scenarios use the one-time credentials passed in the request
        # (SSH host/user/credential from the run dialog).
        scenario_authorized_devices = bool(request.device_ids)

    # : resolve the custom preset -> sets playbooks, variables and target devices.
    # Premium-gated (active subscription runtime of the user or team owner); the strict/flexible
    # permission controls whether variables set in the dialog override the preset values.
    if request.custom_preset_id:
        if not current_user:
            raise HTTPException(status_code=401, detail="Nicht authentifiziert. Presets erfordern eine Anmeldung.")
        preset_owner_id = current_user.associated_user_id if current_user.role == "guest" else current_user.id
        preset = db.query(CustomPreset).filter(
            CustomPreset.id == request.custom_preset_id, CustomPreset.user_id == preset_owner_id
        ).first()
        if not preset:
            raise HTTPException(status_code=404, detail="Preset nicht gefunden.")
        # Determine the permission: owner always 'flexible'; guest needs a share.
        permission = "flexible"
        if current_user.role == "guest":
            share = next((s for s in _safe_json_list(preset.shares) if s.get("guest_id") == current_user.id), None)
            if not share:
                raise HTTPException(status_code=403, detail="Dieses Preset wurde nicht fuer Sie freigegeben.")
            permission = share.get("permission", "strict")
        # point 4: premium gate (active runtime of the user or team owner).
        if not current_user.is_subscription_active(db):
            raise HTTPException(status_code=403, detail="Das Ausfuehren von Presets erfordert eine aktive Premium-Laufzeit.")
        # Playbooks ALWAYS from the preset (not from the client).
        request.playbooks = _safe_json_list(preset.playbook_ids)
        # Adopt the preset's target devices unless the caller chose others.
        _preset_devs = _safe_json_list(preset.device_ids)
        if _preset_devs and not request.device_ids:
            request.device_ids = _preset_devs
        # Variables: strict -> exclusively preset values; flexible/owner -> client
        # overrides win, preset values as fallback.
        preset_vars = _safe_json_obj(preset.variables)
        if permission == "strict":
            request.variables = dict(preset_vars)
        else:
            merged = dict(preset_vars)
            merged.update(request.variables or {})
            request.variables = merged

    if current_user:
        if not current_user.is_subscription_active(db):
            # : guests are blocked without an active host subscription. If the
            # execution concerns a premium playbook, show the required precise message,
            # otherwise a clear note about the host account.
            if current_user.role == "guest":
                premium_files = _load_premium_playbook_files()
                wants_premium = any(
                    (os.path.basename(pb) in premium_files) or (pb in premium_files)
                    for pb in (request.playbooks or [])
                )
                if wants_premium:
                    raise HTTPException(status_code=403, detail="Premium-Playbook kann nicht ausgefuehrt werden (Abonnement des Host-Kontos abgelaufen).")
                raise HTTPException(status_code=403, detail="Ausfuehrung nicht moeglich: Das Abonnement des Host-Kontos ist nicht aktiv.")
            raise HTTPException(status_code=403, detail="Ihr Abonnement oder Ihre Testphase ist nicht aktiv. Bitte abonnieren Sie den Dienst, um Playbooks auszufuehren.")

        target_user = db.query(User).filter(User.id == current_user.associated_user_id).first() if current_user.role == "guest" else current_user
        if target_user and target_user.tier == "free" and target_user.role != "admin":
            jobs = load_jobs()
            active_count = sum(
                1 for j in jobs.values()
                if j.get("user_id") == target_user.id and j.get("status") in ("pending", "running")
            )
            if active_count >= 1:
                raise HTTPException(
                    status_code=429,
                    detail="Im Free-Tier ist maximal 1 Ausfuehrung gleichzeitig erlaubt. Bitte warten Sie, bis der aktive Job beendet ist."
                )
    else:
        # : spam protection. If ALLOW_ANONYMOUS_RUN=false, anonymous execution is
        # completely blocked; the visitor is prompted to log in/register.
        if not _allow_anonymous_run():
            raise HTTPException(status_code=401, detail="Die anonyme Ausfuehrung ist deaktiviert. Bitte melden Sie sich an oder registrieren Sie sich, um Playbooks auszufuehren.")
        # Anonymous callers: not completely unthrottled. session_id required,
        # no custom playbooks, and max. 1 concurrent execution per session.
        sid = request.session_id
        if not sid:
            raise HTTPException(status_code=401, detail="Nicht authentifiziert. Bitte melden Sie sich an oder starten Sie eine Sitzung.")
        if any((pb.startswith("custom/") or "/custom/" in pb) for pb in request.playbooks):
            raise HTTPException(status_code=403, detail="Custom-Playbooks erfordern eine Anmeldung.")
        jobs = load_jobs()
        anon_active = sum(1 for j in jobs.values() if j.get("session_id") == sid and j.get("status") in ("pending", "running"))
        if anon_active >= 1:
            raise HTTPException(status_code=429, detail="Maximal 1 gleichzeitige Ausfuehrung. Bitte warten Sie, bis der aktive Job beendet ist.")

    if not request.playbooks:
        raise HTTPException(status_code=400, detail="At least one playbook must be selected.")

    # Guest accounts: standard playbooks/presets are allowed; custom playbooks
    # only if the owner has shared them with this guest.
    if current_user and current_user.role == "guest":
        owner_id = current_user.associated_user_id
        guest_meta = load_custom_meta(owner_id) if owner_id else {}
        custom_prefix = "custom/" + (owner_id or "") + "/"
        for pb in request.playbooks:
            is_custom = pb.startswith("custom/") or "/custom/" in pb
            if not is_custom:
                continue  # standard playbooks and presets are allowed
            base = pb.split("/")[-1]
            if owner_id and pb.startswith(custom_prefix) and current_user.id in guest_meta.get(base, {}).get("guest_access", []):
                continue
            raise HTTPException(status_code=403, detail="Gast-Accounts duerfen nur freigegebene Custom-Playbooks ausfuehren.")

    # Check if selected playbooks exist and resolve correctly
    effective_owner_id = None
    if current_user:
        effective_owner_id = current_user.associated_user_id if current_user.role == "guest" else current_user.id
    custom_base = os.path.join("/playbooks", "custom") + os.sep
    #: prepare the premium set + guest revokes once
    premium_files = _load_premium_playbook_files()
    guest_revoked = []
    if current_user and current_user.role == "guest":
        try:
            guest_revoked = json.loads(current_user.revoked_playbooks or "[]")
        except Exception:
            guest_revoked = []
    for pb in request.playbooks:
        resolved_path = _resolve_std_playbook_path(pb)   # incl. premium/ subfolder; traversal-safe
        if resolved_path is None:
            raise HTTPException(status_code=400, detail=f"Playbook {pb} not found or invalid.")
        # Security fix: the premium/revoke check MUST be based on the canonical path
        # (like the execution later), not on the raw string. Otherwise, for example,
        # "name.yml/" or "name.yml/." bypasses the check (same os.path.abspath,
        # but a differing base_pb). rel_pb corresponds to the index.yml "file" value or
        # the "custom/<owner>/<file>" path; canon_base is the bare filename.
        rel_pb = os.path.relpath(resolved_path, "/playbooks")
        canon_base = os.path.basename(resolved_path)
        is_premium_pb = rel_pb in premium_files or canon_base in premium_files
        # : premium access edition-independently via the EntitlementProvider.
        # community -> never available; onpremise -> free; cloud -> active subscription and (guest)
        # additionally the explicit share (shared_premium_playbooks). The precise
        # 403 message is provided by the provider.
        if is_premium_pb:
            _ep = entitlements.get_entitlement_provider()
            if not _ep.can_run_premium(current_user, rel_pb, canon_base, db):
                raise HTTPException(status_code=403, detail=_ep.premium_denied_message(current_user, rel_pb, canon_base, db))
        #: block playbooks revoked by the owner for this guest
        if guest_revoked and (rel_pb in guest_revoked or canon_base in guest_revoked):
            raise HTTPException(status_code=403, detail="Dieses Playbook wurde fuer Sie gesperrt.")
        if resolved_path.startswith(custom_base):
            if not current_user:
                raise HTTPException(status_code=401, detail="Nicht authentifiziert. Custom-Playbooks erfordern eine Anmeldung.")
            if not current_user.is_subscription_active(db):
                raise HTTPException(status_code=403, detail="Ihr Abonnement oder Ihre Testphase ist nicht aktiv.")
            parts = resolved_path.split("/")
            playbook_owner = parts[3] if len(parts) > 4 else None
            if not playbook_owner or playbook_owner != effective_owner_id:
                raise HTTPException(status_code=403, detail="Kein Zugriff auf dieses Custom-Playbook.")

    target_host = ""
    username = request.username
    password = request.password
    ssh_key = None
    host_entries = None
    #: sudo/become password for this run. A password provided in the dialog takes
    # precedence over the one stored on the device (added per branch below from the device if needed).
    become_password = (request.become_password or "").strip() or None

    # (Device-Flatten): normalize device_id (single selection from the run dropdown) to the
    # device_ids list; single and multi-host share the same device branch
    # (host_entries with 1..n hosts), replacing the former separate group/device branches.
    _target_device_ids = [d for d in (request.device_ids or []) if d]
    if not _target_device_ids and request.device_id:
        _target_device_ids = [request.device_id]

    if _target_device_ids:
        if not current_user:
            raise HTTPException(status_code=401, detail="Nicht authentifiziert. Bitte melden Sie sich an, um gespeicherte Geräte zu nutzen.")
        owner_id = current_user.associated_user_id if current_user.role == "guest" else current_user.id
        _dev_map = {d.id: d for d in db.query(Device).filter(
            Device.id.in_(_target_device_ids), Device.user_id == owner_id
        ).all()}
        # Preserve the selection order; discard unknown IDs.
        devices = [_dev_map[_i] for _i in _target_device_ids if _i in _dev_map]
        if not devices:
            raise HTTPException(status_code=404, detail="Kein gültiges Zielgerät gefunden.")
        # : guest share per device (moves from the former group share onto the Device).
        # For a run authorized via a scenario, the separate device share is dropped
        # (the scenario share is the authorization; the devices were fixed server-side).
        if current_user.role == "guest" and not scenario_authorized_devices:
            for device in devices:
                if current_user.id not in _safe_json_list(device.guest_access):
                    raise HTTPException(status_code=403, detail=f"Das Gerät '{device.name}' ist nicht für Sie freigegeben.")
        host_entries = []
        for device in devices:
            entry = {
                "host": device.host,   # Device.host is a required field, so always set
                "username": device.username,
                "password": None, "ssh_key": None,
            }
            if device.encrypted_credential:
                try:
                    decrypted = decrypt_credential(device.encrypted_credential)
                except Exception as e:
                    #: broken/older ciphertext must not trigger a 500 with a stack trace
                    print(f"Decrypt-Fehler fuer Geraet {device.id}: {e}")
                    raise HTTPException(status_code=400, detail=f"Anmeldedaten fuer Geraet '{device.name}' konnten nicht entschluesselt werden. Bitte erneut speichern.")
                if device.credential_type == "key":
                    entry["ssh_key"] = decrypted
                else:
                    entry["password"] = decrypted
            #: the device's become/sudo password (if stored); dialog override takes precedence.
            dev_become = None
            if device.encrypted_become_credential:
                try:
                    dev_become = decrypt_credential(device.encrypted_become_credential)
                except Exception as e:
                    print(f"Decrypt-Fehler fuer Become-Credential {device.id}: {e}")
            entry["become_password"] = become_password or dev_become
            #: base_dir per host (formerly a group default) — the inventory writer sets it per line.
            if device.base_directory:
                entry["base_dir"] = device.base_directory
            host_entries.append(entry)
        # Display name (host_entries stays untouched – display only): single device -> device name,
        # multiple selection -> count.
        target_host = devices[0].name if len(devices) == 1 else f"{len(devices)} Geräte"
        #: timezone as a global variable fallback from the first device that has one
        # (base_dir is set per host in the inventory).
        if request.variables is None:
            request.variables = {}
        if not request.variables.get("timezone"):
            for device in devices:
                if device.timezone:
                    request.variables["timezone"] = device.timezone
                    break
    else:
        if not request.target_host or not request.target_host.strip():
            raise HTTPException(status_code=400, detail="Zielgerät muss angegeben werden.")
        target_host = request.target_host.strip()
        # : one-time SSH key (deviceless scenario / ad-hoc run). The key takes precedence over
        # the password and is used only for this run (not persisted).
        if request.ssh_key:
            ssh_key = request.ssh_key
            password = None

    # Generate unique Job ID
    job_id = f"job_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"

    new_job = {
        "job_id": job_id,
        "status": "pending",
        "playbooks": request.playbooks,
        "target_host": target_host,
        "username": username,
        "created_at": datetime.now().isoformat(),
        "finished_at": None,
        "session_id": request.session_id,
        "user_id": current_user.id if current_user else None,
        "variables": request.variables # Store variables in job history
    }

    #: concurrency limit atomic (re-)check + insert, closes the TOCTOU gap.
    with job_create_lock:
        # Single-row insert (no delete-missing),
        save_job(new_job)

    # Push to background worker queue (now with variables dictionary, ssh_key, and email notifications)
    user_email = current_user.email if (current_user and current_user.email_notifications_enabled) else None
    send_notifications = current_user.email_notifications_enabled if current_user else False
    # : webhook URL of the triggering user (if configured).
    webhook_url = (current_user.webhook_url if current_user else None) or None

    execution_queue.put((
        job_id,
        request.playbooks,
        target_host,
        username,
        password,
        request.variables,
        ssh_key,
        user_email,
        send_notifications,
        host_entries,
        webhook_url,
        become_password
    ))

    # : team audit - playbook execution. Only for authenticated users (team
    # context); anonymous runs have no team. Variables are config (ports/domains) -
    # credentials are kept separately and NOT logged.
    if current_user:
        pb_names = [os.path.basename(p) for p in (request.playbooks or [])]
        write_team_audit(
            db, current_user, "playbook.run",
            (pb_names[0] if len(pb_names) == 1 else f"{len(pb_names)} Playbooks"),
            {"job_id": job_id, "target": target_host, "playbooks": pb_names,
             "variables": request.variables or {}},
            _client_ip(http_req)
        )

    return {"job_id": job_id, "status": "pending"}

def _allowed_job_owner_ids(current_user, db) -> list:
    #: guests see ONLY their own jobs; a main account sees its own
    # plus those of its guests. (Sibling/foreign jobs are off-limits.)
    if current_user.role == "guest":
        return [current_user.id]
    guests = db.query(User).filter(User.associated_user_id == current_user.id).all()
    return [current_user.id] + [g.id for g in guests]

def _job_access_allowed(job: dict, current_user, session_id, db) -> bool:
    if current_user:
        if job.get("user_id") in _allowed_job_owner_ids(current_user, db):
            return True
    #: the session_id branch may ONLY release anonymous guest jobs (user_id is None).
    # Otherwise a session_id shared in the browser leaks the jobs (incl. logs) of another
    # or previously logged-in user to the current viewer.
    job_session = job.get("session_id")
    if session_id and job_session and session_id == job_session and job.get("user_id") is None:
        return True
    return False


@app.get("/api/jobs")
def list_jobs(
    request: Request,
    session_id: Optional[str] = None,
    current_user: Optional[User] = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    if getattr(request.state, "is_api_token", False):
        if "read_logs" not in getattr(request.state, "api_token_scopes", []):
            raise HTTPException(status_code=403, detail="Fehlender Scope: read_logs")

    jobs = load_jobs()
    sorted_jobs = sorted(jobs.values(), key=lambda x: x["created_at"], reverse=True)

    # Apply user/session isolation filter (: guests only their own jobs)
    if current_user:
        allowed_ids = _allowed_job_owner_ids(current_user, db)
        #: the session_id match may only add anonymous guest jobs (user_id is None)
        # (e.g. a run started as a guest before login). Without the user_id constraint
        # a shared browser session_id leaks foreign/old user jobs into the same list.
        sorted_jobs = [j for j in sorted_jobs if j.get("user_id") in allowed_ids or (session_id and j.get("session_id") == session_id and j.get("user_id") is None)]
    elif session_id:
        #: anonymous viewers see exclusively real guest jobs. This way the same
        # browser session_id no longer shows the jobs of the previous, logged-in user after a logout.
        sorted_jobs = [j for j in sorted_jobs if j.get("session_id") == session_id and j.get("user_id") is None]
    else:
        # Anonymous users without session_id see nothing
        sorted_jobs = []

    for j in sorted_jobs:
        j["progress"] = get_job_progress(j)

    return sorted_jobs


@app.get("/api/jobs/{job_id}")
def get_job(
    job_id: str,
    request: Request,
    session_id: Optional[str] = None,
    current_user: Optional[User] = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    if getattr(request.state, "is_api_token", False):
        if "read_logs" not in getattr(request.state, "api_token_scopes", []):
            raise HTTPException(status_code=403, detail="Fehlender Scope: read_logs")

    jobs = load_jobs()
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = jobs[job_id]

    if not _job_access_allowed(job, current_user, session_id, db):
        raise HTTPException(status_code=403, detail="Kein Zugriff auf diesen Job.")

    job["progress"] = get_job_progress(job)
    return job

@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(
    job_id: str,
    request: Request,
    session_id: Optional[str] = None,
    current_user: Optional[User] = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    # : cancel a running or still-waiting execution. Also reachable via API token
    # (path /api/jobs*); then requires the run_playbook scope (whoever may run may cancel).
    if getattr(request.state, "is_api_token", False):
        if "run_playbook" not in getattr(request.state, "api_token_scopes", []):
            raise HTTPException(status_code=403, detail="Fehlender Scope: run_playbook")

    jobs = load_jobs()
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = jobs[job_id]

    # Access as with the read endpoints; additionally an admin may cancel any job (system administration).
    is_admin = bool(current_user and current_user.role == "admin")
    if not is_admin and not _job_access_allowed(job, current_user, session_id, db):
        raise HTTPException(status_code=403, detail="Kein Zugriff auf diesen Job.")

    if job.get("status") not in ("pending", "running"):
        raise HTTPException(status_code=409, detail="Job ist bereits beendet.")

    # Flag the cancellation (covers the queue/spawn window) and terminate a running process if any.
    with active_runs_lock:
        cancel_requested.add(job_id)
        entry = active_runs.get(job_id)
    if entry:
        _terminate_run_process(job_id, entry["process"], entry["is_custom"])
    # : terminal-state-safe – if the job naturally landed in the meantime (success/failed),
    # that status wins; final is the actually persisted status.
    final = update_job_status(job_id, "canceled", datetime.now().isoformat()) or "canceled"

    if final == "canceled":
        # Append the cancellation marker to the log + audit – only if the cancellation actually took effect.
        try:
            with open(os.path.join(LOGS_DIR, f"{job_id}.log"), "a", encoding="utf-8") as _lf:
                _lf.write(f"\n=== Vom Benutzer abgebrochen am {datetime.now().isoformat()} ===\n")
        except Exception:
            pass
        # Team audit (only for authenticated users; anonymous runs have no team context).
        if current_user:
            try:
                write_team_audit(db, current_user, "playbook.cancel", job_id,
                                 {"job_id": job_id, "target": job.get("target_host")}, _client_ip(request))
            except Exception:
                pass

    return {"job_id": job_id, "status": final}

@app.get("/api/jobs/{job_id}/logs")
async def get_job_logs(
    job_id: str,
    request: Request,
    session_id: Optional[str] = None,
    offset: int = 0,
    current_user: Optional[User] = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    if getattr(request.state, "is_api_token", False):
        if "read_logs" not in getattr(request.state, "api_token_scopes", []):
            raise HTTPException(status_code=403, detail="Fehlender Scope: read_logs")

    jobs = load_jobs()
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = jobs[job_id]

    if not _job_access_allowed(job, current_user, session_id, db):
        raise HTTPException(status_code=403, detail="Kein Zugriff auf die Logs dieses Jobs.")

    log_file_path = os.path.join(LOGS_DIR, f"{job_id}.log")
    #: reconnect support – the client can resume reading from a byte offset (only real
    # log-file bytes, without heartbeats), so that after a connection drop nothing is duplicated/missing.
    start_offset = max(0, offset)

    #: heartbeat sentinel (NUL byte). When idle (a playbook without output) the stream
    # would otherwise send nothing for minutes -> proxy/browser drop the idle connection after a few
    # seconds ("NetworkError"). The client filters the NUL bytes back out (display + offset).
    HEARTBEAT_SECS = 5.0

    async def log_generator():
        # Send a byte immediately so that header + stream arrive at the client right away (some
        # proxies buffer until the first byte) and the connection is "active" from the start.
        yield b"\x00"
        # Wait for the log file (up to 5s) – with heartbeats so the connection does not die idle.
        waited = 0.0
        while not os.path.exists(log_file_path):
            if waited >= 5.0:
                yield b"Log file not found or waiting to start...\n"
                return
            await asyncio.sleep(0.5)
            waited += 0.5
            yield b"\x00"

        # Binary mode: reliable seek() to a byte offset (text-mode seek is limited).
        with open(log_file_path, "rb") as f:
            if start_offset > 0:
                try:
                    f.seek(min(start_offset, os.path.getsize(log_file_path)))
                except Exception:
                    pass
            idle = 0.0
            while True:
                line = f.readline()
                if line:
                    idle = 0.0
                    yield line
                else:
                    # Check if job is still active
                    current_jobs = load_jobs()
                    job_status = current_jobs.get(job_id, {}).get("status", "failed")
                    if job_status in ["pending", "running"]:
                        await asyncio.sleep(0.5)
                        idle += 0.5
                        if idle >= HEARTBEAT_SECS:
                            idle = 0.0
                            yield b"\x00"   # keep-alive when idle
                    else:
                        # Read remainder
                        remaining = f.read()
                        if remaining:
                            yield remaining
                        break

    # : live streaming – raw text stays (the frontend reader appends RAW chunks,
    # hence NO text/event-stream/SSE). Anti-buffering headers + heartbeats ensure the
    # chunks are passed through immediately (nginx has proxy_buffering off) and the connection is
    # not dropped when idle. The generator flushes line by line (log file flushed live, :1536).
    return StreamingResponse(
        log_generator(),
        media_type="text/plain",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ===========================================================================
# Open-Core App-Factory & Edition-Discovery
# ===========================================================================
def register_extensions(registry: ExtensionRegistry) -> ExtensionRegistry:
    """Dock the active edition onto the registry (open-core seam).

    Contract: an edition extension provides ``register(registry)`` and sets its
    hooks in it (``add_router`` / ``add_startup`` / ``add_maintenance`` as well as, from,
    the entitlement/limits providers).

    : The billing still lives in-tree; it registers itself here (only
    ``EDITION == "cloud"``) once the seam is in place in.  replaces this
    stub with entry-point discovery (``importlib.metadata``, group
    ``ansimate.editions``). Community/On-Premise dock NOTHING -> no-op.
    """
    # Open-Core: Edition-Extensions ausschliesslich ueber Entry-Points der Gruppe
    # 'ansimate.editions' (importlib.metadata). Community/On-Premise laden nichts.
    _discover_edition_extensions(registry)
    return registry


def _discover_edition_extensions(registry) -> int:
    """: discover editions via entry points (group 'ansimate.editions') and
    call their register(registry). NO `if EDITION` decides the
    billing presence here - only the installation of the edition package. Returns the number of loaded
    extensions."""
    try:
        from importlib.metadata import entry_points
    except Exception:
        return 0
    try:
        eps = entry_points()
        group = eps.select(group="ansimate.editions") if hasattr(eps, "select") else eps.get("ansimate.editions", [])
    except Exception:
        group = []
    count = 0
    for ep in group:
        try:
            ep.load()(registry)
            count += 1
        except Exception as e:
            print(f"[editions] Laden der Extension {getattr(ep, 'name', '?')} fehlgeschlagen: {e}")
    return count


def create_app() -> FastAPI:
    """Open-core app factory.

    Returns the fully configured FastAPI app: the core routes (bound to ``app`` via
    decorator) plus the edition routers docked on via the registry. The
    ASGI entry point stays ``main:app`` unchanged; ``create_app()`` serves as a
    documented, testable entry point and as the target design for packaging.
    """
    return app


# Dock the active edition and mount its routers. In Community/On-Premise the
# registry is empty -> mount_routers is a no-op and the behavior stays identical.
register_extensions(registry)
# : set the active EntitlementProvider. Default by build edition; an
# edition extension (cloud billing) can set it via registry.entitlement_provider.
entitlements.set_entitlement_provider(registry.entitlement_provider or entitlements.select_default_provider(EDITION))
# : set the active LimitsProvider. Core default without tariffs; the
# cloud billing extension sets its tariff-driven provider via the registry.
limits.set_limits_provider(registry.limits_provider or limits.default_limits_provider())
registry.mount_routers(app)
