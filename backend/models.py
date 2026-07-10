import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, BigInteger, Boolean, DateTime, Numeric
from database import Base

class Setting(Base):
    __tablename__ = "settings"
    key = Column(String, primary_key=True, index=True)
    value = Column(String, nullable=False)

# : periodische Statistik-Snapshots fuer die Dashboard-Verlaufsgraphen.
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
    # : optionale Webhook-URL fuer Status-Benachrichtigungen (Slack/Teams/Discord).
    webhook_url = Column(String, nullable=True)
    two_factor_enabled = Column(Boolean, default=False, nullable=False)
    # Default True: bestehende Konten, Admin-Bootstrap und Gaeste gelten als verifiziert.
    # Nur die Selbstregistrierung setzt dies bei aktivierter Verifikation explizit auf False.
    email_verified = Column(Boolean, default=True, nullable=False)
    
    
    # Collaboration / Guest Accounts
    associated_user_id = Column(String, nullable=True, index=True)
    #: pro Gast vom Besitzer entzogene Playbooks (JSON-Liste von Playbook-Pfaden)
    revoked_playbooks = Column(String, default="[]", nullable=False)
    # : pro Gast explizit freigegebene Premium-Standard-Playbooks (JSON-Liste).
    # Premium-Playbooks sind fuer Gaeste standardmaessig unsichtbar; nur explizit
    # freigegebene werden angezeigt/ausfuehrbar (Opt-in, Gegenstueck zu revoked_playbooks).
    shared_premium_playbooks = Column(String, default="[]", nullable=False)


    # Pro-Nutzer-Limit-Overrides (NULL = globaler Standard aus Settings)
    storage_quota_mb = Column(Integer, nullable=True)
    max_custom_playbooks = Column(Integer, nullable=True)
    max_guest_accounts = Column(Integer, nullable=True)


    def is_subscription_active(self, db=None) -> bool:
        # : Entscheidung delegiert an den aktiven EntitlementProvider, damit das
        # Core-Modell keine editionsabhaengige Logik mehr traegt. Default-Provider nach
        # Build-Edition (Open/Community/Cloud); die Cloud-Billing-Extension haengt in 
        # ihren Stripe-Provider an. Lazy-Import vermeidet einen Import-Zyklus.
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
    #: optionales Sudo-/Become-Passwort (getrennt vom SSH-Credential). Ermoeglicht
    # Privilege-Escalation auch bei Key-Auth bzw. wenn das Sudo-Passwort != SSH-Passwort ist.
    encrypted_become_credential = Column(String, nullable=True)
    # (Device-Flatten): Geraete-Freigabe an Team-Gaeste. Ein Geraet = genau ein Host;
    # die frueher fuer Freigaben zustaendige 1er-DeviceGroup entfaellt -> guest_access zieht
    # direkt aufs Device (JSON-Liste freigegebener Gast-User-IDs).
    guest_access = Column(String, default="[]", nullable=False)
    # (Device-Flatten): pro-Geraet Run-Kontext, frueher an der 1er-DeviceGroup gehalten.
    base_directory = Column(String, nullable=True)   # Deployment-Zielverzeichnis auf dem Host
    timezone = Column(String, nullable=True)          # Zeitzone fuer Container/Playbooks
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
    playbooks = Column(String, default="[]", nullable=False)   # JSON-Liste
    target_host = Column(String, nullable=True)
    username = Column(String, nullable=True)
    created_at = Column(String, nullable=True)   # ISO-String (lexikografisch sortierbar, wie bisher)
    finished_at = Column(String, nullable=True)
    session_id = Column(String, nullable=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    variables = Column(String, nullable=True)    # JSON
    progress = Column(String, nullable=True)     # JSON (nur fuer Endzustaende gespeichert)


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
    """: revisionssicheres Aktivitaetsprotokoll auf Team-Ebene. Erfasst, WER
    (actor) WANN (created_at) WAS (action/target) mit welchen DETAILS in einem Team
    (team_user_id = besitzender Account) getan hat - z. B. Playbook-Ausfuehrung,
    Geraete-Gruppe erstellt/geloescht, Freigabe erteilt/entzogen. Einsehbar fuer den
    Team-Admin (den besitzenden Account). Append-only: ein DB-Trigger verhindert jegliches
    UPDATE/DELETE, sodass das Protokoll nicht nachtraeglich manipuliert werden kann.
    Bewusst getrennt vom systemweiten audit_log (Admin-Governance)."""
    __tablename__ = "team_audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    team_user_id = Column(String, nullable=False, index=True)   # besitzender Account (Team)
    actor_id = Column(String, nullable=True)                    # ausfuehrender Nutzer (ggf. Gast)
    actor_name = Column(String, nullable=True)                  # Snapshot Username/E-Mail
    action = Column(String, nullable=False)                     # z. B. "playbook.run"
    target_name = Column(String, nullable=True)                 # z. B. Gruppen-/Playbook-Name
    details = Column(String, nullable=True)                     # JSON: Ziel-IPs, Variablen, ...
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)




