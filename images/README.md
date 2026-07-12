# Icon-Assets (`images/`)

Dieses Verzeichnis enthält die Playbook- und Marken-Icons für den Ansimate-Katalog.
Im Web-UI werden sie als kleine Kacheln (24×24 px, `object-fit: contain`) gerendert –
Vektor-SVG wird bevorzugt, PNG-Rasterdateien sind auf ≤ 128 px normiert. Ein Eintrag in
`playbooks/index.yml` referenziert das Icon entweder über einen Dateinamen aus diesem
Ordner (`icon: "minecraft.svg"`) **oder** über einen Material-Symbols-Namen (`icon: "radar"`).

## Herkunft & Lizenzen

### Material Symbols (keine Datei in diesem Ordner)
Generische bzw. genre-typische Icons (z. B. `cabin`, `rocket_launch`, `radar`, `castle`)
sind **Namen** aus **Material Symbols Outlined** (Google), lizenziert unter der
**Apache License 2.0**. Die Schrift wird selbstgehostet unter
`frontend/src/assets/fonts/` ausgeliefert (kein externer Google-Fonts-Request, DSGVO).

### Dashboard Icons — `homarr-labs/dashboard-icons`
Ein Großteil der Marken-Icons stammt aus der Sammlung **Dashboard Icons**
(<https://dashboardicons.com>, Repo `homarr-labs/dashboard-icons`, vormals `walkxcode`).
Die **Kuration/Sammlung** steht unter der **MIT-Lizenz**; die enthaltenen Marken- und
Produktlogos bleiben Eigentum der jeweiligen Rechteinhaber.
Beispiele: `minecraft.svg`, `counter-strike-2.png`, `enshrouded.png`, `terraria.png`,
`satisfactory.png`, `it-tools.svg`, `open-webui.svg`, `claude.svg`, `anydesk.svg`,
`remmina.svg`, `telegram.svg`.

### Flathub- bzw. projekteigene App-Icons
Icons von Desktop-Anwendungen stammen aus der **Flathub-Media-API** bzw. direkt aus dem
jeweiligen Projekt-Repository und stehen jeweils unter der Lizenz der zugehörigen Anwendung.
Beispiele: `lutris.png`, `bottles.png`, `heroic.png`, `prism-launcher.png`, `inkscape.png`,
`gearlever.svg`, `kicad.png`, `flatseal.png`.

### Offizielle Marken-Assets
Einzelne Logos stammen direkt von der offiziellen Quelle des jeweiligen Projekts.
Beispiele: `vlc.png` (VideoLAN), `sublime-text.png` (Sublime HQ).

## Markenrechts-Hinweis (Nominative Fair Use)
Alle Firmen-, Produkt- und Spielenamen sowie die zugehörigen Logos sind Marken bzw.
eingetragene Marken der jeweiligen Inhaber. Sie werden hier **ausschließlich zur
Identifikation** des jeweiligen Dienstes oder der jeweiligen Anwendung im Playbook-Katalog
verwendet (nominative Nutzung). Die Verwendung impliziert **kein** Sponsoring, keine
Partnerschaft und keine Billigung durch die Rechteinhaber. Rechteinhaber, die die Entfernung
oder Ersetzung ihres Logos wünschen, können jederzeit ein Issue eröffnen.
