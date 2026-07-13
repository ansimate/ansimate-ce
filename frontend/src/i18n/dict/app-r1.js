// : app.js Region 1 (Boot/Navigation/Routing/Editions/Landing/renderPlaybooks).
// Namespaces "core" / "nav". Auto-loaded via dict/*.js (import.meta.glob). Keep values stable.
// Common buttons (common.*) and header/nav (nav.*/auth.*) live in core.js -> don't duplicate here.
export default {
    de: {
        // Edition-dependent vault tab descriptions (community override in applyEditionRules)
        "core.vaultDevicesDescCommunity": "Verwalten Sie Ihre Geräte: hinterlegen Sie Verbindungsdaten und Standardwerte für die Ausführung von Playbooks.",
        "core.vaultScenariosDescCommunity": "Ein Szenario verknüpft ein Preset (Playbooks + Einstellungen) fest mit einem Zielgerät. Ausführen per Klick im Startseiten-Abschnitt „Szenarios“.",
        // Footer
        "nav.projectWebsite": "Projekt-Webseite",
        // Legal texts / agent instructions (load fallbacks)
        "core.legalInfoTitle": "Rechtliche Informationen",
        "core.legalLoadError": "Die rechtlichen Informationen konnten nicht geladen werden.",
        "core.llmLoadError": "Die Agent-Anleitung konnte nicht geladen werden.",
        // Toasts: copy / file / token
        "core.logsCopied": "Protokolle in Zwischenablage kopiert!",
        "core.copyFailed": "Kopieren fehlgeschlagen.",
        "core.noFileSelected": "Keine Datei ausgewählt",
        "core.tokenCopied": "Token in die Zwischenablage kopiert!",
        "core.copyFailedManual": "Kopieren fehlgeschlagen — bitte manuell markieren.",
        // Playbook list / renderPlaybooks (empty states, headers, badges, toasts)
        "core.playbooksLoadError": "Fehler beim Laden der Playbooks",
        "core.requires": "Erfordert:",
        "core.premiumBadgeTitle": "Premium-Playbook",
        "core.showVendor": "Hersteller anzeigen",
        "core.vendorDialogTitle": "Hersteller-Informationen — {name}",
        "core.noPlaybooksOrPresets": "Keine Playbooks oder Presets gefunden.",
        "core.scenariosHeader": "Szenarios",
        "core.sharedFlexible": "flexibel freigegeben",
        "core.sharedStrict": "strikt freigegeben",
        "core.availablePresets": "Verfügbare Presets",
        "core.presetModules": "Module: {names}",
        "core.availablePlaybooks": "Verfügbare Playbooks",
        "core.noSearchResults": "Keine Treffer für „{term}\".",
        "core.dependencyAutoSelected": "Abhängigkeit '{name}' wurde automatisch ausgewählt.",
        "core.selectAtLeastOne": "Bitte wähle mindestens ein Playbook aus!",
        "core.loginToRun": "Bitte melden Sie sich an oder registrieren Sie sich, um Playbooks auszuführen.",
    },
    en: {
        // Edition-specific vault tab descriptions (community override in applyEditionRules)
        "core.vaultDevicesDescCommunity": "Manage your devices: store connection details and default values for running playbooks.",
        "core.vaultScenariosDescCommunity": "A scenario firmly links a preset (playbooks + settings) to a target device. Run it with a click in the “Scenarios” section on the home page.",
        // Footer
        "nav.projectWebsite": "Project website",
        // Legal texts / agent instructions (load fallbacks)
        "core.legalInfoTitle": "Legal information",
        "core.legalLoadError": "The legal information could not be loaded.",
        "core.llmLoadError": "The agent instructions could not be loaded.",
        // Toasts: copy / file / token
        "core.logsCopied": "Logs copied to clipboard!",
        "core.copyFailed": "Copy failed.",
        "core.noFileSelected": "No file selected",
        "core.tokenCopied": "Token copied to clipboard!",
        "core.copyFailedManual": "Copy failed — please select manually.",
        // Playbook list / renderPlaybooks (empty states, headers, badges, toasts)
        "core.playbooksLoadError": "Error loading playbooks",
        "core.requires": "Requires:",
        "core.premiumBadgeTitle": "Premium playbook",
        "core.showVendor": "Show vendor",
        "core.vendorDialogTitle": "Vendor information — {name}",
        "core.noPlaybooksOrPresets": "No playbooks or presets found.",
        "core.scenariosHeader": "Scenarios",
        "core.sharedFlexible": "shared flexibly",
        "core.sharedStrict": "shared strictly",
        "core.availablePresets": "Available presets",
        "core.presetModules": "Modules: {names}",
        "core.availablePlaybooks": "Available playbooks",
        "core.noSearchResults": "No matches for \"{term}\".",
        "core.dependencyAutoSelected": "Dependency '{name}' was selected automatically.",
        "core.selectAtLeastOne": "Please select at least one playbook!",
        "core.loginToRun": "Please sign in or register to run playbooks.",
    },
};
