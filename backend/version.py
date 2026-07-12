"""Zentrale Versionsnummer von Ansimate.

Single Source of Truth fuer die Backend-/API-Version. Wird beim Release ZUSAMMEN mit
frontend/package.json angehoben (siehe Release-Prozess in CHANGELOG.md). Der Wert wird in
der FastAPI-App (openapi info.version) und im Endpunkt /api/version (alle Editionen)
ausgegeben.
"""

APP_VERSION = "0.4.4"
