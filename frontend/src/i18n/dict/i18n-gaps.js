// Nachtrag: übersehene Beschriftungen (Log-Konsole, Passwort-Anforderungen, Admin-Export-Dialog,
// Szenario-/Profil-Meldungen) + Playbook-Katalog-Kategorien. index.js zieht diese Datei automatisch
// ein (import.meta.glob). Konvention: flache, namespaced Keys; Werte stabil halten.
export default {
    de: {
        // Log-/Ausführungs-Konsole
        "job.hostHistory": "Historie für diesen Host",
        "job.copyLogs": "Logs kopieren",
        "job.toggleAutoscroll": "Autoscroll umschalten",
        "job.cancelExec": "Ausführung abbrechen",
        // Passwort-Anforderungen (Profil → Passwort ändern)
        "site.pwReqLength": "Mindestens 8 Zeichen",
        "site.pwReqUpper": "Mindestens 1 Großbuchstabe",
        "site.pwReqNumber": "Mindestens 1 Ziffer",
        // Admin: Protokoll-Export-Dialog
        "adm.export.title": "Protokolle exportieren",
        "adm.export.intro": "Wählen Sie die zu exportierenden Protokolle und das Format.",
        "adm.export.security": "Ungewöhnliche Aktivitäten",
        "adm.export.audit": "Audit-Log",
        "adm.export.go": "Exportieren",
        // Admin: Schnellaktions-Buttons (FAB)
        "adm.fabSaveConfig": "Einstellungen speichern",
        "adm.fabIpBlock": "IP-Sperre hinzufügen",
        // Profil-Aktualisierung
        "misc.profileUpdateFailed": "Profil-Update fehlgeschlagen.",
        "misc.profileUpdateNetErr": "Netzwerkfehler beim Aktualisieren des Profils.",
        // Szenarien
        "scenario.loadNetErr": "Netzwerkfehler beim Laden der Szenarien.",
        "scenario.noPreset": "— kein Preset vorhanden —",
        "scenario.deviceOnRun": "beim Ausführen festlegen",
        // Katalog-Kategorie-Filter
        "catalog.filterByCategory": "Nach Kategorie filtern",
        "catalog.filterMenuLabel": "Kategorie-Filter",
        "catalog.filterClear": "Zurücksetzen",
        // Playbook-Katalog-Kategorien (Gruppen-Header). Der deutsche Wert aus index.yml bleibt der
        // stabile Gruppier-Schlüssel; nur die Anzeige wird übersetzt (catLabel() in app.js).
        "catalog.cat.system": "System",
        "catalog.cat.netsec": "Netzwerk Sicherheit",
        "catalog.cat.gaming": "Gaming",
        "catalog.cat.productivity": "Produktivität",
        "catalog.cat.development": "Entwicklung",
        "catalog.cat.files": "Dateiverwaltung",
        "catalog.cat.multimedia": "Multimedia",
        "catalog.cat.runtime": "Laufzeitumgebung",
        "catalog.cat.communication": "Kommunikation",
        "catalog.cat.browser": "Browser",
        "catalog.cat.network": "Netzwerk",
        "catalog.cat.graphics": "Grafik",
        "catalog.cat.smarthome": "Smart Home",
        "catalog.cat.other": "Sonstige",
    },
    en: {
        // Log/execution console
        "job.hostHistory": "History for this host",
        "job.copyLogs": "Copy logs",
        "job.toggleAutoscroll": "Toggle auto-scroll",
        "job.cancelExec": "Cancel execution",
        // Password requirements (Profile → Change password)
        "site.pwReqLength": "At least 8 characters",
        "site.pwReqUpper": "At least 1 uppercase letter",
        "site.pwReqNumber": "At least 1 digit",
        // Admin: log export dialog
        "adm.export.title": "Export logs",
        "adm.export.intro": "Select the logs to export and the format.",
        "adm.export.security": "Unusual activity",
        "adm.export.audit": "Audit log",
        "adm.export.go": "Export",
        // Admin: quick-action buttons (FAB)
        "adm.fabSaveConfig": "Save settings",
        "adm.fabIpBlock": "Add IP block",
        // Profile update
        "misc.profileUpdateFailed": "Profile update failed.",
        "misc.profileUpdateNetErr": "Network error while updating the profile.",
        // Scenarios
        "scenario.loadNetErr": "Network error while loading scenarios.",
        "scenario.noPreset": "— no preset available —",
        "scenario.deviceOnRun": "set at run time",
        // Catalog category filter
        "catalog.filterByCategory": "Filter by category",
        "catalog.filterMenuLabel": "Category filter",
        "catalog.filterClear": "Reset",
        // Playbook catalog categories (group headers). The German value from index.yml stays the
        // stable grouping key; only the display is translated (catLabel() in app.js).
        "catalog.cat.system": "System",
        "catalog.cat.netsec": "Network Security",
        "catalog.cat.gaming": "Gaming",
        "catalog.cat.productivity": "Productivity",
        "catalog.cat.development": "Development",
        "catalog.cat.files": "File Management",
        "catalog.cat.multimedia": "Multimedia",
        "catalog.cat.runtime": "Runtime Environment",
        "catalog.cat.communication": "Communication",
        "catalog.cat.browser": "Browser",
        "catalog.cat.network": "Network",
        "catalog.cat.graphics": "Graphics",
        "catalog.cat.smarthome": "Smart Home",
        "catalog.cat.other": "Other",
    },
};
