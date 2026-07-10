import os
import time
from datetime import datetime, timedelta
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from database import SessionLocal
from models import IPBlock, IPBlockHistory, Setting

DEFAULT_GLOBAL_LIMIT = 60  # per minute
DEFAULT_USER_LIMIT = 120  # per minute
DEFAULT_BAN_DURATION = 86400  # 24 hours in seconds

# In-memory tracking lists
request_history = {}
violation_history = {}

#: Obergrenzen + periodische Bereinigung gegen unbegrenztes Dict-Wachstum (DoS)
MAX_TRACKED_KEYS = 50000
_last_state_cleanup = [0.0]  # Liste als veraenderbarer Container fuer den Zeitstempel

def _safe_int(value, default: int) -> int:
    #: nicht-numerische Settings duerfen die Middleware nicht zum Absturz bringen.
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default

def _prune_state(now_ts: float):
    # Entfernt Schluessel, deren Zeitstempel-Listen abgelaufen sind (lazy GC),
    # hoechstens einmal pro 60s. Verhindert unbegrenzten Speicherverbrauch.
    if now_ts - _last_state_cleanup[0] < 60:
        return
    _last_state_cleanup[0] = now_ts
    for key in list(request_history.keys()):
        request_history[key] = [t for t in request_history[key] if now_ts - t < 60]
        if not request_history[key]:
            del request_history[key]
    for ip in list(violation_history.keys()):
        violation_history[ip] = [t for t in violation_history[ip] if now_ts - t < 600]
        if not violation_history[ip]:
            del violation_history[ip]

def get_client_ip(request: Request) -> str:
    #: X-Real-IP wird von unserem nginx aus der echten Client-IP gesetzt
    # (proxy_set_header X-Real-IP $remote_addr; nginx ueberschreibt einen ggf. vom
    # Client mitgeschickten Header) und ist daher vertrauenswuerdig. Den linkesten
    # X-Forwarded-For-Eintrag NICHT mehr bevorzugen: er ist client-kontrolliert
    # (Traefik haengt die echte IP nur an, statt sie zu ueberschreiben), sodass ein
    # Angreifer sonst Bans umgehen oder fremde IPs gezielt sperren lassen koennte.
    real_ip = request.headers.get("X-Real-IP")
    if real_ip and is_valid_ip(real_ip.strip()):
        return real_ip.strip()
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"

def is_valid_ip(value: str) -> bool:
    import ipaddress
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False

def get_whitelist() -> set:
    whitelist_str = os.environ.get("RATE_LIMIT_WHITELIST", "127.0.0.1,::1")
    return {ip.strip() for ip in whitelist_str.split(",") if ip.strip()}

def get_manual_blacklist() -> set:
    blacklist_str = os.environ.get("IP_BLACKLIST", "")
    return {ip.strip() for ip in blacklist_str.split(",") if ip.strip()}

def get_db_setting(key: str, default_val: str) -> str:
    try:
        with SessionLocal() as db:
            setting = db.query(Setting).filter(Setting.key == key).first()
            if setting:
                return setting.value
    except Exception as e:
        print(f"Database error reading setting {key}: {e}")
    
    # Fallback to env
    env_key = key.upper()
    return os.environ.get(env_key, default_val)

def _ip_blocked_response(expires_at=None, reason=None) -> JSONResponse:
    #: Das Frontend zeigt einen Vollbild-Sperrbildschirm mit Countdown/Freigabezeit.
    # Dafuer expires_at (+ reason) mitgeben. expires_at ist eine naive UTC-datetime
    # (oder None = permanent) und wird als ISO-8601 mit 'Z'-Suffix (UTC) ausgeliefert,
    # damit der Browser sie korrekt als UTC interpretiert.
    return JSONResponse(
        status_code=403,
        content={
            "detail": "IP address is blocked.",
            "expires_at": (expires_at.isoformat() + "Z") if expires_at else None,
            "reason": reason,
        },
    )

