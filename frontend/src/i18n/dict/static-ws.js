//  (Region 1): dictionary for the static main workspace / landing
// (config-card, guest-premium-hint, loading) as well as the My Vault card (tabs,
// info texts, empty states) and the FAB labels. Namespace: "ws.".
// Collected automatically by index.js via import.meta.glob.
// Convention: flat, namespaced keys; de value = original text, en value = translation.
export default {
    de: {
        // View toggle (playbook list)
        "ws.viewGrid": "Kachelansicht",
        "ws.viewList": "Listenansicht",
        // Guest premium hint
        "ws.guestPremiumActive": "Premium-Modus aktiv (bereitgestellt durch Host-Konto)",
        // My Vault tab labels
        "ws.tabScenarios": "Szenarios",
        "ws.tabPresets": "Presets",
        "ws.tabDevices": "Geräte",
        // Tab: Custom playbooks
        "ws.ownPlaybooks": "Eigene Playbooks",
        "ws.customPlaybooksInfo1": "Eigene Ansible-Playbooks (YAML) hochladen. Voraussetzungen: ",
        "ws.customPlaybooksInfo2": " auf oberster Ebene, sensible Werte mit ",
        "ws.customPlaybooksInfo3": ". Die Ausführung erfolgt in einer isolierten Docker-Sandbox.",
        "ws.noCustomPlaybooks": "Keine eigenen Playbooks hochgeladen.",
        "ws.downloadExamplePlaybook": "Beispiel-Playbook herunterladen",
        // Tab: Devices
        "ws.devices": "Geräte",
        "ws.devicesDesc": "Verwalten Sie Ihre Geräte: hinterlegen Sie Verbindungsdaten und Standardwerte und geben Sie einzelne Geräte für Ihre Teammitglieder frei.",
        "ws.noDevices": "Keine Geräte angelegt.",
        // Tab: Custom presets
        "ws.ownPresets": "Eigene Presets",
        "ws.presetsDesc1": "Wiederverwendbare Deployment-Szenarien aus festen Playbooks, Standard-Variablen und einer optionalen Geräte-Gruppe. Teilbar mit Team-Mitgliedern – pro Mitglied ",
        "ws.presetsStrict": "strikt",
        "ws.presetsDesc2": " (nur ausführen) oder ",
        "ws.presetsFlexible": "flexibel",
        "ws.presetsDesc3": " (Werte anpassbar). Das Ausführen erfordert eine aktive Premium-Laufzeit.",
        "ws.noPresets": "Keine Presets angelegt.",
        // Tab: Scenarios
        "ws.scenarios": "Szenarios",
        "ws.scenariosDesc": 'Ein Szenario verknüpft ein Preset (Playbooks + Einstellungen) fest mit einem Zielgerät und lässt sich – wie Presets – mit Team-Mitgliedern teilen. Ausführen per Klick im Startseiten-Abschnitt „Szenarios".',
        "ws.scenarioEmptyHint1": "Für Szenarien benötigst du mindestens ein ",
        "ws.scenarioEmptyPreset": "Preset",
        "ws.scenarioEmptyHint2": " und ein ",
        "ws.scenarioEmptyDevice": "Gerät",
        "ws.scenarioEmptyHint3": '. Lege diese zuerst in den Tabs „Presets" und „Geräte" an.',
        "ws.noScenarios": "Keine Szenarien angelegt.",
        // FAB labels (static default; app.js overrides per active tab)
        "ws.fabAdd": "Hinzufügen",
        "ws.fabCreate": "Erstellen",
    },
    en: {
        // View toggle (playbook list)
        "ws.viewGrid": "Tile view",
        "ws.viewList": "List view",
        // Guest premium hint
        "ws.guestPremiumActive": "Premium mode active (provided by host account)",
        // My Vault tab labels
        "ws.tabScenarios": "Scenarios",
        "ws.tabPresets": "Presets",
        "ws.tabDevices": "Devices",
        // Tab: Custom playbooks
        "ws.ownPlaybooks": "Custom Playbooks",
        "ws.customPlaybooksInfo1": "Upload your own Ansible playbooks (YAML). Requirements: ",
        "ws.customPlaybooksInfo2": " at the top level, sensitive values with ",
        "ws.customPlaybooksInfo3": ". Execution takes place in an isolated Docker sandbox.",
        "ws.noCustomPlaybooks": "No custom playbooks uploaded.",
        "ws.downloadExamplePlaybook": "Download example playbook",
        // Tab: Devices
        "ws.devices": "Devices",
        "ws.devicesDesc": "Manage your devices: store connection details and default values, and share individual devices with your team members.",
        "ws.noDevices": "No devices created.",
        // Tab: Custom presets
        "ws.ownPresets": "Custom Presets",
        "ws.presetsDesc1": "Reusable deployment scenarios built from fixed playbooks, default variables, and an optional device group. Shareable with team members – per member ",
        "ws.presetsStrict": "strict",
        "ws.presetsDesc2": " (run only) or ",
        "ws.presetsFlexible": "flexible",
        "ws.presetsDesc3": " (values adjustable). Running requires an active premium runtime.",
        "ws.noPresets": "No presets created.",
        // Tab: Scenarios
        "ws.scenarios": "Scenarios",
        "ws.scenariosDesc": 'A scenario permanently links a preset (playbooks + settings) to a target device and can be shared with team members – just like presets. Run it with a click in the "Scenarios" section on the home page.',
        "ws.scenarioEmptyHint1": "For scenarios you need at least a ",
        "ws.scenarioEmptyPreset": "preset",
        "ws.scenarioEmptyHint2": " and a ",
        "ws.scenarioEmptyDevice": "device",
        "ws.scenarioEmptyHint3": '. Create these first in the "Presets" and "Devices" tabs.',
        "ws.noScenarios": "No scenarios created.",
        // FAB labels (static default; app.js overrides per active tab)
        "ws.fabAdd": "Add",
        "ws.fabCreate": "Create",
    },
};
