"""Open-Core extension seam.

Editions (e.g. the cloud billing features) attach to the core via this registry,
WITHOUT the core knowing or importing them. This is the central seam
for the Open-Core model:

  * The core (Community/On-Premise) runs with the No-Op/Open defaults and contains
    no proprietary code whatsoever.
  * An edition extension provides a function ``register(registry)`` that
    sets hooks. In  the billing still lives in-tree and calls ``register`` itself
    (see ``register_extensions`` in main.py); from  extensions are discovered via
    an ``importlib.metadata`` entry point (group ``ansimate.editions``).

Hook types:
  * ``add_router(router)``      - a ``fastapi.APIRouter`` that is mounted via
                                  ``include_router`` (edition-specific routes, e.g. billing).
  * ``add_startup(fn)``         - ``fn()`` is executed on FastAPI startup.
  * ``add_maintenance(fn)``     - ``fn(db, now)`` is executed in every hourly cron
                                  cycle (e.g. subscription downgrade).

The provider interfaces (Entitlement/Limits) are added in.

IMPORTANT: This module deliberately imports NO heavy or proprietary packages
(no fastapi import at module level, no stripe), so that the core can load it cleanly
everywhere.
"""
from typing import Callable, List


class ExtensionRegistry:
    """Collects the hooks contributed by editions and makes them available to the core.

    A single instance is created in main.py and passed to ``register(registry)`` of the
    active edition. The core reads the collected hooks in exactly three
    places: app assembly (routers), startup event and cron maintenance.
    """

    def __init__(self) -> None:
        self._routers: List[object] = []
        self._startup_hooks: List[Callable[[], None]] = []
        self._maintenance_hooks: List[Callable[..., None]] = []
        # Provider seam: providers set by an edition; None -> core default.
        self.entitlement_provider = None
        self.limits_provider = None
        # : billing status report (e.g. Stripe connection) for the admin panel.
        self.status_provider = None

    # --- Registration hooks (called by editions) --------------------------------------
    def add_router(self, router: object) -> None:
        """Register an APIRouter; mounted via include_router during app assembly."""
        self._routers.append(router)

    def add_startup(self, fn: Callable[[], None]) -> None:
        """Register a startup function ``fn()`` (runs in the FastAPI startup event)."""
        self._startup_hooks.append(fn)

    def add_maintenance(self, fn: Callable[..., None]) -> None:
        """Register a maintenance function ``fn(db, now)`` (runs in the hourly cron)."""
        self._maintenance_hooks.append(fn)

    def set_entitlement_provider(self, provider) -> None:
        """Set the edition's EntitlementProvider. None -> core default stays."""
        self.entitlement_provider = provider

    def set_limits_provider(self, provider) -> None:
        """Set the edition's LimitsProvider. None -> core default stays."""
        self.limits_provider = provider

    def set_status_provider(self, fn) -> None:
        """Register a billing status function ``fn() -> dict`` (admin panel)."""
        self.status_provider = fn


    # --- Access by the core -------------------------------------------------------------
    def mount_routers(self, app) -> None:
        """Mount all registered edition routers into the app."""
        for router in self._routers:
            app.include_router(router)

    def run_startup(self) -> None:
        """Run the registered startup hooks. An error in one edition must not
        prevent the core from starting -> each hook is wrapped."""
        for fn in self._startup_hooks:
            try:
                fn()
            except Exception as e:  # pragma: no cover - defensive
                print(f"[extensions] Startup-Hook {getattr(fn, '__name__', fn)} fehlgeschlagen: {e}")

    def run_maintenance(self, db, now) -> None:
        """Run the registered maintenance hooks in the cron cycle. Each hook is wrapped,
        so that an error in one edition does not abort the core maintenance."""
        for fn in self._maintenance_hooks:
            try:
                fn(db, now)
            except Exception as e:  # pragma: no cover - defensive
                print(f"[extensions] Maintenance-Hook {getattr(fn, '__name__', fn)} fehlgeschlagen: {e}")
