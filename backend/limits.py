"""Open-Core limits seam.

The ``LimitsProvider`` encapsulates the computation of the effective resource limits, so that
the core no longer hard-wires any tariff/billing-dependent logic. Editions set their
provider via the ExtensionRegistry (``registry.set_limits_provider``); if none is
registered, the core chooses:

  * community / onpremise -> CoreLimitsProvider: user override -> global settings
                             (no tariff; devices unlimited). This is the current
                             behavior without tariffs.
  * cloud                 -> TariffLimitsProvider: additionally tariff-driven limits.
                             The tariff resolver (``_active_tariff``) is injected by
                             the core so that this module does NOT import any billing
                             models.  moves the tariff provider into the
                             billing package.

Open-Core rule: no proprietary import. Settings are read lazily via the core model
``Setting``; tariffs exclusively via the injected resolver.
"""
from abc import ABC, abstractmethod


def _global_int_setting(db, key: str, default: int) -> int:
    """Read a global integer setting (fallback = default). Identical to the previous
    core logic; Setting is imported lazily to avoid import cycles."""
    from models import Setting
    s = db.query(Setting).filter(Setting.key == key).first()
    if s and s.value and str(s.value).strip().isdigit():
        return int(s.value)
    return default


class LimitsProvider(ABC):
    """Contract for effective resource limits."""

    @abstractmethod
    def effective_storage_quota_mb(self, user, db) -> int: ...

    @abstractmethod
    def effective_max_custom_playbooks(self, user, db) -> int: ...

    @abstractmethod
    def effective_max_guest_accounts(self, user, db) -> int: ...

    @abstractmethod
    def effective_max_devices(self, user, db):
        """None = unlimited."""




#: Community fallback for the limits seam. The tariff-less CoreLimitsProvider is
# Enterprise-only (see above) and is removed in the Community export; the Community still needs
# a valid provider. It is a single admin without tariffs/quotas -> everything unlimited
# (devices without an upper bound; storage/guest/custom-playbook limits don't exist in the
# Community anyway). Reads only global settings, does NOT access Enterprise user columns.
class CommunityLimitsProvider(LimitsProvider):
    """Community: no tariffs/quotas, everything unlimited (single admin)."""

    def effective_storage_quota_mb(self, user, db) -> int:
        return _global_int_setting(db, "storage_quota_mb", 100)

    def effective_max_custom_playbooks(self, user, db) -> int:
        return _global_int_setting(db, "max_custom_playbooks", 50)

    def effective_max_guest_accounts(self, user, db) -> int:
        return _global_int_setting(db, "max_guest_accounts", 3)

    def effective_max_devices(self, user, db):
        return None  # no upper bound


# : The tariff-driven provider (user override -> tariff -> settings) now lives in the
# billing package (editions/billing: BillingLimitsProvider) and is set in the cloud edition via
# the registry. The core knows only the tariff-free CoreLimitsProvider.


#: Default provider per edition. Cloud/On-Premise use the tariff-less CoreLimitsProvider
# (Cloud overrides it at runtime via the registry with the tariff provider); the Community uses
# the CommunityLimitsProvider, since CoreLimitsProvider is stripped out there.
def default_limits_provider() -> LimitsProvider:
    return CommunityLimitsProvider()


# Active provider. An edition extension can override it via the registry.
_active_provider: LimitsProvider = default_limits_provider()


def get_limits_provider() -> LimitsProvider:
    return _active_provider


def set_limits_provider(provider) -> None:
    global _active_provider
    if provider is not None:
        _active_provider = provider
