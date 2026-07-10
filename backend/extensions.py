"""Open-Core extension seam.

Editionen (z. B. die Cloud-Billing-Funktionen) docken sich ueber diese Registry an
den Core an, OHNE dass der Core sie kennt oder importiert. Das ist die zentrale Naht
fuer das Open-Core-Modell:

  * Der Core (Community/On-Premise) laeuft mit den No-Op-/Open-Defaults und enthaelt
    keinerlei proprietaeren Code.
  * Eine Edition-Extension stellt eine Funktion ``register(registry)`` bereit, die
    Hooks setzt. In  liegt das Billing noch in-tree und ruft ``register`` selbst auf
    (siehe ``register_extensions`` in main.py); ab  werden Extensions per
    ``importlib.metadata``-Entry-Point (Gruppe ``ansimate.editions``) entdeckt.

Hook-Typen:
  * ``add_router(router)``      - ein ``fastapi.APIRouter``, der via ``include_router``
                                  gemountet wird (Edition-spezifische Routen, z. B. Billing).
  * ``add_startup(fn)``         - ``fn()`` wird beim FastAPI-Startup ausgefuehrt.
  * ``add_maintenance(fn)``     - ``fn(db, now)`` wird in jedem stuendlichen Cron-Zyklus
                                  ausgefuehrt (z. B. Abo-Downgrade).

Die Provider-Schnittstellen (Entitlement/Limits) werden in ergaenzt.

WICHTIG: Dieses Modul importiert bewusst KEINE schweren oder proprietaeren Pakete
(kein fastapi-Import auf Modulebene, kein stripe), damit der Core es ueberall sauber
laden kann.
"""
from typing import Callable, List


class ExtensionRegistry:
    """Sammelt die von Editionen beigesteuerten Hooks und stellt sie dem Core bereit.

    Eine einzelne Instanz wird in main.py erzeugt und an ``register(registry)`` der
    aktiven Edition uebergeben. Der Core liest die gesammelten Hooks an genau drei
    Stellen aus: App-Aufbau (Router), Startup-Event und Cron-Wartung.
    """

    def __init__(self) -> None:
        self._routers: List[object] = []
        self._startup_hooks: List[Callable[[], None]] = []
        self._maintenance_hooks: List[Callable[..., None]] = []
        # Provider-Naht: von einer Edition gesetzte Provider; None -> Core-Default.
        self.entitlement_provider = None
        self.limits_provider = None
        # : Billing-Statusbericht (z. B. Stripe-Verbindung) fuers Admin-Panel.
        self.status_provider = None

    # --- Registrierungs-Hooks (von Editionen aufgerufen) ------------------------------
    def add_router(self, router: object) -> None:
        """Einen APIRouter registrieren; wird beim App-Aufbau via include_router gemountet."""
        self._routers.append(router)

    def add_startup(self, fn: Callable[[], None]) -> None:
        """Eine Startup-Funktion ``fn()`` registrieren (laeuft im FastAPI-Startup-Event)."""
        self._startup_hooks.append(fn)

    def add_maintenance(self, fn: Callable[..., None]) -> None:
        """Eine Wartungsfunktion ``fn(db, now)`` registrieren (laeuft im stuendlichen Cron)."""
        self._maintenance_hooks.append(fn)

    def set_entitlement_provider(self, provider) -> None:
        """Den EntitlementProvider der Edition setzen. None -> Core-Default bleibt."""
        self.entitlement_provider = provider

    def set_limits_provider(self, provider) -> None:
        """Den LimitsProvider der Edition setzen. None -> Core-Default bleibt."""
        self.limits_provider = provider

    def set_status_provider(self, fn) -> None:
        """Eine Billing-Statusfunktion ``fn() -> dict`` registrieren (Admin-Panel)."""
        self.status_provider = fn


    # --- Zugriff durch den Core -------------------------------------------------------
    def mount_routers(self, app) -> None:
        """Alle registrierten Edition-Router in die App einhaengen."""
        for router in self._routers:
            app.include_router(router)

    def run_startup(self) -> None:
        """Registrierte Startup-Hooks ausfuehren. Ein Fehler in einer Edition darf den
        Core-Start nicht verhindern -> pro Hook gekapselt."""
        for fn in self._startup_hooks:
            try:
                fn()
            except Exception as e:  # pragma: no cover - defensiv
                print(f"[extensions] Startup-Hook {getattr(fn, '__name__', fn)} fehlgeschlagen: {e}")

    def run_maintenance(self, db, now) -> None:
        """Registrierte Wartungs-Hooks im Cron-Zyklus ausfuehren. Pro Hook gekapselt,
        damit der Fehler einer Edition die Core-Wartung nicht abbricht."""
        for fn in self._maintenance_hooks:
            try:
                fn(db, now)
            except Exception as e:  # pragma: no cover - defensiv
                print(f"[extensions] Maintenance-Hook {getattr(fn, '__name__', fn)} fehlgeschlagen: {e}")
