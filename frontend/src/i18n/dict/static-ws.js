//  (Region 1): Woerterbuch fuer den statischen Haupt-Workspace / Landing
// (config-card, guest-premium-hint, loading) sowie die My-Vault-Karte (Tabs,
// Infotexte, Leerzustaende) und die FAB-Labels. Namespace: "ws.".
// Wird von index.js automatisch via import.meta.glob eingesammelt.
// Konvention: flache, namespaced Keys; de-Wert = Originaltext, en-Wert = Uebersetzung.
export default {
    de: {
        // Ansichts-Umschalter (Playbook-Liste)
        "ws.viewGrid": "Kachelansicht",
        "ws.viewList": "Listenansicht",
        // Gast-Premium-Hinweis
        "ws.guestPremiumActive": "Premium-Modus aktiv (bereitgestellt durch Host-Konto)",
        // My-Vault Tab-Beschriftungen
        "ws.tabScenarios": "Szenarios",
        "ws.tabPresets": "Presets",
        "ws.tabDevices": "Geräte",
        // Tab: Eigene Playbooks
        "ws.ownPlaybooks": "Eigene Playbooks",
        "ws.customPlaybooksInfo1": "Eigene Ansible-Playbooks (YAML) hochladen. Voraussetzungen: ",
        "ws.customPlaybooksInfo2": " auf oberster Ebene, sensible Werte mit ",
        "ws.customPlaybooksInfo3": ". Die Ausführung erfolgt in einer isolierten Docker-Sandbox.",
        "ws.noCustomPlaybooks": "Keine eigenen Playbooks hochgeladen.",
        "ws.downloadExamplePlaybook": "Beispiel-Playbook herunterladen",
        // Tab: Geräte
        "ws.devices": "Geräte",
        "ws.devicesDesc": "Verwalten Sie Ihre Geräte: hinterlegen Sie Verbindungsdaten und Standardwerte und geben Sie einzelne Geräte für Ihre Teammitglieder frei.",
        "ws.noDevices": "Keine Geräte angelegt.",
        // Tab: Eigene Presets
        "ws.ownPresets": "Eigene Presets",
        "ws.presetsDesc1": "Wiederverwendbare Deployment-Szenarien aus festen Playbooks, Standard-Variablen und einer optionalen Geräte-Gruppe. Teilbar mit Team-Mitgliedern – pro Mitglied ",
        "ws.presetsStrict": "strikt",
        "ws.presetsDesc2": " (nur ausführen) oder ",
        "ws.presetsFlexible": "flexibel",
        "ws.presetsDesc3": " (Werte anpassbar). Das Ausführen erfordert eine aktive Premium-Laufzeit.",
        "ws.noPresets": "Keine Presets angelegt.",
        // Tab: Szenarios
        "ws.scenarios": "Szenarios",
        "ws.scenariosDesc": 'Ein Szenario verknüpft ein Preset (Playbooks + Einstellungen) fest mit einem Zielgerät und lässt sich – wie Presets – mit Team-Mitgliedern teilen. Ausführen per Klick im Startseiten-Abschnitt „Szenarios".',
        "ws.scenarioEmptyHint1": "Für Szenarien benötigst du mindestens ein ",
        "ws.scenarioEmptyPreset": "Preset",
        "ws.scenarioEmptyHint2": " und ein ",
        "ws.scenarioEmptyDevice": "Gerät",
        "ws.scenarioEmptyHint3": '. Lege diese zuerst in den Tabs „Presets" und „Geräte" an.',
        "ws.noScenarios": "Keine Szenarien angelegt.",
        // FAB-Labels (statische Vorgabe; app.js ueberschreibt je aktivem Tab)
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
