import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, BigInteger, Boolean, DateTime, Numeric
from database import Base

class Setting(Base):
    __tablename__ = "settings"
    key = Column(String, primary_key=True, index=True)
    value = Column(String, nullable=False)

# : periodic statistics snapshots for the dashboard history graphs.
class StatsSnapshot(Base):
    __tablename__ = "stats_snapshots"
    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    total_users = Column(Integer, default=0, nullable=False)
    inactive = Column(Integer, default=0, nullable=False)
    ip_blocks_total = Column(Integer, default=0, nullable=False)
    ip_blocks_auto = Column(Integer, default=0, nullable=False)
    ip_blocks_manual = Column(Integer, default=0, nullable=False)
    playbook_storage_bytes = Column(BigInteger, default=0, nullable=False)

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="user", nullable=False)  # admin, user, guest
    tier = Column(String, default="free", nullable=False)  # free, pro
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    agb_accepted_at = Column(DateTime, nullable=True)
    agb_version = Column(String, default="1.0", nullable=False)
    dsgvo_accepted_at = Column(DateTime, nullable=True)
    dsgvo_version = Column(String, default="1.0", nullable=False)
    avv_accepted_at = Column(DateTime, nullable=True)
    avv_company = Column(String, nullable=True)
    avv_representative = Column(String, nullable=True)
    avv_version = Column(String, nullable=True)
    deletion_pending_at = Column(DateTime, nullable=True)
    email_notifications_enabled = Column(Boolean, default=False, nullable=False)
    # : optional webhook URL for status notifications (Slack/Teams/Discord).
    webhook_url = Column(String, nullable=True)
    two_factor_enabled = Column(Boolean, default=False, nullable=False)
    # Default True: existing accounts, admin bootstrap and guests count as verified.
    # Only self-registration explicitly sets this to False when verification is enabled.
    email_verified = Column(Boolean, default=True, nullable=False)
    # : preferred UI language (de|en). NULL = automatic (browser detection applies).
    # Core feature (NOT an edition marker) — account-bound, cross-device, Community too.
    language = Column(String(5), nullable=True)

    
    # Collaboration / Guest Accounts
    associated_user_id = Column(String, nullable=True, index=True)
    #: playbooks revoked per guest by the owner (JSON list of playbook paths)
    revoked_playbooks = Column(String, default="[]", nullable=False)
    # : premium standard playbooks explicitly shared per guest (JSON list).
    # Premium playbooks are hidden from guests by default; only explicitly
    # shared ones are shown/runnable (opt-in, counterpart to revoked_playbooks).
    shared_premium_playbooks = Column(String, default="[]", nullable=False)


    # Per-user limit overrides (NULL = global default from Settings)
    storage_quota_mb = Column(Integer, nullable=True)
    max_custom_playbooks = Column(Integer, nullable=True)
    max_guest_accounts = Column(Integer, nullable=True)


    def is_subscription_active(self, db=None) -> bool:
        # : decision delegated to the active EntitlementProvider so that the
        # core model no longer carries edition-dependent logic. Default provider by
        # build edition (Open/Community/Cloud); the cloud billing extension attaches its
        # Stripe provider in . Lazy import avoids an import cycle.
        from entitlements import get_entitlement_provider
        return get_entitlement_provider().is_active(self, db)



class IPBlock(Base):
    __tablename__ = "ip_blocks"
    ip = Column(String, primary_key=True, index=True)
    reason = Column(String, nullable=False)
    blocked_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True)  # Null means permanent

class IPBlockHistory(Base):
    __tablename__ = "ip_block_history"
    id = Column(Integer, primary_key=True, autoincrement=True)
    ip = Column(String, nullable=False, index=True)
    reason = Column(String, nullable=False)
    blocked_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    released_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    release_method = Column(String, nullable=False)  # auto, manual

class Session(Base):
    __tablename__ = "sessions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)

class OTP(Base):
    __tablename__ = "otps"
    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String, nullable=False, index=True)
    otp_code = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)

class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    email = Column(String, primary_key=True, index=True)
    failed_attempts = Column(Integer, default=0, nullable=False)
    last_attempt_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    locked_until = Column(DateTime, nullable=True)

