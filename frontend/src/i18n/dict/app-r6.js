// : app.js Region 6 (~5638–6497).
// Presets (renderPresetsList/dialog/shares) + admin dashboard (renderAdminStats:
// tiles/KPI/chart axis titles) + IP bans. Namespaces "preset" / "adminDash".
// Common buttons use common.* from core.js (common.edit/common.delete -> no entry here).
export default {
    de: {
        // --- Presets: empty states / errors ---
        "preset.loadError": "Netzwerkfehler beim Laden der Presets.",
        "preset.noPlaybooksAvail": "Keine Playbooks verfügbar.",
        "preset.noDevices": "Keine Geräte angelegt.",
        "preset.noTeamMembers": "Keine Teammitglieder vorhanden.",
        "preset.noPresets": "Keine Presets angelegt.",
        // --- Presets: sharing options / badges ---
        "preset.permStrict": "strikt (nur ausführen)",
        "preset.permFlexible": "flexibel (anpassbar)",
        "preset.sharedFlexible": "flexibel freigegeben",
        "preset.sharedStrict": "strikt freigegeben",
        "preset.share": "Freigeben",
        "preset.shareOne": "{count} Freigabe",
        "preset.shareMany": "{count} Freigaben",
        // --- Presets: form titles ---
        "preset.editTitle": "Preset bearbeiten",
        "preset.newTitle": "Neues Preset",
        // --- Presets: validation / result toasts ---
        "preset.nameRequired": "Bitte einen Preset-Namen eingeben.",
        "preset.selectPlaybook": "Bitte mindestens ein Playbook auswählen.",
        "preset.updated": "Preset aktualisiert.",
        "preset.created": "Preset erstellt.",
        "preset.saveFailed": "Speichern fehlgeschlagen.",
        "preset.saveError": "Netzwerkfehler beim Speichern.",
        // --- Presets: deletion ---
        "preset.deleteConfirmNamed": "Möchten Sie das Preset <b>{name}</b> wirklich löschen?",
        "preset.deleteConfirmGeneric": "Preset wirklich löschen?",
        "preset.deleteTitle": "Preset löschen?",
        "preset.deleted": "Preset gelöscht.",
        "preset.deleteFailed": "Löschen fehlgeschlagen.",
        "preset.deleteError": "Netzwerkfehler beim Löschen.",
        // --- Presets: run (launchPreset) ---
        "preset.noPlaybooksInPreset": "Dieses Preset hat keine Playbooks.",
        "preset.playbooksNotInCatalog": "Die Preset-Playbooks sind aktuell nicht im Katalog verfügbar.",
        "preset.playbooksUnavailable": "{count} Playbook(s) nicht verfügbar: {list}",
        "preset.strictSharedInfo": "Strikt freigegebenes Preset – die hinterlegten Werte sind fest.",
        // --- Admin dashboard: pie / timeline charts (legends / axes) ---
        "adminDash.pieActivePaid": "Aktiv (Paid)",
        "adminDash.pieActiveTrial": "Aktiv (Trial)",
        "adminDash.pieInactive": "Inaktiv",
        "adminDash.ipAuto": "Automatisch (Rate-Limit)",
        "adminDash.ipManual": "Manuell (Admin)",
        "adminDash.total": "Gesamt",
        "adminDash.ipBlocks": "IP-Sperren",
        "adminDash.storageMb": "Speicher (MB)",
        // --- Admin dashboard: loading / error states ---
        "adminDash.loadError": "Fehler beim Laden.",
        "adminDash.networkError": "Netzwerkfehler.",
        // --- Admin dashboard: status chips ---
        "adminDash.active": "aktiv",
        "adminDash.inactive": "inaktiv",
        "adminDash.configured": "konfiguriert",
        "adminDash.notConfigured": "nicht konfiguriert",
        "adminDash.on": "an",
        "adminDash.off": "aus",
        "adminDash.emailVerification": "E-Mail-Verifikation",
        // --- Admin dashboard: Stripe status texts ---
        "adminDash.error": "Fehler",
        "adminDash.stripeInactiveMock": "Inaktiv (Mock / keine Schlüssel)",
        "adminDash.stripeActiveLive": "Aktiv – Live",
        "adminDash.stripeLiveNoWebhook": "Live – Webhook fehlt",
        "adminDash.stripeActiveTest": "Aktiv – Test",
        "adminDash.stripeInactiveUnknown": "Inaktiv / unbekannt",
    },
    en: {
        // --- Presets: empty states / errors ---
        "preset.loadError": "Network error while loading presets.",
        "preset.noPlaybooksAvail": "No playbooks available.",
        "preset.noDevices": "No devices added.",
        "preset.noTeamMembers": "No team members yet.",
        "preset.noPresets": "No presets created.",
        // --- Presets: sharing options / badges ---
        "preset.permStrict": "strict (run only)",
        "preset.permFlexible": "flexible (adjustable)",
        "preset.sharedFlexible": "shared (flexible)",
        "preset.sharedStrict": "shared (strict)",
        "preset.share": "Share",
        "preset.shareOne": "{count} share",
        "preset.shareMany": "{count} shares",
        // --- Presets: form titles ---
        "preset.editTitle": "Edit preset",
        "preset.newTitle": "New preset",
        // --- Presets: validation / result toasts ---
        "preset.nameRequired": "Please enter a preset name.",
        "preset.selectPlaybook": "Please select at least one playbook.",
        "preset.updated": "Preset updated.",
        "preset.created": "Preset created.",
        "preset.saveFailed": "Save failed.",
        "preset.saveError": "Network error while saving.",
        // --- Presets: deletion ---
        "preset.deleteConfirmNamed": "Do you really want to delete the preset <b>{name}</b>?",
        "preset.deleteConfirmGeneric": "Really delete this preset?",
        "preset.deleteTitle": "Delete preset?",
        "preset.deleted": "Preset deleted.",
        "preset.deleteFailed": "Deletion failed.",
        "preset.deleteError": "Network error while deleting.",
        // --- Presets: run (launchPreset) ---
        "preset.noPlaybooksInPreset": "This preset has no playbooks.",
        "preset.playbooksNotInCatalog": "The preset's playbooks are currently not available in the catalog.",
        "preset.playbooksUnavailable": "{count} playbook(s) unavailable: {list}",
        "preset.strictSharedInfo": "Strictly shared preset – the stored values are fixed.",
        // --- Admin dashboard: pie / timeline charts (legends / axes) ---
        "adminDash.pieActivePaid": "Active (Paid)",
        "adminDash.pieActiveTrial": "Active (Trial)",
        "adminDash.pieInactive": "Inactive",
        "adminDash.ipAuto": "Automatic (rate limit)",
        "adminDash.ipManual": "Manual (admin)",
        "adminDash.total": "Total",
        "adminDash.ipBlocks": "IP blocks",
        "adminDash.storageMb": "Storage (MB)",
        // --- Admin dashboard: loading / error states ---
        "adminDash.loadError": "Failed to load.",
        "adminDash.networkError": "Network error.",
        // --- Admin dashboard: status chips ---
        "adminDash.active": "active",
        "adminDash.inactive": "inactive",
        "adminDash.configured": "configured",
        "adminDash.notConfigured": "not configured",
        "adminDash.on": "on",
        "adminDash.off": "off",
        "adminDash.emailVerification": "Email verification",
        // --- Admin dashboard: Stripe status texts ---
        "adminDash.error": "Error",
        "adminDash.stripeInactiveMock": "Inactive (mock / no keys)",
        "adminDash.stripeActiveLive": "Active – Live",
        "adminDash.stripeLiveNoWebhook": "Live – webhook missing",
        "adminDash.stripeActiveTest": "Active – Test",
        "adminDash.stripeInactiveUnknown": "Inactive / unknown",
    },
};
