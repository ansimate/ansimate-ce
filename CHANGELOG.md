# Changelog

Alle nennenswerten Änderungen an Ansimate werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

<!--
RELEASE-PROZESS (siehe auch scripts/update_changelog.py)
--------------------------------------------------------
1. Während der Entwicklung: Änderungen unter "## [Unreleased]" in die passende
   Rubrik eintragen (Added / Changed / Fixed / Security / Removed / Deprecated).
   Jeder Eintrag referenziert die Issue-Nummer, z. B. "... (#910)".
2. Beim Release die Version festlegen (SemVer: MAJOR.MINOR.PATCH) und
   `python3 scripts/update_changelog.py X.Y.Z` ausführen — das verschiebt den
   Inhalt von [Unreleased] in einen datierten Versionsabschnitt und legt einen
   frischen, leeren [Unreleased]-Block an.
3. Version in package.json (frontend) + ggf. weiteren Manifests anheben, commit,
   PR develop -> main, danach Tag `vX.Y.Z` pushen. Die CI publiziert die
   Community-Images (ansimate/ce-backend, ansimate/ce-frontend) nach Docker Hub.

Diese Datei ist Teil des oeffentlichen Community-Spiegels. Eintraege, die AUSSCHLIESSLICH
Cloud- oder Enterprise-Funktionen betreffen (weder die Community-Edition noch alle Editionen),
zwischen den Markern
einfassen. scripts/community-export.sh schneidet diese Bloecke beim Export fail-closed heraus.
-->

## [Unreleased]

## [0.4.1] - 2026-07-11

