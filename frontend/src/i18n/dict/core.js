// : core dictionary (header/nav/switcher/profile + common buttons). Other areas
// provide their own files in this folder (dict/*.js) — index.js pulls them in automatically
// (import.meta.glob), so parallel content work does NOT have to touch a shared file.
// Convention: flat, namespaced keys ("nav.playbooks"); keep values stable.
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
        // Mobile menu
        "burger.open": "Menü öffnen",
        "drawer.menu": "Menü",
        "drawer.close": "Menü schließen",
        // Language switcher / profile
        "lang.switch": "Sprache wechseln",
        "lang.menuLabel": "Sprache auswählen",
        "profile.appearance": "Darstellung",
        "profile.language.label": "Sprache",
        "profile.language.auto": "Automatisch (Browser)",
        // Landing / playbooks (excerpt — rest in)
        "landing.searchPlaceholder": "Durchsuchen ...",
        "landing.run": "Ausführen",
        "landing.loading": "Lade Playbooks...",
        // Common buttons (shared base for the content issues)
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
