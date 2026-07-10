"""Open-Core entitlement seam.

Der ``EntitlementProvider`` kapselt ALLE Premium-/Abo-Entscheidungen, damit der Core
keine editionsabhaengigen Inline-Checks (``EDITION == ...``) mehr in seinen Gates traegt.
Editionen docken ihren Provider ueber die ExtensionRegistry an
(``registry.set_entitlement_provider``); ist keiner registriert, waehlt der Core anhand
der Build-Edition einen Default:

  * community  -> CommunityEntitlementProvider: alles frei, ABER Premium-Playbooks werden
                  weder aufgelistet noch ausgefuehrt (nicht Teil der Auslieferung).
  * onpremise  -> OpenEntitlementProvider: alles frei, Premium-Playbooks laufen ohne Abo.
  * cloud      -> CloudEntitlementProvider: Abo-/Trial-gesteuert.  ersetzt diesen ueber
                  die Registry durch den Stripe-gestuetzten Provider.

Open-Core-Regel: Dieses Modul importiert KEINEN proprietaeren Code (kein ``stripe``). Es
liest ausschliesslich Felder des Core-User-Modells (duck-typed, ohne ``models`` zu
importieren -> kein Import-Zyklus).
"""
from abc import ABC, abstractmethod

from edition import EDITION


class EntitlementProvider(ABC):
    """Vertrag fuer Premium-/Abo-Entscheidungen."""

    @abstractmethod
    def is_active(self, user, db=None) -> bool:
        """Hat ``user`` eine aktive Berechtigung (Abo/Trial bzw. editionsbedingt frei)?"""

    @abstractmethod
    def can_run_premium(self, user, rel_pb, canon_base, db=None) -> bool:
        """Darf ``user`` das als premium markierte Playbook (rel_pb/canon_base) ausfuehren?"""

    def hides_premium_in_catalog(self) -> bool:
        """True, wenn Premium-Playbooks in dieser Edition gar nicht aufgelistet werden."""
        return False

    def premium_denied_message(self, user, rel_pb, canon_base, db=None) -> str:
        """Fehlertext fuer den 403, wenn ``can_run_premium`` False ist (editionsspezifisch)."""
        return "Premium-Playbooks erfordern ein aktives Abonnement."




class CommunityEntitlementProvider(EntitlementProvider):
    """Community: alle (Nicht-Premium-)Features frei, aber Premium-Playbooks sind nicht
    Teil der Community-Auslieferung -> weder gelistet noch ausfuehrbar.

: erbt direkt von EntitlementProvider (nicht von OpenEntitlementProvider), da der
    On-Premise-Provider in der Community-Edition entfernt wird -> is_active hier eigenstaendig
    (in der Community ist alles frei)."""

    def is_active(self, user, db=None) -> bool:
        return True

    def can_run_premium(self, user, rel_pb, canon_base, db=None) -> bool:
        return False

    def hides_premium_in_catalog(self) -> bool:
        return True

    def premium_denied_message(self, user, rel_pb, canon_base, db=None) -> str:
        return "Premium-Playbooks sind in der Community-Edition nicht verfuegbar."




def select_default_provider(edition: str) -> EntitlementProvider:
    """Core-Default-Provider anhand der Build-Edition (kein proprietaerer Code)."""
    if edition == "community":
        return CommunityEntitlementProvider()


# Aktiver Provider. Default nach Build-Edition; per ``set_entitlement_provider``
# (z. B. durch die Cloud-Billing-Extension in) ueberschreibbar.
_active_provider: EntitlementProvider = select_default_provider(EDITION)


def get_entitlement_provider() -> EntitlementProvider:
    return _active_provider


def set_entitlement_provider(provider) -> None:
    global _active_provider
    if provider is not None:
        _active_provider = provider
