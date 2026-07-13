"""Central version number of Ansimate.

Single source of truth for the backend/API version. Bumped at release TOGETHER with
frontend/package.json (see the release process in CHANGELOG.md). The value is emitted in
the FastAPI app (openapi info.version) and at the /api/version endpoint (all
editions).
"""

APP_VERSION = "0.4.4"
