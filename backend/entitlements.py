"""Open-Core entitlement seam.

The ``EntitlementProvider`` encapsulates ALL premium/subscription decisions, so that the core
no longer carries edition-dependent inline checks (``EDITION == ...``) in its gates.
Editions attach their provider via the ExtensionRegistry
(``registry.set_entitlement_provider``); if none is registered, the core picks a default
based on the build edition:

  * community  -> CommunityEntitlementProvider: everything free, BUT premium playbooks are
                  neither listed nor executed (not part of the shipment).
  * onpremise  -> OpenEntitlementProvider: everything free, premium playbooks run without a subscription.
  * cloud      -> CloudEntitlementProvider: subscription/trial-driven.  replaces it via
                  the registry with the Stripe-backed provider.

Open-Core rule: This module imports NO proprietary code (no ``stripe``). It
reads only fields of the core user model (duck-typed, without importing ``models``
-> no import cycle).
"""
from abc import ABC, abstractmethod

from edition import EDITION


class EntitlementProvider(ABC):
    """Contract for premium/subscription decisions."""

    @abstractmethod
    def is_active(self, user, db=None) -> bool:
        """Does ``user`` have an active entitlement (subscription/trial or edition-based free)?"""

    @abstractmethod
    def can_run_premium(self, user, rel_pb, canon_base, db=None) -> bool:
        """May ``user`` run the playbook marked as premium (rel_pb/canon_base)?"""

    def hides_premium_in_catalog(self) -> bool:
        """True if premium playbooks are not listed at all in this edition."""
        return False

    def premium_denied_message(self, user, rel_pb, canon_base, db=None) -> str:
        """Error text for the 403 when ``can_run_premium`` is False (edition-specific)."""
        return "Premium-Playbooks erfordern ein aktives Abonnement."




class CommunityEntitlementProvider(EntitlementProvider):
    """Community: all (non-premium) features free, but premium playbooks are not
    part of the Community shipment -> neither listed nor runnable.

: inherits directly from EntitlementProvider (not from OpenEntitlementProvider), since the
    On-Premise provider is removed in the Community-Edition -> is_active is standalone here
    (in the Community everything is free)."""

    def is_active(self, user, db=None) -> bool:
        return True

    def can_run_premium(self, user, rel_pb, canon_base, db=None) -> bool:
        return False

    def hides_premium_in_catalog(self) -> bool:
        return True

    def premium_denied_message(self, user, rel_pb, canon_base, db=None) -> str:
        return "Premium-Playbooks sind in der Community-Edition nicht verfuegbar."




def select_default_provider(edition: str) -> EntitlementProvider:
    """Core default provider based on the build edition (no proprietary code)."""
    if edition == "community":
        return CommunityEntitlementProvider()


# Active provider. Default by build edition; overridable via ``set_entitlement_provider``
# (e.g. by the cloud billing extension in).
_active_provider: EntitlementProvider = select_default_provider(EDITION)


def get_entitlement_provider() -> EntitlementProvider:
    return _active_provider


def set_entitlement_provider(provider) -> None:
    global _active_provider
    if provider is not None:
        _active_provider = provider