class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        client_ip = get_client_ip(request)
        whitelist = get_whitelist()
        
        # 1. Whitelist bypass
        if client_ip in whitelist:
            return await call_next(request)
            
        # 2. Manual IP Blacklist check
        manual_blacklist = get_manual_blacklist()
        if client_ip in manual_blacklist:
            # Manuelle Blacklist (IP_BLACKLIST env): dauerhaft, kein Ablauf.
            return _ip_blocked_response(reason="Manuelle IP-Sperre")
            
        # 3. Database IP Block check & auto-release
        try:
            with SessionLocal() as db:
                block = db.query(IPBlock).filter(IPBlock.ip == client_ip).first()
                if block:
                    now = datetime.utcnow()
                    if block.expires_at and block.expires_at < now:
                        # Auto release expired ban
                        db.delete(block)
                        history_entry = IPBlockHistory(
                            ip=client_ip,
                            reason=block.reason,
                            blocked_at=block.blocked_at,
                            expires_at=block.expires_at,
                            released_at=now,
                            release_method="auto"
                        )
                        db.add(history_entry)
                        db.commit()
                    else:
                        # Still blocked -> mit Ablaufzeit/Grund fuer den Sperrbildschirm.
                        return _ip_blocked_response(expires_at=block.expires_at, reason=block.reason)
        except Exception as e:
            print(f"Error checking blocked IPs in middleware: {e}")
                    
        # 4. Rate Limiting Check
        user_id = None
        if hasattr(request.state, "user") and request.state.user:
            user_id = request.state.user.get("id")
            
        limit_key = f"user_{user_id}" if user_id else f"ip_{client_ip}"
        
        # Determine current limit (: robust gegen nicht-numerische Settings)
        if user_id:
            limit_val = _safe_int(get_db_setting("rate_limit_user_ip", str(DEFAULT_USER_LIMIT)), DEFAULT_USER_LIMIT)
        else:
            limit_val = _safe_int(get_db_setting("rate_limit_global_ip", str(DEFAULT_GLOBAL_LIMIT)), DEFAULT_GLOBAL_LIMIT)

        now_ts = time.time()

        #: periodische Bereinigung + harte Obergrenze gegen Memory-Exhaustion
        _prune_state(now_ts)
        if limit_key not in request_history and len(request_history) >= MAX_TRACKED_KEYS:
            # Tracking-Tabelle ist voll (vermutlich X-Forwarded-For-Flooding): neue,
            # noch unbekannte Schluessel nicht mehr anlegen, aber Request normal bedienen.
            return await call_next(request)

        # Initialize or clean history
        if limit_key not in request_history:
            request_history[limit_key] = []
        request_history[limit_key] = [t for t in request_history[limit_key] if now_ts - t < 60]
        
        if len(request_history[limit_key]) >= limit_val:
            # Rate limit exceeded! Record violation for dynamic ban
            if client_ip not in violation_history:
                violation_history[client_ip] = []
            violation_history[client_ip] = [t for t in violation_history[client_ip] if now_ts - t < 600]
            violation_history[client_ip].append(now_ts)
            
            # Check for dynamic ban (5 violations in 10 mins)
            if len(violation_history[client_ip]) >= 5 and is_valid_ip(client_ip):
                # Nur valide IPs persistieren (X-Forwarded-For ist spoofbar -> kein Stored-XSS/Muelldaten)
                ban_duration = _safe_int(get_db_setting("ip_ban_duration", str(DEFAULT_BAN_DURATION)), DEFAULT_BAN_DURATION)
                ban_expires = datetime.utcnow() + timedelta(seconds=ban_duration)

                try:
                    with SessionLocal() as db:
                        db_block = IPBlock(
                            ip=client_ip,
                            reason="Repeated rate-limit violations",
                            blocked_at=datetime.utcnow(),
                            expires_at=ban_expires
                        )
                        db.merge(db_block)
                        db.commit()
                    print(f"IP {client_ip} has been dynamically banned for {ban_duration} seconds.")
                except Exception as e:
                    print(f"Error dynamically banning IP {client_ip}: {e}")
                
                # Clear lists
                if limit_key in request_history:
                    del request_history[limit_key]
                if client_ip in violation_history:
                    del violation_history[client_ip]
                
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."}
            )
            
        request_history[limit_key].append(now_ts)
        return await call_next(request)

class SessionAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.user = None
        session_id = request.cookies.get("session_id")
        if session_id:
            from auth import verify_session
            try:
                with SessionLocal() as db:
                    user = verify_session(db, session_id)
                    if user:
                        request.state.user = {
                            "id": user.id,
                            "username": user.username,
                            "role": user.role,
                            "tier": user.tier
                        }
            except Exception as e:
                print(f"Error in SessionAuthMiddleware: {e}")
        return await call_next(request)
