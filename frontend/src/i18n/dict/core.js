// : Kern-Woerterbuch (Header/Nav/Switcher/Profil + haeufige Buttons). Weitere Bereiche
// liefern eigene Dateien in diesem Ordner (dict/*.js) — index.js zieht sie automatisch ein
// (import.meta.glob), sodass parallele Content-Arbeit KEINE gemeinsame Datei anfassen muss.
// Konvention: flache, namespaced Keys ("nav.playbooks"); Werte stabil halten.
export default {
    de: {
        // Header / Logo
        "logo.subtext": "Remote App Installer for any Linux Host",
        "logo.homeTitle": "Zur Startseite",
        // Navigation
        "nav.playbooks": "Playbooks",
        "nav.vault": "My Vault",
        "nav.teams": "Teams",
        "nav.logs": "Logs",
        "nav.admin": "Admin",
        // Auth
        "auth.login": "Anmelden",
        "auth.register": "Registrieren",
        "auth.logout": "Abmelden",
        // Mobiles Menue
        "burger.open": "Menü öffnen",
        "drawer.menu": "Menü",
        "drawer.close": "Menü schließen",
        // Sprach-Switcher / Profil
        "lang.switch": "Sprache wechseln",
        "lang.menuLabel": "Sprache auswählen",
        "profile.appearance": "Darstellung",
        "profile.language.label": "Sprache",
        "profile.language.auto": "Automatisch (Browser)",
        // Landing / Playbooks (Ausschnitt — Rest in)
        "landing.searchPlaceholder": "Durchsuchen ...",
        "landing.run": "Ausführen",
        "landing.loading": "Lade Playbooks...",
        // Haeufige Buttons (gemeinsame Basis fuer die Content-Issues)
        "common.save": "Speichern",
        "common.cancel": "Abbrechen",
        "common.delete": "Löschen",
        "common.edit": "Bearbeiten",
        "common.close": "Schließen",
        "common.confirm": "Bestätigen",
    },
    en: {
        // Header / Logo
        "logo.subtext": "Remote App Installer for any Linux Host",
        "logo.homeTitle": "Go to homepage",
        // Navigation
        "nav.playbooks": "Playbooks",
        "nav.vault": "My Vault",
        "nav.teams": "Teams",
        "nav.logs": "Logs",
        "nav.admin": "Admin",
        // Auth
        "auth.login": "Sign in",
        "auth.register": "Sign up",
        "auth.logout": "Sign out",
        // Mobile menu
        "burger.open": "Open menu",
        "drawer.menu": "Menu",
        "drawer.close": "Close menu",
        // Language switcher / profile
        "lang.switch": "Switch language",
        "lang.menuLabel": "Select language",
        "profile.appearance": "Appearance",
        "profile.language.label": "Language",
        "profile.language.auto": "Automatic (browser)",
        // Landing / playbooks (excerpt — rest in)
        "landing.searchPlaceholder": "Search ...",
        "landing.run": "Run",
        "landing.loading": "Loading playbooks...",
        // Common buttons (shared base for the content issues)
        "common.save": "Save",
        "common.cancel": "Cancel",
        "common.delete": "Delete",
        "common.edit": "Edit",
        "common.close": "Close",
        "common.confirm": "Confirm",
    },
};