class Device(Base):
    __tablename__ = "devices"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    host = Column(String, nullable=False)
    username = Column(String, nullable=True)
    port = Column(Integer, default=22, nullable=False)
    encrypted_credential = Column(String, nullable=True)
    credential_type = Column(String, nullable=True)  # "password" or "key"
    #: optional sudo/become password (separate from the SSH credential). Enables
    # privilege escalation even with key auth or when the sudo password != SSH password.
    encrypted_become_credential = Column(String, nullable=True)
    # (Device-Flatten): device sharing with team guests. One device = exactly one host;
    # the single-member DeviceGroup formerly responsible for sharing is gone -> guest_access applies
    # directly to the device (JSON list of shared guest user IDs).
    guest_access = Column(String, default="[]", nullable=False)
    # (Device-Flatten): per-device run context, formerly held on the single-member DeviceGroup.
    base_directory = Column(String, nullable=True)   # Deployment target directory on the host
    timezone = Column(String, nullable=True)          # Timezone for containers/playbooks
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class APIToken(Base):
    __tablename__ = "api_tokens"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    token_hash = Column(String, unique=True, index=True, nullable=False)
    scopes = Column(String, default="", nullable=False)  # comma-separated: "run_playbook,read_logs"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True)


class Captcha(Base):
    __tablename__ = "captchas"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    answer = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)


class Job(Base):
    __tablename__ = "jobs"
    job_id = Column(String, primary_key=True)
    status = Column(String, default="pending", nullable=False)
    playbooks = Column(String, default="[]", nullable=False)   # JSON list
    target_host = Column(String, nullable=True)
    username = Column(String, nullable=True)
    created_at = Column(String, nullable=True)   # ISO string (lexicographically sortable, as before)
    finished_at = Column(String, nullable=True)
    session_id = Column(String, nullable=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    variables = Column(String, nullable=True)    # JSON
    progress = Column(String, nullable=True)     # JSON (only stored for final states)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    actor_id = Column(String, nullable=True)
    actor_name = Column(String, nullable=True)
    action = Column(String, nullable=False)
    target_name = Column(String, nullable=True)
    detail = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)


class TeamAuditLog(Base):
    """: tamper-proof activity log at team level. Records WHO
    (actor) WHEN (created_at) did WHAT (action/target) with which DETAILS in a team
    (team_user_id = owning account) - e.g. playbook execution,
    device group created/deleted, share granted/revoked. Visible to the
    team admin (the owning account). Append-only: a DB trigger prevents any
    UPDATE/DELETE, so the log cannot be tampered with after the fact.
    Deliberately kept separate from the system-wide audit_log (admin governance)."""
    __tablename__ = "team_audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    team_user_id = Column(String, nullable=False, index=True)   # owning account (team)
    actor_id = Column(String, nullable=True)                    # executing user (guest if applicable)
    actor_name = Column(String, nullable=True)                  # snapshot username/email
    action = Column(String, nullable=False)                     # e.g. "playbook.run"
    target_name = Column(String, nullable=True)                 # e.g. group/playbook name
    details = Column(String, nullable=True)                     # JSON: target IPs, variables, ...
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)




# (Device-Flatten): The former device groups (DeviceGroup) are gone. A "device"
# is now exactly one host (Device); multi-host runs via the device_ids selection on scenario/
# preset. The old device_groups table remains inert on existing installations (only read
# by the one-time startup migration) and is no longer created at all on fresh
# installations.


class CustomPreset(Base):
    """: user-defined preset = reusable deployment scenario
    (fixed playbooks + default variables + optional device group with IPs/SSH). The
    owner can share it with team members (guests); each member gets one
    permission: 'strict' (run only as stored) or 'flexible' (values adjustable before
    execution). Running it is a premium feature (item 4)."""
    __tablename__ = "custom_presets"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)  # owner
    name = Column(String, nullable=False)
    playbook_ids = Column(String, default="[]", nullable=False)   # JSON list of playbook IDs
    variables = Column(String, default="{}", nullable=False)       # JSON object of default variables
    # (Device-Flatten): target devices directly as a JSON list of device IDs (multi-host via
    # checkbox selection), replaces the former optional device_group_id link.
    device_ids = Column(String, default="[]", nullable=False)
    # JSON list: [{"guest_id": "...", "permission": "strict"|"flexible"}]
    shares = Column(String, default="[]", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Scenario(Base):
    """: scenario = a stored preset (recipe: playbooks + variables) firmly linked to
    target devices. The Scenarios tab runs it with one click (run with
    custom_preset_id + device_ids) without the run dialog. Own table, so presets
    (device-less recipes) and devices stay cleanly separated; created automatically
    at startup via Base.metadata.create_all."""
    __tablename__ = "scenarios"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)  # owner
    name = Column(String, nullable=False)
    preset_id = Column(String, nullable=False)          # logical reference to CustomPreset.id
    # (Device-Flatten): one or more target devices as a JSON list of device IDs
    # (multi-host via checkbox selection). Empty list = device-less scenario; the device is
    # then entered once in the credentials dialog at run time (not persisted).
    device_ids = Column(String, default="[]", nullable=False)
    # : shareable like presets — JSON list [{"guest_id": "...", "permission": "strict"|"flexible"}]
    shares = Column(String, default="[]", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)