# (Device-Flatten): Die frueheren Geraete-Gruppen (DeviceGroup) sind entfallen. Ein "Gerät"
# ist jetzt genau ein Host (Device); Multi-Host laeuft ueber die device_ids-Auswahl an Szenario/
# Preset. Die alte Tabelle device_groups bleibt auf bestehenden Installationen inert erhalten (wird
# von der einmaligen Startup-Migration nur noch gelesen) und auf frischen Installationen gar nicht
# mehr angelegt.


class CustomPreset(Base):
    """: benutzerdefiniertes Preset = wiederverwendbares Deployment-Szenario
    (feste Playbooks + Standard-Variablen + optionale Geraete-Gruppe mit IPs/SSH). Der
    Besitzer kann es mit Team-Mitgliedern (Gaesten) teilen; pro Mitglied gilt eine
    Berechtigung: 'strict' (nur ausfuehren wie hinterlegt) oder 'flexible' (Werte vor der
    Ausfuehrung anpassbar). Das Ausfuehren ist eine Premium-Funktion (Punkt 4)."""
    __tablename__ = "custom_presets"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)  # Besitzer
    name = Column(String, nullable=False)
    playbook_ids = Column(String, default="[]", nullable=False)   # JSON-Liste Playbook-IDs
    variables = Column(String, default="{}", nullable=False)       # JSON-Objekt Standard-Variablen
    # (Device-Flatten): Zielgeraete direkt als JSON-Liste von Device-IDs (Multi-Host via
    # Checkbox-Auswahl), ersetzt die frühere optionale device_group_id-Verknuepfung.
    device_ids = Column(String, default="[]", nullable=False)
    # JSON-Liste: [{"guest_id": "...", "permission": "strict"|"flexible"}]
    shares = Column(String, default="[]", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Scenario(Base):
    """: Szenario = ein gespeichertes Preset (Rezept: Playbooks + Variablen) fest mit
    Zielgeraeten verknuepft. Der Szenarios-Tab fuehrt es per 1-Klick aus (Run mit
    custom_preset_id + device_ids) ohne den Ausfuehren-Dialog. Eigene Tabelle, damit Presets
    (geraete-lose Rezepte) und Geraete sauber getrennt bleiben; per Base.metadata.create_all
    beim Start automatisch angelegt."""
    __tablename__ = "scenarios"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)  # Besitzer
    name = Column(String, nullable=False)
    preset_id = Column(String, nullable=False)          # logischer Verweis CustomPreset.id
    # (Device-Flatten): ein oder mehrere Zielgeraete als JSON-Liste von Device-IDs
    # (Multi-Host via Checkbox-Auswahl). Leere Liste = geraeteloses Szenario; das Geraet wird
    # dann beim Ausfuehren einmalig im Credentials-Dialog eingegeben (nicht persistiert).
    device_ids = Column(String, default="[]", nullable=False)
    # : teilbar wie Presets — JSON-Liste [{"guest_id": "...", "permission": "strict"|"flexible"}]
    shares = Column(String, default="[]", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)













