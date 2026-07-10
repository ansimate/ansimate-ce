"""Open-Core limits seam.

Der ``LimitsProvider`` kapselt die Berechnung der effektiven Ressourcenlimits, damit der
Core keine tarif-/billing-abhaengige Logik mehr fest verdrahtet. Editionen setzen ihren
Provider ueber die ExtensionRegistry (``registry.set_limits_provider``); ist keiner
registriert, waehlt der Core:

  * community / onpremise -> CoreLimitsProvider: User-Override -> globale Settings
                             (kein Tarif; Geraete unbegrenzt). Das ist das heutige
                             Verhalten ohne Tarife.
  * cloud                 -> TariffLimitsProvider: zusaetzlich tarifgesteuerte Limits.
                             Der Tarif-Resolver (``_active_tariff``) wird vom Core
                             injiziert, damit dieses Modul KEINE Billing-Modelle
                             importieren muss.  verschiebt den Tarif-Provider in das
                             Billing-Paket.

Open-Core-Regel: kein proprietaerer Import. Settings werden lazy ueber das Core-Modell
``Setting`` gelesen; Tarife ausschliesslich ueber den injizierten Resolver.
"""
from abc import ABC, abstractmethod


def _global_int_setting(db, key: str, default: int) -> int:
    """Globale Integer-Einstellung lesen (Fallback = default). Identisch zur bisherigen
    Core-Logik; Setting wird lazy importiert, um Import-Zyklen zu vermeiden."""
    from models import Setting
    s = db.query(Setting).filter(Setting.key == key).first()
    if s and s.value and str(s.value).strip().isdigit():
        return int(s.value)
    return default


class LimitsProvider(ABC):
    """Vertrag fuer effektive Ressourcenlimits."""

    @abstractmethod
    def effective_storage_quota_mb(self, user, db) -> int: ...

    @abstractmethod
    def effective_max_custom_playbooks(self, user, db) -> int: ...

    @abstractmethod
    def effective_max_guest_accounts(self, user, db) -> int: ...

    @abstractmethod
    def effective_max_devices(self, user, db):
        """None = unbegrenzt."""




#: Community-Fallback fuer die Limits-Seam. Der tariflose CoreLimitsProvider ist
# Enterprise-only (s. o.) und wird im Community-Export entfernt; die Community braucht dennoch
# einen gueltigen Provider. Sie ist Einzel-Admin ohne Tarife/Kontingente -> alles unbegrenzt
# (Geraete ohne Obergrenze; Storage-/Guest-/Custom-Playbook-Limits existieren in der Community
# ohnehin nicht). Liest nur globale Settings, greift NICHT auf Enterprise-User-Spalten zu.
class CommunityLimitsProvider(LimitsProvider):
    """Community: keine Tarife/Kontingente, alles unbegrenzt (Einzel-Admin)."""

    def effective_storage_quota_mb(self, user, db) -> int:
        return _global_int_setting(db, "storage_quota_mb", 100)

    def effective_max_custom_playbooks(self, user, db) -> int:
        return _global_int_setting(db, "max_custom_playbooks", 50)

    def effective_max_guest_accounts(self, user, db) -> int:
        return _global_int_setting(db, "max_guest_accounts", 3)

    def effective_max_devices(self, user, db):
        return None  # keine Obergrenze


# : Der tarifgesteuerte Provider (User-Override -> Tarif -> Settings) lebt jetzt im
# Billing-Paket (editions/billing: BillingLimitsProvider) und wird in der cloud-Edition ueber
# die Registry gesetzt. Der Core kennt nur den tariffreien CoreLimitsProvider.


#: Default-Provider je Edition. Cloud/On-Premise nutzen den tariflosen CoreLimitsProvider
# (Cloud ueberschreibt ihn zur Laufzeit via Registry mit dem Tarif-Provider); die Community nutzt
# den CommunityLimitsProvider, da CoreLimitsProvider dort weggestrippt ist.
def default_limits_provider() -> LimitsProvider:
    return CommunityLimitsProvider()


# Aktiver Provider. Eine Edition-Extension kann ihn via Registry ueberschreiben.
_active_provider: LimitsProvider = default_limits_provider()


def get_limits_provider() -> LimitsProvider:
    return _active_provider


def set_limits_provider(provider) -> None:
    global _active_provider
    if provider is not None:
        _active_provider = provider
