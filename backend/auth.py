import bcrypt
import os
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session as DBSession
from models import User, Session

SESSION_EXPIRY_DAYS = int(os.environ.get("SESSION_EXPIRY_DAYS", "14"))

def get_password_hash(password: str) -> str:
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'), 
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False

def create_user_session(db: DBSession, user_id: str, ip: str = None, ua: str = None) -> Session:
    expires_at = datetime.utcnow() + timedelta(days=SESSION_EXPIRY_DAYS)
    session = Session(
        user_id=user_id,
        expires_at=expires_at,
        ip_address=ip,
        user_agent=ua
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

def verify_session(db: DBSession, session_id: str) -> Optional[User]:
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        return None
    
    if session.expires_at < datetime.utcnow():
        # Clean up expired session
        db.delete(session)
        db.commit()
        return None
        
    user = db.query(User).filter(User.id == session.user_id).first()
    if not user or not user.is_active:
        return None

    #: ein Gast wird abgelehnt, wenn sein Hauptaccount fehlt oder deaktiviert ist
    if user.role == "guest":
        if not user.associated_user_id:
            return None
        parent = db.query(User).filter(User.id == user.associated_user_id).first()
        if not parent or not parent.is_active:
            return None

    return user

def delete_session(db: DBSession, session_id: str):
    session = db.query(Session).filter(Session.id == session_id).first()
    if session:
        db.delete(session)
        db.commit()
