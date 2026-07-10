import os
import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_INSECURE_DEV_FALLBACK = "ansimate_dev_fallback_secret_key_change_me"

def _resolve_key_source() -> str:
    key_source = os.environ.get("ENCRYPTION_KEY") or os.environ.get("SECRET_KEY")
    if key_source:
        return key_source
    # Fail-closed: kein im Quellcode hinterlegter Standardschluessel in Produktion.
    if os.environ.get("ALLOW_INSECURE_CRYPTO", "false").lower() == "true":
        return _INSECURE_DEV_FALLBACK
    raise RuntimeError(
        "ENCRYPTION_KEY (oder SECRET_KEY) ist nicht gesetzt. Aus Sicherheitsgruenden wird "
        "kein Standardschluessel verwendet. Bitte einen starken Schluessel setzen "
        "(oder ALLOW_INSECURE_CRYPTO=true nur fuer lokale Entwicklung)."
    )

def get_aesgcm_key() -> bytes:
    return hashlib.sha256(_resolve_key_source().encode()).digest()

def encrypt_credential(plain_text: str) -> str:
    if not plain_text:
        return ""
    key = get_aesgcm_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plain_text.encode(), None)
    combined = nonce + ciphertext
    b64_str = base64.b64encode(combined).decode()
    return f"aesgcm:{b64_str}"

def get_fernet():
    from cryptography.fernet import Fernet
    enc_key = os.environ.get("ENCRYPTION_KEY")
    if not enc_key:
        secret = os.environ.get("SECRET_KEY")
        if not secret:
            secret = _resolve_key_source()  # fail-closed bzw. Dev-Fallback
        derived_key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
        return Fernet(derived_key)
    try:
        return Fernet(enc_key.encode())
    except Exception:
        derived_key = base64.urlsafe_b64encode(hashlib.sha256(enc_key.encode()).digest())
        return Fernet(derived_key)

def decrypt_credential(cipher_text: str) -> str:
    if not cipher_text:
        return ""

    if cipher_text.startswith("aesgcm:"):
        try:
            b64_str = cipher_text[7:]
            combined = base64.b64decode(b64_str.encode())
            if len(combined) < 12:
                raise ValueError("Invalid AESGCM payload length")
            nonce = combined[:12]
            ciphertext = combined[12:]
            key = get_aesgcm_key()
            aesgcm = AESGCM(key)
            return aesgcm.decrypt(nonce, ciphertext, None).decode()
        except Exception as e:
            print(f"AESGCM decryption failed: {e}. Trying Fernet fallback.")

    # Fallback to Fernet decryption
    try:
        fernet = get_fernet()
        clean_cipher = cipher_text[7:] if cipher_text.startswith("aesgcm:") else cipher_text
        return fernet.decrypt(clean_cipher.encode()).decode()
    except Exception as e:
        print(f"Fernet decryption fallback failed: {e}")
        raise e
