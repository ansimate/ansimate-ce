//  (Region 4): dictionary for the static UI texts of the core dialogs in
// index.html — team/guest dialogs (create/edit/scenario share/activities),
// generic confirmation dialogs (discard/confirm), the run dialog
// (connection & authentication), the vendor info dialog, and the auth dialogs
// (login, forgot password, reset password, OTP, registration).
// Namespace: "dlgcore.". Common buttons/titles use the shared keys from core.js
// (common.* / auth.login / auth.register / common.confirm) and are not duplicated here.
// Admin/billing dialogs (log export, user creation, premium upsell, maintenance overlay)
// belong thematically to adm.* or dlgpay.* and stay out of this namespace.
// Collected automatically by index.js via import.meta.glob. de = original, en = translation.
export default {
    de: {
        // Common field labels (reused across guest/auth dialogs)
        "dlgcore.username": "Benutzername",
        "dlgcore.emailAddress": "E-Mail-Adresse",
        "dlgcore.password": "Passwort",
        "dlgcore.newPassword": "Neues Passwort",
        "dlgcore.confirmPassword": "Passwort bestätigen",
        "dlgcore.usernameOrEmail": "Benutzername oder E-Mail",
        "dlgcore.showPassword": "Passwort anzeigen",
        "dlgcore.pwMismatch": "Passwörter stimmen nicht überein.",
        "dlgcore.enterAnswer": "Antwort eingeben",
        "dlgcore.loadingShort": "Lade…",

        // guest-create-dialog
        "dlgcore.guestCreateTitle": "Neues Teammitglied anlegen",
        "dlgcore.guestCreateSubmit": "Teammitglied anlegen",

        // guest-edit-dialog
        "dlgcore.guestEditTitle": "Teammitglied bearbeiten",
        "dlgcore.guestEditPwHint": "Neues Passwort vergeben (optional – leer lassen, um es nicht zu ändern):",

        // guest-scenarios-dialog
        "dlgcore.guestScenariosTitle": "Szenarien freigeben",
        "dlgcore.guestScenariosP1": "Freigaben für",
        "dlgcore.guestScenariosP2": ". Aktivierte Szenarien kann das Teammitglied ausführen.",
        "dlgcore.saveShares": "Freigaben speichern",

        // guest-activity-dialog
        "dlgcore.activities": "Aktivitäten",
        "dlgcore.copyLogs": "Logs kopieren",
        "dlgcore.exportTxt": "Als .txt exportieren",
        "dlgcore.colTime": "Zeitpunkt",
        "dlgcore.colAction": "Aktion",
        "dlgcore.colTarget": "Ziel",
        "dlgcore.colDetails": "Details",

        // discard-confirm-dialog
        "dlgcore.discardTitle": "Dialog schließen?",
        "dlgcore.discardMsg": "Ungespeicherte Eingaben gehen verloren. Möchten Sie den Ausführen-Dialog wirklich schließen?",
        "dlgcore.keepEditing": "Weiter bearbeiten",
        "dlgcore.discardClose": "Verwerfen & schließen",

        // credentials-dialog (run)
        "dlgcore.credTitle": "Verbindung & Authentifizierung",
        "dlgcore.credDesc": "Gib das Zielgerät sowie die SSH-Zugangsdaten an:",
        "dlgcore.manualEntry": "-- Manuelle Eingabe --",
        "dlgcore.manageDevices": "Geräte verwalten",
        "dlgcore.targetHost": "Zielgerät (IP oder Hostname)",
        "dlgcore.targetHostHelp": "z. B. 192.168.1.50 oder webserver.local",
        "dlgcore.sshUsername": "SSH-Benutzername",
        "dlgcore.sshPassword": "SSH-Passwort",
        "dlgcore.sudoPasswordOptional": "Sudo-Passwort (optional)",
        "dlgcore.baseDir": "Basisverzeichnis (Standard: /home/<user>, /root für root)",
        "dlgcore.timezone": "Zeitzone (timezone)",
        "dlgcore.timezoneHelp": "z. B. Europe/Berlin",
        "dlgcore.osAutodetect": "Betriebssystem automatisch erkennen",
        "dlgcore.osFamily": "OS-Familie",
        "dlgcore.useTraefik": "Dienste über Traefik (Reverse Proxy) erreichbar machen",
        "dlgcore.routeMode": "Routing",
        "dlgcore.routeModeDomain": "Eigene (Sub-)Domain",
        "dlgcore.routeModeSubpath": "Subpfad einer Domain",
        "dlgcore.baseDomain": "Haupt-Domain / IP (für Subpfad)",
        "dlgcore.settingsForServices": "Einstellungen für aktivierte Dienste:",
        "dlgcore.presetName": "Preset-Name",
        "dlgcore.savePresetOnRun": "Beim „Ausführen starten“ zusätzlich als Preset speichern",
        "dlgcore.saveAsPresetOnly": "Nur als Preset speichern",
        "dlgcore.runStart": "Ausführen starten",

        // playbook-vendor-dialog
        "dlgcore.vendorTitle": "Hersteller-Informationen",
        "dlgcore.vendorDesc": "Dieses Playbook installiert Software von Drittanbietern. Die offiziellen Hersteller-/Projektseiten:",

        // login-dialog
        "dlgcore.forgotPassword": "Passwort vergessen?",

        // forgot-dialog
        "dlgcore.forgotTitle": "Passwort zurücksetzen",
        "dlgcore.forgotDesc": "Geben Sie Ihren Benutzernamen oder Ihre E-Mail-Adresse ein. Wir senden Ihnen einen Link zum Zurücksetzen.",
        "dlgcore.requestLink": "Link anfordern",

        // reset-dialog
        "dlgcore.resetTitle": "Neues Passwort festlegen",
        "dlgcore.savePassword": "Passwort speichern",

        // otp-dialog
        "dlgcore.otpTitle": "Sicherheits-Code eingeben",
        "dlgcore.otpDesc": "Wir haben Ihnen einen 6-stelligen OTP-Code per E-Mail gesendet. Bitte geben Sie diesen ein:",
        "dlgcore.otpPin": "Einmal-PIN",

        // register-dialog
        "dlgcore.pwSrHint": "Das Passwort muss mindestens 8 Zeichen lang sein und mindestens einen Großbuchstaben sowie eine Ziffer enthalten.",
        "dlgcore.captchaSr": "Sicherheitsabfrage gegen Spam: Bitte loesen Sie die folgende Rechenaufgabe.",
        "dlgcore.agreeAgbPre": "Ich stimme den",
        "dlgcore.agreeDsgvoPre": "Ich stimme der",
        "dlgcore.agreeSuffix": "zu",
    },
    en: {
        // Common field labels (reused across guest/auth dialogs)
        "dlgcore.username": "Username",
        "dlgcore.emailAddress": "Email address",
        "dlgcore.password": "Password",
        "dlgcore.newPassword": "New password",
        "dlgcore.confirmPassword": "Confirm password",
        "dlgcore.usernameOrEmail": "Username or email",
        "dlgcore.showPassword": "Show password",
        "dlgcore.pwMismatch": "Passwords do not match.",
        "dlgcore.enterAnswer": "Enter answer",
        "dlgcore.loadingShort": "Loading…",

        // guest-create-dialog
        "dlgcore.guestCreateTitle": "Create new team member",
        "dlgcore.guestCreateSubmit": "Create team member",

        // guest-edit-dialog
        "dlgcore.guestEditTitle": "Edit team member",
        "dlgcore.guestEditPwHint": "Set a new password (optional – leave empty to keep it unchanged):",

        // guest-scenarios-dialog
        "dlgcore.guestScenariosTitle": "Share scenarios",
        "dlgcore.guestScenariosP1": "Sharing for",
        "dlgcore.guestScenariosP2": ". The team member can run the enabled scenarios.",
        "dlgcore.saveShares": "Save sharing",

        // guest-activity-dialog
        "dlgcore.activities": "Activities",
        "dlgcore.copyLogs": "Copy logs",
        "dlgcore.exportTxt": "Export as .txt",
        "dlgcore.colTime": "Time",
        "dlgcore.colAction": "Action",
        "dlgcore.colTarget": "Target",
        "dlgcore.colDetails": "Details",

        // discard-confirm-dialog
        "dlgcore.discardTitle": "Close dialog?",
        "dlgcore.discardMsg": "Unsaved input will be lost. Do you really want to close the run dialog?",
        "dlgcore.keepEditing": "Keep editing",
        "dlgcore.discardClose": "Discard & close",

        // credentials-dialog (run)
        "dlgcore.credTitle": "Connection & authentication",
        "dlgcore.credDesc": "Enter the target device and the SSH credentials:",
        "dlgcore.manualEntry": "-- Manual entry --",
        "dlgcore.manageDevices": "Manage devices",
        "dlgcore.targetHost": "Target device (IP or hostname)",
        "dlgcore.targetHostHelp": "e.g. 192.168.1.50 or webserver.local",
        "dlgcore.sshUsername": "SSH username",
        "dlgcore.sshPassword": "SSH password",
        "dlgcore.sudoPasswordOptional": "Sudo password (optional)",
        "dlgcore.baseDir": "Base directory (default: /home/<user>, /root for root)",
        "dlgcore.timezone": "Time zone (timezone)",
        "dlgcore.timezoneHelp": "e.g. Europe/Berlin",
        "dlgcore.osAutodetect": "Auto-detect operating system",
        "dlgcore.osFamily": "OS family",
        "dlgcore.useTraefik": "Make services reachable via Traefik (reverse proxy)",
        "dlgcore.routeMode": "Routing",
        "dlgcore.routeModeDomain": "Dedicated (sub)domain",
        "dlgcore.routeModeSubpath": "Subpath of a domain",
        "dlgcore.baseDomain": "Main domain / IP (for subpath)",
        "dlgcore.settingsForServices": "Settings for enabled services:",
        "dlgcore.presetName": "Preset name",
        "dlgcore.savePresetOnRun": "Also save as a preset when starting the run",
        "dlgcore.saveAsPresetOnly": "Save as preset only",
        "dlgcore.runStart": "Start run",

        // playbook-vendor-dialog
        "dlgcore.vendorTitle": "Vendor information",
        "dlgcore.vendorDesc": "This playbook installs third-party software. The official vendor/project pages:",

        // login-dialog
        "dlgcore.forgotPassword": "Forgot password?",

        // forgot-dialog
        "dlgcore.forgotTitle": "Reset password",
        "dlgcore.forgotDesc": "Enter your username or email address. We will send you a reset link.",
        "dlgcore.requestLink": "Request link",

        // reset-dialog
        "dlgcore.resetTitle": "Set a new password",
        "dlgcore.savePassword": "Save password",

        // otp-dialog
        "dlgcore.otpTitle": "Enter security code",
        "dlgcore.otpDesc": "We have sent you a 6-digit OTP code by email. Please enter it:",
        "dlgcore.otpPin": "One-time PIN",

        // register-dialog
        "dlgcore.pwSrHint": "The password must be at least 8 characters long and contain at least one uppercase letter and one digit.",
        "dlgcore.captchaSr": "Anti-spam security check: please solve the following arithmetic problem.",
        "dlgcore.agreeAgbPre": "I accept the",
        "dlgcore.agreeDsgvoPre": "I agree to the",
        "dlgcore.agreeSuffix": "",
    },
};