### Added
- **Mehrsprachige Web-UI (Deutsch/Englisch)** (#1020): Die gesamte Oberfläche ist jetzt
  vollständig auf Deutsch und Englisch verfügbar. Die Sprache lässt sich direkt über einen
  Umschalter in der Kopfzeile oder im Profil wählen und wird pro Benutzer serverseitig
  gespeichert; ohne ausdrückliche Wahl richtet sie sich nach dem Browser (Deutsch/Englisch,
  sonst Englisch). Datums-, Zahlen- und Währungsformate folgen der gewählten Sprache
  (#1096–#1113).
- **`docker-compose.no-traefik.yml`** (#1119): eigenständiges Compose ohne Traefik, das die
  vorgebauten Community-Images (`ansimate/ce-backend`, `ansimate/ce-frontend`) nutzt und das
  Frontend direkt über `FRONTEND_PORT` veröffentlicht — Schnellstart ohne Klonen und ohne
  lokalen Build.

### Changed
- **Community-Edition aufgeräumt** (#1114, #1115, #1116, #1121, #1122, #1123): Der Schnellstart
  setzt jetzt auf die vorgebauten Images (Klonen + selbst bauen ist der „Advanced"-Weg), die
  README enthält einen Abschnitt zum Agent-Skill, und `SECURITY.md` sowie `docs/COMMUNITY.md`
  wurden gestrafft. Interne bzw. kommerzielle Bestandteile wurden aus dem öffentlichen
  Quellspiegel entfernt.

### Fixed
- **Community-Edition: Anmeldung nach der Erst-Initialisierung** (#1118): Beim Start konnte ein
  Datenbank-Initialisierungsfehler das Anlegen des Standard-Administrators verhindern, sodass
  keine Anmeldung möglich war. Die betroffene Initialisierung ist nun editions-sicher und setzt
  die Transaktion im Fehlerfall sauber zurück.

### CI
- **Öffentlicher Community-Spiegel wird jetzt forward-only synchronisiert** (#1087): Statt die
  Historie bei jedem Release per Force-Push neu zu schreiben, klont die CI den bestehenden
  Spiegel, legt den Community-Export darüber und pusht Änderungen als einen regulären Commit
  (ohne `--force`). Die öffentliche Historie bleibt dadurch linear, und Forks lassen sich per
  „Sync Fork" bzw. `git pull` aktualisieren.
- **`CHANGELOG.md` ist jetzt Teil des öffentlichen Community-Spiegels:** Beim Export werden
  Einträge, die ausschließlich Cloud- oder Enterprise-Funktionen betreffen, herausgefiltert —
  der Spiegel enthält nur Änderungen, die alle Editionen oder die Community-Edition betreffen.

## [0.4.0] - 2026-07-10

### Changed
- **Geräte-Modell vereinfacht: ein Host pro Gerät** (#1070): Die Geräte-Gruppen entfallen.
  Ein „Gerät" ist jetzt genau ein Host; Verbindungsdaten, Basisverzeichnis, Zeitzone und
  Freigaben liegen direkt am Gerät. Die Ausführung eines Playbooks auf **mehreren** Hosts
  gleichzeitig erfolgt nun über **Szenarien und Presets**, in denen sich mehrere Geräte per
  Checkbox auswählen lassen. Bestehende Geräte-Gruppen-Bindungen von Szenarien/Presets werden
  beim Start automatisch und verlustfrei auf die neue Mehrfach-Geräteauswahl migriert.

## [0.3.8] - 2026-07-09

### Fixed
- **JDownloader 2: Host-Port ohne Traefik im Ausführen-Dialog konfigurierbar** (#1068):
  Im Ausführen-Dialog fehlte für das JD2-Playbook das Eingabefeld für den Host-Port,
  sobald Traefik deaktiviert wurde — anders als bei den übrigen Web-App-Playbooks. Das
  Feld „HTTP-Port (ohne Traefik)" (Standard 5800) wird nun auch für JDownloader 2
  eingeblendet, und der Web-Port wird im Betrieb ohne Traefik entsprechend veröffentlicht.

## [0.3.7] - 2026-07-09

### Security
- **Community-Edition-Isolation der Web-UI vervollständigt:** Cloud- und
  enterprise-exklusive Oberflächen werden jetzt beim Community-Build gestrippt statt
  nur ausgeblendet — u. a. Wartungs-, Registrierungs-, Webhook- und Konten-Diagramme
  sowie zwölf weitere Cloud-/Enterprise-Dialoge und -Sektionen (benutzerdefinierte
  Playbooks, Gäste, Freigaben, Admin-Benutzeranlage, der komplette Rechnungen-Tab
  inklusive AVV) und der Gast-Premium-Hinweis (#1059, #1060, #1062, #1064).
- **Zwei-Faktor-Authentifizierung (2FA/OTP) ist jetzt enterprise-exklusiv** und wird
  in Frontend und Backend aus der Community-Edition entfernt (#1064).
- **Trial-/Browser-Fingerprint-Mechanik als cloud-only entfernt:** Fingerprint-Erfassung,
  Sicherheits-Alerts und Abo-Trial-Statistiken werden aus der Community-Edition gestrippt;
  eine community-only-Migration entfernt die zugehörige Datenbankspalte fail-safe (#1057).
- **Editions-Marker verfeinert** (`cloud-only` / `enterprise-only`): konsistentere
  Trennung von Community, Cloud und Enterprise in Backend und Frontend, inklusive
  Community-Limits-Fallback und Abgrenzung der Benutzerverwaltung (#1054).

### CI
- **Frontend-Strip beim Community-Export läuft jetzt node-first** statt in einem Docker-Run —
  der Bind-Mount schlug im Gitea-Runner (Docker-in-Docker) fehl; zusätzlich wird die
  Spiegel-Quelle beim Export bereinigt (#1059, #1060).

## [0.3.6] - 2026-07-07

### Added
- **Host-Port konfigurierbar (ohne Traefik) für 6 weitere Web-App-Playbooks**: Beim Ausführen
  ohne Traefik lässt sich der veröffentlichte Host-Port jetzt auch für **Filebrowser** (Standard
  8080), **SearXNG** (8888), **Dockman** (8866), **Node-RED** (1880), **Prometheus** (9090) und das
  **Dashboard** (80) über das Feld „HTTP-Port (ohne Traefik)" überschreiben — der im Playbook
  hinterlegte Port bleibt der Default. Das schließt die Lücke zu den bereits parametrisierten
  Stacks und erlaubt so Sequenzen mehrerer Web-Apps ohne Traefik ohne Port-Kollisionen.

## [0.3.5] - 2026-07-07

### Fixed
- **Docker-Datenverzeichnis gehört dem SSH-Benutzer statt root** (#1041-Folge): In den
  `create-stack`-Playbooks *filebrowser*, *jdownloader2*, *searxng* sowie in `install-docker.yml`
  wurden die Verzeichnisse `{{base_dir}}/docker` bzw. `.../docker/{{stack}}` ohne
  Rechteausweitung angelegt. Existierte das Verzeichnis bereits mit root-Besitz (z. B. weil der
  Docker-Daemon es beim Anlegen eines Bind-Mounts erzeugt hatte), scheiterte der Lauf mit
  `chown failed: Operation not permitted`. Diese Tasks laufen nun (wie die übrigen 62 create-stack-
  Playbooks) mit `become: true` und übergeben den Ordner an den SSH-Benutzer (`owner: {{ssh_user}}`)
  — behebt den Fehler und stellt sicher, dass die Daten dem anmeldenden Benutzer gehören.

## [0.3.4] - 2026-07-07

### Fixed
- **Rechteausweitung schlägt auf Ubuntu 25.10+ (sudo-rs) fehl** (#1041): Ubuntu 25.10 ersetzt das
  klassische `sudo` durch **`sudo-rs`**. Dieses gibt das von Ansible via `-p` gesetzte Passwort-Prompt
  nicht als Ersatz aus, sondern umschließt es als `[sudo: … ] Password:`. Ansibles Prompt-Erkennung
  griff dadurch nicht → `Timeout … waiting for privilege escalation prompt`, obwohl Passwort und
  Sudo-Rechte korrekt waren (manuelles `sudo` lief sofort durch). Ansimate lädt jetzt ein eigenes
  `sudo`-Become-Plugin, das **beide** Prompt-Formate erkennt (klassisches sudo **und** sudo-rs) —
  ohne Änderung am Zielsystem, für alle Läufe (normal und Custom-Sandbox). Basiert auf Ansible
  Upstream-PR #86175.

## [0.3.3] - 2026-07-07

### Fixed
- **`Timeout … waiting for privilege escalation prompt` bei langsamem Sudo** (#1041): Auf Zielen,
  deren Sudo-Passwort-Abfrage erst nach mehr als ~10 Sekunden erscheint (z. B. langsames PAM,
  netzwerkbasierte Authentifizierung wie LDAP/SSSD/DNS), brach Ansible die Rechteausweitung ab —
  obwohl das Passwort korrekt war. Das Ansible-Verbindungstimeout ist nun über eine neue
  Admin-Einstellung **„Verbindungs-Timeout (Sek.)"** steuerbar (Standard 30 s statt ~10 s), sodass
  auch langsame Ziele zuverlässig funktionieren.

## [0.3.2] - 2026-07-07

### Fixed
- **Rechteausweitung (sudo/become) auf Systemen ohne passwortloses Sudo** (#1041): Playbook-Läufe
  liefen bei `become`-Tasks in einen Timeout („waiting for privilege escalation prompt"), weil kein
  Sudo-Passwort an Ansible übergeben wurde — insbesondere bei SSH-Key-Authentifizierung. Geräte in
  *My Vault* sowie der Ausführen- und der Szenario-Dialog haben nun ein optionales **Sudo-/Become-
  Passwort** (wird als `ansible_become_password` genutzt, funktioniert auch bei Key-Auth; ohne
  Angabe dient weiterhin das SSH-Passwort als Sudo-Passwort). Schlägt die Rechteausweitung fehl,
  erscheint eine klare Fehlermeldung mit Handlungshinweis statt eines stummen Timeouts.

## [0.3.1] - 2026-07-07

### Added
- **Über die API angelegte Geräte sind jetzt in der Web-UI sichtbar** (#1022), und
  Job-Abschluss-Mails enthalten nun Status und Laufzeit des Laufs (#1019).

### Changed
- **Playbooks erzwingen kein systemweites OS-Upgrade mehr:** `install-docker.yml` aktualisiert
  nur noch den apt-Paket-Cache, statt alle installierten Pakete zwangsweise zu aktualisieren —
  allgemeine System-Updates bleiben Sache des Administrators und werden nicht mehr ungefragt von
  Anwendungs-Playbooks durchgeführt (#1037).
- **Community-Edition-Dokumentation vollständig auf Englisch** (#1024).

### Security
- **Editions-Marker-System** (`cloud-only` / `enterprise-only`): Der Community-Export
  entfernt cloud- und enterprise-exklusiven Quellcode spannenweise (fail-closed), inklusive
  Stripe-/Abo-Datenbankspalten, Rechts-Helper und Registrierungs-Dialog; erweiterter Leak-Guard
  über alle Dateitypen (#1014, #1018, #1021, #1025, #1026, #1027, #1028, #1029, #1030, #1031).
- **Premium-Endpunkte aus der Community-OpenAPI entfernt** und Inline-Rechtstext-Modale gestrippt
  (#1007, #1008).
- **Premium-Upsell-Dialog aus der Community-UI entfernt** und Flackern der Wartungsseite behoben
  (#1011, #1012).

### CI
- **Docker-Hub-README/Beschreibung** der Community-Images wird beim Image-Push automatisch
  gesetzt (#1013); zusätzliche Diagnose für den Community-Quellspiegel-Push (#1010).

## [0.3.0] - 2026-07-05

### Added
- **27 Game-Server-Playbooks** (#840–#867) als `create-stack`-Playbooks (Docker-Compose,
  Kategorie *Gaming*, `requires: install-docker.yml`): Minecraft, Rust, ARK: Survival Evolved,
  Counter-Strike 2, Valheim, DayZ, 7 Days to Die, Enshrouded, Palworld, Conan Exiles,
  Garry's Mod, FiveM, Factorio, Satisfactory, Terraria, Team Fortress 2, V Rising, The Forest,
  Unturned, Space Engineers, Project Zomboid, Sons of the Forest, Left 4 Dead 2,
  Don't Starve Together, Vintage Story, Core Keeper, Barotrauma. Jedes Playbook wurde
  adversarial gegengeprüft (dabei u. a. drei Volume-Masking-Bugs behoben, die einen
  Container-Crash-Loop verursacht hätten).
- **Brand-Icons für die neuen Free-Playbooks** (#1003): echte App-Logos (VS Code, GIMP, VLC,
  Spotify, Firefox u. v. m.) statt generischer Material-Icons für 32 Katalog-Einträge; werden
  in Katalog-Kacheln und der Job-Log-Flow-Chart-Ansicht angezeigt.
- **README-Schnellstart mit fertigen Public-Images** samt `docker-compose.public.yml` (#927):
  Einstieg ohne lokalen Build direkt über die Community-Images von Docker Hub.

### Hinweise
- Game-Server-Betrieb: Minecraft akzeptiert die Mojang-EULA automatisch (`EULA=TRUE`), FiveM
  benötigt einen kostenlosen `LICENSE_KEY` (keymaster.fivem.net), Counter-Strike 2 optional
  einen GSLT-Token für die öffentliche Server-Listung. Default-Passwörter sind Platzhalter.

## [0.2.1] - 2026-07-04

### Added
- **`install-flatpak.yml`** als eigenständiges Voraussetzungs-Playbook (installiert den
  Flatpak-Paketmanager und richtet das Flathub-Remote ein), analog zu `install-docker.yml` (#998).
- **Agenten-Skill „Ansimate Operator"** unter `skills/ansimate/` (`SKILL.md` + dependency-freies
  Python-CLI), mit dem KI-Agenten (Claude, Gemini & Co.) Geräte, Playbooks, Szenarien, Läufe und
  Job-Logs über die REST-API steuern – inkl. Integrator-README (Auth/Token-Scopes, CLI-Referenz,
  Einrichtung je Agent) und Verlinkung in der Haupt-README.

### Changed
- **Gemeinsames Flatpak-Setup aus den 30 Flatpak-App-Playbooks (Zoom, Brave, Chrome, …) in
  `install-flatpak.yml` ausgelagert.** Die Apps deklarieren es nun als `requires`-Abhängigkeit
  und beschränken sich auf die reine App-Installation via Flathub (#998).
- **`requires`-Abhängigkeiten werden jetzt serverseitig erzwungen** – für alle Ausführungspfade
  (direkte Auswahl, Presets, Szenarien, API/Token). Voraussetzungs-Playbooks (Flatpak, Docker)
  werden bei Bedarf automatisch ergänzt und laufen garantiert vor den abhängigen Playbooks;
  schließt zugleich die bislang nur im Frontend abgesicherte Docker-Reihenfolge-Lücke (#998).

## [0.2.0] - 2026-07-03

### Added
- **Freie Playbook-Bibliothek massiv erweitert (Playbook Roadmap – Free): 48 neue Playbooks.**
  - **40 Host-Setup-Installationen** (`install-*`): Sprach-Laufzeiten/-SDKs (Java JRE/JDK,
    .NET SDK/Runtime, Python mit/ohne PIP, Miniconda, uv), Browser (Firefox, Google Chrome,
    Brave, Opera), Entwicklung (VS Code, Sublime Text), Multimedia (VLC, Audacity, HandBrake,
    Spotify), Grafik (GIMP, Inkscape, Blender), Kommunikation (Thunderbird, Discord, Signal,
    Element, TeamSpeak, Zoom, Pidgin), Gaming-Launcher (Steam, Lutris) sowie
    System-/Netzwerk-/Datei-Werkzeuge (Gearlever, LACT, TigerVNC, RustDesk, FileZilla,
    qBittorrent, KeePassXC, LibreOffice, Dropbox, PeaZip). Installation je nach App über die
    Debian/Ubuntu-Paketquellen (apt), Flatpak/Flathub oder das offizielle Installer-Skript
    (uv, Miniconda) — alle Flathub-App-IDs gegen die Flathub-API verifiziert (#949–#991).
  - **8 dedizierte Spielserver** (`create-stack-*`, Docker): Abiotic Factor, Soulmask,
    Astroneer, Eco, Empyrion, Icarus, Mordhau und Euro Truck Simulator 2 — jeweils mit
    vorkonfigurierten Ports, sinnvollen Standard-Umgebungsvariablen und einem persistenten
    Datenvolume auf dem dokumentierten Container-Pfad des jeweiligen Images (#868–#875).

## [0.1.12] - 2026-07-03

### Added
- Endpunkt `/api/version` liefert jetzt in ALLEN Editionen die Ansimate-Versionsnummer
  (`{"version": "…"}`) aus einer zentralen Quelle (`backend/version.py`) — für Diagnose,
  Monitoring und Deployment-Validierung (#939).
- Job-Log-Flow-Chart: vor jedem Playbook-Namen wird nun das zugehörige Service-Icon
  (Logo bzw. Material-Icon) angezeigt (#937).

### Changed
- OpenAPI-/Swagger-Dokumentation (`/docs`, `/openapi.json`) trägt jetzt die echte
  Anwendungsversion statt des Default-Werts `0.1.0`; Endpunkt-Abgleich geprüft (#932).

### Fixed
- Bereits als Szenario gespeicherte Presets werden nicht mehr doppelt in der Liste der
  verfügbaren Presets angezeigt (Backend-Logik/Löschen bleibt unverändert) (#938).
- Community-Edition: die rechtlichen Footer-Links (Impressum/AGB/Datenschutz) blitzen beim
  Laden nicht mehr kurz auf — sie werden build-zeitlich entfernt statt nachträglich per
  JavaScript versteckt (#936).

### Security
- Community-Edition: die rechtlichen Seiten (`impressum.html`, `tos.html`, `privacy.html`)
  und ihre Footer-Links werden build-zeitlich vollständig aus dem Bundle entfernt
  (`strip-cloud-only.cjs`, Klasse `legal-only`) statt nur versteckt (#931).

## [0.1.11] - 2026-07-02

### Fixed
- Job-Log-Historie im mobilen Hochformat: In der Kachel-/Flow-Chart-Ansicht wurden die
  Playbook-Kacheln im Hochkant-Modus in mehrere Spalten umgebrochen und dadurch rechts
  abgeschnitten. Die Kacheln stapeln jetzt in einer einzigen Spalte (kein horizontaler
  Überlauf / keine abgeschnittenen Inhalte mehr); lange Playbook-Namen werden mit „…"
  gekürzt (#928).

## [0.1.10] - 2026-07-02

### Fixed
- Mobiles Burger-Menü: Menüpunkte zeigen nicht mehr die Material-Icons-Namen als Text
  vor dem Label (z. B. „terminal Playbooks", „account_circle <Name>"); es erscheinen das
  Icon-Symbol und der reine Text, das Profil zeigt nur den Benutzernamen (#921).
- Job-Historie auf Mobilgeräten responsiv: Konsolen-Kopfzeile bricht um statt die
  Aktionsbuttons abzuschneiden, lange Job-ID wird gekürzt, Log-Padding/Schrift verkleinert
  und die Flow-Chart-Kacheln stapeln vertikal mit nach unten zeigenden Pfeilen (#922).
- Admin-Seite auf Mobilgeräten: Dashboard-Diagramme stapeln einspaltig und sprengen nicht
  mehr die Bildschirmbreite, die Seite lässt sich vertikal scrollen und das SMTP-Test-Feld
  samt Button ist vollständig sichtbar/bedienbar (#923).

## [0.1.9] - 2026-07-02

### Changed
- Konfigurations-Dialoge (Playbook ausführen, Szenario-/Preset-Assistent): Wahrheitswert-
  Parameter (z. B. Traefik-Dashboard, MQTT-Authentifizierung, Vaultwarden-Registrierung)
  werden als Umschalt-Checkbox statt als Freitextfeld „true/false" dargestellt, und die
  Eingabefelder zeigen ihre Beispielwerte als grauen Platzhalter statt eines separaten
  „z. B."-Hinweistexts (#917).

## [0.1.8] - 2026-07-02

### Added
- Freie Playbooks: erweiterte Konfigurations-Optionen in der Web-UI — MQTT/Mosquitto
  (Authentifizierung an/aus, Benutzer/Passwort, konfigurierbarer Port) und Traefik
  (Dashboard an/aus, Dashboard-Subdomain, Basic-Auth) (#912).
- Job-Ansicht: grafische Kachel-/Flow-Chart-Darstellung der Playbooks mit Status
  (ausstehend/ausführend/erfolg/fehler) und Ablauf-Pfeilen; per Umschalter wechselbar
  zur klassischen Text-Log-Konsole (#913).
- `CHANGELOG.md` inklusive dokumentiertem Release-Prozess und Hilfsskript
  `scripts/update_changelog.py` (#899).

### Fixed
- Live-Log bleibt während eines laufenden Playbook-Laufs nicht mehr leer: der
  ansible-Subprozess läuft jetzt ungepuffert (`PYTHONUNBUFFERED=1`, zeilengepuffertes
  Lesen), sodass jede Ausgabezeile innerhalb von 1–2 s in der GUI erscheint (#910).

## [0.1.7] - 2026-07-01

### Fixed
- Live-Log-Streaming stabilisiert: Keep-Alive-Heartbeats gegen Proxy-/Browser-Timeouts
  im Leerlauf, offset-basierter Auto-Reconnect nach Verbindungsabbruch und Umstellung
  auf ungepuffertes Lesen — kein „NetworkError“ und kein leeres Log mehr (#906).

## [0.1.6] - 2026-07-01

### Changed
- Stabile Playbook-Ausführungsreihenfolge: `install-*`-Playbooks laufen vor
  `create-stack-*`-Playbooks (Abhängigkeiten wie Docker vor Stacks) (#903).

## [0.1.5] - 2026-07-01

### Security
- SSH-Host-Keys (`known_hosts`) werden pro Job ephemer gehalten statt dauerhaft
  gespeichert; nach einer OS-Neuinstallation des Zielgeräts blockiert ein geänderter
  Fingerabdruck den Lauf nicht mehr (#897).

## [0.1.4] - 2026-07-01

### Security
- Community-Edition: cloud-/premium-exklusive Elemente werden zur Build-Zeit aus dem
  ausgelieferten HTML entfernt (`strip-cloud-only.cjs`), abgesichert durch einen
  CI-`edition-isolation`-Check (#894).

## [0.1.3] - 2026-07-01

### Added
- Granulare API-Token-Scopes (`manage_devices`, `manage_scenarios`) zusätzlich zu
  Run/Jobs; Ablaufdatum-Anzeige in der Token-Übersicht (#375).

### Fixed
- Kopieren-Button (Job-ID/Log) mit Fallback für Umgebungen ohne
  `navigator.clipboard` (#886).

## [0.1.2] - 2026-07-01

### Added
- OpenAPI-Dokumentation, Wartungssperre und `llm.txt`-Discovery (MS50 #887, #888, #889).

## [0.1.1] - 2026-07-01

### Added
- „Driven by Agents“: `llm.txt` als maschinenlesbare Beschreibung der Anwendung für
  LLM-/Agent-Nutzung (MS53).

## [0.1.0] - 2026-06-30

### Added
- Erster deployment-fähiger Community-Release. Enthält u. a. den Job-/Log-Viewer mit
  Live-Streaming, die „My Vault“-Dialoge (Szenarien, Playbooks, Presets, Geräte) und
  das Community-Gating (Ausblenden cloud-exklusiver Funktionen) (MS50 #823–#835).

[Unreleased]: https://github.com/your-org/ansimate/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/your-org/ansimate/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/your-org/ansimate/compare/v0.3.8...v0.4.0
[0.3.8]: https://github.com/your-org/ansimate/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/your-org/ansimate/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/your-org/ansimate/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/your-org/ansimate/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/your-org/ansimate/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/your-org/ansimate/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/your-org/ansimate/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/your-org/ansimate/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/your-org/ansimate/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/your-org/ansimate/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/your-org/ansimate/compare/v0.1.12...v0.2.0
[0.1.12]: https://github.com/your-org/ansimate/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/your-org/ansimate/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/your-org/ansimate/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/your-org/ansimate/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/your-org/ansimate/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/your-org/ansimate/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/your-org/ansimate/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/your-org/ansimate/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/your-org/ansimate/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/your-org/ansimate/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/your-org/ansimate/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/your-org/ansimate/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/your-org/ansimate/releases/tag/v0.1.0
