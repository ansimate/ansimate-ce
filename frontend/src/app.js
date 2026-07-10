// : Chart.js für die Admin-Dashboard-Diagramme (Pie + Verlauf).
import Chart from "chart.js/auto";

// : Billing-UI nur in der cloud-Edition laden. import.meta.env.VITE_EDITION ist eine
// BUILD-ZEIT-Konstante; der dynamische, editionsabhaengige Import wird in community/onprem-
// Builds per Dead-Code-Elimination komplett entfernt -> diese Bundles enthalten KEINEN
// Billing-Code (kein pricing/checkout/tariff/coupon/stripe). Die Aufrufstellen rufen lokale
// Stubs, die an das (in cloud) geladene Modul delegieren (Stub = No-Op ohne Billing).
const billingApi = {};
if (import.meta.env.VITE_EDITION === "cloud") {
    import("./billing.js")
        .then((m) => Object.assign(billingApi, m))
        .catch((e) => console.error("Billing-Modul konnte nicht geladen werden:", e));
}
function promptPremiumUpsell(...a) { return billingApi.promptPremiumUpsell?.(...a); }
function closePremiumUpsell(...a) { return billingApi.closePremiumUpsell?.(...a); }
function goToPricing(...a) { return billingApi.goToPricing?.(...a); }
function fetchPricing(...a) { return billingApi.fetchPricing?.(...a); }
function validatePricingCoupon(...a) { return billingApi.validatePricingCoupon?.(...a); }
function handleSubscribeNow(...a) { return billingApi.handleSubscribeNow?.(...a); }
function handleManageBilling(...a) { return billingApi.handleManageBilling?.(...a); }
function fetchInvoices(...a) { return billingApi.fetchInvoices?.(...a); }
function renderInvoicesInto(...a) { return billingApi.renderInvoicesInto?.(...a); }
function fetchTariffs(...a) { return billingApi.fetchTariffs?.(...a); }
function handleTariffSubmit(...a) { return billingApi.handleTariffSubmit?.(...a); }
function resetTariffForm(...a) { return billingApi.resetTariffForm?.(...a); }
function fetchCoupons(...a) { return billingApi.fetchCoupons?.(...a); }
function fetchBillingInvoices(...a) { return billingApi.fetchBillingInvoices?.(...a); }  // 
function handleCouponSubmit(...a) { return billingApi.handleCouponSubmit?.(...a); }
function resetCouponForm(...a) { return billingApi.resetCouponForm?.(...a); }
// : Tarif-/Gutschein-Dialoge (im Billing-Modul, via FAB geöffnet).
function openTariffCreateDialog(...a) { return billingApi.openTariffCreateDialog?.(...a); }
function closeTariffDialog(...a) { return billingApi.closeTariffDialog?.(...a); }
function openCouponCreateDialog(...a) { return billingApi.openCouponCreateDialog?.(...a); }
function closeCouponDialog(...a) { return billingApi.closeCouponDialog?.(...a); }

let activeHost = null;
let selectedJobId = null;
let jobViewMode = "tiles";   //: "tiles" (Flow-Chart, Standard) oder "log" (Text-Konsole)
let currentlyStreamingJobId = null;
let logController = null;
let logUserScrolledUp = false;   //: Auto-Scroll pausieren, sobald der Nutzer hochscrollt
let logScrollListenerAttached = false; //: Scroll-Listener nur einmal anhängen
let pollTimeout = null;
let pollingActive = false; //: verhindert doppelte Poll-Schleifen + erlaubt Re-Arm nach Logout
let allJobs = [];
let closedHosts = new Set();  // : vom Nutzer (sitzungsweit) geschlossene Host-Tabs
let knownJobIds = new Set();  // : bekannte job_ids -> ein neuer Lauf öffnet einen geschlossenen Tab wieder
let playbookNameMap = {};
let playbookMetadataMap = {};
let allPresets = [];
let allPlaybooks = [];
let containerTimezone = "Europe/Berlin";
let currentEdition = "cloud";   // aktive Edition (cloud|onpremise|community), via GET /api/version
let allowAnonymousRun = true;   // : anonyme Playbook-Ausfuehrung erlaubt? via GET /api/version
let registrationEnabled = true; // : Selbstregistrierung erlaubt? via GET /api/version

// : Registrieren-Button ein-/ausblenden je nach Server-Einstellung.
function applyRegistrationVisibility() {
    const btn = document.getElementById("register-btn");
    // : in der Community-Edition gibt es keine Selbstregistrierung -> Button immer ausblenden.
    if (btn) btn.style.display = (registrationEnabled && currentEdition !== "community") ? "" : "none";
}
// : erst nach dem Auth-Boot steht currentUser fest. Bis dahin trifft routePage()
// keine /admin-Entscheidung (kein verfrühtes Umleiten von Admins, kein Layout-Flicker).
let authReady = false;
//: Ziel des Footer-Links ("Projekt-Webseite") in der Community-Edition.
const COMMUNITY_PROJECT_URL = "https://ansimate.eu";

// Generate or retrieve Session ID
const sessionId = getSessionId();

// ===: Globaler IP-Sperr-Detektor ===========================================
// Die SecurityMiddleware liefert bei gesperrter IP auf JEDEN Request 403 mit
// {"detail":"IP address is blocked.","expires_at":<iso|null>,"reason":<str|null>}.
// window.fetch wird umhuellt, genau diese Antwort erkannt und ein Vollbild-
// Sperrbildschirm (mit Freigabe-Countdown) gezeigt statt einer generischen Fehlermeldung.
const IP_BLOCK_DETAIL = "IP address is blocked.";
let ipBlockShown = false;
let ipBlockCountdownTimer = null;

// : wird der Wartungsmodus aktiviert, beendet das Backend Nicht-Admin-Sessions; deren
// nächster Request (z. B. der Historie-Poll) liefert 503 {maintenance:true}. Dann einmalig
// neuladen -> der Boot zeigt die Wartungsseite (enforceMaintenanceGate).
let maintenanceReloadTriggered = false;

(function installIpBlockInterceptor() {
    const origFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
        const response = await origFetch(...args);
        if (response.status === 403 && !ipBlockShown) {
            try {
                const data = await response.clone().json();
                if (data && data.detail === IP_BLOCK_DETAIL) {
                    showIpBlockedScreen(data.expires_at || null, data.reason || null);
                }
            } catch (e) {
                // Kein JSON-Body oder anderer 403 (z.B. Rechte/Scope) -> ignorieren.
            }
        } else if (response.status === 503 && !maintenanceReloadTriggered) {
            // : Wartungsmodus aktiviert -> Nicht-Admin sofort auf die Wartungsseite.
            try {
                const data = await response.clone().json();
                if (data && data.maintenance) {
                    maintenanceReloadTriggered = true;
                    window.location.reload();
                }
            } catch (e) {
                // anderer 503 -> ignorieren.
            }
        }
        return response;
    };
})();

function showIpBlockedScreen(expiresAtIso, reason) {
    const overlay = document.getElementById("ip-block-overlay");
    if (!overlay) return;
    // Schon sichtbar? Dann nicht neu rendern (laufenden Countdown nicht zuruecksetzen).
    if (ipBlockShown && !overlay.classList.contains("hidden")) return;
    ipBlockShown = true;

    const reasonEl = document.getElementById("ip-block-reason");
    if (reasonEl && reason) {
        reasonEl.textContent = "Grund: " + reason;
        reasonEl.classList.remove("hidden");
    }

    const cdWrap = document.getElementById("ip-block-countdown-wrap");
    const permEl = document.getElementById("ip-block-permanent");
    const expiresAt = expiresAtIso ? new Date(expiresAtIso) : null;

    if (expiresAt && !isNaN(expiresAt.getTime())) {
        if (permEl) permEl.classList.add("hidden");
        if (cdWrap) cdWrap.classList.remove("hidden");
        const untilEl = document.getElementById("ip-block-until");
        if (untilEl) untilEl.textContent = "Freigabe um " + expiresAt.toLocaleString();
        startIpBlockCountdown(expiresAt);
    } else {
        // Permanente Sperre (manuelle Blacklist) -> kein Countdown.
        if (cdWrap) cdWrap.classList.add("hidden");
        if (permEl) permEl.classList.remove("hidden");
    }

    // : „Erneut versuchen"-Button entfernt — keine direkte Wiederhol-Option im Sperr-Dialog.

    overlay.classList.remove("hidden");
}

function startIpBlockCountdown(expiresAt) {
    const cdEl = document.getElementById("ip-block-countdown");
    if (ipBlockCountdownTimer) clearInterval(ipBlockCountdownTimer);
    const pad = (n) => String(n).padStart(2, "0");
    function tick() {
        const remainingMs = expiresAt.getTime() - Date.now();
        if (remainingMs <= 0) {
            if (cdEl) cdEl.textContent = "00:00";
            clearInterval(ipBlockCountdownTimer);
            ipBlockCountdownTimer = null;
            // Auto-Reload bei Ablauf, aber gegen Reload-Schleifen (Uhren-Drift Client/Server)
            // auf hoechstens einmal je 15s drosseln; sonst nutzt der Nutzer den Retry-Button.
            const last = parseInt(sessionStorage.getItem("ip_block_reload_at") || "0", 10);
            if (Date.now() - last > 15000) {
                sessionStorage.setItem("ip_block_reload_at", String(Date.now()));
                window.location.reload();
            }
            return;
        }
        const totalSec = Math.floor(remainingMs / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (cdEl) cdEl.textContent = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }
    tick();
    ipBlockCountdownTimer = setInterval(tick, 1000);
}

// DOM Elements
const connectionStatus = document.getElementById("connection-status");
const pulseDot = document.querySelector(".pulse-dot");
const playbooksList = document.getElementById("playbooks-list");
const runForm = document.getElementById("config-card");
const runButton = document.getElementById("run-button");
const toast = document.getElementById("toast");

// Local Icons Mapping Dictionary
const localIconMap = {
    "block": "pi-hole.svg",
    "router": "traefik.svg",
    "folder": "filebrowser.svg",
    "commit": "git.svg",
    "download": "jdownloader2.svg",
    "chat": "matrix-synapse-light.svg",
    "sensors": "mqtt.svg",
    "schema": "node-red.svg",
    "monitoring": "prometheus.svg",
    "search": "searxng.svg",
    "hub": "zerotier.svg",
    "settings_applications": "dockman.png",
    "gshield": "fail2ban.png",
    "layers": "logo.svg"
};

// Layout panels
const tabsBar = document.getElementById("tabs-bar");
const hostHistoryList = document.getElementById("host-history-list");

// Console components
const consoleOutput = document.getElementById("console-output");
const activeJobIdBadge = document.getElementById("active-job-id");
const copyLogsBtn = document.getElementById("copy-logs-btn");
const autoscrollBtn = document.getElementById("autoscroll-btn");
const viewToggleBtn = document.getElementById("view-toggle-btn");  //

// Grid/List toggles
const viewGridBtn = document.getElementById("view-grid-btn");
const viewListBtn = document.getElementById("view-list-btn");

// Credentials Dialog Modal
const credentialsDialog = document.getElementById("credentials-dialog");
let modalDirty = false; //: ungespeicherte Eingaben im Ausfuehrungs-Dialog
const modalTargetHost = document.getElementById("modal-target-host");
const modalUsernameInput = document.getElementById("modal-ssh-username");
const modalPasswordInput = document.getElementById("modal-ssh-password");
const modalBaseDirInput = document.getElementById("modal-base-dir");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const modalSubmitBtn = document.getElementById("modal-submit-btn");

// Initialize application
document.addEventListener("DOMContentLoaded", () => {
    init();
});

//: Theme-Auswahl (System/Hell/Dunkel)
const THEME_KEY = "ansimate-theme";
function getThemePreference() {
    const v = localStorage.getItem(THEME_KEY);
    return (v === "light" || v === "dark") ? v : "system";
}
function applyTheme(pref) {
    const html = document.documentElement;
    html.classList.remove("theme-light", "theme-dark");
    if (pref === "light") html.classList.add("theme-light");
    else if (pref === "dark") html.classList.add("theme-dark");
    // "system": keine Klasse -> CSS @media (prefers-color-scheme) greift automatisch.
}
function setThemePreference(pref) {
    localStorage.setItem(THEME_KEY, pref);
    applyTheme(pref);
}
function initTheme() {
    applyTheme(getThemePreference());
    // System-Wechsel zur Laufzeit nachziehen (CSS macht das automatisch; Listener
    // fuer Robustheit/zukuenftige JS-Reaktionen).
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => { if (getThemePreference() === "system") applyTheme("system"); };
    if (mq.addEventListener) mq.addEventListener("change", onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
    // Dropdown im Profil verdrahten.
    const sel = document.getElementById("profile-theme-select");
    if (sel) {
        sel.value = getThemePreference();
        sel.addEventListener("change", () => setThemePreference(sel.value));
    }
}

//: Barrierefreiheit fuer modale Dialoge - ARIA-Semantik, Focus-Trap und
// Fokus-Ruecksprung. Zentral ueber einen MutationObserver pro .dialog-overlay,
// sodass die ~50 ad-hoc open/close-Aufrufstellen (classList.add/remove("hidden"))
// NICHT angefasst werden muessen.
const _modalTrap = new Map();
function _isVisible(e) {
    // Robuster als offsetParent (deckt position:fixed/absolute mit ab).
    return e.getClientRects().length > 0 && !e.closest('[aria-hidden="true"]');
}
function _focusablesIn(el) {
    return Array.from(el.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(_isVisible);
}
function _anyOtherModalOpen(except) {
    return Array.from(document.querySelectorAll(".dialog-overlay"))
        .some(o => o !== except && !o.classList.contains("hidden"));
}
function _onModalOpen(overlay) {
    if (_modalTrap.has(overlay)) return;
    const prevFocus = document.activeElement;
    // Fokus SYNCHRON ins Modal setzen, BEVOR der Trap-Handler aktiv wird
    // (verhindert Race, falls sofort Tab gedrueckt wird).
    const f = _focusablesIn(overlay);
    if (f.length) { try { f[0].focus(); } catch (e) {} }
    const handler = (e) => {
        if (e.key !== "Tab") return;
        const items = _focusablesIn(overlay);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    };
    document.addEventListener("keydown", handler, true);
    _modalTrap.set(overlay, { prevFocus, handler });
}
function _onModalClose(overlay) {
    const s = _modalTrap.get(overlay);
    if (!s) return;
    document.removeEventListener("keydown", s.handler, true);
    _modalTrap.delete(overlay);
    // Fokus nur zuruecksetzen, wenn KEIN anderes Modal offen ist (kein Fokus-Sprung
    // bei Modal-zu-Modal-Wechsel, z.B. login -> otp).
    if (!_anyOtherModalOpen(overlay) && s.prevFocus && typeof s.prevFocus.focus === "function") {
        try { s.prevFocus.focus(); } catch (e) {}
    }
}
function initModalA11y() {
    const overlays = document.querySelectorAll(".dialog-overlay");
    overlays.forEach(overlay => {
        const card = overlay.querySelector(".dialog-card") || overlay.firstElementChild;
        if (card) {
            card.setAttribute("role", "dialog");
            card.setAttribute("aria-modal", "true");
            const header = card.querySelector(".dialog-header h1, .dialog-header h2, .dialog-header h3, .dialog-header h4, h1, h2, h3, h4");
            if (header) {
                if (!header.id) header.id = "modaltitle-" + (overlay.id || Math.random().toString(36).slice(2));
                card.setAttribute("aria-labelledby", header.id);
            }
        }
        // aria-hidden nur im geschlossenen Zustand setzen; im offenen Zustand entfernen,
        // damit der Dialog (role=dialog auf der Card) fuer AT sichtbar bleibt.
        const setAria = (hidden) => {
            if (hidden) overlay.setAttribute("aria-hidden", "true");
            else overlay.removeAttribute("aria-hidden");
        };
        const hiddenNow = overlay.classList.contains("hidden");
        setAria(hiddenNow);
        const obs = new MutationObserver(() => {
            const hidden = overlay.classList.contains("hidden");
            setAria(hidden);
            if (hidden) _onModalClose(overlay); else _onModalOpen(overlay);
        });
        obs.observe(overlay, { attributes: true, attributeFilter: ["class"] });
        if (!hiddenNow) _onModalOpen(overlay);
    });
}

async function init() {
    initTheme();   //: so frueh wie moeglich, um Theme-Flackern zu minimieren
    initModalA11y(); //: ARIA + Focus-Trap fuer alle Modals
    setupEventListeners();
    initTabNavigation();
    applyCachedNavVisibility(); //: Nav-Button synchron aus Auth-Cache setzen (kein Flackern)
    routePage(); // Route to correct view based on current URL
    applyViewMode();

    // : Wartungs-Gate so früh wie möglich — der Boot-Splash (#maintenance-overlay,
    // per Default sichtbar) deckt die App ab, daher kein Aufblitzen der echten Seite. Die
    // Admin-/Community-Ausnahme klärt der Server (`bypass`), sodass die Entscheidung NICHT auf
    // den vollständigen Auth-/Edition-Boot warten muss. Blockiert -> Splash zeigt die Wartungs-
    // meldung und der restliche Boot wird abgebrochen; sonst Splash ausblenden und normal weiter.
    if (await enforceMaintenanceGate()) return;
    hideBootSplash();

    await verifyConnection();
    await loadBrandConfig(); //: Laufzeit-Branding (Titel/Footer) fuer dynamische UI laden
    await loadEdition();   //: aktive Edition bestimmen, bevor Auth/UI aufgebaut wird
    // : Community hat jetzt echtes Login (Admin + vom Admin via Teams angelegte
    // Teammitglieder); ein abgemeldeter Besucher ist ein echter Gast. Daher in ALLEN
    // Editionen den realen Auth-Status vom Server bestimmen (kein simulierter Admin mehr).
    // Das behebt zugleich, dass im Gastzustand faelschlich die Admin-Navigation erschien.
    await checkAuthStatus();
    authReady = true;  // : Auth steht fest -> routePage darf /admin final entscheiden.
    // /: Zugriff auf /pricing und /teams erst final entscheiden,
    // wenn Edition + Auth geladen sind. Der fruehe routePage()-Aufruf nutzt noch
    // Defaults; hier neu evaluieren, falls eine dieser Seiten aktiv ist.
    // : /admin ebenfalls erst jetzt final routen (Admin sehen, Nicht-Admin umleiten).
    if (["/pricing", "/teams", "/admin"].includes(window.location.pathname)) routePage();
    updateMaintenanceBanner();  // : Admin-Wartungsbanner (falls aktiv).
    await fetchTimezone();
    await fetchPresets();
    await fetchPlaybooks();
    await startHistoryPolling();
    //  (Community): DSGVO/Cookie-Consent nur in der Cloud-Edition. Community/On-Premise
    // betreiben keine Telemetrie und brauchen daher kein Consent-Banner.
    if (currentEdition === "cloud") initCookieConsent();
}

// : Wartungsmodus-Gate. Liefert true, wenn die Wartungsseite gezeigt wurde (Aufrufer
// bricht den restlichen App-Aufbau ab). Die Admin-/Community-Ausnahme (`bypass`) entscheidet der
// Server, damit das Gate vor dem vollständigen Auth-/Edition-Boot laufen kann (kein FOUC).
async function enforceMaintenanceGate() {
    //: In der Community-Edition gibt es keinen Wartungsmodus (serverseitig deaktiviert,;
    // /api/maintenance liefert dort ohnehin immer bypass=true) und das Wartungs-Overlay wird aus dem
    // Build gestrippt. Hier sofort zurückkehren -> kein /api/maintenance-Roundtrip und kein kurzes
    // Aufblitzen des Boot-Splashes (VITE_EDITION ist eine Build-Zeit-Konstante, s. billing-Import).
    if (import.meta.env.VITE_EDITION === "community") return false;
    try {
        const r = await fetch("/api/maintenance", { cache: "no-store" });
        if (!r.ok) return false;
        const d = await r.json();
        if (d && d.active && !d.bypass) {
            // : Nicht-Admins im Wartungsmodus auf „/" umleiten (Ausnahme: /login),
            // statt die aufgerufene Route in der Adresszeile stehen zu lassen.
            if (window.location.pathname !== "/login" && window.location.pathname !== "/") {
                history.replaceState({}, "", "/");
            }
            showMaintenancePage(d.note);
            return true;
        }
    } catch (e) {
        // Bei Netzwerkfehler nicht aussperren (fail-open) — das Backend blockt ohnehin selbst.
    }
    return false;
}

// Boot-Splash ausblenden -> App wird sichtbar (normaler, nicht gesperrter Boot-Pfad).
function hideBootSplash() {
    const ov = document.getElementById("maintenance-overlay");
    if (ov) ov.classList.add("hidden");
    document.body.style.overflow = "";
}

// Boot-Splash auf die Wartungsmeldung umschalten (Spinner aus, Wartungsinhalt an) und sichtbar
// lassen. So sieht der Besucher nie die echte App, nur Splash -> Wartungsseite.
// : persistentes Wartungs-Banner für eingeloggte Admins (auf allen Seiten).
async function updateMaintenanceBanner() {
    const banner = document.getElementById("maintenance-admin-banner");
    if (!banner) return;
    let active = false;
    if (currentUser && currentUser.role === "admin" && currentEdition !== "community") {
        try {
            const r = await fetch("/api/maintenance", { cache: "no-store" });
            if (r.ok) active = !!(await r.json()).active;
        } catch (e) {}
    }
    banner.classList.toggle("hidden", !active);
}

function showMaintenancePage(note) {
    const noteEl = document.getElementById("maintenance-overlay-note");
    if (noteEl && note && note.trim()) noteEl.textContent = note;
    const loading = document.getElementById("maintenance-loading");
    if (loading) loading.classList.add("hidden");
    const content = document.getElementById("maintenance-content");
    if (content) content.classList.remove("hidden");
    const ov = document.getElementById("maintenance-overlay");
    if (ov) ov.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    // : Footer-Links ausblenden (nur Anmeldung erlauben).
    document.body.classList.add("maintenance-active");
    // : Anmelden-Button öffnet den Login-Dialog ÜBER der Wartungsseite (höherer z-index).
    const loginBtn = document.getElementById("maintenance-login-btn");
    if (loginBtn && !loginBtn.dataset.wired) {
        loginBtn.dataset.wired = "1";
        loginBtn.addEventListener("click", () => {
            const dlg = document.getElementById("login-dialog");
            if (dlg) { dlg.style.zIndex = "100001"; dlg.classList.remove("hidden"); }
        });
    }
}

//: Laufzeit-Branding (zur Build-Zeit aus config.yml erzeugt). Stellt den
// konfigurierten Marken-Titel und Footer-Text dynamisch fuer JS bereit, damit auch
// UI-Komponenten (nicht nur die eingebackene HTML) den Markennamen nutzen koennen.
let brandConfig = { title: "Ansimate", footer_text: null };
async function loadBrandConfig() {
    try {
        const r = await fetch("/branding-runtime.json", { cache: "no-store" });
        if (r.ok) {
            const d = await r.json();
            if (d && typeof d === "object") {
                if (d.title) brandConfig.title = d.title;
                if (d.footer_text) brandConfig.footer_text = d.footer_text;
            }
        }
    } catch (e) {
        // Kein Branding-Runtime vorhanden -> Standardwerte behalten.
    }
    // Footer-Text zur Laufzeit absichern (falls die HTML-Ersetzung nicht griff).
    if (brandConfig.footer_text) {
        const fb = document.querySelector(".footer-brand");
        if (fb) fb.textContent = brandConfig.footer_text;
    }
    if (brandConfig.title) document.title = brandConfig.title;
}

// Aktive Edition vom Backend laden. Faellt bei Fehler auf "cloud" zurueck.
async function loadEdition() {
    try {
        const r = await fetch("/api/version");
        if (r.ok) {
            const d = await r.json();
            if (d && d.edition) currentEdition = d.edition;
            // : anonyme Ausfuehrung kann serverseitig deaktiviert sein.
            if (d && typeof d.allow_anonymous_run === "boolean") allowAnonymousRun = d.allow_anonymous_run;
            // : Registrierung kann vom Admin deaktiviert sein.
            if (d && typeof d.registration_enabled === "boolean") registrationEnabled = d.registration_enabled;
        }
        applyRegistrationVisibility();
    } catch (e) {
        console.warn("Edition konnte nicht geladen werden, Standard 'cloud':", e);
    }
    document.body.classList.add("edition-" + currentEdition);
}

// Editionsspezifische UI-Regeln. Wird am Ende von updateAuthUI() aufgerufen,
// damit die Regeln nach jedem UI-Refresh erhalten bleiben.
function applyEditionRules() {
    if (currentEdition === "community") {
        // : Community hat echtes Login (Admin + vom Admin angelegte Teammitglieder).
        // Die Auth-Leiste bleibt sichtbar (Anmelden/Profil/Abmelden) — frueher war sie hier
        // komplett ausgeblendet. Nur die Selbstregistrierung entfaellt.
        applyRegistrationVisibility();
        //: "My Vault" bleibt in der Community-Edition fuer den System-Admin nutzbar — aber
        // eingeschraenkt: nur Szenarien + Geraete, KEIN Freigeben (keine weiteren Benutzer/Teams).
        // Nur "Teams" wird ausgeblendet. (Loest die zeitweise Vault-Ausblendung aus ab.)
        ["nav-btn-teams"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add("hidden");
        });
        //: Playbooks-Tab im Vault entfaellt in Community (Custom-Upload ist Backend-seitig
        // gesperrt,) -> nur Szenarien + Geraete. Presets-Tab ist ohnehin global aus.
        const pbTabBtn = document.getElementById("vault-tab-playbooks-btn");
        if (pbTabBtn) pbTabBtn.style.display = "none";
        //: Tab-Beschreibungen ohne Team-/Freigabe-Bezug (in Community nicht zutreffend).
        const devDesc = document.getElementById("vault-devices-desc");
        if (devDesc) devDesc.textContent = "Verwalten Sie Ihre Geräte: hinterlegen Sie Verbindungsdaten und Standardwerte für die Ausführung von Playbooks.";
        const scnDesc = document.getElementById("vault-scenarios-desc");
        if (scnDesc) scnDesc.textContent = "Ein Szenario verknüpft ein Preset (Playbooks + Einstellungen) fest mit einem Zielgerät. Ausführen per Klick im Startseiten-Abschnitt „Szenarios“.";
        //  (Community): Elemente ausblenden, die nur für Cloud/On-Premise gelten.
        // Hinweis: Wartungs-Config, Selbstregistrierungs-Schalter, Konten-Statistik-Charts und der
        // Webhook-Block werden inzwischen build-zeitlich ENTFERNT (Klasse community-strip), nicht
        // mehr hier per JS versteckt. Hier bleiben nur noch reine JS-Hides:
        //  - Admin: Benutzer-Tab (#admin-tab-users-btn via .community-hide-tab);
        //  - Admin-Config: die „System"-Kategorie-Überschrift (.community-hide), damit über dem
        //    verbleibenden SMTP-Test keine leere Überschrift steht;
        //  - Login: nur noch "Passwort vergessen?" — setzt funktionierendes SMTP voraus
        //    (Community hat i. d. R. keins; ohne SMTP würde es Konten aussperren), daher
        //    bewusst nur versteckt (mit SMTP nutzbar), nicht gestrippt. 2FA (E-Mail-OTP, ebenfalls
        //    SMTP-abhängig) wird jetzt BUILD-ZEITLICH gestrippt (.community-strip, enterprise-only).
        document.querySelectorAll(".community-hide-tab").forEach(el => { el.style.display = "none"; });
        document.querySelectorAll(".community-hide").forEach(el => { el.style.display = "none"; });
        ["forgot-password-link"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = "none";
        });
        //: Die Rechts-Footer-Links (Impressum/AGB/Datenschutz) werden in der
        // Community-Edition bereits BUILD-ZEITLICH aus dem HTML entfernt (strip-cloud-only.cjs,
        // Klasse "legal-only") — kein nachträgliches JS-Verstecken mehr (behebt das Flackern,
        //). Hier wird nur noch der einzelne Projekt-Webseiten-Link ergänzt.
        if (!document.getElementById("footer-link-project")) {
            const footer = document.querySelector("footer.config-footer");
            if (footer) {
                const sep = document.createElement("span");
                sep.className = "footer-sep";
                sep.textContent = "|";
                const a = document.createElement("a");
                a.id = "footer-link-project";
                a.className = "footer-link";
                a.href = COMMUNITY_PROJECT_URL;
                a.target = "_blank";
                a.rel = "noopener";
                a.textContent = "Projekt-Webseite";
                footer.appendChild(sep);
                footer.appendChild(a);
            }
        }
    } else if (currentEdition === "onpremise") {
        // Billing & Teams ausblenden, dauerhaft "Enterprise Pro" anzeigen.
        ["ptab-rechnungen", "ptab-teams"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = "none";
        });
        const billing = document.getElementById("profile-billing-section");
        if (billing) billing.style.display = "none";
        const invoices = document.getElementById("profile-invoices-section");
        if (invoices) invoices.style.display = "none";
        const tierVal = document.getElementById("profile-tier-val");
        if (tierVal) tierVal.textContent = "Enterprise Pro";
    }
    // : Pricing-/Billing-Funktionen (Tarif-/Gutschein-Admin-Tabs, Preisseite,
    // Preise-Footer-Link) existieren nur in der Cloud-Edition. Sonst ausblenden.
    if (currentEdition !== "cloud") {
        document.querySelectorAll(".cloud-only-tab, .cloud-only").forEach(el => { el.style.display = "none"; });
    }
}


// Tab Switching
function initTabNavigation() {
    const btnConfigure = document.getElementById("nav-btn-configure");
    const btnHistory = document.getElementById("nav-btn-history");
    const btnVault = document.getElementById("nav-btn-vault");

    btnConfigure.addEventListener("click", () => navigateTo("/"));
    btnHistory.addEventListener("click", () => navigateTo("/history"));

    //: Klick (oder Enter/Space) auf das Header-Logo fuehrt zur Startseite.
    const logoHome = document.getElementById("logo-home");
    if (logoHome) {
        logoHome.addEventListener("click", () => navigateTo("/"));
        logoHome.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigateTo("/"); }
        });
    }

    //: Header-"Teams" navigiert zur dedizierten Teams-Seite.
    const teamsNav = document.getElementById("nav-btn-teams");
    if (teamsNav) {
        teamsNav.addEventListener("click", () => {
            if (teamsNav.classList.contains("hidden")) return;
            navigateTo("/teams");
        });
    }
    //  (#A): Header-"My Vault" navigiert zur vereinten Vault-Seite (Playbooks/Geräte/Presets).
    if (btnVault) {
        btnVault.addEventListener("click", () => {
            if (btnVault.classList.contains("hidden")) return;
            navigateTo("/vault");
        });
    }

    // Footer legal link interception for SPA routing
    // : "Agent Instructions" (/llm) ebenfalls als SPA-Navigation abfangen.
    const footerLinkIds = ["footer-link-impressum", "footer-link-agb", "footer-link-datenschutz", "footer-link-llm"];
    footerLinkIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("click", (e) => {
                e.preventDefault();
                navigateTo(el.getAttribute("href"));
            });
        }
    });

    // Handle popstate (browser back/forward)
    window.addEventListener("popstate", () => routePage());

    // : Burger-Menue / mobiles Drawer verdrahten.
    const burgerBtn = document.getElementById("burger-btn");
    const drawerClose = document.getElementById("mobile-drawer-close");
    const drawerBackdrop = document.getElementById("mobile-drawer-backdrop");
    if (burgerBtn) burgerBtn.addEventListener("click", openMobileDrawer);
    if (drawerClose) drawerClose.addEventListener("click", closeMobileDrawer);
    if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeMobileDrawer);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const dr = document.getElementById("mobile-drawer");
            if (dr && !dr.classList.contains("hidden")) closeMobileDrawer();
        }
    });
}

// ---------------------------------------------------------------------------
// : Mobiles Navigations-Drawer (Burger-Menue). Statt die Nav-/Auth-/
// Footer-Logik zu duplizieren, werden im Drawer Proxy-Eintraege erzeugt, die
// per .click() die (auf Mobilgeraeten per CSS ausgeblendeten, aber weiterhin
// funktionsfaehigen) Original-Elemente ausloesen. Sichtbarkeit wird aus dem
// logischen Zustand der Originale (Klassen/Disabled/currentUser) abgeleitet.
// ---------------------------------------------------------------------------
function _drawerSourceUsable(el) {
    if (!el) return false;
    if (el.classList.contains("hidden")) return false;
    if (el.style.display === "none") return false;
    if (el.disabled || el.hasAttribute("disabled")) return false;
    return true;
}

function _addDrawerProxy(container, srcId, iconOverride) {
    const src = document.getElementById(srcId);
    if (!_drawerSourceUsable(src)) return;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "mobile-drawer-item";
    //: Label OHNE Icon-Ligatur ableiten. src.textContent enthielte sonst den Text des
    // .material-symbols-outlined-Spans (z. B. "terminal", "account_circle") und würde ihn als
    // Klartext vor das Label rendern. Daher an einem Klon die Icon-Spans entfernen.
    const labelSrc = src.cloneNode(true);
    labelSrc.querySelectorAll(".material-symbols-outlined").forEach(n => n.remove());
    const label = (labelSrc.textContent || "").replace(/\s+/g, " ").trim() || src.getAttribute("aria-label") || "";
    const icon = iconOverride || (src.querySelector(".material-symbols-outlined")?.textContent || "");
    item.innerHTML = (icon ? `<span class="material-symbols-outlined">${escapeHtml(icon)}</span>` : "") + `<span>${escapeHtml(label)}</span>`;
    item.addEventListener("click", () => { closeMobileDrawer(); src.click(); });
    container.appendChild(item);
}

function buildMobileDrawer() {
    const navSec = document.getElementById("mobile-drawer-nav");
    const authSec = document.getElementById("mobile-drawer-auth");
    const footSec = document.getElementById("mobile-drawer-footer");
    if (!navSec || !authSec || !footSec) return;
    navSec.innerHTML = ""; authSec.innerHTML = ""; footSec.innerHTML = "";

    // Navigation (nur sichtbare/aktive Header-Buttons)
    ["nav-btn-configure", "nav-btn-vault", "nav-btn-teams", "nav-btn-history", "nav-btn-admin"]
        .forEach(id => _addDrawerProxy(navSec, id));

    // Auth-Aktionen abhaengig vom Login-Zustand
    if (currentUser) {
        _addDrawerProxy(authSec, "profile-btn");
        _addDrawerProxy(authSec, "logout-btn");
    } else {
        _addDrawerProxy(authSec, "login-btn");
        _addDrawerProxy(authSec, "register-btn");
    }

    // Footer-Links (-Reihenfolge: API-Docs, Agent Instructions, Preise, AGB, Impressum, Datenschutz, Projekt)
    ["footer-link-docs", "footer-link-llm", "footer-link-pricing", "footer-link-agb", "footer-link-impressum", "footer-link-datenschutz", "footer-link-project"]
        .forEach(id => _addDrawerProxy(footSec, id));
}

function openMobileDrawer() {
    buildMobileDrawer();
    const dr = document.getElementById("mobile-drawer");
    const burger = document.getElementById("burger-btn");
    if (dr) dr.classList.remove("hidden");
    if (burger) burger.setAttribute("aria-expanded", "true");
    document.body.classList.add("drawer-open");
}

function closeMobileDrawer() {
    const dr = document.getElementById("mobile-drawer");
    const burger = document.getElementById("burger-btn");
    if (dr) dr.classList.add("hidden");
    if (burger) burger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
}

// Legal content definitions
//: Rechtstexte werden dynamisch vom Backend geladen (GET /api/legal/text/{doc}),
// nicht mehr hartcodiert. Map: SPA-Pfad -> Dokumentschluessel.
const LEGAL_PATHS = {
    "/impressum": "impressum",
    "/tos": "tos",
    "/privacy": "privacy"
};

async function loadLegalContent(doc) {
    const titleEl = document.getElementById("legal-content-title");
    const bodyEl = document.getElementById("legal-content-body");
    try {
        const r = await fetch("/api/legal/text/" + doc);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        if (titleEl) titleEl.innerHTML = d.title || "Rechtliche Informationen";
        if (bodyEl) bodyEl.innerHTML = d.html || "";
    } catch (e) {
        console.warn("Rechtstext konnte nicht geladen werden:", e);
        if (titleEl) titleEl.textContent = "Rechtliche Informationen";
        if (bodyEl) bodyEl.textContent = "Die rechtlichen Informationen konnten nicht geladen werden.";
    }
}

// : Agent-Anleitung (llm.txt) laden und rendern.
// Die Datei liegt statisch unter /llm.txt (nginx), ist in Markdown verfasst und wird
// clientseitig zu HTML gerendert. Bewusst KEIN externer Markdown-Parser: die CSP erlaubt
// nur script-src 'self'; der kleine, eigene Renderer deckt genau die in llm.txt genutzte
// Teilmenge ab (Überschriften, Absätze, Listen, Blockzitate, Code, Tabellen, Trennlinien).
function _mdInline(s) {
    // Erst komplett escapen, dann die Inline-Marker auf dem escapten Text anwenden.
    let out = escapeHtml(s);
    out = out.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
        (m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    return out;
}

function renderMarkdown(md) {
    const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let listType = null;   // "ul" | "ol" | null
    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
    const isSpecial = (l) => (
        /^\s*```/.test(l) || /^\s*#{1,6}\s/.test(l) || /^\s*(---|\*\*\*|___)\s*$/.test(l) ||
        /^\s*>\s?/.test(l) || /^\s*\d+\.\s+/.test(l) || /^\s*[-*]\s+/.test(l) || /\|/.test(l)
    );

    while (i < lines.length) {
        const line = lines[i];

        // Fenced code block — einrückungstolerant (Blöcke unter Aufzählungspunkten sind eingerückt);
        // die Einrückung der öffnenden Fence wird vom Inhalt entfernt.
        const fenceOpen = line.match(/^(\s*)```/);
        if (fenceOpen) {
            closeList();
            const indent = fenceOpen[1].length;
            const buf = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i].slice(indent)); i++; }
            i++; // schliessende Fence ueberspringen
            out.push(`<pre class="llm-code"><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
            continue;
        }

        // GFM-Tabelle: aktuelle Zeile hat |, naechste ist eine Trenn-Zeile (---|---)
        if (/\|/.test(line) && i + 1 < lines.length &&
            /-/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
            closeList();
            const parseRow = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
            const headers = parseRow(line);
            i += 2; // Kopf + Trenner ueberspringen
            let t = '<table class="llm-table"><thead><tr>';
            headers.forEach(h => { t += `<th>${_mdInline(h)}</th>`; });
            t += "</tr></thead><tbody>";
            while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") {
                const cells = parseRow(lines[i]);
                t += "<tr>" + cells.map(c => `<td>${_mdInline(c)}</td>`).join("") + "</tr>";
                i++;
            }
            t += "</tbody></table>";
            out.push(t);
            continue;
        }

        // Horizontale Trennlinie
        if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out.push("<hr>"); i++; continue; }

        // Ueberschrift
        const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
        if (h) { closeList(); const lv = h[1].length; out.push(`<h${lv}>${_mdInline(h[2])}</h${lv}>`); i++; continue; }

        // Blockzitat (aufeinanderfolgende >-Zeilen zusammenfassen)
        if (/^\s*>\s?/.test(line)) {
            closeList();
            const buf = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
            out.push(`<blockquote>${_mdInline(buf.join(" "))}</blockquote>`);
            continue;
        }

        // Nummerierte Liste
        let m = line.match(/^\s*\d+\.\s+(.*)$/);
        if (m) {
            if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
            out.push(`<li>${_mdInline(m[1])}</li>`); i++; continue;
        }
        // Aufzaehlung
        m = line.match(/^\s*[-*]\s+(.*)$/);
        if (m) {
            if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
            out.push(`<li>${_mdInline(m[1])}</li>`); i++; continue;
        }

        // Leerzeile
        if (line.trim() === "") { closeList(); i++; continue; }

        // Absatz (bis zur naechsten Leerzeile / Spezialzeile sammeln)
        closeList();
        const pbuf = [line];
        i++;
        while (i < lines.length && lines[i].trim() !== "" && !isSpecial(lines[i])) { pbuf.push(lines[i]); i++; }
        out.push(`<p>${_mdInline(pbuf.join(" "))}</p>`);
    }
    closeList();
    return out.join("\n");
}

async function loadLlmInstructions() {
    const bodyEl = document.getElementById("llm-instructions-body");
    if (!bodyEl) return;
    if (bodyEl.dataset.loaded === "1") return;   // einmal laden reicht
    try {
        const r = await fetch("/llm.txt", { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const md = await r.text();
        bodyEl.innerHTML = renderMarkdown(md);
        bodyEl.dataset.loaded = "1";
    } catch (e) {
        console.warn("Agent-Anleitung konnte nicht geladen werden:", e);
        bodyEl.textContent = "Die Agent-Anleitung konnte nicht geladen werden.";
    }
}

function navigateTo(path) {
    history.pushState({}, "", path);
    routePage();
}

function routePage() {
    const path = window.location.pathname;
    const configCard = document.getElementById("config-card");
    const vaultCard = document.getElementById("vault-card");
    const legalCard = document.getElementById("legal-content-card");
    const llmCard = document.getElementById("llm-instructions-card");
    const adminCard = document.getElementById("admin-card");
    const pricingCard = document.getElementById("pricing-card");
    const teamsCard = document.getElementById("teams-card");

    // Hide all primary views
    const hideAll = () => {
        [configCard, vaultCard, legalCard, llmCard, adminCard, pricingCard, teamsCard].forEach(el => {
            if (el) { el.classList.add("hidden"); el.style.display = "none"; }
        });
        //: API-Docs-Footer-Link standardmaessig wieder einblenden (auf /pricing aus).
        const docsLink = document.getElementById("footer-link-docs");
        if (docsLink) docsLink.style.display = "";
        document.body.classList.remove("tab-configure", "tab-history", "tab-vault", "tab-admin", "tab-legal", "tab-pricing", "tab-teams");
        const teamsNavBtn = document.getElementById("nav-btn-teams");
        if (teamsNavBtn) teamsNavBtn.classList.remove("active");
        const vaultNavBtn = document.getElementById("nav-btn-vault");
        if (vaultNavBtn) vaultNavBtn.classList.remove("active");
        document.getElementById("nav-btn-configure").classList.remove("active");
        document.getElementById("nav-btn-history").classList.remove("active");
        const btnAdmin = document.getElementById("nav-btn-admin");
        if (btnAdmin) btnAdmin.classList.remove("active");
    };

    if (path === "/" || path === "" || path === "/reset-password" || path === "/verify-email") {
        // "/reset-password" and "/verify-email" show the default view; the
        // corresponding flow is handled separately and then cleans the URL.
        hideAll();
        if (configCard) { configCard.classList.remove("hidden"); configCard.style.removeProperty("display"); }
        document.body.classList.add("tab-configure");
        document.getElementById("nav-btn-configure").classList.add("active");
    } else if (path === "/history") {
        hideAll();
        document.body.classList.add("tab-history");
        document.getElementById("nav-btn-history").classList.add("active");
    } else if (path === "/vault" || path.startsWith("/vault/")) {
        //  (#A): "My Vault" — Eigene Playbooks/Geräte/Presets/Szenarios als Tabs unter einer
        // Seite. Nur fuer eingeloggte Nicht-Gaeste; das Abo wird pro Tab/Endpoint erzwungen,
        // nicht durch Ausblenden des ganzen Vaults.
        //: In der Community-Edition ist My Vault (eingeschraenkt) erreichbar — nicht mehr sperren.
        if (!currentUser || currentUser.role === "guest") {
            history.replaceState({}, "", "/");
            routePage();
            return;
        }
        hideAll();
        if (vaultCard) { vaultCard.classList.remove("hidden"); vaultCard.style.display = "flex"; }
        document.body.classList.add("tab-vault");
        const btnVault = document.getElementById("nav-btn-vault");
        if (btnVault) btnVault.classList.add("active");
        // : Beim Öffnen von "My Vault" ohne expliziten Tab standardmäßig Szenarien zeigen.
        const vaultTab = path.split("/")[2] || "scenarios";
        switchVaultTab(vaultTab);
    } else if (path === "/admin") {
        // : Solange die Auth noch lädt, NICHT entscheiden — kein Admin-Markup zeigen
        // (kein Flicker) und Admins nicht verfrüht umleiten. init() routet /admin nach dem
        // Auth-Boot erneut.
        if (!authReady) { hideAll(); return; }
        // Berechtigung ZUERST prüfen — Nicht-Admins vor jeglichem Admin-Markup auf „/" leiten.
        if (!currentUser || currentUser.role !== "admin") {
            history.replaceState({}, "", "/");
            routePage();
            return;
        }
        hideAll();
        if (adminCard) { adminCard.classList.remove("hidden"); adminCard.style.display = "flex"; }
        document.body.classList.add("tab-admin");
        const btnAdmin = document.getElementById("nav-btn-admin");
        if (btnAdmin) btnAdmin.classList.add("active");
        openAdminDashboard();
    } else if (LEGAL_PATHS[path]) {
        hideAll();
        //: eigene Body-Klasse, damit die Job-Historie/Konsole (#right-column)
        // auf Rechtsseiten ausgeblendet wird (CSS-Regeln haengen an tab-* Klassen).
        document.body.classList.add("tab-legal");
        if (legalCard) {
            legalCard.classList.remove("hidden");
            legalCard.style.display = "flex";
            //: Inhalt dynamisch aus den serverseitigen Textdateien laden.
            loadLegalContent(LEGAL_PATHS[path]);
        }
    } else if (path === "/llm") {
        // : Agent-Anleitung (llm.txt) als eigene SPA-Karte — in ALLEN Editionen.
        // Gleiche Body-Klasse wie Rechtsseiten, damit die Job-Konsole (#right-column)
        // ausgeblendet wird und der Doku-Inhalt die volle Breite bekommt.
        hideAll();
        document.body.classList.add("tab-legal");
        if (llmCard) {
            llmCard.classList.remove("hidden");
            llmCard.style.display = "flex";
            loadLlmInstructions();
        }
    } else if (path === "/pricing") {
        // : Preisseite nur in der Cloud-Edition.: Gaeste DUERFEN die Preisseite
        // einsehen (zum Informieren), koennen aber nicht buchen.  (-Feedback): Admins DUERFEN
        // die Preisseite jetzt ebenfalls einsehen (read-only) — sie verwalten Tarife und wollen die
        // oeffentliche Ansicht pruefen; frueher wurden sie hier auf "/" umgeleitet (Bounce nach Auth-Boot).
        if (currentEdition !== "cloud") {
            history.replaceState({}, "", "/");
            routePage();
            return;
        }
        hideAll();
        document.body.classList.add("tab-pricing");
        //: API-Docs-Link auf der Preisseite ausblenden.
        const docsLink = document.getElementById("footer-link-docs");
        if (docsLink) docsLink.style.display = "none";
        if (pricingCard) { pricingCard.classList.remove("hidden"); pricingCard.style.display = "flex"; }
        fetchPricing();
    } else if (path === "/teams") {
        // : Solange die Auth noch lädt, NICHT entscheiden — sonst redirectet der frühe
        // routePage()-Aufruf den (noch unbekannten) Nutzer auf „/" und überschreibt die URL,
        // wodurch das Post-Auth-Re-Routing für /teams nicht mehr greift. init() routet /teams
        // nach dem Auth-Boot erneut (analog /admin).
        if (!authReady) { hideAll(); return; }
        ///: dedizierte Teams-Seite. Admins dürfen sie jetzt nutzen; weiterhin
        // gesperrt für Gäste/ausgeloggte Besucher und in der On-Premise-Edition.
        if (!currentUser || currentUser.role === "guest" || currentEdition === "onpremise" || currentEdition === "community") {
            history.replaceState({}, "", "/");
            routePage();
            return;
        }
        hideAll();
        document.body.classList.add("tab-teams");
        const teamsNavActive = document.getElementById("nav-btn-teams");
        if (teamsNavActive) teamsNavActive.classList.add("active");
        if (teamsCard) { teamsCard.classList.remove("hidden"); teamsCard.style.display = "flex"; }
        switchTeamsTab("users");   // : immer auf Benutzer-Tab starten
        fetchGuests();
        loadAuditLog();   // : Team-Aktivitaetsprotokoll laden
        //  (#D): Eigene Presets liegen jetzt im Vault-Presets-Tab (nicht mehr auf /teams).
    } else if (path === "/custom-playbooks") {
        //  (#A) Backward-Compat: alte Direktlinks auf den passenden Vault-Tab umleiten.
        history.replaceState({}, "", "/vault/playbooks");
        routePage();
        return;
    } else if (path === "/devices") {
        history.replaceState({}, "", "/vault/devices");
        routePage();
        return;
    } else {
        // Unknown path: fallback to configure
        history.replaceState({}, "", "/");
        routePage();
    }
}

// Alias setTab for backward compatibility
function setTab(tabId) {
    const pathMap = { configure: "/", history: "/history", "custom-playbooks": "/vault/playbooks", vault: "/vault" };
    navigateTo(pathMap[tabId] || "/");
}


function setupEventListeners() {
    runForm.addEventListener("submit", handleSidebarSubmit);
    
    playbooksList.addEventListener("change", (e) => {
        if (e.target && e.target.name === "playbooks") {
            const val = e.target.value;
            const checked = e.target.checked;
            
            // Synchronize selection state for same playbook across categories
            const matchingCheckboxes = playbooksList.querySelectorAll(`input[name="playbooks"][value="${val}"]`);
            matchingCheckboxes.forEach(cb => {
                cb.checked = checked;
            });
            
            if (checked) {
                checkPlaybookAndDependencies(matchingCheckboxes[0]);
            }
            
            updatePresetHighlights();
        }
    });

    playbooksList.addEventListener("click", (e) => {
        const presetTile = e.target.closest(".preset-tile");
        if (presetTile) {
            const presetName = presetTile.dataset.presetName;
            const preset = allPresets.find(p => p.name === presetName);
            if (preset) {
                // Determine if preset is currently "fully selected" (active)
                let allChecked = true;
                preset.playbooks.forEach(pb => {
                    const cb = playbooksList.querySelector(`input[name="playbooks"][value="${pb.file}"]`);
                    if (!cb || !cb.checked) {
                        allChecked = false;
                    }
                });
                
                // Toggle state: if all checked, uncheck all. Otherwise, check all.
                const shouldCheck = !allChecked;
                
                preset.playbooks.forEach(pb => {
                    const cb = playbooksList.querySelector(`input[name="playbooks"][value="${pb.file}"]`);
                    if (cb) {
                        cb.checked = shouldCheck;
                        // Synchronize state for same playbook across categories
                        const matchingCheckboxes = playbooksList.querySelectorAll(`input[name="playbooks"][value="${pb.file}"]`);
                        matchingCheckboxes.forEach(mcb => {
                            mcb.checked = shouldCheck;
                        });
                        
                        if (shouldCheck) {
                            checkPlaybookAndDependencies(cb);
                        }
                    }
                });
                
                // Update UI preset selection highlights
                updatePresetHighlights();
            }
        }
    });

    
    autoscrollBtn.addEventListener("click", () => {
        autoscrollBtn.classList.toggle("active");
    });

    //: Umschalter Kachel-/Flow-Chart-Ansicht <-> Text-Log. Standard = Kacheln.
    if (viewToggleBtn) {
        viewToggleBtn.addEventListener("click", () => {
            jobViewMode = jobViewMode === "tiles" ? "log" : "tiles";
            applyJobViewMode();
        });
    }
    applyJobViewMode();

    // : Firefox-Fallback (textarea + execCommand) + Erfolgs-Toast, gespiegelt an copyGuestActivity().
    copyLogsBtn.addEventListener("click", async () => {
        if (!consoleOutput.textContent) return;
        const text = consoleOutput.textContent;
        try {
            await navigator.clipboard.writeText(text);
            showToast("Protokolle in Zwischenablage kopiert!");
        } catch (e) {
            // Fallback ohne Clipboard-API (z. B. Firefox / unsicherer Kontext).
            const ta = document.createElement("textarea");
            ta.value = text; document.body.appendChild(ta); ta.select();
            try { document.execCommand("copy"); showToast("Protokolle in Zwischenablage kopiert!"); }
            catch (x) { showToast("Kopieren fehlgeschlagen."); }
            document.body.removeChild(ta);
        }
    });

    // : Abbrechen-Button im Konsolen-Header (bricht die aktuell gewählte Ausführung ab).
    const cancelJobBtn = document.getElementById("cancel-job-btn");
    if (cancelJobBtn) {
        cancelJobBtn.addEventListener("click", () => {
            if (selectedJobId) cancelJob(selectedJobId);
        });
    }

    // View Mode toggles
    viewGridBtn.addEventListener("click", () => setViewMode("grid"));
    viewListBtn.addEventListener("click", () => setViewMode("list"));

    // Playbook/Preset-Suche
    //: Suche filtert nur die Sichtbarkeit (kein Neuaufbau), damit die getroffene
    // Playbook-Auswahl beim Tippen erhalten bleibt.
    const playbookSearch = document.getElementById("playbook-search");
    if (playbookSearch) playbookSearch.addEventListener("input", applyPlaybookSearch);

    // Modal actions
    //: Abbrechen, Backdrop-Klick und ESC schliessen mit Warnung bei ungespeicherten
    // Eingaben; jede Nutzereingabe im Dialog markiert ihn als "dirty".
    modalCancelBtn.addEventListener("click", closeCredentialsModalGuarded);
    modalSubmitBtn.addEventListener("click", handleModalSubmit);
    //  (#E): "Nur als Preset speichern" + Checkbox blendet das Namensfeld ein.
    const modalSavePresetBtn = document.getElementById("modal-save-preset-btn");
    if (modalSavePresetBtn) modalSavePresetBtn.addEventListener("click", handleSavePresetFromDialog);
    // : "Nur als Preset speichern" erst aktiv, wenn ein Preset-Name eingegeben wurde.
    const modalPresetNameInp = document.getElementById("modal-preset-name");
    if (modalPresetNameInp && modalSavePresetBtn) {
        modalPresetNameInp.addEventListener("input", () => {
            modalSavePresetBtn.disabled = modalPresetNameInp.value.trim().length === 0;
        });
    }
    enableModalDismiss("credentials-dialog", closeCredentialsModalGuarded);
    // : Buttons des gestylten Abbrechen-Bestätigungsdialogs (verwerfen / weiter bearbeiten).
    const _discardHide = () => { const d = document.getElementById("discard-confirm-dialog"); if (d) d.classList.add("hidden"); };
    const discardCancel = document.getElementById("discard-confirm-cancel");
    if (discardCancel) discardCancel.addEventListener("click", _discardHide);
    const discardOk = document.getElementById("discard-confirm-ok");
    if (discardOk) discardOk.addEventListener("click", () => { _discardHide(); hideCredentialsModal(); });
    enableModalDismiss("discard-confirm-dialog", _discardHide);
    credentialsDialog.addEventListener("input", () => { modalDirty = true; });

    //: Premium-Upsell-Modal (Abbrechen / CTA zur Preisseite / Backdrop+ESC).
    const upsellCancel = document.getElementById("premium-upsell-cancel");
    const upsellCta = document.getElementById("premium-upsell-cta");
    if (upsellCancel) upsellCancel.addEventListener("click", closePremiumUpsell);
    if (upsellCta) upsellCta.addEventListener("click", () => { closePremiumUpsell(); goToPricing(); });
    enableModalDismiss("premium-upsell-dialog", closePremiumUpsell);
    // : Hersteller-Info-Dialog schliessbar (Overlay-Klick/ESC + Button).
    enableModalDismiss("playbook-vendor-dialog", closeVendorDialog);
    const vendorCloseBtn = document.getElementById("playbook-vendor-close-btn");
    if (vendorCloseBtn) vendorCloseBtn.addEventListener("click", closeVendorDialog);

    // Dynamic Autofill for BASE_DIR based on username input
    modalUsernameInput.addEventListener("input", () => {
        const username = modalUsernameInput.value.trim();
        
        // Only autofill if the field has not been edited manually by the user
        if (!modalBaseDirInput.dataset.edited || modalBaseDirInput.dataset.edited === "false") {
            if (username) {
                if (username === "root") {
                    modalBaseDirInput.value = "/root";
                } else {
                    modalBaseDirInput.value = `/home/${username}`;
                }
            } else {
                modalBaseDirInput.value = "";
            }
        }
    });

    // Lock autofill once the user starts manually typing in the base directory field
    modalBaseDirInput.addEventListener("input", () => {
        modalBaseDirInput.dataset.edited = "true";
    });

    // Auth Dialog Triggers
    const loginBtn = document.getElementById("login-btn");
    const registerBtn = document.getElementById("register-btn");
    const profileBtn = document.getElementById("profile-btn");
    const logoutBtn = document.getElementById("logout-btn");
    
    if (loginBtn) loginBtn.addEventListener("click", () => document.getElementById("login-dialog").classList.remove("hidden"));
    if (registerBtn) registerBtn.addEventListener("click", openRegisterModal);
    if (profileBtn) profileBtn.addEventListener("click", openProfileDialog);
    setupProfileTabs();
    if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

    // Close modal actions
    const closeLogin = () => document.getElementById("login-dialog").classList.add("hidden");
    document.getElementById("close-login-btn").addEventListener("click", closeLogin);
    document.getElementById("close-otp-btn")?.addEventListener("click", () => document.getElementById("otp-dialog")?.classList.add("hidden"));
    //: null-safe, da der Registrieren-Dialog in der Community-Edition aus dem HTML entfernt wird.
    document.getElementById("close-register-btn")?.addEventListener("click", closeRegisterModal);
    document.getElementById("close-profile-btn").addEventListener("click", () => document.getElementById("profile-dialog").classList.add("hidden"));

    // Forgot/Reset password wiring
    document.getElementById("forgot-password-link").addEventListener("click", (e) => { e.preventDefault(); openForgotModal(); });
    document.getElementById("close-forgot-btn").addEventListener("click", closeForgotModal);
    document.getElementById("forgot-form").addEventListener("submit", handleForgotSubmit);
    document.getElementById("close-reset-btn").addEventListener("click", closeResetModal);
    document.getElementById("reset-form").addEventListener("submit", handleResetSubmit);
    document.getElementById("reset-password").addEventListener("input", updateResetRequirements);
    document.getElementById("reset-password-confirm").addEventListener("input", checkResetMatch);

    // ESC / backdrop dismissal for auth modals
    enableModalDismiss("login-dialog", closeLogin);
    enableModalDismiss("otp-dialog", () => document.getElementById("otp-dialog").classList.add("hidden"));
    enableModalDismiss("register-dialog", closeRegisterModal);
    enableModalDismiss("forgot-dialog", closeForgotModal);
    enableModalDismiss("reset-dialog", closeResetModal);
    enableModalDismiss("profile-dialog", () => document.getElementById("profile-dialog").classList.add("hidden"));

    // Password visibility toggles (all eye buttons)
    setupPasswordToggles();

    // Open reset-password modal if arrived via e-mail link (/reset-password?token=...)
    openResetModalFromUrl();

    // Handle e-mail verification link (/verify-email?token=...)
    handleVerifyEmailFromUrl();

    // Register password: live requirements check
    document.getElementById("register-password")?.addEventListener("input", updatePasswordRequirements);

    // Register password confirm: live mismatch check
    document.getElementById("register-password-confirm")?.addEventListener("input", checkPasswordMatch);

    // Profile 2FA toggle
    document.getElementById("profile-2fa-toggle")?.addEventListener("change", handle2FAToggle);

    // Device groups
    const dgSave = document.getElementById("device-group-save-btn");
    const dgCancel = document.getElementById("device-group-cancel-btn");
    if (dgSave) dgSave.addEventListener("click", saveDeviceGroup);
    if (dgCancel) dgCancel.addEventListener("click", resetDeviceGroupForm);
    // : Filter fuer die Szenario-Playbook-Auswahl
    const dgPbFilter = document.getElementById("device-group-playbook-filter");
    if (dgPbFilter) dgPbFilter.addEventListener("input", (e) => filterDeviceGroupPlaybooks(e.target.value));
    //  (#C): Verwaltete Einzelgeraete (Vault-Geraete-Tab) + Freigabe-Modal verdrahten.
    const mdSave = document.getElementById("managed-device-save-btn");
    if (mdSave) mdSave.addEventListener("click", saveManagedDevice);
    const mdCancel = document.getElementById("managed-device-cancel-btn");
    if (mdCancel) mdCancel.addEventListener("click", closeManagedDeviceDialog);  // : Dialog schließen
    // : ESC / Klick außerhalb prüft auf ungespeicherte Eingaben (dataset.dirty).
    enableAdminDialogDismiss("managed-device-dialog", closeManagedDeviceDialog);
    // : FAB + Cancel-Buttons der Erstell-/Bearbeiten-Dialoge.
    const vaultFab = document.getElementById("vault-fab");
    if (vaultFab) vaultFab.addEventListener("click", onVaultFab);
    // : Beispiel-Playbook (Hello World) als YAML herunterladen.
    const dlExample = document.getElementById("download-example-playbook-btn");
    if (dlExample) dlExample.addEventListener("click", downloadExamplePlaybook);
    const pbCreateCancel = document.getElementById("custom-pb-create-cancel");
    if (pbCreateCancel) pbCreateCancel.addEventListener("click", closeCustomPbCreateDialog);
    // : Preset-Erstell-Wizard
    const pwCancel = document.getElementById("preset-wizard-cancel");
    if (pwCancel) pwCancel.addEventListener("click", closePresetWizard);
    const pwBack = document.getElementById("preset-wizard-back");
    if (pwBack) pwBack.addEventListener("click", presetWizardBack);
    const pwNext = document.getElementById("preset-wizard-next");
    if (pwNext) pwNext.addEventListener("click", presetWizardNext);
    const pwFinish = document.getElementById("preset-wizard-finish");
    if (pwFinish) pwFinish.addEventListener("click", presetWizardFinish);
    const pwFilter = document.getElementById("preset-wizard-pb-filter");
    if (pwFilter) pwFilter.addEventListener("input", (e) => renderWizardPlaybooks(e.target.value));
    // : Szenario-Erstell-Wizard
    const swCancel = document.getElementById("scenario-wizard-cancel");
    if (swCancel) swCancel.addEventListener("click", closeScenarioWizard);
    const swBack = document.getElementById("scenario-wizard-back");
    if (swBack) swBack.addEventListener("click", scenarioWizardBack);
    const swNext = document.getElementById("scenario-wizard-next");
    if (swNext) swNext.addEventListener("click", scenarioWizardNext);
    const swFinish = document.getElementById("scenario-wizard-finish");
    if (swFinish) swFinish.addEventListener("click", scenarioWizardFinish);
    const swFilter = document.getElementById("scenario-wizard-pb-filter");
    if (swFilter) swFilter.addEventListener("input", (e) => renderWizardPlaybooks(e.target.value, scenarioWizardCtx()));
    // : ESC / Klick außerhalb prüft auf ungespeicherte Eingaben (dataset.dirty).
    enableAdminDialogDismiss("scenario-wizard-dialog", closeScenarioWizard);
    // : Einmal-Geräte-Dialog beim geräteslosen Szenario-Run
    const srdCancel = document.getElementById("scenario-run-device-cancel");
    if (srdCancel) srdCancel.addEventListener("click", closeScenarioRunDeviceDialog);
    const srdGo = document.getElementById("scenario-run-device-go");
    if (srdGo) srdGo.addEventListener("click", submitScenarioRunDevice);
    // : SSH-Key-Upload im Einmal-Geräte-Dialog (Klick öffnet Dateiauswahl, Entfernen leert sie).
    const srdKeyDz = document.getElementById("scenario-run-key-dropzone");
    const srdKeyFile = document.getElementById("scenario-run-key-file");
    const srdKeyReset = document.getElementById("scenario-run-key-reset");
    if (srdKeyDz && srdKeyFile) {
        srdKeyDz.addEventListener("click", (e) => { if (e.target !== srdKeyReset) srdKeyFile.click(); });
        srdKeyFile.addEventListener("change", () => {
            const has = !!(srdKeyFile.files && srdKeyFile.files[0]);
            const lbl = document.getElementById("scenario-run-key-filename-lbl");
            if (lbl) lbl.textContent = has ? srdKeyFile.files[0].name : "Keine Datei ausgewählt";
            if (srdKeyReset) srdKeyReset.classList.toggle("hidden", !has);
        });
    }
    if (srdKeyReset) srdKeyReset.addEventListener("click", _resetScenarioRunKeyUpload);
    // Basisverzeichnis aus dem SSH-Benutzer ableiten (root -> /root, sonst /home/<user>),
    // solange der Nutzer das Feld nicht selbst bearbeitet hat (gleiche Logik wie im Run-Dialog).
    const srdUser = document.getElementById("scenario-run-user");
    const srdBaseDir = document.getElementById("scenario-run-basedir");
    if (srdUser && srdBaseDir) {
        srdUser.addEventListener("input", () => {
            if (srdBaseDir.dataset.edited === "true") return;
            const u = srdUser.value.trim();
            srdBaseDir.value = u ? (u === "root" ? "/root" : `/home/${u}`) : "";
        });
        srdBaseDir.addEventListener("input", () => { srdBaseDir.dataset.edited = "true"; });
    }
    // : sobald der Nutzer das Platzhalter-Passwort anfasst, gilt es als geändert
    // (leer = löschen, Eingabe = neues Secret).
    const mdCred = document.getElementById("managed-device-credential");
    if (mdCred) mdCred.addEventListener("input", () => { mdCred.dataset.placeholder = ""; });
    // : Basisverzeichnis aus dem SSH-Benutzer ableiten (root -> /root, sonst /home/<user>),
    // solange das Feld nicht manuell bearbeitet wurde (gleiche Logik wie Run-/Einmal-Geräte-Dialog).
    const mdUser = document.getElementById("managed-device-user");
    const mdBaseDir = document.getElementById("managed-device-basedir");
    if (mdUser && mdBaseDir) {
        mdUser.addEventListener("input", () => {
            if (mdBaseDir.dataset.edited === "true") return;
            const u = mdUser.value.trim();
            mdBaseDir.value = u ? (u === "root" ? "/root" : `/home/${u}`) : "";
        });
        mdBaseDir.addEventListener("input", () => { mdBaseDir.dataset.edited = "true"; });
    }
    // : SSH-Key-Upload-Dropzone (Klick öffnet Dateiauswahl; Auswahl zeigt den Dateinamen).
    const mdKeyDz = document.getElementById("managed-device-key-dropzone");
    const mdKeyFile = document.getElementById("managed-device-key-file");
    if (mdKeyDz && mdKeyFile) {
        mdKeyDz.addEventListener("click", () => mdKeyFile.click());
        mdKeyFile.addEventListener("change", () => {
            const lbl = document.getElementById("managed-device-key-filename-lbl");
            if (lbl) lbl.textContent = (mdKeyFile.files && mdKeyFile.files[0]) ? mdKeyFile.files[0].name : "Keine Datei ausgewählt";
        });
    }
    const mdShareCancel = document.getElementById("managed-device-share-cancel");
    if (mdShareCancel) mdShareCancel.addEventListener("click", closeManagedDeviceShare);
    const mdShareSave = document.getElementById("managed-device-share-save");
    if (mdShareSave) mdShareSave.addEventListener("click", saveManagedDeviceShare);

    // : Custom-Presets
    const presetSave = document.getElementById("preset-save-btn");
    const presetCancel = document.getElementById("preset-cancel-btn");
    if (presetSave) presetSave.addEventListener("click", savePreset);
    if (presetCancel) presetCancel.addEventListener("click", closePresetModal);  //  (#D): Modal schliessen
    const presetPbFilter = document.getElementById("preset-playbook-filter");
    if (presetPbFilter) presetPbFilter.addEventListener("input", (e) => filterPresetPlaybooks(e.target.value));
    //  (#D): Klick ausserhalb schliesst das Preset-Modal (geöffnet via "Bearbeiten";
    // neue Presets entstehen im Ausführen-Dialog, daher kein "Neues Preset"-Button mehr).
    enableModalDismiss("preset-edit-dialog", closePresetModal);

    // Profile password change
    document.getElementById("profile-password-form").addEventListener("submit", handlePasswordChange);
    document.getElementById("pw-change-new").addEventListener("input", updatePwChangeRequirements);
    document.getElementById("pw-change-confirm").addEventListener("input", checkPwChangeMatch);

    
    document.getElementById("close-devices-btn").addEventListener("click", () => {
        document.getElementById("devices-dialog").classList.add("hidden");
        credentialsDialog.classList.remove("hidden");
    });
    
    //  (#C): "Geräte verwalten"-Shortcut im Ausführen-Dialog zeigt jetzt auf den Vault-Geräte-Tab.
    // Das alte #devices-dialog ist aus dem Flow genommen (/api/devices bleibt intern fuer das Dropdown).
    const manageDevicesShortcut = document.getElementById("manage-devices-shortcut");
    if (manageDevicesShortcut) manageDevicesShortcut.addEventListener("click", () => {
        credentialsDialog.classList.add("hidden");
        navigateTo("/vault/devices");
    });
    
    // Submit forms
    document.getElementById("login-form").addEventListener("submit", handleLoginSubmit);
    document.getElementById("otp-form")?.addEventListener("submit", handleOtpSubmit);
    document.getElementById("register-form")?.addEventListener("submit", handleRegisterSubmit);
    document.getElementById("profile-update-form").addEventListener("submit", handleProfileUpdateSubmit);
    document.getElementById("delete-confirm-form")?.addEventListener("submit", handleDeleteConfirmSubmit);  // cloud-only: in Community gestrippt
    document.getElementById("device-edit-form").addEventListener("submit", handleDeviceFormSubmit);
    
    // Profile settings changes
    document.getElementById("profile-email-notif").addEventListener("change", handleNotificationToggle);
    // : Webhook-URL speichern.
    const webhookBtn = document.getElementById("profile-webhook-save-btn");
    if (webhookBtn) webhookBtn.addEventListener("click", handleWebhookSave);
    document.getElementById("profile-export-btn").addEventListener("click", handleProfileExport);
    document.getElementById("logout-all-btn").addEventListener("click", handleLogoutAll);
    document.getElementById("profile-delete-btn")?.addEventListener("click", () => document.getElementById("delete-confirm-dialog").classList.remove("hidden"));
    document.getElementById("profile-cancel-delete-btn")?.addEventListener("click", handleCancelDeletion);
    document.getElementById("subscribe-now-btn")?.addEventListener("click", handleSubscribeNow);
    document.getElementById("manage-billing-btn")?.addEventListener("click", handleManageBilling);
    document.getElementById("close-delete-confirm-btn")?.addEventListener("click", () => document.getElementById("delete-confirm-dialog").classList.add("hidden"));

    // Admin Control Panel triggers
    const adminBtn = document.getElementById("nav-btn-admin");
    if (adminBtn) adminBtn.addEventListener("click", () => navigateTo("/admin"));
    document.getElementById("close-admin-edit-user-btn")?.addEventListener("click", () => document.getElementById("admin-edit-user-dialog").classList.add("hidden"));  // community-strip

    // Admin tab bar buttons
    document.getElementById("admin-tab-dashboard-btn").addEventListener("click", () => switchAdminTab("dashboard"));
    document.getElementById("admin-tab-users-btn")?.addEventListener("click", () => switchAdminTab("users"));  // community-strip: in Community gestrippt
    document.getElementById("admin-tab-config-btn").addEventListener("click", () => switchAdminTab("config"));
    document.getElementById("admin-tab-ip-btn").addEventListener("click", () => switchAdminTab("ip"));
    // : „Audit-Log"-Tab entfernt -> Inhalt jetzt im Tab „Protokolle" (security).
    document.getElementById("admin-tab-security-btn").addEventListener("click", () => switchAdminTab("security"));
    // : zentraler Admin-FAB (Aktion je aktivem Tab).
    const adminFab = document.getElementById("admin-fab");
    if (adminFab) adminFab.addEventListener("click", onAdminFab);
    // : Export-Dialog der Protokolle.
    const expCancel = document.getElementById("admin-export-cancel");
    if (expCancel) expCancel.addEventListener("click", closeAdminExportDialog);
    const expGo = document.getElementById("admin-export-go");
    if (expGo) expGo.addEventListener("click", runAdminExport);
    // : Benutzer-erstellen-Dialog.
    const ucCancel = document.getElementById("admin-user-create-cancel");
    if (ucCancel) ucCancel.addEventListener("click", closeAdminUserCreateDialog);
    const ucForm = document.getElementById("admin-user-create-form");
    if (ucForm) ucForm.addEventListener("submit", handleAdminUserCreate);
    // : IP-Sperre-Dialog Abbrechen.
    const ipCancel = document.getElementById("admin-ip-cancel");
    if (ipCancel) ipCancel.addEventListener("click", closeIpBlockDialog);
    // : SMTP-Test-E-Mail.
    const testEmailBtn = document.getElementById("admin-test-email-btn");
    if (testEmailBtn) testEmailBtn.addEventListener("click", sendAdminTestEmail);
    // : ESC/Backdrop-Schließen für Admin-Dialoge (Formulare mit Dirty-Warnung; Export ohne).
    enableAdminDialogDismiss("admin-user-create-dialog", closeAdminUserCreateDialog);
    enableAdminDialogDismiss("admin-ip-dialog", closeIpBlockDialog);
    enableAdminDialogDismiss("admin-tariff-dialog", () => closeTariffDialog());
    enableAdminDialogDismiss("admin-coupon-dialog", () => closeCouponDialog());
    enableModalDismiss("admin-export-dialog", closeAdminExportDialog);
    // : Tarif- & Gutschein-Verwaltung (nur Cloud-Edition sichtbar).
    // : In der Community-Edition sind diese Tabs aus dem HTML entfernt -> null-sicher anbinden.
    const tariffsTabBtn = document.getElementById("admin-tab-tariffs-btn");
    if (tariffsTabBtn) tariffsTabBtn.addEventListener("click", () => switchAdminTab("tariffs"));
    const couponsTabBtn = document.getElementById("admin-tab-coupons-btn");
    if (couponsTabBtn) couponsTabBtn.addEventListener("click", () => switchAdminTab("coupons"));
    // : Billing-Tab (nur Cloud).
    const billingTabBtn = document.getElementById("admin-tab-billing-btn");
    if (billingTabBtn) billingTabBtn.addEventListener("click", () => switchAdminTab("billing"));
    // : Zeitraum-Filter der Dashboard-Verlaufsgraphen.
    document.querySelectorAll(".admin-range-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            _adminChartRange = btn.dataset.range || "7d";
            document.querySelectorAll(".admin-range-btn").forEach(b => b.classList.toggle("active", b === btn));
            loadDashboardTimeseries();
        });
    });
    //  (-Feedback): Dashboard-Diagramme manuell neu laden (Cache verwerfen + frisch ziehen).
    const chartRefreshBtn = document.getElementById("admin-chart-refresh-btn");
    if (chartRefreshBtn) {
        chartRefreshBtn.addEventListener("click", () => {
            Object.keys(_adminTimeseriesCache).forEach(k => delete _adminTimeseriesCache[k]);
            fetchAdminStats(true);
        });
    }
    //  (#A): "My Vault"-Tab-Bar-Buttons (Szenarios ist disabled -> kein Handler nötig).
    ["playbooks", "devices", "presets", "scenarios"].forEach(t => {
        const b = document.getElementById(`vault-tab-${t}-btn`);
        if (b) b.addEventListener("click", () => switchVaultTab(t));
    });
    // : Szenario-Formular (Anlegen/Bearbeiten/Abbrechen)
    const scSave = document.getElementById("scenario-save-btn");
    if (scSave) scSave.addEventListener("click", saveScenario);
    const scCancel = document.getElementById("scenario-cancel-btn");
    if (scCancel) scCancel.addEventListener("click", closeScenarioDialog);  // : Dialog schließen
    // : Szenario-Freigabe-Dialog
    const scShareSave = document.getElementById("scenario-share-save");
    if (scShareSave) scShareSave.addEventListener("click", saveScenarioShares);
    const scShareCancel = document.getElementById("scenario-share-cancel");
    if (scShareCancel) scShareCancel.addEventListener("click", closeScenarioShareDialog);
    // : Tarif-/Gutschein-Dialoge sind in der Community-Edition aus dem HTML entfernt -> null-sicher.
    const tariffForm = document.getElementById("admin-tariff-form");
    if (tariffForm) tariffForm.addEventListener("submit", handleTariffSubmit);
    // : „Abbrechen" schließt jetzt den Dialog (Formular liegt im Modal).
    const tariffReset = document.getElementById("admin-tariff-reset");
    if (tariffReset) tariffReset.addEventListener("click", closeTariffDialog);
    const couponForm = document.getElementById("admin-coupon-form");
    if (couponForm) couponForm.addEventListener("submit", handleCouponSubmit);
    const couponReset = document.getElementById("admin-coupon-reset");
    if (couponReset) couponReset.addEventListener("click", closeCouponDialog);
    // : Gutschein-Eingabefeld auf der Preisseite entfernt (Rabattcodes im Stripe-Checkout).
    // : GoBD-Finanzamt-Export
    const gobdBtn = document.getElementById("gobd-export-btn");
    if (gobdBtn) gobdBtn.addEventListener("click", handleGobdExport);

    // Admin user search + sort (community-strip : gesamter Benutzer-Tab in Community gestrippt -> null-sicher)
    document.getElementById("admin-user-search")?.addEventListener("input", renderAdminUsers);
    document.getElementById("admin-user-sort")?.addEventListener("change", renderAdminUsers);

    // Admin user management actions
    document.getElementById("admin-grant-time-btn")?.addEventListener("click", adminGrantTime);
    document.getElementById("admin-toggle-active-btn")?.addEventListener("click", adminToggleActive);
    document.getElementById("admin-delete-user-btn")?.addEventListener("click", adminDeleteUser);
    document.getElementById("admin-edit-save-btn")?.addEventListener("click", adminSaveChanges);

    // ESC / backdrop dismissal for the user management sub-dialog
    enableModalDismiss("admin-edit-user-dialog", () => document.getElementById("admin-edit-user-dialog").classList.add("hidden"));

    // Admin forms submission
    document.getElementById("admin-config-form").addEventListener("submit", handleAdminConfigSubmit);
    document.getElementById("admin-ip-ban-form").addEventListener("submit", handleAdminIPBanSubmit);

    // Custom Playbook Form & Uploader
    const fileInput = document.getElementById("custom-playbook-file-input");
    const cpbReset = document.getElementById("custom-playbook-reset");
    const _cpbUpdateLbl = () => {
        const lbl = document.getElementById("custom-playbook-filename-lbl");
        const has = fileInput && fileInput.files.length > 0;
        if (lbl) lbl.textContent = has ? fileInput.files[0].name : "Keine Datei ausgewählt";
        if (cpbReset) cpbReset.classList.toggle("hidden", !has);
    };
    if (fileInput) {
        fileInput.addEventListener("change", _cpbUpdateLbl);
    }
    // : Auswahl der Playbook-Datei zurücksetzen (stopPropagation -> nicht den Dateidialog öffnen).
    if (cpbReset && fileInput) {
        cpbReset.addEventListener("click", (e) => { e.stopPropagation(); fileInput.value = ""; _cpbUpdateLbl(); });
    }
    const uploadForm = document.getElementById("custom-playbook-upload-form");
    if (uploadForm) {
        uploadForm.addEventListener("submit", handleCustomPlaybookUpload);
    }

    //: CSP-Haertung – statt Inline-onclick-Handlern Event-Delegation verwenden,
    // damit script-src ohne 'unsafe-inline' auskommt.
    const cpbDropzone = document.getElementById("custom-playbook-dropzone");
    if (cpbDropzone && fileInput) {
        cpbDropzone.addEventListener("click", () => fileInput.click());
    }

    //: Logo-Upload-Box (Dropzone) – Klick, Datei-Label und Drag&Drop, analog zur YML-Box.
    const iconInput = document.getElementById("custom-pb-icon-file");
    const iconDropzone = document.getElementById("custom-pb-icon-dropzone");
    const iconReset = document.getElementById("custom-pb-icon-reset");
    const updateIconLbl = () => {
        const lbl = document.getElementById("custom-pb-icon-filename-lbl");
        const has = iconInput && iconInput.files.length;
        if (lbl) lbl.textContent = has ? iconInput.files[0].name : "Keine Datei ausgewählt";
        if (iconReset) iconReset.classList.toggle("hidden", !has);
    };
    if (iconInput) iconInput.addEventListener("change", updateIconLbl);
    // : Auswahl des Logos zurücksetzen.
    if (iconReset && iconInput) {
        iconReset.addEventListener("click", (e) => { e.stopPropagation(); iconInput.value = ""; updateIconLbl(); });
    }
    if (iconDropzone && iconInput) {
        iconDropzone.addEventListener("click", () => iconInput.click());
        ["dragover", "dragenter"].forEach(ev => iconDropzone.addEventListener(ev, (e) => {
            e.preventDefault();
            iconDropzone.style.borderColor = "var(--md-sys-color-primary)";
        }));
        ["dragleave", "dragend"].forEach(ev => iconDropzone.addEventListener(ev, () => {
            iconDropzone.style.borderColor = "rgba(255,255,255,0.1)";
        }));
        iconDropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            iconDropzone.style.borderColor = "rgba(255,255,255,0.1)";
            if (e.dataTransfer && e.dataTransfer.files.length) {
                iconInput.files = e.dataTransfer.files;
                updateIconLbl();
            }
        });
    }

    //: Logo-Upload-Box (Dropzone) im Bearbeiten-Dialog – analog zum Erstellen-Formular.
    const editIconInput = document.getElementById("custom-pb-edit-icon-file");
    const editIconDropzone = document.getElementById("custom-pb-edit-icon-dropzone");
    if (editIconInput) editIconInput.addEventListener("change", updateEditIconLbl);
    if (editIconDropzone && editIconInput) {
        editIconDropzone.addEventListener("click", () => editIconInput.click());
        ["dragover", "dragenter"].forEach(ev => editIconDropzone.addEventListener(ev, (e) => {
            e.preventDefault();
            editIconDropzone.style.borderColor = "var(--md-sys-color-primary)";
        }));
        ["dragleave", "dragend"].forEach(ev => editIconDropzone.addEventListener(ev, () => {
            editIconDropzone.style.borderColor = "rgba(255,255,255,0.1)";
        }));
        editIconDropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            editIconDropzone.style.borderColor = "rgba(255,255,255,0.1)";
            if (e.dataTransfer && e.dataTransfer.files.length) {
                editIconInput.files = e.dataTransfer.files;
                updateEditIconLbl();
            }
        });
    }

    const guestsList = document.getElementById("guests-list");
    if (guestsList) {
        guestsList.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-action]");
            if (!btn) return;
            if (btn.dataset.action === "guest-revoke") openGuestRevokeDialog(btn.dataset.id);
            else if (btn.dataset.action === "guest-devices") openGuestDevicesDialog(btn.dataset.id);
            else if (btn.dataset.action === "guest-scenarios") openGuestScenariosDialog(btn.dataset.id);
            else if (btn.dataset.action === "guest-activity") openGuestActivityDialog(btn.dataset.id);
            else if (btn.dataset.action === "guest-edit") openGuestEditDialog(btn.dataset.id);
            else if (btn.dataset.action === "guest-delete") deleteGuest(btn.dataset.id);
        });
    }

    // : Teams-Tabs, FAB + Erstellen-Dialog.
    const teamUsersBtn = document.getElementById("team-tab-users-btn");
    if (teamUsersBtn) teamUsersBtn.addEventListener("click", () => switchTeamsTab("users"));
    const teamActivityBtn = document.getElementById("team-tab-activity-btn");
    if (teamActivityBtn) teamActivityBtn.addEventListener("click", () => switchTeamsTab("activity"));
    const teamFab = document.getElementById("team-fab");
    if (teamFab) teamFab.addEventListener("click", openGuestCreateDialog);
    const guestCreateCancel = document.getElementById("guest-create-cancel");
    if (guestCreateCancel) guestCreateCancel.addEventListener("click", closeGuestCreateDialog);
    enableModalDismiss("guest-create-dialog", closeGuestCreateDialog);
    // : Bearbeiten-Dialog.
    const guestEditCancel = document.getElementById("guest-edit-cancel");
    if (guestEditCancel) guestEditCancel.addEventListener("click", closeGuestEditDialog);
    const guestEditSave = document.getElementById("guest-edit-save");
    if (guestEditSave) guestEditSave.addEventListener("click", saveGuestEdit);
    enableModalDismiss("guest-edit-dialog", closeGuestEditDialog);
    // : Szenario-Freigabe-Dialog je Teammitglied.
    const guestScenCancel = document.getElementById("guest-scenarios-cancel");
    if (guestScenCancel) guestScenCancel.addEventListener("click", closeGuestScenariosDialog);
    const guestScenSave = document.getElementById("guest-scenarios-save");
    if (guestScenSave) guestScenSave.addEventListener("click", saveGuestScenarios);
    enableModalDismiss("guest-scenarios-dialog", closeGuestScenariosDialog);
    // : Aktivitäten-Dialog je Teammitglied.
    const guestActClose = document.getElementById("guest-activity-close");
    if (guestActClose) guestActClose.addEventListener("click", closeGuestActivityDialog);
    const guestActCopy = document.getElementById("guest-activity-copy");
    if (guestActCopy) guestActCopy.addEventListener("click", copyGuestActivity);
    const guestActExport = document.getElementById("guest-activity-export");
    if (guestActExport) guestActExport.addEventListener("click", exportGuestActivity);
    enableModalDismiss("guest-activity-dialog", closeGuestActivityDialog);
    const tokensTbody = document.getElementById("tokens-tbody");
    if (tokensTbody) {
        tokensTbody.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-action='token-delete']");
            if (btn) deleteToken(btn.dataset.id);
        });
    }

    // Custom playbook edit modal
    const cpbCancel = document.getElementById("custom-pb-edit-cancel");
    const cpbSave = document.getElementById("custom-pb-edit-save");
    if (cpbCancel) cpbCancel.addEventListener("click", closeEditCustomPlaybook);
    if (cpbSave) cpbSave.addEventListener("click", saveCustomPlaybookMeta);
    enableModalDismiss("custom-pb-edit-dialog", closeEditCustomPlaybook);

    //: Freigabe-Dialog
    const pbsCancel = document.getElementById("playbook-share-cancel");
    const pbsSave = document.getElementById("playbook-share-save");
    if (pbsCancel) pbsCancel.addEventListener("click", closeShareCustomPlaybook);
    if (pbsSave) pbsSave.addEventListener("click", saveShareCustomPlaybook);
    enableModalDismiss("playbook-share-dialog", closeShareCustomPlaybook);
    enableModalDismiss("managed-device-share-dialog", closeManagedDeviceShare);

    //: Gast-Playbook-Sperren-Dialog
    const grCancel = document.getElementById("guest-revoke-cancel");
    const grSave = document.getElementById("guest-revoke-save");
    if (grCancel) grCancel.addEventListener("click", closeGuestRevokeDialog);
    if (grSave) grSave.addEventListener("click", saveGuestRevoke);
    enableModalDismiss("guest-revoke-dialog", closeGuestRevokeDialog);
    // : Geräte-Freigabe-Dialog je Gast.
    const gdCancel = document.getElementById("guest-devices-cancel");
    if (gdCancel) gdCancel.addEventListener("click", closeGuestDevicesDialog);
    const gdSave = document.getElementById("guest-devices-save");
    if (gdSave) gdSave.addEventListener("click", saveGuestDevicesDialog);
    enableModalDismiss("guest-devices-dialog", closeGuestDevicesDialog);

    // Device forms cred type selection change
    document.getElementById("device-cred-type").addEventListener("change", handleDeviceCredTypeChange);
    document.getElementById("device-cancel-edit-btn").addEventListener("click", resetDeviceForm);

    const deviceSelect = document.getElementById("modal-device-select");
    if (deviceSelect) {
        deviceSelect.addEventListener("change", () => {
            const devId = deviceSelect.value;
            if (devId) {
                const dev = userDevices.find(d => d.id === devId);
                if (dev) {
                    modalTargetHost.value = dev.host;
                    modalTargetHost.disabled = true;
                    modalUsernameInput.value = dev.username || "";
                    modalUsernameInput.disabled = true;
                    modalPasswordInput.value = dev.has_credential ? "********" : "";
                    modalPasswordInput.disabled = true;
                }
            } else {
                modalTargetHost.value = "";
                modalTargetHost.disabled = false;
                modalUsernameInput.value = "";
                modalUsernameInput.disabled = false;
                modalPasswordInput.value = "";
                modalPasswordInput.disabled = false;
            }
        });
    }

    // Legal-Links werden von eigenstaendigen Seiten behandelt (keine Modal-Listener mehr noetig).
    const closeImpressum = document.getElementById("close-impressum-modal-btn");
    const closeAgb = document.getElementById("close-agb-modal-btn");
    const closeDsgvo = document.getElementById("close-datenschutz-modal-btn");
    
    if (closeImpressum) closeImpressum.addEventListener("click", () => closeLegalModal('impressum'));
    if (closeAgb) closeAgb.addEventListener("click", () => closeLegalModal('agb'));
    if (closeDsgvo) closeDsgvo.addEventListener("click", () => closeLegalModal('datenschutz'));

    const profileSignAvvBtn = document.getElementById("profile-sign-avv-btn");
    const closeAvvSignBtn = document.getElementById("close-avv-sign-btn");
    const avvSignForm = document.getElementById("avv-sign-form");

    if (profileSignAvvBtn) profileSignAvvBtn.addEventListener("click", openAVVSignatureModal);
    if (closeAvvSignBtn) closeAvvSignBtn.addEventListener("click", closeAVVSignatureModal);
    if (avvSignForm) avvSignForm.addEventListener("submit", handleAVVSignFormSubmit);

    // Cookie Consent Actions
    const cookieAcceptAll = document.getElementById("cookie-accept-all-btn");
    const cookieDecline = document.getElementById("cookie-decline-btn");
    const cookieCustomize = document.getElementById("cookie-customize-btn");
    const cookieSavePref = document.getElementById("cookie-save-pref-btn");

    if (cookieAcceptAll) cookieAcceptAll.addEventListener("click", () => saveCookieConsent(true, true));
    if (cookieDecline) cookieDecline.addEventListener("click", () => saveCookieConsent(false, false));
    if (cookieCustomize) cookieCustomize.addEventListener("click", showCookiePreferences);
    if (cookieSavePref) cookieSavePref.addEventListener("click", saveCustomCookieConsent);

    // Collaboration and API Tokens event listeners
    const closeTokenDisplayBtn = document.getElementById("close-token-display-btn");
    if (closeTokenDisplayBtn) {
        closeTokenDisplayBtn.addEventListener("click", () => {
            document.getElementById("token-display-dialog").classList.add("hidden");
        });
    }
    
    const copyTokenBtn = document.getElementById("copy-token-btn");
    if (copyTokenBtn) {
        //: navigator.clipboard ist NUR in Secure Contexts (HTTPS/localhost) verfuegbar; in
        // HTTP-Deployments (On-Prem/Homelab per IP) war es undefined -> der Handler warf synchron
        // und der Button tat scheinbar nichts. copyToClipboard() faengt das mit execCommand-Fallback.
        copyTokenBtn.addEventListener("click", async () => {
            const text = document.getElementById("generated-token-text").textContent;
            const ok = await copyToClipboard(text);
            showToast(ok ? "Token in die Zwischenablage kopiert!" : "Kopieren fehlgeschlagen — bitte manuell markieren.");
        });
    }
    
    const guestSubmitBtn = document.getElementById("guest-submit-btn");
    if (guestSubmitBtn) {
        guestSubmitBtn.addEventListener("click", handleGuestSubmit);
    }
    //: kein manueller "Aktualisieren"-Knopf mehr - loadAuditLog() laeuft beim
    // Oeffnen der /teams-Seite (routePage).

    const tokenSubmitBtn = document.getElementById("token-submit-btn");
    if (tokenSubmitBtn) {
        tokenSubmitBtn.addEventListener("click", handleTokenSubmit);
    }
}


// Session ID helper
function getSessionId() {
    let id = sessionStorage.getItem("session_id");
    if (!id) {
        if (self.crypto && crypto.randomUUID) {
            id = crypto.randomUUID();
        } else {
            id = "sess_" + Math.random().toString(36).substring(2, 15) + "_" + Date.now().toString(36);
        }
        sessionStorage.setItem("session_id", id);
    }
    return id;
}

//: Robustes Kopieren in die Zwischenablage. navigator.clipboard funktioniert nur in
// Secure Contexts (HTTPS/localhost); in HTTP-Deployments fehlt es. Dann Fallback auf ein
// temporaeres <textarea> + document.execCommand("copy"). Gibt true bei Erfolg zurueck.
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* faellt unten auf execCommand zurueck */ }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch (e) {
        return false;
    }
}

// View Mode (Grid / List) manager
function setViewMode(mode) {
    localStorage.setItem("view_mode", mode);
    applyViewMode();
}

function applyViewMode() {
    const currentMode = localStorage.getItem("view_mode") || "grid";
    const lists = document.querySelectorAll(".playbooks-list");
    lists.forEach(list => {
        if (currentMode === "grid") {
            list.classList.add("grid-mode");
            list.classList.remove("list-mode");
        } else {
            list.classList.add("list-mode");
            list.classList.remove("grid-mode");
        }
    });
    
    if (currentMode === "grid") {
        viewGridBtn.classList.add("active");
        viewListBtn.classList.remove("active");
    } else {
        viewListBtn.classList.add("active");
        viewGridBtn.classList.remove("active");
    }
}

// Verify connection with Backend API
async function verifyConnection() {
    try {
        const response = await fetch("/api/playbooks");
        if (response.ok) {
            if (pulseDot) pulseDot.classList.add("online");
            if (connectionStatus) connectionStatus.textContent = "System";
            return true;
        }
    } catch (e) {
        // Handled by default offline status
    }
    if (pulseDot) pulseDot.classList.remove("online");
    if (connectionStatus) connectionStatus.textContent = "System";
    return false;
}

// Fetch container system timezone
async function fetchTimezone() {
    try {
        const response = await fetch("/api/timezone");
        if (response.ok) {
            const data = await response.json();
            containerTimezone = data.timezone || "Europe/Berlin";
        }
    } catch (e) {
        console.error("Fehler beim Laden der Zeitzone:", e);
    }
}

// Fetch all presets
async function fetchPresets() {
    try {
        const response = await fetch("/api/presets");
        if (response.ok) {
            allPresets = await response.json();
        } else {
            //: bei Fehler nicht die (ggf. fremden) alten Presets behalten -> leeren,
            // damit nach einem Logout nie der Katalog des Vorgaengers stehen bleibt.
            allPresets = [];
        }
    } catch (e) {
        console.error("Fehler beim Laden der Presets:", e);
        allPresets = [];
    }
}

// Fetch all available playbooks from directory
// : vom Nutzer erstellte/freigegebene Presets fuer Katalog-Kacheln (eigene + geteilte).
let userCustomPresets = [];
async function fetchUserCustomPresets() {
    // : KEIN Admin-Ausschluss mehr. Admins (und der Community-Single-User mit role=admin)
    // dürfen eigene Presets anlegen (Premium-Ausnahme); /api/profile/presets liefert sie scoped auf
    // den User. Vorher lud nur loadPresets (Vault-Tab) sie ohne Guard, fetchUserCustomPresets aber
    // nicht -> die Startseiten-Kacheln erschienen erst nach Besuch des Presets-Tabs. Jetzt konsistent.
    if (!currentUser) { userCustomPresets = []; return; }
    try {
        const r = await fetch("/api/profile/presets");
        userCustomPresets = r.ok ? await r.json() : [];
    } catch (e) { userCustomPresets = []; }
}

// : eigene + freigegebene Szenarien für den Startseiten-Abschnitt "Szenarios".
let userScenarios = [];
async function fetchUserScenarios() {
    if (!currentUser) { userScenarios = []; return; }
    try {
        const r = await fetch("/api/profile/scenarios");
        userScenarios = r.ok ? await r.json() : [];
    } catch (e) { userScenarios = []; }
}

async function fetchPlaybooks() {
    try {
        const response = await fetch("/api/playbooks", { cache: "no-store" });
        if (!response.ok) throw new Error("Fehler beim Laden");
        allPlaybooks = await response.json();
        await fetchUserCustomPresets();  //: eigene/freigegebene Presets fuer Kacheln laden
        await fetchUserScenarios();       //: Szenarien-Kacheln
        renderPlaybooks();
    } catch (err) {
        playbooksList.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-outlined">warning</span>
                Fehler beim Laden der Playbooks
            </div>`;
    }
}

function renderSinglePlaybookItem(pb) {
    const item = document.createElement("label");
    item.className = "playbook-item";
    //: Suchindex (Name, Kategorie, Beschreibung) fuer das Sichtbarkeits-Filtern.
    item.dataset.search = `${pb.name || ""} ${pb.category || ""} ${pb.description || ""}`.toLowerCase();

    let requiresHtml = "";
    if (pb.requires && pb.requires.length > 0) {
        const reqNames = pb.requires.map(reqFile => playbookNameMap[reqFile] || reqFile).join(", ");
        requiresHtml = `
            <div class="playbook-requires">
                <span class="material-symbols-outlined">link</span>
                <span>Erfordert: <span class="req-names">${reqNames}</span></span>
            </div>
        `;
    }
    
    let iconHtml = "";
    let iconSrc = "";
    //: Custom-Playbooks haben ein hochgeladenes/verknuepftes Logo (icon_value:
    // data-URI oder https-URL) -> dieses bevorzugt anzeigen, statt des Platzhalters.
    if (pb.icon_value) {
        iconSrc = pb.icon_value;
    } else if (pb.icon) {
        if (pb.icon.includes(".") || pb.icon.includes("/")) {
            iconSrc = `images/${pb.icon}`;
        } else if (localIconMap[pb.icon]) {
            iconSrc = `images/${localIconMap[pb.icon]}`;
        }
    }

    if (iconSrc) {
        const img = document.createElement("img");
        img.className = "playbook-item-icon-img";
        img.alt = pb.name || 'Playbook';
        img.src = iconSrc; // als Property gesetzt -> keine HTML-Injection ueber data-URI
        iconHtml = img.outerHTML;
    } else {
        iconHtml = `<span class="material-symbols-outlined playbook-item-icon">${escapeHtml(pb.icon || 'settings')}</span>`;
    }
    
    //: Premium-Kennzeichnung nur in der Cloud-Edition (on-prem/community: alles frei).
    // Badge am Namen + Akzentfarben-Hintergrund der ganzen Kachel (Klasse playbook-item--premium).
    let premiumHtml = "";
    const isPremium = pb.premium && currentEdition === "cloud";
    // : Premium-Playbooks erfordern eine aktive Premium-Laufzeit. Nicht
    // berechtigte Nutzer (nicht eingeloggt oder ohne aktives Abo) sehen die Kachel
    // ausgegraut und deaktiviert; ein Klick fuehrt zum Abo-/Upsell-Flow.
    const entitled = !!(currentUser && currentUser.is_subscription_active);
    const locked = isPremium && !entitled;
    if (isPremium) {
        item.classList.add("playbook-item--premium");
        premiumHtml = `<span class="playbook-premium-badge" title="Premium-Playbook">
                <span class="material-symbols-outlined">workspace_premium</span>Premium</span>`;
    }
    if (locked) {
        item.classList.add("playbook-item--locked");
    }

    // : Hersteller-Info nur fuer systemseitige Playbooks mit hinterlegten vendor_urls.
    let vendorHtml = "";
    const hasVendor = !pb.custom && Array.isArray(pb.vendor_urls) && pb.vendor_urls.length > 0;
    if (hasVendor) {
        vendorHtml = `
            <div class="playbook-vendor">
                <a href="#" class="playbook-vendor-trigger">
                    <span class="material-symbols-outlined">info</span>Hersteller anzeigen
                </a>
            </div>
        `;
    }

    item.innerHTML = `
        ${iconHtml}
        <input type="checkbox" name="playbooks" value="${pb.file}" data-requires='${JSON.stringify(pb.requires || [])}'${locked ? " disabled" : ""}>
        <div class="playbook-info">
            <span class="playbook-name">${escapeHtml(pb.name)}${premiumHtml}</span>
            <span class="playbook-desc">${escapeHtml(pb.description)}</span>
            ${requiresHtml}
            ${vendorHtml}
        </div>
    `;

    if (hasVendor) {
        const trigger = item.querySelector(".playbook-vendor-trigger");
        if (trigger) {
            trigger.addEventListener("click", (e) => {
                // Verhindert, dass der Klick die Kachel-Checkbox (Label) toggelt.
                e.preventDefault();
                e.stopPropagation();
                openVendorDialog(pb);
            });
        }
    }

    if (locked) {
        // Auswahl unterbinden und stattdessen den Upsell-Dialog oeffnen.
        item.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            promptPremiumUpsell();
        });
    }
    return item;
}

// : Hersteller-Info-Dialog. Zeigt die offiziellen Hersteller-/Autoren-URLs eines
// systemseitigen Playbooks als anklickbare Links (oeffnen in neuem Tab, rel=noopener).
function openVendorDialog(pb) {
    const dialog = document.getElementById("playbook-vendor-dialog");
    if (!dialog) return;
    const titleEl = document.getElementById("playbook-vendor-title");
    if (titleEl) titleEl.textContent = `Hersteller-Informationen — ${pb.name || ""}`;
    const list = document.getElementById("playbook-vendor-list");
    if (list) {
        list.innerHTML = "";
        (pb.vendor_urls || []).forEach(url => {
            const a = document.createElement("a");
            a.className = "playbook-vendor-link";
            a.href = url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.innerHTML = `<span class="material-symbols-outlined">open_in_new</span>`;
            a.appendChild(document.createTextNode(url));
            list.appendChild(a);
        });
    }
    dialog.classList.remove("hidden");
}

function closeVendorDialog() {
    const dialog = document.getElementById("playbook-vendor-dialog");
    if (dialog) dialog.classList.add("hidden");
}

// : Upsell-Dialog fuer gesperrte Premium-Playbooks - gestyltes Modal im
// Seitenstil statt window.confirm. Rollenabhaengiger Text; CTA fuehrt zur Preisseite.




// : Zentraler Einstieg in den Preis-/Abo-Flow -> dedizierte Preisseite.
// In Nicht-Cloud-Editionen oder fuer Gaeste/Admins faellt /pricing in routePage()
// auf die Startseite zurueck; dort greift dann der bestehende Abo-Flow im Profil.


// ===========================================================================
// : Preisseite /pricing — Tabs (Tarif-Gruppen), Hochkant-Kacheln
// (Optionen), Laufzeit-Dropdown (Intervalle), Buchen-Flow.
// ===========================================================================















//: Gutscheincode auf der Preisseite pruefen (UX-Feedback; das Backend
// validiert erneut beim Checkout).


function renderPlaybooks() {
    // : Gast-Accounts mit aktivem Host-Abo erhalten einen dezenten
    // Premium-Hinweis (Premium-Playbooks werden serverseitig bereits gefiltert).
    const guestHint = document.getElementById("guest-premium-hint");
    if (guestHint) {
        const showHint = !!(currentUser && currentUser.role === "guest" && currentUser.is_subscription_active);
        guestHint.classList.toggle("hidden", !showHint);
    }

    // Build mapping dictionary of playbook files to display names and metadata
    playbookNameMap = {};
    playbookMetadataMap = {};
    
    // Put standalone playbooks in the map first
    allPlaybooks.forEach(pb => {
        playbookNameMap[pb.file] = pb.name;
        //: icon_value (Custom-Playbook-Logo) mitfuehren, damit auch das Run-Modal
        // und das Konfig-Akkordeon das hochgeladene Logo anzeigen.
        //: service_group fuer die Port-Kollisionspruefung.
        playbookMetadataMap[pb.file] = { name: pb.name, icon: pb.icon, icon_value: pb.icon_value, service_group: pb.service_group };
    });
    
    // Put preset playbooks in the map (by base file name)
    allPresets.forEach(preset => {
        preset.playbooks.forEach(pb => {
            const baseFile = pb.file.split('/').pop();
            const meta = { name: pb.name, icon: pb.icon };
            playbookNameMap[pb.file] = pb.name;
            playbookNameMap[baseFile] = pb.name;
            playbookMetadataMap[pb.file] = meta;
            playbookMetadataMap[baseFile] = meta;
        });
    });
    
    playbooksList.innerHTML = "";
    
    if ((!allPlaybooks || allPlaybooks.length === 0) && (!allPresets || allPresets.length === 0)) {
        playbooksList.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-outlined">folder_open</span>
                Keine Playbooks oder Presets gefunden.
            </div>`;
        return;
    }
    
    //: Immer ALLE Presets/Playbooks rendern. Die Suche filtert anschliessend nur die
    // Sichtbarkeit (applyPlaybookSearch am Funktionsende), damit die getroffene Auswahl
    // (Checkboxen im DOM) beim Tippen vollstaendig erhalten bleibt.
    const presetsToShow = allPresets || [];
    const playbooksToShow = allPlaybooks || [];

    // : Szenarios-Abschnitt (eigene + freigegebene) mit Raketen-Icon. Klick = 1-Klick-Run.
    // : Szenarios stehen jetzt VOR den verfügbaren Presets (eigene Inhalte zuerst).
    const _scenarios = Array.isArray(userScenarios) ? userScenarios.filter(s => s.valid !== false) : [];
    if (_scenarios.length > 0) {
        const scHeader = document.createElement("div");
        scHeader.className = "category-main-title grid-row-header";
        scHeader.innerHTML = `
            <span class="material-symbols-outlined">rocket_launch</span>
            Szenarios
        `;
        playbooksList.appendChild(scHeader);
        _scenarios.forEach(s => {
            const tile = document.createElement("div");
            tile.className = "playbook-item scenario-tile";
            tile.style.cursor = "pointer";
            const badge = !s.is_owner ? `<span class="playbook-desc">${s.permission === "flexible" ? "flexibel freigegeben" : "strikt freigegeben"}</span>` : "";
            // : Kachel-Subtitel nur „→ Zielgerät" (kein Preset-Name); gerätelos -> „beim Ausführen festlegen".
            tile.innerHTML = `<span class="material-symbols-outlined playbook-item-icon">rocket_launch</span>` +
                `<div class="playbook-info"><span class="playbook-name">${escapeHtml(s.name)}</span>` +
                `<span class="playbook-desc">→ ${escapeHtml(scenarioTargetLabel(s))}</span>${badge}</div>`;
            tile.addEventListener("click", () => runScenario(s));
            playbooksList.appendChild(tile);
        });
    }

    // : Eigene/freigegebene Presets als startbare Kacheln. Auch fuer Gaeste,
    // damit freigegebene Presets ausgefuehrt werden koennen. Klick -> launchPreset (Server
    // erzwingt Berechtigung + Premium).
    // 1. Render Preset Header & Tiles — : eigene/freigegebene Presets gehören in
    // "Verfügbare Presets" (keine separate "Eigene Presets"-Kategorie mehr).
    //: Presets ausblenden, aus denen bereits ein Szenario erstellt wurde (das Preset ist
    // dann über das Szenario repräsentiert; Löschen/Logik bleibt intakt, nur die Anzeige entfällt).
    // Nur GÜLTIGE Szenarien (_scenarios, valid !== false) zählen — ein Szenario mit gelöschtem
    // Gerät erscheint nicht in der Szenarien-Liste und darf sein Preset nicht mit-verstecken.
    const _scenarioPresetIds = new Set(_scenarios.map(s => s.preset_id).filter(Boolean));
    const _customPresets = (Array.isArray(userCustomPresets) ? userCustomPresets : []).filter(p => !_scenarioPresetIds.has(p.id));
    if (presetsToShow.length > 0 || _customPresets.length > 0) {
        const presetHeader = document.createElement("div");
        presetHeader.className = "category-main-title grid-row-header";
        // : Abstand zum darüberliegenden Szenarios-Abschnitt (falls vorhanden).
        if (_scenarios.length > 0) presetHeader.style.marginTop = "24px";
        // : gleiches Icon wie der Presets-Tab (tune).
        presetHeader.innerHTML = `
            <span class="material-symbols-outlined">tune</span>
            Verfügbare Presets
        `;
        playbooksList.appendChild(presetHeader);

        // Eigene/freigegebene Presets zuerst (klickbare Kacheln; Klick -> launchPreset).
        _customPresets.forEach(p => {
            const tile = document.createElement("div");
            tile.className = "playbook-item custom-preset-tile";
            tile.style.cursor = "pointer";
            const pbCount = (p.playbook_ids || []).length;
            const badge = !p.is_owner ? `<span class="playbook-desc">${p.permission === "flexible" ? "flexibel freigegeben" : "strikt freigegeben"}</span>` : "";
            tile.innerHTML = `<span class="material-symbols-outlined playbook-item-icon">bookmark</span>` +
                `<div class="playbook-info"><span class="playbook-name">${escapeHtml(p.name)}</span>` +
                `<span class="playbook-desc">${pbCount} Playbook${pbCount === 1 ? "" : "s"}</span>${badge}</div>`;
            tile.addEventListener("click", () => launchPreset(p));
            playbooksList.appendChild(tile);
        });

        presetsToShow.forEach(preset => {
            // Filter out base package installations (install-*.yml) from presets list
            const nonStandalonePlaybooks = preset.playbooks.filter(pb => {
                const baseFile = pb.file.split('/').pop();
                return !baseFile.startsWith("install");
            });
            
            const presetPlaybookNames = nonStandalonePlaybooks.map(pb => pb.name).join(", ");
            
            const tile = document.createElement("div");
            tile.className = "playbook-item preset-tile";
            tile.dataset.presetName = preset.name;
            //: Suchindex (Name, Beschreibung, enthaltene Playbook-Namen).
            tile.dataset.search = `${preset.name || ""} ${preset.description || ""} ${(preset.playbooks || []).map(p => p.name).join(" ")}`.toLowerCase();
            
            // Resolve preset icon path
            let iconSrc = "";
            if (preset.icon) {
                if (preset.icon.includes(".") || preset.icon.includes("/")) {
                    iconSrc = `images/${preset.icon}`;
                } else if (localIconMap[preset.icon]) {
                    iconSrc = `images/${localIconMap[preset.icon]}`;
                }
            }
            if (!iconSrc) {
                iconSrc = `images/${localIconMap['layers'] || 'logo.svg'}`;
            }
            
            const iconHtml = `<img src="${iconSrc}" class="playbook-item-icon-img" alt="${escapeHtml(preset.name || 'Preset')}">`;
            
            const descriptionText = preset.description || `Module: ${presetPlaybookNames}`;
            
            tile.innerHTML = `
                ${iconHtml}
                <div class="playbook-info">
                    <span class="playbook-name">${preset.name}</span>
                    <span class="playbook-desc">${descriptionText}</span>
                </div>
            `;
            playbooksList.appendChild(tile);
        });
    }

    // 2. Render Standalone Playbooks Header & Tiles
    //    Gaeste sehen den Standardkatalog ebenfalls (hebt auf).
    if (playbooksToShow.length > 0) {
        const pbHeader = document.createElement("div");
        pbHeader.className = "category-main-title grid-row-header";
        pbHeader.style.marginTop = "24px";
        pbHeader.innerHTML = `
            <span class="material-symbols-outlined">settings_applications</span>
            Verfügbare Playbooks
        `;
        playbooksList.appendChild(pbHeader);

        // Group playbooks by category
        const grouped = {};
        playbooksToShow.forEach(pb => {
            const cat = pb.category && pb.category.trim() ? pb.category.trim() : "Sonstige";
            if (!grouped[cat]) {
                grouped[cat] = [];
            }
            grouped[cat].push(pb);
        });
        
        // Sort categories alphabetically, keeping "Sonstige" at the end
        const catNames = Object.keys(grouped).sort((a, b) => {
            if (a === "Sonstige") return 1;
            if (b === "Sonstige") return -1;
            return a.localeCompare(b);
        });
        
        catNames.forEach(catName => {
            const subTitle = document.createElement("div");
            subTitle.className = "subcategory-title grid-row-header";
            subTitle.style.marginTop = "12px";
            subTitle.textContent = catName;
            playbooksList.appendChild(subTitle);
            
            //: innerhalb der Kategorie alphabetisch nach Anzeigenamen sortieren.
            grouped[catName]
                .slice()
                .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de", { sensitivity: "base" }))
                .forEach(pb => {
                    playbooksList.appendChild(renderSinglePlaybookItem(pb));
                });
        });
    }
    
    // Apply grid/list view settings
    applyViewMode();

    // Initialize preset indeterminate states
    updatePresetHighlights();

    //: aktiven Suchbegriff (falls vorhanden) als reine Sichtbarkeits-Filterung anwenden.
    applyPlaybookSearch();
}

//: Filtert NUR die Sichtbarkeit von Preset-/Playbook-Kacheln anhand des Suchfelds und
// blendet leere Kategorie-/Unterkategorie-Ueberschriften aus. Es wird nichts neu gerendert,
// daher bleibt die getroffene Auswahl (Checkboxen) - auch bei aktuell ausgeblendeten
// Kacheln - vollstaendig erhalten.
function applyPlaybookSearch() {
    if (!playbooksList) return;
    const searchEl = document.getElementById("playbook-search");
    const term = (searchEl ? searchEl.value : "").trim().toLowerCase();
    let anyVisible = false;
    let mainHeader = null, mainCount = 0;
    let subHeader = null, subCount = 0;
    const finalizeSub = () => { if (subHeader) subHeader.style.display = subCount > 0 ? "" : "none"; };
    const finalizeMain = () => { if (mainHeader) mainHeader.style.display = mainCount > 0 ? "" : "none"; };
    Array.from(playbooksList.children).forEach(el => {
        if (el.id === "playbook-no-results") return;
        if (el.classList.contains("category-main-title")) {
            finalizeSub(); subHeader = null; subCount = 0;
            finalizeMain();
            mainHeader = el; mainCount = 0;
            return;
        }
        if (el.classList.contains("subcategory-title")) {
            finalizeSub();
            subHeader = el; subCount = 0;
            return;
        }
        if (el.classList.contains("playbook-item") || el.classList.contains("preset-tile")) {
            const vis = !term || (el.dataset.search || "").includes(term);
            el.style.display = vis ? "" : "none";
            if (vis) { anyVisible = true; mainCount++; subCount++; }
        }
    });
    finalizeSub();
    finalizeMain();

    // "Keine Treffer"-Hinweis als eigenes Element (zerstoert die Kacheln nicht).
    let empty = document.getElementById("playbook-no-results");
    if (term && !anyVisible) {
        if (!empty) {
            empty = document.createElement("div");
            empty.id = "playbook-no-results";
            empty.className = "empty-state";
            playbooksList.appendChild(empty);
        }
        empty.innerHTML = `<span class="material-symbols-outlined">search_off</span> Keine Treffer für „${escapeHtml(term)}".`;
        empty.style.display = "";
    } else if (empty) {
        empty.style.display = "none";
    }
}

function updatePresetHighlights() {
    allPresets.forEach(preset => {
        const presetTile = playbooksList.querySelector(`.preset-tile[data-preset-name="${preset.name}"]`);
        if (!presetTile) return;
        
        let checkedCount = 0;
        preset.playbooks.forEach(pb => {
            const cb = playbooksList.querySelector(`input[name="playbooks"][value="${pb.file}"]`);
            if (cb && cb.checked) {
                checkedCount++;
            }
        });
        
        if (checkedCount === 0) {
            presetTile.classList.remove("active", "indeterminate");
        } else if (checkedCount === preset.playbooks.length) {
            presetTile.classList.add("active");
            presetTile.classList.remove("indeterminate");
        } else {
            presetTile.classList.remove("active");
            presetTile.classList.add("indeterminate");
        }
    });
}

function checkPlaybookAndDependencies(checkbox) {
    if (!checkbox.checked) return;
    
    try {
        const requires = JSON.parse(checkbox.dataset.requires || "[]");
        requires.forEach(reqFile => {
            const reqCheckbox = playbooksList.querySelector(`input[name="playbooks"][value="${reqFile}"]`);
            if (reqCheckbox && !reqCheckbox.checked) {
                reqCheckbox.checked = true;
                const reqName = playbookNameMap[reqFile] || reqFile;
                showToast(`Abhängigkeit '${reqName}' wurde automatisch ausgewählt.`);
                // Recursively check its dependencies (if any)
                checkPlaybookAndDependencies(reqCheckbox);
            }
        });
    } catch (e) {
        console.error("Error checking playbook dependencies:", e);
    }
}

// Sidebar Submit (Triggers modal Credentials display)
function handleSidebarSubmit(e) {
    e.preventDefault();
    
    const checkedBoxes = document.querySelectorAll('input[name="playbooks"]:checked');
    if (checkedBoxes.length === 0) {
        showToast("Bitte wähle mindestens ein Playbook aus!");
        return;
    }

    // : Spam-Schutz. Ist die anonyme Ausfuehrung serverseitig deaktiviert,
    // fordern wir nicht angemeldete Besucher zur Anmeldung/Registrierung auf.
    if (!currentUser && !allowAnonymousRun) {
        showToast("Bitte melden Sie sich an oder registrieren Sie sich, um Playbooks auszuführen.");
        const dlg = document.getElementById("login-dialog");
        if (dlg) dlg.classList.remove("hidden");
        return;
    }

    showCredentialsModal();
}

const playbookDomainConfigs = {
    "create-stack-searxng.yml": [
        { label: "SearXNG Domain", variable: "searxng_domain", placeholder: "search.local", required: true },
        { label: "HTTP-Port (ohne Traefik)", variable: "searxng_port", placeholder: "8888", required: false }
    ],
    "create-stack-traefik.yml": [
        { label: "Traefik Domain", variable: "traefik_domain", placeholder: "traefik.local", required: true },
        //: Dashboard-Optionen. Defaults im Playbook erhalten das bisherige Verhalten
        // (Dashboard an, Basic-Auth an, Dashboard unter der Traefik-Domain).
        { label: "Dashboard aktivieren", variable: "traefik_enable_dashboard", type: "bool", default: true, required: false, scope: "general" },
        { label: "Dashboard-Subdomain (optional, sonst Traefik-Domain)", variable: "traefik_dashboard_subdomain", placeholder: "dash.example.com", required: false, scope: "general" },
        { label: "Dashboard Basic-Auth", variable: "traefik_dashboard_basicauth_enabled", type: "bool", default: true, required: false, scope: "general" }
    ],
    "create-stack-pihole.yml": [
        { label: "Pi-hole Domain", variable: "pihole_domain", placeholder: "pihole.local", required: true }
    ],
    "create-stack-dashboard.yml": [
        { label: "Dashboard Domain", variable: "dashboard_domain", placeholder: "dashboard.local", required: true },
        { label: "HTTP-Port (ohne Traefik)", variable: "dashboard_port", placeholder: "80", required: false }
    ],
    "create-stack-dockman.yml": [
        { label: "Dockman Domain", variable: "dockman_domain", placeholder: "dockman.local", required: true },
        { label: "HTTP-Port (ohne Traefik)", variable: "dockman_port", placeholder: "8866", required: false }
    ],
    "create-stack-filebrowser.yml": [
        { label: "Filebrowser Domain", variable: "filebrowser_domain", placeholder: "files.local", required: true },
        { label: "HTTP-Port (ohne Traefik)", variable: "filebrowser_port", placeholder: "8080", required: false }
    ],
    "create-stack-nodered.yml": [
        { label: "Node-RED Domain", variable: "nodered_domain", placeholder: "nodered.local", required: true },
        { label: "HTTP-Port (ohne Traefik)", variable: "nodered_port", placeholder: "1880", required: false }
    ],
    //: MQTT/Mosquitto war bisher ohne UI-Konfiguration. Defaults im Playbook
    // erhalten das bisherige Verhalten (Auth an, Port 1883, Benutzer = SSH-User).
    // Der Port ist KEINE Traefik-Alternative -> scope "general" (immer sichtbar).
    "create-stack-mqtt.yml": [
        { label: "MQTT-Port", variable: "mqtt_port", placeholder: "1883", required: false, scope: "general" },
        { label: "Authentifizierung aktivieren", variable: "mqtt_enable_auth", type: "bool", default: true, required: false, scope: "general" },
        { label: "MQTT-Benutzer (optional, sonst SSH-Benutzer)", variable: "mqtt_username", placeholder: "mqtt", required: false, scope: "general" },
        { label: "MQTT-Passwort (optional, sonst SSH-Passwort)", variable: "mqtt_password", placeholder: "Passwort", type: "password", required: false, scope: "general" }
    ],
    "create-stack-jdownloader2.yml": [
        { label: "JDownloader Domain", variable: "jd2_domain", placeholder: "jd2.local", required: true },
        { label: "HTTP-Port (ohne Traefik)", variable: "jd2_port", placeholder: "5800", required: false },
        { label: "JDownloader VNC Passwort", variable: "jd2_vnc_passwd", placeholder: "Passwort (optional)", type: "password", required: false }
    ],
    "create-stack-prometheus.yml": [
        { label: "Prometheus Domain", variable: "prometheus_domain", placeholder: "prometheus.local", required: true },
        { label: "HTTP-Port (ohne Traefik)", variable: "prometheus_port", placeholder: "9090", required: false }
    ],
    "create-stack-vaultwarden.yml": [
        { label: "Vaultwarden Domain (bei Traefik)", variable: "vaultwarden_domain", placeholder: "vault.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "vaultwarden_port", placeholder: "8080", required: false },
        { label: "Registrierung erlauben", variable: "vaultwarden_signups_allowed", type: "bool", default: false, required: false },
        { label: "Admin-Token (optional)", variable: "vaultwarden_admin_token", placeholder: "Token für Admin-Panel", type: "password", required: false }
    ],
    "create-stack-postgresql.yml": [
        { label: "DB-Benutzer", variable: "postgres_user", placeholder: "appuser", required: false },
        { label: "DB-Passwort (leer = zufällig generiert)", variable: "postgres_password", placeholder: "Passwort", type: "password", required: false },
        { label: "Datenbankname", variable: "postgres_db", placeholder: "appdb", required: false },
        //: DB-Port ist KEINE Traefik-Alternative (PostgreSQL laeuft nicht hinter Traefik)
        // -> immer sichtbar/konfigurierbar, unabhaengig vom Traefik-Schalter.
        { label: "Port", variable: "postgres_port", placeholder: "5432", required: false, scope: "general" },
        { label: "Bind-Adresse (127.0.0.1 = nur lokal)", variable: "postgres_bind", placeholder: "127.0.0.1", required: false }
    ],
    // Playbook Roadmap (Free) – Batch 1
    "create-stack-uptime-kuma.yml": [
        { label: "Uptime Kuma Domain (bei Traefik)", variable: "uptime_kuma_domain", placeholder: "status.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "uptime_kuma_port", placeholder: "3001", required: false }
    ],
    "create-stack-it-tools.yml": [
        { label: "IT-Tools Domain (bei Traefik)", variable: "it_tools_domain", placeholder: "tools.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "it_tools_port", placeholder: "8082", required: false }
    ],
    "create-stack-gotenberg.yml": [
        { label: "Gotenberg Domain (bei Traefik)", variable: "gotenberg_domain", placeholder: "gotenberg.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "gotenberg_port", placeholder: "3000", required: false }
    ],
    "create-stack-adminer.yml": [
        { label: "Adminer Domain (bei Traefik)", variable: "adminer_domain", placeholder: "adminer.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "adminer_port", placeholder: "8083", required: false }
    ],
    "create-stack-cyberchef.yml": [
        { label: "CyberChef Domain (bei Traefik)", variable: "cyberchef_domain", placeholder: "cyberchef.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "cyberchef_port", placeholder: "8000", required: false }
    ],
    "create-stack-linkstack.yml": [
        { label: "LinkStack Domain (bei Traefik)", variable: "linkstack_domain", placeholder: "links.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "linkstack_port", placeholder: "8084", required: false }
    ],
    // Playbook Roadmap (Free) – Batch 2
    "create-stack-actualbudget.yml": [
        { label: "Actual Budget Domain (bei Traefik)", variable: "actualbudget_domain", placeholder: "budget.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "actualbudget_port", placeholder: "5006", required: false }
    ],
    "create-stack-superproductivity.yml": [
        { label: "Super Productivity Domain (bei Traefik)", variable: "superproductivity_domain", placeholder: "todo.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "superproductivity_port", placeholder: "8091", required: false }
    ],
    "create-stack-grocy.yml": [
        { label: "Grocy Domain (bei Traefik)", variable: "grocy_domain", placeholder: "grocy.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "grocy_port", placeholder: "8088", required: false }
    ],
    "create-stack-vikunja.yml": [
        { label: "Vikunja Domain (bei Traefik)", variable: "vikunja_domain", placeholder: "vikunja.local", required: false },
        { label: "Öffentliche URL (für korrekte Links, optional)", variable: "vikunja_publicurl", placeholder: "https://vikunja.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "vikunja_port", placeholder: "3456", required: false }
    ],
    "create-stack-babybuddy.yml": [
        { label: "Baby Buddy Domain (bei Traefik)", variable: "babybuddy_domain", placeholder: "baby.local", required: false },
        { label: "CSRF Trusted Origin (z. B. https://baby.local)", variable: "babybuddy_csrf", placeholder: "https://baby.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "babybuddy_port", placeholder: "8089", required: false }
    ],
    "create-stack-navidrome.yml": [
        { label: "Navidrome Domain (bei Traefik)", variable: "navidrome_domain", placeholder: "music.local", required: false },
        { label: "Musik-Verzeichnis auf dem Host (read-only)", variable: "navidrome_music_dir", placeholder: "/srv/music", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "navidrome_port", placeholder: "4533", required: false }
    ],
    // Playbook Roadmap (Free) – Batch 3
    "create-stack-code-server.yml": [
        { label: "code-server Domain (bei Traefik)", variable: "code_server_domain", placeholder: "code.local", required: false },
        { label: "Login-Passwort", variable: "code_server_password", placeholder: "Passwort", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "code_server_port", placeholder: "8093", required: false }
    ],
    "create-stack-portainer.yml": [
        { label: "Portainer Domain (bei Traefik)", variable: "portainer_domain", placeholder: "portainer.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "portainer_port", placeholder: "9000", required: false }
    ],
    "create-stack-photoprism.yml": [
        { label: "PhotoPrism Domain (bei Traefik)", variable: "photoprism_domain", placeholder: "photos.local", required: false },
        { label: "Admin-Passwort", variable: "photoprism_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "Foto-Verzeichnis auf dem Host (read-only)", variable: "photoprism_originals", placeholder: "/srv/photos", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "photoprism_port", placeholder: "2342", required: false }
    ],
    "create-stack-speedtest-tracker.yml": [
        { label: "Speedtest Tracker Domain (bei Traefik)", variable: "speedtest_tracker_domain", placeholder: "speedtest.local", required: false },
        { label: "APP_KEY (optional, leer = automatisch generiert)", variable: "speedtest_tracker_app_key", placeholder: "base64:...", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "speedtest_tracker_port", placeholder: "8094", required: false }
    ],
    "create-stack-syncthing.yml": [
        { label: "Syncthing GUI Domain (bei Traefik)", variable: "syncthing_domain", placeholder: "syncthing.local", required: false },
        { label: "GUI-Port (ohne Traefik)", variable: "syncthing_port", placeholder: "8384", required: false }
    ],
    "create-stack-n8n.yml": [
        { label: "n8n Domain (bei Traefik)", variable: "n8n_domain", placeholder: "n8n.local", required: false },
        { label: "Encryption-Key (optional, leer = auto)", variable: "n8n_encryption_key", placeholder: "Key", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "n8n_port", placeholder: "5678", required: false }
    ],
    // Playbook Roadmap (Free) – Batch 4
    "create-stack-jellyfin.yml": [
        { label: "Jellyfin Domain (bei Traefik)", variable: "jellyfin_domain", placeholder: "media.local", required: false },
        { label: "Medien-Verzeichnis auf dem Host (read-only)", variable: "jellyfin_media", placeholder: "/srv/media", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "jellyfin_port", placeholder: "8096", required: false }
    ],
    "create-stack-gitea.yml": [
        { label: "Gitea Domain (bei Traefik)", variable: "gitea_domain", placeholder: "git.local", required: false },
        { label: "Git-SSH-Port (Host)", variable: "gitea_ssh_port", placeholder: "2222", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "gitea_port", placeholder: "3030", required: false }
    ],
    "create-stack-netdata.yml": [
        { label: "Netdata Domain (bei Traefik)", variable: "netdata_domain", placeholder: "netdata.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "netdata_port", placeholder: "19999", required: false }
    ],
    "create-stack-excalidraw.yml": [
        { label: "Excalidraw Domain (bei Traefik)", variable: "excalidraw_domain", placeholder: "draw.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "excalidraw_port", placeholder: "8095", required: false }
    ],
    "create-stack-yaade.yml": [
        { label: "Yaade Domain (bei Traefik)", variable: "yaade_domain", placeholder: "yaade.local", required: false },
        { label: "Admin-Benutzername", variable: "yaade_admin_username", placeholder: "admin", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "yaade_port", placeholder: "9339", required: false }
    ],
    "create-stack-convertx.yml": [
        { label: "ConvertX Domain (bei Traefik)", variable: "convertx_domain", placeholder: "convert.local", required: false },
        { label: "JWT-Secret (optional, leer = automatisch generiert)", variable: "convertx_jwt_secret", placeholder: "Secret", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "convertx_port", placeholder: "3032", required: false }
    ],
    // Playbook Roadmap (Premium) – Batch 1
    "create-stack-mariadb.yml": [
        { label: "Root-Passwort (leer = automatisch generiert)", variable: "mariadb_root_password", placeholder: "Passwort", type: "password", required: false },
        { label: "Datenbankname", variable: "mariadb_database", placeholder: "appdb", required: false },
        { label: "DB-Benutzer", variable: "mariadb_user", placeholder: "appuser", required: false },
        { label: "DB-Benutzer-Passwort (leer = automatisch generiert)", variable: "mariadb_password", placeholder: "Passwort", type: "password", required: false },
        { label: "Port", variable: "mariadb_port", placeholder: "3306", scope: "general", required: false },
        { label: "Bind-Adresse (127.0.0.1 = nur lokal)", variable: "mariadb_bind", placeholder: "127.0.0.1", required: false }
    ],
    "create-stack-registry.yml": [
        { label: "Registry Domain (bei Traefik)", variable: "registry_domain", placeholder: "registry.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "registry_port", placeholder: "5000", required: false }
    ],
    "create-stack-backrest.yml": [
        { label: "Backrest Domain (bei Traefik)", variable: "backrest_domain", placeholder: "backup.local", required: false },
        { label: "Zu sicherndes Quellverzeichnis (Host, read-only)", variable: "backrest_source", placeholder: "/srv", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "backrest_port", placeholder: "9898", required: false }
    ],
    "create-stack-docuseal.yml": [
        { label: "DocuSeal Domain (bei Traefik)", variable: "docuseal_domain", placeholder: "sign.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "docuseal_port", placeholder: "3033", required: false }
    ],
    "create-stack-signal-cli.yml": [
        { label: "TCP-Port (JSON-RPC)", variable: "signal_cli_port", placeholder: "7583", scope: "general", required: false },
        { label: "Bind-Adresse (127.0.0.1 = nur lokal)", variable: "signal_cli_bind", placeholder: "127.0.0.1", required: false }
    ],
    "create-stack-llama-cpp.yml": [
        { label: "llama.cpp Domain (bei Traefik)", variable: "llama_cpp_domain", placeholder: "ai.local", required: false },
        { label: "Modell-Datei (.gguf im Modell-Verzeichnis)", variable: "llama_model", placeholder: "mistral-7b-instruct.Q4_K_M.gguf", scope: "general", required: true },
        { label: "Modell-Verzeichnis auf dem Host", variable: "llama_models_dir", placeholder: "/srv/models", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "llama_cpp_port", placeholder: "8097", required: false }
    ],
    // Playbook Roadmap (Premium) – Batch 2 (RustDesk hat keine konfigurierbaren Variablen)
    "create-stack-crowdsec.yml": [
        { label: "CrowdSec LAPI Domain (bei Traefik)", variable: "crowdsec_domain", placeholder: "crowdsec.local", required: false },
        { label: "Collections (durch Leerzeichen getrennt)", variable: "crowdsec_collections", placeholder: "crowdsecurity/linux", required: false },
        { label: "LAPI-Port (ohne Traefik)", variable: "crowdsec_port", placeholder: "8087", required: false },
        { label: "Bind-Adresse (127.0.0.1 = nur lokal)", variable: "crowdsec_bind", placeholder: "127.0.0.1", scope: "port", required: false }
    ],
    "create-stack-ghost.yml": [
        { label: "Ghost Domain (bei Traefik)", variable: "ghost_domain", placeholder: "blog.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "ghost_url", placeholder: "http://blog.example.com", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "ghost_port", placeholder: "2368", required: false }
    ],
    "create-stack-bookstack.yml": [
        { label: "BookStack Domain (bei Traefik)", variable: "bookstack_domain", placeholder: "wiki.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "bookstack_url", placeholder: "http://wiki.example.com", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "bookstack_port", placeholder: "8098", required: false }
    ],
    // Playbook Roadmap (Premium) – Batch 3
    "create-stack-fireflyiii.yml": [
        { label: "Firefly III Domain (bei Traefik)", variable: "fireflyiii_domain", placeholder: "firefly.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "fireflyiii_url", placeholder: "http://firefly.example.com", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "fireflyiii_port", placeholder: "8099", required: false }
    ],
    "create-stack-monica.yml": [
        { label: "Monica Domain (bei Traefik)", variable: "monica_domain", placeholder: "monica.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "monica_url", placeholder: "http://monica.example.com", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "monica_port", placeholder: "8100", required: false }
    ],
    "create-stack-kimai.yml": [
        { label: "Kimai Domain (bei Traefik)", variable: "kimai_domain", placeholder: "kimai.local", required: false },
        { label: "Initial-Admin E-Mail", variable: "kimai_admin_email", placeholder: "admin@kimai.local", required: false },
        { label: "Initial-Admin Passwort (leer = automatisch generiert)", variable: "kimai_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "kimai_port", placeholder: "8001", required: false }
    ],
    "create-stack-headscale.yml": [
        { label: "Headscale Domain (bei Traefik)", variable: "headscale_domain", placeholder: "headscale.local", required: false },
        { label: "Öffentliche URL (server_url; Pflicht bei Remote ohne Traefik)", variable: "headscale_url", placeholder: "http://headscale.example.com", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "headscale_port", placeholder: "8085", required: false }
    ],
    "create-stack-gophish.yml": [
        { label: "GoPhish Admin-Domain (bei Traefik)", variable: "gophish_domain", placeholder: "gophish.local", required: false },
        { label: "Admin-Passwort (leer = automatisch generiert)", variable: "gophish_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "Admin-Port (ohne Traefik)", variable: "gophish_admin_port", placeholder: "3333", required: false },
        { label: "Phishing-Listener-Port", variable: "gophish_phish_port", placeholder: "8086", required: false, scope: "general" },
        { label: "Kontakt-Adresse (für gemeldete Test-Mails)", variable: "gophish_contact_address", placeholder: "security@example.com", required: false }
    ],
    "create-stack-freescout.yml": [
        { label: "FreeScout Domain (bei Traefik)", variable: "freescout_domain", placeholder: "help.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "freescout_url", placeholder: "http://help.example.com", required: false },
        { label: "Initial-Admin E-Mail", variable: "freescout_admin_email", placeholder: "admin@freescout.local", required: false },
        { label: "Initial-Admin Passwort (leer = automatisch generiert)", variable: "freescout_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "freescout_port", placeholder: "8101", required: false }
    ],
    "create-stack-akaunting.yml": [
        { label: "Akaunting Domain (bei Traefik)", variable: "akaunting_domain", placeholder: "akaunting.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "akaunting_url", placeholder: "http://akaunting.example.com", required: false },
        { label: "Firmenname", variable: "akaunting_company_name", placeholder: "My Company", required: false },
        { label: "Firmen-E-Mail", variable: "akaunting_company_email", placeholder: "admin@akaunting.local", required: false },
        { label: "Admin-E-Mail (Login)", variable: "akaunting_admin_email", placeholder: "admin@akaunting.local", required: false },
        { label: "Admin-Passwort (leer = automatisch generiert)", variable: "akaunting_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "Sprache (z.B. de-DE, en-GB)", variable: "akaunting_locale", placeholder: "de-DE", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "akaunting_port", placeholder: "8102", required: false }
    ],
    "create-stack-ghostfolio.yml": [
        { label: "Ghostfolio Domain (bei Traefik)", variable: "ghostfolio_domain", placeholder: "ghostfolio.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "ghostfolio_port", placeholder: "8103", required: false }
    ],
    "create-stack-stirling-pdf.yml": [
        { label: "Stirling-PDF Domain (bei Traefik)", variable: "stirling_domain", placeholder: "pdf.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "stirling_port", placeholder: "8090", required: false }
    ],
    "create-stack-nginx-proxy-manager.yml": [
        { label: "Initial-Admin E-Mail", variable: "npm_admin_email", placeholder: "admin@example.com", required: false, scope: "general" },
        { label: "Initial-Admin Passwort (leer = automatisch generiert)", variable: "npm_admin_password", placeholder: "Passwort", type: "password", required: false, scope: "general" },
        { label: "Admin-UI-Port", variable: "npm_admin_port", placeholder: "81", required: false, scope: "general" }
    ],
    "create-stack-ctfd.yml": [
        { label: "CTFd Domain (bei Traefik)", variable: "ctfd_domain", placeholder: "ctf.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "ctfd_port", placeholder: "8106", required: false }
    ],
    "create-stack-planka.yml": [
        { label: "Planka Domain (bei Traefik)", variable: "planka_domain", placeholder: "planka.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "planka_url", placeholder: "http://planka.example.com", required: false },
        { label: "Initial-Admin E-Mail", variable: "planka_admin_email", placeholder: "admin@planka.local", required: false },
        { label: "Initial-Admin Passwort (leer = automatisch generiert)", variable: "planka_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "planka_port", placeholder: "8104", required: false }
    ],
    "create-stack-hoppscotch.yml": [
        { label: "Hoppscotch Domain (bei Traefik)", variable: "hoppscotch_domain", placeholder: "hoppscotch.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "hoppscotch_url", placeholder: "http://hoppscotch.example.com", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "hoppscotch_port", placeholder: "8105", required: false }
    ],
    "create-stack-spiderfoot.yml": [
        { label: "SpiderFoot Domain (bei Traefik)", variable: "spiderfoot_domain", placeholder: "osint.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "spiderfoot_port", placeholder: "5001", required: false }
    ],
    "create-stack-listmonk.yml": [
        { label: "Listmonk Domain (bei Traefik)", variable: "listmonk_domain", placeholder: "listmonk.local", required: false },
        { label: "Admin Passwort (leer = automatisch generiert)", variable: "listmonk_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "listmonk_port", placeholder: "8112", required: false }
    ],
    "create-stack-paperless-ngx.yml": [
        { label: "Paperless Domain (bei Traefik)", variable: "paperless_domain", placeholder: "paperless.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "paperless_url", placeholder: "http://paperless.example.com", required: false },
        { label: "Admin Passwort (leer = automatisch generiert)", variable: "paperless_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "OCR-Sprache(n) (z.B. deu+eng)", variable: "paperless_ocr_language", placeholder: "deu+eng", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "paperless_port", placeholder: "8110", required: false }
    ],
    "create-stack-mattermost.yml": [
        { label: "Mattermost Domain (bei Traefik)", variable: "mattermost_domain", placeholder: "chat.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "mattermost_url", placeholder: "http://chat.example.com", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "mattermost_port", placeholder: "8065", required: false }
    ],
    "create-stack-prometheus-grafana.yml": [
        { label: "Grafana Domain (bei Traefik)", variable: "grafana_domain", placeholder: "grafana.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "grafana_url", placeholder: "http://grafana.example.com", required: false },
        { label: "Grafana Admin Passwort (leer = automatisch generiert)", variable: "grafana_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "HTTP-Port (Grafana, ohne Traefik)", variable: "grafana_port", placeholder: "8111", required: false }
    ],
    "create-stack-nextcloud.yml": [
        { label: "Nextcloud Domain (bei Traefik)", variable: "nextcloud_domain", placeholder: "cloud.example.com", required: false },
        { label: "Trusted Domains (Leerzeichen-getrennt; sonst lokal)", variable: "nextcloud_trusted_domains", placeholder: "cloud.example.com", required: false, scope: "general" },
        { label: "Admin Passwort (leer = automatisch generiert)", variable: "nextcloud_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "nextcloud_port", placeholder: "8113", required: false }
    ],
    "create-stack-immich.yml": [
        { label: "Immich Domain (bei Traefik)", variable: "immich_domain", placeholder: "immich.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "immich_port", placeholder: "8114", required: false }
    ],
    "create-stack-invoiceninja.yml": [
        { label: "Invoice Ninja Domain (bei Traefik)", variable: "invoiceninja_domain", placeholder: "invoices.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "invoiceninja_url", placeholder: "http://invoices.example.com", required: false },
        { label: "Initial-Admin E-Mail", variable: "invoiceninja_admin_email", placeholder: "admin@invoiceninja.local", required: false },
        { label: "Initial-Admin Passwort (leer = automatisch generiert)", variable: "invoiceninja_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "invoiceninja_port", placeholder: "8115", required: false }
    ],
    "create-stack-odoo.yml": [
        { label: "Odoo Domain (bei Traefik)", variable: "odoo_domain", placeholder: "odoo.local", required: false },
        { label: "Master-Passwort (DB-Manager; leer = automatisch generiert)", variable: "odoo_master_password", placeholder: "Passwort", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "odoo_port", placeholder: "8116", required: false }
    ],
    "create-stack-authentik.yml": [
        { label: "Authentik Domain (bei Traefik)", variable: "authentik_domain", placeholder: "auth.local", required: false },
        { label: "Admin E-Mail (akadmin)", variable: "authentik_admin_email", placeholder: "admin@authentik.local", required: false },
        { label: "Admin Passwort (leer = automatisch generiert)", variable: "authentik_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "authentik_port", placeholder: "8117", required: false }
    ],
    "create-stack-chatwoot.yml": [
        { label: "Chatwoot Domain (bei Traefik)", variable: "chatwoot_domain", placeholder: "chat.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "chatwoot_url", placeholder: "http://chat.example.com", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "chatwoot_port", placeholder: "8118", required: false }
    ],
    "create-stack-penpot.yml": [
        { label: "Penpot Domain (bei Traefik)", variable: "penpot_domain", placeholder: "design.local", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "penpot_url", placeholder: "http://design.example.com", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "penpot_port", placeholder: "8119", required: false }
    ],
    "create-stack-gitlab.yml": [
        { label: "GitLab Domain (bei Traefik)", variable: "gitlab_domain", placeholder: "gitlab.example.com", required: false },
        { label: "Öffentliche URL (Pflicht bei Remote-Zugriff ohne Traefik)", variable: "gitlab_url", placeholder: "http://gitlab.example.com", required: false },
        { label: "Root-Passwort (leer = automatisch generiert)", variable: "gitlab_root_password", placeholder: "Passwort", type: "password", required: false },
        { label: "SSH-Port (git over ssh)", variable: "gitlab_ssh_port", placeholder: "2223", required: false, scope: "general" },
        { label: "HTTP-Port (ohne Traefik)", variable: "gitlab_port", placeholder: "8121", required: false }
    ],
    "create-stack-defectdojo.yml": [
        { label: "DefectDojo Domain (bei Traefik)", variable: "defectdojo_domain", placeholder: "defectdojo.local", required: false },
        { label: "Admin Passwort (leer = automatisch generiert)", variable: "defectdojo_admin_password", placeholder: "Passwort", type: "password", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "defectdojo_port", placeholder: "8120", required: false }
    ],
    "create-stack-zammad.yml": [
        { label: "Zammad Domain (bei Traefik)", variable: "zammad_domain", placeholder: "helpdesk.local", required: false },
        { label: "HTTP-Port (ohne Traefik)", variable: "zammad_port", placeholder: "8122", required: false }
    ],
    "create-stack-woodpecker.yml": [
        { label: "Woodpecker Domain (bei Traefik)", variable: "woodpecker_domain", placeholder: "ci.example.com", required: false },
        { label: "Öffentliche URL (muss zur OAuth-Callback-URL passen)", variable: "woodpecker_url", placeholder: "http://ci.example.com", required: false },
        { label: "Forge-URL (Gitea/Forgejo)", variable: "woodpecker_forge_url", placeholder: "https://git.example.com", required: true, scope: "general" },
        { label: "OAuth2 Client-ID (von der Forge)", variable: "woodpecker_oauth_client", placeholder: "Client-ID", required: true, scope: "general" },
        { label: "OAuth2 Client-Secret (von der Forge)", variable: "woodpecker_oauth_secret", placeholder: "Client-Secret", type: "password", required: true, scope: "general" },
        { label: "Admin-Benutzer (Forge-Usernamen, kommagetrennt)", variable: "woodpecker_admin", placeholder: "alice,bob", required: true, scope: "general" },
        { label: "HTTP-Port (ohne Traefik)", variable: "woodpecker_port", placeholder: "8123", required: false }
    ]
};

// Modal dialog display controls
function showCredentialsModal() {
    modalTargetHost.value = "";
    modalUsernameInput.value = "";
    modalPasswordInput.value = "";
    modalBaseDirInput.value = "";
    modalBaseDirInput.dataset.edited = "false";
    
    // Prefill timezone
    const modalTimezone = document.getElementById("modal-timezone");
    if (modalTimezone) {
        modalTimezone.value = containerTimezone;
    }
    
    // Determine which domains are required
    const checkedBoxes = playbooksList.querySelectorAll('input[name="playbooks"]:checked');
    const checkedPlaybooks = Array.from(checkedBoxes).map(cb => cb.value);
    const uniqueCheckedPlaybooks = [...new Set(checkedPlaybooks)];
    //: dieselbe Rangfolge wie der Backend-Runner (Voraussetzungen -> install-* -> create-stack-*).
    uniqueCheckedPlaybooks.sort((a, b) => playbookOrderRank(a) - playbookOrderRank(b));
    
    //: Die Box "Gewählte Playbooks" wurde entfernt; uniqueCheckedPlaybooks wird
    // weiterhin fuer die HTTPS-/Port-Warnungen und die Konfig-Akkordeons benoetigt.

    //: Warnhinweis, wenn ein gewaehltes Playbook HTTPS voraussetzt.
    const httpsWarn = document.getElementById("modal-https-warning");
    const httpsWarnText = document.getElementById("modal-https-warning-text");
    if (httpsWarn && httpsWarnText) {
        const httpsNames = [];
        uniqueCheckedPlaybooks.forEach(pbPath => {
            const baseFile = pbPath.split('/').pop();
            const pb = (allPlaybooks || []).find(p => p.file === pbPath || (p.file && p.file.split('/').pop() === baseFile));
            if (pb && pb.requires_https) httpsNames.push(pb.name || baseFile);
        });
        if (httpsNames.length) {
            const verb = httpsNames.length === 1 ? "setzt" : "setzen";
            httpsWarnText.textContent = `${httpsNames.join(", ")} ${verb} HTTPS voraus. Bitte stellen Sie sicher, dass Ihre Ziel-Infrastruktur SSL unterstützt.`;
            httpsWarn.classList.remove("hidden");
        } else {
            httpsWarn.classList.add("hidden");
        }
    }

    //: Konfigurations-Felder pro Playbook gruppieren (fuer das Akkordeon).
    const configGroups = [];
    let totalConfigs = 0;
    uniqueCheckedPlaybooks.forEach(pbPath => {
        const baseName = pbPath.split('/').pop();
        const cfgs = playbookDomainConfigs[baseName];
        if (cfgs && cfgs.length) {
            const meta = playbookMetadataMap[pbPath] || playbookMetadataMap[baseName] || { name: baseName };
            //: Service-Gruppe (Varianten desselben Diensts kollidieren nicht);
            // ohne explizite Gruppe ist jedes Playbook seine eigene Gruppe.
            const serviceGroup = meta.service_group || baseName;
            configGroups.push({ name: meta.name || baseName, icon: meta.icon, configs: cfgs, serviceGroup });
            totalConfigs += cfgs.length;
        }
    });

    // Detect active presets (where at least one linked playbook is checked)
    const activePresets = allPresets.filter(preset => {
        return preset.playbooks.some(pb => {
            const cb = playbooksList.querySelector(`input[name="playbooks"][value="${pb.file}"]`);
            return cb && cb.checked;
        });
    });

    // Merge default variables from active presets
    const activeVariables = {};
    activePresets.forEach(preset => {
        if (preset.variables) {
            Object.assign(activeVariables, preset.variables);
        }
    });
    // : Variablen aktiver eigener/freigegebener Presets ergänzen (alle ihre Playbooks
    // gewählt), damit die gespeicherten Einstellungen sichtbar in die Felder geladen werden.
    (userCustomPresets || []).forEach(p => {
        const ids = p.playbook_ids || [];
        if (!ids.length || !p.variables) return;
        const allSelected = ids.every(file => {
            const cb = playbooksList.querySelector(`input[name="playbooks"][value="${cssEscape(file)}"]`);
            return cb && cb.checked;
        });
        if (allSelected) Object.assign(activeVariables, p.variables);
    });
    // base_dir/timezone liegen ausserhalb der Domains-Sektion -> hier sichtbar vorbefüllen
    // (die Domain/Port-Felder ziehen ihren Wert weiter unten direkt aus activeVariables).
    if (activeVariables.base_dir) {
        modalBaseDirInput.value = activeVariables.base_dir;
        modalBaseDirInput.dataset.edited = "true";
    }
    if (activeVariables.timezone) {
        const _tzEl = document.getElementById("modal-timezone");
        if (_tzEl) _tzEl.value = activeVariables.timezone;
    }

    const domainsInputsContainer = document.getElementById("modal-domains-inputs");
    const domainsSection = document.getElementById("modal-domains-section");
    const traefikContainer = document.getElementById("modal-traefik-container");
    const useTraefikCheckbox = document.getElementById("modal-use-traefik");
    
    domainsInputsContainer.innerHTML = "";
    
    if (totalConfigs > 0) {
        traefikContainer.classList.remove("hidden");
        //: Sektion ist sichtbar, sobald es Felder gibt (nicht mehr nur im Traefik-Modus).
        domainsSection.classList.remove("hidden");

        //: Felder je Playbook in ein einklappbares Akkordeon (standardmaessig zu).
        configGroups.forEach(group => {
            const details = document.createElement("details");
            details.className = "modal-config-accordion";
            const summary = document.createElement("summary");
            summary.className = "modal-config-accordion-summary";
            //: Playbook-Logo links neben dem Titel; Anzahl wird in
            // applyScopeVisibility anhand der tatsaechlich sichtbaren Felder gesetzt.
            summary.innerHTML =
                `<span class="modal-config-accordion-label">${playbookIconHtml({ icon: group.icon })}<span>${escapeHtml(group.name)}</span></span>` +
                `<span class="modal-config-accordion-count"></span>`;
            details.appendChild(summary);
            const body = document.createElement("div");
            body.className = "modal-config-accordion-body";

            group.configs.forEach(cfg => {
                //: Geltungsbereich je Feld – Domains nur mit Traefik, HTTP-Ports nur ohne
                // Traefik, alle uebrigen Einstellungen immer. Ein expliziter cfg.scope hat Vorrang
                // (z.B. der DB-Port postgres_port ist KEINE Traefik-Alternative -> 'general').
                let scope = cfg.scope
                    || (cfg.variable.endsWith("_domain") ? "domain"
                        : (cfg.variable.endsWith("_port") ? "port" : "general"));
                const div = document.createElement("div");
                div.dataset.scope = scope;
                //: Service-Gruppe am Feld hinterlegen (Port-Kollisionspruefung).
                div.dataset.serviceGroup = group.serviceGroup;
                if (cfg.type === "bool") {
                    //: Wahrheitswerte als Umschalt-Checkbox statt Freitext "true/false".
                    // Vorbelegung aus dem aktiven Preset, sonst der Playbook-Default (cfg.default).
                    const prefill = activeVariables[cfg.variable];
                    const checked = (prefill !== undefined) ? (prefill === true || prefill === "true") : !!cfg.default;
                    div.className = "config-field bool-field";
                    div.innerHTML =
                        `<label class="checkbox-label bool-field-label"><input type="checkbox" class="styled-checkbox" id="variable-${cfg.variable}" data-variable="${cfg.variable}" data-scope="${scope}"${checked ? " checked" : ""}><span>${escapeHtml(cfg.label)}</span></label>`;
                } else {
                    //: Beispielwert als grauer HTML-Placeholder (Label schwebt via .config-field
                    // dauerhaft oben, damit es den Placeholder nicht überlagert).
                    const defaultValue = activeVariables[cfg.variable] || "";
                    const type = cfg.type || "text";
                    const requiredAttr = cfg.required ? "required" : "";
                    const ph = cfg.placeholder ? escapeHtml(cfg.placeholder) : " ";
                    div.className = "text-field config-field";
                    div.innerHTML =
                        `<input type="${type}" id="variable-${cfg.variable}" data-variable="${cfg.variable}" data-required="${cfg.required}" data-scope="${scope}" ${requiredAttr} placeholder="${ph}" value="${escapeHtml(defaultValue)}">` +
                        `<label for="variable-${cfg.variable}">${escapeHtml(cfg.label)}</label>`;
                }
                body.appendChild(div);
            });
            details.appendChild(body);
            domainsInputsContainer.appendChild(details);
        });

        const hasPrefilled = Object.keys(activeVariables).length > 0;

        //: Felder je nach Traefik-Modus ein-/ausblenden; Akkordeons ohne
        // sichtbares Feld komplett ausblenden.
        const applyScopeVisibility = () => {
            const traefik = useTraefikCheckbox.checked;
            let anyVisible = false;
            domainsInputsContainer.querySelectorAll(".modal-config-accordion").forEach(acc => {
                let visibleCount = 0;
                acc.querySelectorAll(".config-field").forEach(field => {
                    const scope = field.dataset.scope;
                    const visible = scope === "general" || (scope === "domain" ? traefik : !traefik);
                    field.style.display = visible ? "" : "none";
                    if (visible) { anyVisible = true; visibleCount++; }
                    const inp = field.querySelector("input");
                    if (inp) inp.required = visible && inp.dataset.required === "true";
                });
                acc.style.display = visibleCount > 0 ? "" : "none";
                //: Anzahl an die tatsaechlich sichtbaren Felder anpassen.
                const countEl = acc.querySelector(".modal-config-accordion-count");
                if (countEl) countEl.textContent = `${visibleCount} Einstellung${visibleCount === 1 ? "" : "en"}`;
            });
            //: Die Sektion enthaelt jetzt die Traefik-Checkbox und muss erreichbar bleiben,
            // solange es ueberhaupt Konfig-Felder gibt (totalConfigs > 0) - daher NICHT mehr
            // anhand sichtbarer Felder ausblenden. Die Unter-Ueberschrift wird nur eingeblendet,
            // wenn tatsaechlich Felder sichtbar sind.
            domainsSection.classList.remove("hidden");
            const fieldsSubtitle = domainsSection.querySelector(".section-subtitle");
            if (fieldsSubtitle) fieldsSubtitle.style.display = anyVisible ? "" : "none";
            //: nach jeder Sichtbarkeitsaenderung Port-Kollisionen pruefen.
            checkPortCollisions();
        };

        //: Port-Kollisionen auch bei jeder Eingabe in den Port-Feldern live pruefen.
        domainsInputsContainer.addEventListener("input", checkPortCollisions);

        useTraefikCheckbox.onchange = applyScopeVisibility;
        // : use_traefik aus dem aktiven Preset übernehmen, falls gespeichert; sonst Default
        // (true, wenn das Preset überhaupt Variablen mitbringt).
        useTraefikCheckbox.checked = (activeVariables.use_traefik !== undefined)
            ? (activeVariables.use_traefik === true || activeVariables.use_traefik === "true")
            : hasPrefilled;
        applyScopeVisibility();
    } else {
        traefikContainer.classList.add("hidden");
        domainsSection.classList.add("hidden");
        useTraefikCheckbox.checked = false;
        useTraefikCheckbox.onchange = null;
    }
    
    //  (#E): "Als Preset speichern"-Controls nur fuer aktive Nicht-Gaeste (oder Admins) zeigen.
    // Das Server-Gate in create_custom_preset ist die eigentliche Grenze; dies ist nur Komfort.
    //  (Community): in der Community-Edition komplett ausblenden+deaktivieren.
    const canSavePreset = currentEdition !== "community" && !!currentUser && currentUser.role !== "guest" && (currentUser.is_subscription_active || currentUser.role === "admin");
    const savePresetRow = document.getElementById("modal-save-preset-row");
    if (savePresetRow) savePresetRow.style.display = canSavePreset ? "" : "none";
    const savePresetBtn = document.getElementById("modal-save-preset-btn");
    // : "Nur als Preset speichern" startet deaktiviert (erst ab eingegebenem Namen aktiv).
    if (savePresetBtn) { savePresetBtn.style.display = canSavePreset ? "" : "none"; savePresetBtn.disabled = true; }
    const savePresetCb = document.getElementById("modal-save-preset-cb");
    if (savePresetCb) savePresetCb.checked = false;
    const modalPresetName = document.getElementById("modal-preset-name");
    if (modalPresetName) modalPresetName.value = "";

    //: frischer Dialog -> keine ungespeicherten Aenderungen.
    modalDirty = false;
    credentialsDialog.classList.remove("hidden");
    modalTargetHost.focus();
}

// : Das Vorbefüllen der Preset-Einstellungen läuft jetzt zentral in showCredentialsModal
// (activeVariables inkl. userCustomPresets) — eine separate applyPresetVariablesToModal-Funktion
// ist nicht mehr nötig.

function hideCredentialsModal() {
    credentialsDialog.classList.add("hidden");
    modalDirty = false;
    modalTargetHost.disabled = false;
    modalUsernameInput.disabled = false;
    modalPasswordInput.disabled = false;
    const deviceSelect = document.getElementById("modal-device-select");
    if (deviceSelect) deviceSelect.value = "";
    // : aktive Preset-Bindung loesen, damit ein folgender normaler Lauf sie nicht erbt.
    window._activePresetId = null;
    //  (#E): Preset-Speichern-Controls zuruecksetzen.
    const _spCb = document.getElementById("modal-save-preset-cb"); if (_spCb) _spCb.checked = false;
    const _spName = document.getElementById("modal-preset-name"); if (_spName) _spName.value = "";
    const _spBtn = document.getElementById("modal-save-preset-btn"); if (_spBtn) _spBtn.disabled = true;
}

// : wiederverwendbarer, gestylter Bestätigungsdialog (#app-confirm-dialog) als Ersatz
// fuer natives window.confirm() — v. a. bei Lösch-Bestätigungen (Geräte, Presets, Playbooks, …).
// Gibt ein Promise<boolean> zurueck (true = bestaetigt). ESC/Backdrop/Abbrechen -> false.
// : `messageHtml` erlaubt formatierten Inhalt (fette Namen, Akzentfarben). Aufrufer
// MÜSSEN dynamische Werte darin selbst via escapeHtml() entschärfen; `message` bleibt reiner Text.
function showConfirmDialog({ title = "Bestätigen", message = "", messageHtml = null, confirmLabel = "Bestätigen", cancelLabel = "Abbrechen" } = {}) {
    return new Promise(resolve => {
        const dlg = document.getElementById("app-confirm-dialog");
        if (!dlg) { resolve(window.confirm(message)); return; }
        document.getElementById("app-confirm-title").textContent = title;
        const msgEl = document.getElementById("app-confirm-message");
        if (messageHtml != null) msgEl.innerHTML = messageHtml;
        else msgEl.textContent = message;
        const ok = document.getElementById("app-confirm-ok");
        const cancel = document.getElementById("app-confirm-cancel");
        ok.textContent = confirmLabel;
        cancel.textContent = cancelLabel;
        let done = false;
        const cleanup = () => {
            dlg.classList.add("hidden");
            ok.removeEventListener("click", onOk);
            cancel.removeEventListener("click", onCancel);
            dlg.removeEventListener("click", onBackdrop);
            document.removeEventListener("keydown", onKey);
        };
        const finish = val => { if (done) return; done = true; cleanup(); resolve(val); };
        const onOk = () => finish(true);
        const onCancel = () => finish(false);
        const onBackdrop = e => { if (e.target === dlg) finish(false); };
        const onKey = e => { if (e.key === "Escape") finish(false); };
        ok.addEventListener("click", onOk);
        cancel.addEventListener("click", onCancel);
        dlg.addEventListener("click", onBackdrop);
        document.addEventListener("keydown", onKey);
        dlg.classList.remove("hidden");
        ok.focus();
    });
}

//: benutzerinitiiertes Schliessen (ESC/Backdrop/Abbrechen) mit Warnung bei
// ungespeicherten Eingaben. Nach erfolgreichem Start ruft handleModalSubmit
// hideCredentialsModal() direkt auf (ohne Nachfrage).
function closeCredentialsModalGuarded() {
    if (modalDirty) {
        // : gestylte Bestätigung im Webseiten-Stil statt nativem window.confirm.
        const dlg = document.getElementById("discard-confirm-dialog");
        if (dlg) { dlg.classList.remove("hidden"); return; }
    }
    hideCredentialsModal();
}

//: Port-Kollisionspruefung. Warnt, wenn derselbe Host-Port von Feldern
// UNTERSCHIEDLICHER Dienste (service_group) belegt wird. Varianten desselben
// Diensts (gleiche service_group) kollidieren bewusst nicht. Nur sichtbare
// Port-Felder (im veroeffentlichten-Ports-Modus relevant) zaehlen.
function checkPortCollisions() {
    const warn = document.getElementById("modal-port-warning");
    const warnText = document.getElementById("modal-port-warning-text");
    const container = document.getElementById("modal-domains-inputs");
    if (!warn || !warnText || !container) return;
    const portMap = {}; // host-port -> Set(service_group)
    container.querySelectorAll(".text-field").forEach(field => {
        if (field.style.display === "none") return;
        const inp = field.querySelector("input");
        if (!inp || !inp.dataset.variable || !inp.dataset.variable.endsWith("_port")) return;
        const val = (inp.value || "").trim();
        if (!val) return;
        const grp = field.dataset.serviceGroup || inp.dataset.variable;
        (portMap[val] = portMap[val] || new Set()).add(grp);
    });
    const conflicting = Object.keys(portMap).filter(p => portMap[p].size > 1);
    if (conflicting.length) {
        const verb = conflicting.length === 1 ? "wird" : "werden";
        warnText.textContent = `Port-Kollision: ${conflicting.join(", ")} ${verb} von mehreren unterschiedlichen Diensten belegt. Bitte vergeben Sie unterschiedliche Host-Ports.`;
        warn.classList.remove("hidden");
    } else {
        warn.classList.add("hidden");
    }
}

//  (#E): Playbook-/Variablen-Sammlung aus dem Run-Dialog ausfaktorisiert, damit der Run-Pfad
// (handleModalSubmit) UND das Preset-Speichern byte-gleiche Werte verwenden.
function collectModalPlaybooks() {
    const checkedBoxes = playbooksList.querySelectorAll('input[name="playbooks"]:checked');
    const playbooks = Array.from(checkedBoxes).map(cb => cb.value);
    const uniquePlaybooks = [...new Set(playbooks)];
    //: dieselbe Rangfolge wie der Backend-Runner (Voraussetzungen -> install-* -> create-stack-*).
    uniquePlaybooks.sort((a, b) => playbookOrderRank(a) - playbookOrderRank(b));
    return uniquePlaybooks;
}

function collectModalVariables(baseDir) {
    const variables = {};
    if (baseDir) {
        variables["base_dir"] = baseDir;
    }
    const modalTimezone = document.getElementById("modal-timezone");
    if (modalTimezone && modalTimezone.value.trim()) {
        variables["timezone"] = modalTimezone.value.trim();
    }
    const useTraefikCheckbox = document.getElementById("modal-use-traefik");
    const useTraefik = !!(useTraefikCheckbox && useTraefikCheckbox.checked);
    variables["use_traefik"] = useTraefik;
    document.querySelectorAll("#modal-domains-inputs .config-field").forEach(field => {
        if (field.style.display === "none") return;
        const inp = field.querySelector("input");
        if (!inp || !inp.dataset.variable) return;
        //: Bool-Checkbox liefert immer einen expliziten true/false-String; Textfelder
        // wie bisher nur, wenn befüllt (leer = Playbook-Default greift).
        if (inp.type === "checkbox") {
            variables[inp.dataset.variable] = inp.checked ? "true" : "false";
        } else if (inp.value.trim()) {
            variables[inp.dataset.variable] = inp.value.trim();
        }
    });
    return variables;
}

//  (#E): aktuelle Run-Konfiguration als Preset speichern (Premium; Server erzwingt das Gate
// erneut, das UI-Gating ist nur Komfort). opts.silent unterdrueckt den Erfolgs-Toast.
async function saveModalPreset(opts) {
    opts = opts || {};
    const nameEl = document.getElementById("modal-preset-name");
    const name = ((nameEl && nameEl.value) || "").trim();
    const playbook_ids = collectModalPlaybooks();
    if (!name) { showToast("Bitte einen Preset-Namen eingeben."); if (nameEl) nameEl.focus(); return false; }
    if (!playbook_ids.length) { showToast("Bitte mindestens ein Playbook auswählen."); return false; }
    // base_dir wie im echten Run aufloesen (gleiche Fallback-Logik).
    const username = modalUsernameInput.value.trim();
    let baseDir = modalBaseDirInput.value.trim();
    if (!baseDir && username && !document.getElementById("modal-device-select").value) {
        baseDir = username === "root" ? "/root" : `/home/${username}`;
    }
    // Preset-Variablen sind Strings (Backend-Schema Dict[str,str]); use_traefik (bool) etc.
    // stringifizieren. Der Run-Pfad (/api/run) bleibt unveraendert mit den Rohwerten.
    const _vars = collectModalVariables(baseDir);
    const variables = {};
    Object.keys(_vars).forEach(k => { variables[k] = String(_vars[k]); });
    try {
        // : Ein Preset bündelt NUR Playbooks + deren Einstellungen — keine Gerätedaten
        // bzw. Geräte-Bindung (Geräte werden separat verwaltet). device_group_id bleibt leer.
        const res = await fetch("/api/profile/presets", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, playbook_ids, variables, device_ids: [], shares: [] })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            if (!opts.silent) showToast("Preset gespeichert.");
            if (typeof fetchUserCustomPresets === "function") await fetchUserCustomPresets();
            //: Katalog-Kacheln auf der Startseite ohne Reload aktualisieren.
            if (typeof renderPlaybooks === "function" && Array.isArray(allPlaybooks) && allPlaybooks.length) renderPlaybooks();
            if (typeof loadPresets === "function" && document.querySelector("#vault-tab-presets #presets-list") && document.body.classList.contains("tab-vault")) loadPresets();
            return true;
        }
        showToast(errorDetailToMessage(data.detail, "Preset speichern fehlgeschlagen."));
        return false;
    } catch (e) { showToast("Netzwerkfehler beim Speichern."); return false; }
}

// "Nur als Preset speichern" — speichert ohne Run und schliesst den Dialog bei Erfolg.
async function handleSavePresetFromDialog() {
    const ok = await saveModalPreset();
    if (ok) hideCredentialsModal();
}

// Final Submit from Modal dialog
async function handleModalSubmit() {
    //: vorherige Fehlermeldung im Dialog zuruecksetzen.
    const modalErrEl = document.getElementById("modal-error");
    if (modalErrEl) modalErrEl.classList.add("hidden");
    const targetHost = modalTargetHost.value.trim();
    const username = modalUsernameInput.value.trim();
    const password = modalPasswordInput.value.trim();
    
    // Resolve BASE_DIR (with fallback if empty)
    let baseDir = modalBaseDirInput.value.trim();
    if (!baseDir && username && !document.getElementById("modal-device-select").value) {
        if (username === "root") {
            baseDir = "/root";
        } else {
            baseDir = `/home/${username}`;
        }
    }
    
    const uniquePlaybooks = collectModalPlaybooks();

    const deviceSelect = document.getElementById("modal-device-select");
    // (Device-Flatten): das Dropdown liefert direkt eine device_id (kein group:-Praefix mehr).
    const deviceId = deviceSelect ? deviceSelect.value : "";

    // Bei einem gebundenen Preset loest der Server die Zielgeraete (device_ids) auf -> keine
    // manuelle Host-Eingabe erzwingen (das Einzel-Dropdown kann Multi-Host nicht abbilden).
    if (!deviceId && !window._activePresetId) {
        if (!targetHost) {
            showToast("Zielgerät ist erforderlich.");
            modalTargetHost.focus();
            return;
        }
        if (!username) {
            showToast("SSH-Benutzername ist erforderlich.");
            modalUsernameInput.focus();
            return;
        }
        if (!password) {
            showToast("SSH-Passwort ist erforderlich.");
            modalPasswordInput.focus();
            return;
        }
    }
    
    //: Dialog NICHT vorab schliessen - erst nach erfolgreichem Start (s. unten).
    // Bei Server-Fehler bleibt er offen und zeigt die Meldung inline, damit die
    // bereits gemachten Eingaben erhalten bleiben.
    // Disable run button and start execution
    runButton.disabled = true;
    runButton.innerHTML = `<span class="spinner"></span> Ausführen...`;
    
    // Prepare variables payload (#E: ausfaktorisiert -> byte-gleich zum Preset-Speichern).
    const variables = collectModalVariables(baseDir);
    
    const payload = {
        playbooks: uniquePlaybooks,
        session_id: sessionId,
        variables: variables
    };
    // : Preset-Ausfuehrung -> der Server loest Playbooks/Variablen/Gruppe auf und
    // erzwingt Berechtigung (strict/flexible) + Premium-Gate.
    if (window._activePresetId) {
        payload.custom_preset_id = window._activePresetId;
    }

    if (deviceId) {
        payload.device_id = deviceId;
    } else {
        payload.target_host = targetHost;
        payload.username = username;
        payload.password = password;
    }
    //: optionales Sudo-/Become-Passwort mitsenden (überschreibt ein am Gerät hinterlegtes).
    const becomeEl = document.getElementById("modal-become-password");
    if (becomeEl && becomeEl.value) {
        payload.become_password = becomeEl.value;
    }

    try {
        const response = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {

            const data = await response.json();
            throw new Error(errorDetailToMessage(data.detail, "Serverfehler beim Starten des Jobs."));
        }
        
        const result = await response.json();
        //  (#E): "Als Preset speichern" angehakt -> Run-Konfiguration zusaetzlich als Preset sichern.
        //  (Community): in der Community-Edition nie speichern (Controls dort ausgeblendet).
        const _savePresetCb = document.getElementById("modal-save-preset-cb");
        if (currentEdition !== "community" && _savePresetCb && _savePresetCb.checked) { await saveModalPreset({ silent: true }); }
        hideCredentialsModal();   //: erst nach erfolgreichem Start schliessen
        showToast("Playbook-Ausführung in die Warteschlange eingereiht!");
        
        // Temporarily enable history button immediately since a job is created
        const btnHistory = document.getElementById("nav-btn-history");
        if (btnHistory) btnHistory.disabled = false;
        
        // Auto focus new host tab and select new running job
        activeHost = targetHost;
        selectedJobId = result.job_id;
        streamLogs(result.job_id);
        
        // Switch tab to history so user sees logs immediately
        setTab("history");

        // Refresh history immediately
        await refreshHistory();
        //: Falls die Poll-Schleife nach einem Logout pausiert wurde, hier wieder
        // anstossen, damit auch ein anonymer Lauf live verfolgt werden kann. Idempotent.
        startHistoryPolling();
    } catch (err) {
        //: Fehler NUR im weiterhin offenen Dialog anzeigen (kein zusaetzlicher Toast;
        // Eingaben bleiben erhalten). Toast nur als Fallback, falls das Element fehlt.
        if (modalErrEl) { modalErrEl.textContent = err.message; modalErrEl.classList.remove("hidden"); }
        else { showToast(err.message); }
    } finally {
        runButton.disabled = false;
        runButton.innerHTML = `<span class="material-symbols-outlined">play_arrow</span> Ausführen`;
    }
}

//: Läuft der Job noch? Entscheidet, ob ein beendeter Log-Stream als "fertig" gilt oder
// ein vorzeitiger Abbruch war, der einen Reconnect erfordert.
async function jobIsActive(jobId) {
    try {
        const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}?session_id=${encodeURIComponent(sessionId)}`);
        if (!r.ok) return false;
        const j = await r.json();
        return j.status === "pending" || j.status === "running";
    } catch (e) {
        return false;
    }
}

// Stream logs in real-time from server using ReadableStream.
//: robust gegen Verbindungsabbrüche – Server sendet Heartbeats (NUL-Bytes) gegen den
// Idle-Timeout von Proxys/Browser; der Client filtert diese heraus und reconnectet bei einem
// Abbruch automatisch ab dem zuletzt gelesenen Byte-Offset (kein Duplikat, keine Lücke).
async function streamLogs(jobId) {
    if (currentlyStreamingJobId === jobId && logController) {
        return; // Already streaming this job!
    }

    // Cancel any previous stream
    if (logController) {
        logController.abort();
    }

    currentlyStreamingJobId = jobId;
    logController = new AbortController();
    const myController = logController;

    activeJobIdBadge.textContent = jobId;
    consoleOutput.textContent = "";
    copyLogsBtn.disabled = true;
    logUserScrolledUp = false; //: neuer Stream -> wieder am Ende verankern

    //: Scroll-Listener einmalig anhängen – pausiert Auto-Scroll, sobald der Nutzer
    // hochscrollt, und nimmt es wieder auf, sobald er zurück ans Ende scrollt.
    if (!logScrollListenerAttached) {
        consoleOutput.addEventListener("scroll", () => {
            const atBottom = consoleOutput.scrollTop + consoleOutput.clientHeight >= consoleOutput.scrollHeight - 24;
            logUserScrolledUp = !atBottom;
        });
        logScrollListenerAttached = true;
    }

    // bytesReceived zählt NUR echte Logdatei-Bytes (Heartbeat-NULs werden herausgefiltert und
    // NICHT mitgezählt) -> der Server macht nach einem Reconnect exakt an der richtigen Stelle
    // weiter. attempt begrenzt Endlos-Reconnects, wird bei echtem Fortschritt zurückgesetzt.
    let bytesReceived = 0;
    let attempt = 0;

    const appendChunk = (bytes, decoder, done) => {
        const chunk = decoder.decode(bytes, { stream: !done });
        if (!chunk) return;
        consoleOutput.textContent += chunk;
        //: Auto-Scroll nur, wenn aktiviert UND der Nutzer nicht selbst hochgescrollt hat.
        if (autoscrollBtn.classList.contains("active") && !logUserScrolledUp) {
            requestAnimationFrame(() => {
                consoleOutput.scrollTop = consoleOutput.scrollHeight;
            });
        }
    };

    while (true) {
        if (myController.signal.aborted || currentlyStreamingJobId !== jobId) return;
        const decoder = new TextDecoder("utf-8");
        let cleanEof = false;
        try {
            // : session_id mitsenden, damit anonyme Betrachter ihren EIGENEN anonymen
            // Lauf sehen.: offset = bereits gelesene Logdatei-Bytes (Reconnect-Resume).
            const url = `/api/jobs/${encodeURIComponent(jobId)}/logs?session_id=${encodeURIComponent(sessionId)}&offset=${bytesReceived}`;
            const response = await fetch(url, { signal: myController.signal });

            if (!response.ok) {
                // 404/403 sind endgültig -> nicht reconnecten.
                if (response.status === 404 || response.status === 403) {
                    if (bytesReceived === 0) consoleOutput.textContent += `\n[Log nicht verfügbar]`;
                    return;
                }
                throw new Error("Fehler beim Abrufen des Log-Streams.");
            }

            const reader = response.body.getReader();
            copyLogsBtn.disabled = false;
            let done = false;
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value && value.length) {
                    //: Heartbeat-NUL-Bytes herausfiltern (Anzeige) und von der Offset-Zählung
                    // ausnehmen, damit der Reconnect-Offset exakt der Logdatei-Position entspricht.
                    let hasNul = false;
                    for (let i = 0; i < value.length; i++) { if (value[i] === 0) { hasNul = true; break; } }
                    const bytes = hasNul ? value.filter(b => b !== 0) : value;
                    if (bytes.length) {
                        bytesReceived += bytes.length;
                        attempt = 0; // echter Fortschritt -> Reconnect-Zähler zurücksetzen
                        appendChunk(bytes, decoder, done);
                    }
                }
            }
            cleanEof = true;
        } catch (err) {
            if (err.name === 'AbortError' || myController.signal.aborted) {
                return; // Clean cancellation when switching logs
            }
            // sonst: Netzwerkabbruch -> unten reconnecten
        }

        if (myController.signal.aborted || currentlyStreamingJobId !== jobId) return;

        // Sauberes Stream-Ende: der Server beendet den Stream nur, wenn der Job fertig ist. Läuft
        // der Job laut Status noch, hat vermutlich ein Proxy die Verbindung geschlossen -> reconnect.
        if (cleanEof && !(await jobIsActive(jobId))) {
            return; // Job fertig, Log vollständig
        }

        attempt++;
        if (attempt > 120) {
            consoleOutput.textContent += `\n[Log-Streaming nach mehreren Fehlversuchen abgebrochen]`;
            return;
        }
        await new Promise(r => setTimeout(r, Math.min(1000 * attempt, 3000)));
    }
}

// Poll history list
async function startHistoryPolling() {
    //: Idempotent - eine zweite Schleife wuerde /api/jobs doppelt feuern.
    if (pollingActive) return;
    pollingActive = true;
    async function poll() {
        await refreshHistory();

        //: Nach dem Logout (kein eingeloggter User) und ohne eigene Jobs/aktiven
        // Log-Stream gibt es nichts zu pollen -> Schleife anhalten statt endlos
        // /api/jobs?session_id=... zu feuern. Re-Arm erfolgt bei Login (checkAuthStatus)
        // bzw. beim Starten eines neuen Laufs (handleRun).
        if (!currentUser && allJobs.length === 0 && !logController) {
            pollingActive = false;
            pollTimeout = null;
            return;
        }

        // Adjust polling frequency based on active jobs in list
        const activeStates = allJobs.filter(j => j.status === "running" || j.status === "pending");
        const interval = activeStates.length > 0 ? 2500 : 8000;

        pollTimeout = setTimeout(poll, interval);
    }
    await poll();
}

//: Polling hart stoppen (Logout). clearTimeout + Flag zuruecksetzen, damit ein
// spaeteres startHistoryPolling() wieder anlaeuft.
function stopHistoryPolling() {
    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
    }
    pollingActive = false;
}

async function refreshHistory() {
    try {
        const response = await fetch(`/api/jobs?session_id=${sessionId}`);
        if (!response.ok) return;
        const jobs = await response.json();
        
        allJobs = jobs;
        updateUI();
    } catch (e) {
        // Silently catch polling network errors
    }
}

//: Ausführungsreihenfolge spiegelt _playbook_order_rank im Backend (install-* vor
// create-stack-*), damit die Kachel-Reihenfolge exakt der tatsächlichen Ausführung entspricht.
function playbookOrderRank(pb) {
    const base = String(pb || "").split("/").pop();
    //: Paketmanager-Voraussetzungen (Docker, Flatpak) sind selbst install-* Playbooks,
    // laufen aber VOR den uebrigen install-* (install-flatpak vor den Flatpak-Apps) -> Stufe 0.
    if (base === "install-docker.yml" || base === "install-flatpak.yml") return 0;
    if (base.startsWith("install-")) return 1;
    if (base.startsWith("create-stack-")) return 3;
    return 2;
}

//: schöner Anzeigename für eine Kachel (Pfad/Präfix/Endung weg, Trenner -> Leerzeichen).
function playbookDisplayName(pb) {
    let base = String(pb || "").split("/").pop().replace(/\.ya?ml$/i, "");
    base = base.replace(/^install-/, "").replace(/^create-stack-/, "");
    return base.replace(/[-_]+/g, " ").trim() || base;
}

//: Status je Playbook aus Job-Status + progress.finished ableiten (konsistent mit der
// Fortschrittsanzeige, die dieselbe finished-Zählung nutzt). finished = abgeschlossene Plays;
// das finished-te (0-basiert) Playbook läuft gerade / ist bei Fehler das gescheiterte.
function deriveTileStatuses(job) {
    const pbs = [...(job.playbooks || [])].sort((a, b) => playbookOrderRank(a) - playbookOrderRank(b));
    const prog = job.progress || { finished: 0, total: pbs.length, percent: 0 };
    const finished = Math.max(0, Math.min(prog.finished || 0, pbs.length));
    const st = job.status;
    return pbs.map((pb, i) => {
        let status;
        if (st === "success") status = "success";
        else if (i < finished) status = "success";
        else if (st === "failed") status = (i === finished) ? "error" : "pending";
        else if (st === "canceled") status = (i === finished) ? "canceled" : "pending";
        else if (st === "running") status = (i === finished) ? "executing" : "pending";
        else status = "pending";  // pending job
        return { playbook: pb, status };
    });
}

const FLOW_STATUS_ICON = { pending: "schedule", executing: "sync", success: "check_circle", error: "error", canceled: "cancel" };

//: Flow-Chart der Playbooks des ausgewählten Jobs rendern (Kacheln + Verbindungspfeile).
function renderFlowchart(job) {
    const view = document.getElementById("flowchart-view");
    if (!view) return;
    if (!job || !(job.playbooks || []).length) {
        view.innerHTML = `<div class="flowchart-empty">${job ? "Für diesen Job liegen keine Playbook-Informationen vor." : "Wähle links einen Job aus, um den Ablauf anzuzeigen."}</div>`;
        return;
    }
    const tiles = deriveTileStatuses(job);
    const frag = document.createDocumentFragment();
    tiles.forEach((t, i) => {
        if (i > 0) {
            const arrow = document.createElement("span");
            arrow.className = "flow-arrow material-symbols-outlined";
            arrow.textContent = "arrow_forward";
            frag.appendChild(arrow);
        }
        const tile = document.createElement("div");
        tile.className = "flow-tile flow-" + t.status;
        const icon = document.createElement("span");
        icon.className = "flow-tile-icon material-symbols-outlined";
        icon.textContent = FLOW_STATUS_ICON[t.status] || "schedule";
        //: zugehöriges Service-Icon des Playbooks vor dem Namen anzeigen (Logo bzw.
        // Material-Icon aus den Playbook-Metadaten; Fallback in playbookIconHtml).
        const svcMeta = playbookMetadataMap[t.playbook] || playbookMetadataMap[String(t.playbook).split("/").pop()] || {};
        const svcIcon = document.createElement("span");
        svcIcon.className = "flow-tile-service-icon";
        svcIcon.innerHTML = playbookIconHtml({ icon: svcMeta.icon, icon_value: svcMeta.icon_value });
        const name = document.createElement("span");
        name.className = "flow-tile-name";
        name.textContent = playbookDisplayName(t.playbook);
        name.title = t.playbook;
        tile.appendChild(icon);
        tile.appendChild(svcIcon);
        tile.appendChild(name);
        frag.appendChild(tile);
    });
    view.innerHTML = "";
    view.appendChild(frag);
}

//: aktive Ansicht (Kacheln vs. Text-Log) anwenden + Umschalt-Button-Icon/Titel aktualisieren.
function applyJobViewMode() {
    const flow = document.getElementById("flowchart-view");
    const log = document.getElementById("console-output");
    const btn = document.getElementById("view-toggle-btn");
    const showTiles = jobViewMode === "tiles";
    if (flow) flow.classList.toggle("hidden", !showTiles);
    if (log) log.classList.toggle("hidden", showTiles);
    if (btn) {
        btn.title = showTiles ? "Zur Text-Log-Ansicht wechseln" : "Zur Kachel-Ansicht wechseln";
        const ic = btn.querySelector(".material-symbols-outlined");
        if (ic) ic.textContent = showTiles ? "terminal" : "account_tree";
    }
}

function updateConsoleProgressBar() {
    const activeJob = allJobs.find(j => j.job_id === selectedJobId);
    renderFlowchart(activeJob);   //: Kachel-Ansicht bei jedem Refresh aktualisieren (Echtzeit-Status).
    const consoleJobProgress = document.getElementById("console-job-progress");
    if (activeJob && consoleJobProgress) {
        consoleJobProgress.classList.remove("hidden");
        const progress = activeJob.progress || { finished: 0, total: 0, percent: 0 };
        const finished = progress.finished;
        const total = progress.total;
        const percent = progress.percent;
        const outstanding = total - finished;
        
        const fillEl = document.getElementById("console-progress-fill");
        if (fillEl) {
            fillEl.className = "console-progress-fill " + activeJob.status;
            fillEl.style.width = `${percent}%`;
        }
        
        const textEl = document.getElementById("console-progress-text");
        if (textEl) {
            textEl.textContent = `${finished} von ${total} Playbooks (${percent}%) - ${outstanding} ausstehend`;
        }
    } else if (consoleJobProgress) {
        consoleJobProgress.classList.add("hidden");
    }

    // : Abbrechen-Button nur bei laufender/wartender Auswahl zeigen (auch beim Job-Wechsel).
    const cancelBtn = document.getElementById("cancel-job-btn");
    if (cancelBtn) {
        cancelBtn.style.display = (activeJob && (activeJob.status === "running" || activeJob.status === "pending")) ? "" : "none";
    }
}

// : Laufende oder wartende Ausführung abbrechen (mit Bestätigung).
async function cancelJob(jobId) {
    if (!jobId) return;
    const ok = await showConfirmDialog({
        title: "Ausführung abbrechen?",
        message: "Die Ausführung wird beendet. Bereits ausgeführte Schritte werden nicht rückgängig gemacht.",
        confirmLabel: "Abbrechen",
        cancelLabel: "Weiterlaufen lassen"
    });
    if (!ok) return;
    try {
        const r = await fetch(`/api/jobs/${jobId}/cancel?session_id=${encodeURIComponent(sessionId)}`, { method: "POST" });
        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            showToast(errorDetailToMessage(d.detail, "Abbruch fehlgeschlagen."));
            return;
        }
        showToast("Ausführung abgebrochen.");
        await refreshHistory();
    } catch (e) {
        showToast("Abbruch fehlgeschlagen.");
    }
}

// : Host-Tab schließen; Fokus auf den vorherigen (sonst nächsten) sichtbaren Tab legen.
function closeHostTab(host) {
    const visible = [...new Set(allJobs.map(j => j.target_host))].filter(h => !closedHosts.has(h));
    const idx = visible.indexOf(host);
    closedHosts.add(host);
    if (activeHost === host) {
        const remaining = visible.filter(h => h !== host);
        activeHost = remaining[idx - 1] || remaining[idx] || remaining[0] || null;
        selectedJobId = null;
    }
    updateUI();
}

// Re-renders the tabs and split-screen history/console panels based on active state
function updateUI() {
    const btnHistory = document.getElementById("nav-btn-history");
    if (!allJobs || allJobs.length === 0) {
        if (btnHistory) btnHistory.disabled = true;
        // LANDING MODE layout
        document.body.classList.remove("workspace-mode", "tab-configure", "tab-history");
        document.body.classList.add("landing-mode");
        
        // Cancel logs and clear badge if jobs were cleared
        if (logController) {
            logController.abort();
            logController = null;
        }
        currentlyStreamingJobId = null;
        selectedJobId = null;
        activeHost = null;
        updateConsoleProgressBar();
        return;
    }
    
    if (btnHistory) btnHistory.disabled = false;
    
    // WORKSPACE MODE layout
    if (!document.body.classList.contains("workspace-mode")) {
        document.body.classList.add("workspace-mode");
        document.body.classList.remove("landing-mode");
    }
    
    // Set default active tab if none is active.
    //: nur auf "configure" zurueckspringen, wenn KEINE gueltige Hauptseite aktiv ist.
    // Frueher kannte der Guard nur configure/history -> der History-Poll riss Nutzer von
    // /admin, /custom-playbooks und Rechtsseiten zurueck auf "/".
    //: /teams und /pricing waren ebenfalls nicht gelistet -> der Poll warf Nutzer
    // nach wenigen Sekunden von diesen Seiten zurueck auf die Startseite.
    const activeMainTabs = ["tab-configure", "tab-history", "tab-vault", "tab-admin", "tab-legal", "tab-teams", "tab-pricing"];
    if (!activeMainTabs.some(c => document.body.classList.contains(c))) {
        setTab("configure");
    }
    
    // Extract unique hosts
    const hosts = [...new Set(allJobs.map(j => j.target_host))];

    // : vom Nutzer geschlossene Host-Tabs ausblenden (rein clientseitig, sitzungsweit).
    // Verschwundene Hosts vergessen; ein NEUER Lauf für einen geschlossenen Host blendet ihn wieder ein.
    for (const h of [...closedHosts]) {
        if (!hosts.includes(h)) closedHosts.delete(h);
    }
    allJobs.forEach(j => {
        if (closedHosts.has(j.target_host) && !knownJobIds.has(j.job_id)) closedHosts.delete(j.target_host);
    });
    allJobs.forEach(j => knownJobIds.add(j.job_id));
    const visibleHosts = hosts.filter(h => !closedHosts.has(h));

    if (visibleHosts.length === 0) {
        // Alle Tabs geschlossen -> leerer Arbeitsbereich (Aktualisieren oder ein neuer Lauf bringt sie zurück).
        tabsBar.innerHTML = "";
        hostHistoryList.innerHTML = "";
        if (logController) { logController.abort(); logController = null; }
        currentlyStreamingJobId = null;
        selectedJobId = null;
        activeHost = null;
        consoleOutput.textContent = "Alle Tabs geschlossen. Aktualisieren oder einen neuen Lauf starten, um sie wieder anzuzeigen.";
        activeJobIdBadge.textContent = "Kein Job aktiv";
        updateConsoleProgressBar();
        return;
    }

    // Default focus target host tab
    if (!activeHost || !visibleHosts.includes(activeHost)) {
        activeHost = visibleHosts[0];
    }

    // Render Tab buttons
    tabsBar.innerHTML = "";
    visibleHosts.forEach(host => {
        const tabBtn = document.createElement("button");
        tabBtn.type = "button";
        tabBtn.className = "tab-btn";
        if (host === activeHost) {
            tabBtn.classList.add("active");
        }
        
        tabBtn.innerHTML = `
            <span class="material-symbols-outlined" style="font-size: 18px; margin-right: 6px;">dns</span>
            ${escapeHtml(host)}
            <span class="tab-close material-symbols-outlined" title="Tab schließen">close</span>
        `;

        tabBtn.addEventListener("click", () => {
            if (activeHost === host) return;
            activeHost = host;

            // Clear selected job of previous host so it grabs the newest for the next host
            selectedJobId = null;

            updateUI();
        });

        // : X schließt den Host-Tab (nicht den Tab-Wechsel auslösen).
        const closeIcon = tabBtn.querySelector(".tab-close");
        if (closeIcon) {
            closeIcon.addEventListener("click", async (e) => {
                e.stopPropagation();
                // : Schließen bestätigen – der Tab-Fokus geht verloren (der Lauf kann im
                // Hintergrund weiterlaufen), das lässt sich nicht rückgängig machen.
                const ok = await showConfirmDialog({
                    title: "Tab schließen?",
                    message: "Dieser Verlaufs-Tab wird geschlossen und kann nicht wiederhergestellt werden. Eine laufende Ausführung läuft im Hintergrund weiter, der Fokus auf diesen Tab geht jedoch verloren.",
                    confirmLabel: "Schließen",
                    cancelLabel: "Abbrechen"
                });
                if (!ok) return;
                closeHostTab(host);
            });
        }

        tabsBar.appendChild(tabBtn);
    });
    
    // Render Job List for active host tab
    const hostJobs = allJobs.filter(j => j.target_host === activeHost);
    
    // Default focus active job inside tab
    if (!selectedJobId || !hostJobs.some(j => j.job_id === selectedJobId)) {
        selectedJobId = hostJobs[0].job_id;
    }
    
    // Trigger log stream for selected job (protection prevents resetting active streams)
    streamLogs(selectedJobId);
    updateConsoleProgressBar();

    // Populate host history sidebar
    hostHistoryList.innerHTML = "";
    hostJobs.forEach(job => {
        const item = document.createElement("div");
        item.className = "history-item";
        if (selectedJobId === job.job_id) {
            item.classList.add("active-selection");
        }
        
        let statusIcon = "pending";
        let statusClass = "pending";
        if (job.status === "success") {
            statusIcon = "check_circle";
            statusClass = "success";
        } else if (job.status === "failed") {
            statusIcon = "error";
            statusClass = "failed";
        } else if (job.status === "running") {
            statusIcon = "sync";
            statusClass = "running";
        } else if (job.status === "canceled") {
            statusIcon = "cancel";
            statusClass = "canceled";
        }

        // Calculate duration if dates are present
        let durationStr = "";
        if (job.created_at && job.finished_at) {
            const start = new Date(job.created_at);
            const end = new Date(job.finished_at);
            const diffMs = end - start;
            const diffSec = Math.floor(diffMs / 1000);
            if (diffSec < 60) {
                durationStr = `${diffSec}s`;
            } else {
                const min = Math.floor(diffSec / 60);
                const sec = diffSec % 60;
                durationStr = `${min}m ${sec}s`;
            }
        } else if (job.status === "running") {
            durationStr = "Läuft...";
        } else if (job.status === "pending") {
            durationStr = "In Warteschlange";
        }

        const dateObj = new Date(job.created_at);
        const dateStr = dateObj.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
        const timeStr = dateObj.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
        const jobTime = `${timeStr} Uhr`;
        
        let progressHtml = "";
        if (job.status === "running") {
            const progress = job.progress || { finished: 0, total: 0, percent: 0 };
            const finished = progress.finished;
            const total = progress.total;
            const percent = progress.percent;
            progressHtml = `
                <div class="job-progress-container">
                    <div class="job-progress-bar">
                        <div class="job-progress-fill running" style="width: ${percent}%"></div>
                    </div>
                    <span class="job-progress-text">${finished}/${total} (${percent}%)</span>
                </div>
            `;
        }
        
        item.innerHTML = `
            <div class="history-row">
                <div class="history-left">
                    <div class="history-status-indicator ${statusClass}">
                        <span class="material-symbols-outlined">${statusIcon}</span>
                    </div>
                    <div class="history-details">
                        <div class="history-title">${jobTime}</div>
                        <div class="history-subtitle">${dateStr}</div>
                    </div>
                </div>
                <div class="history-right">
                    <span>${job.status.toUpperCase()}</span>
                    <span>${durationStr}</span>
                    ${(job.status === "running" || job.status === "pending") ? `<button type="button" class="history-cancel-btn btn-icon" title="Ausführung abbrechen"><span class="material-symbols-outlined">stop_circle</span></button>` : ""}
                </div>
            </div>
            ${progressHtml}
        `;

        // : per-Zeile abbrechen (laufende/wartende Jobs) – ohne den Job nur auszuwählen.
        const rowCancelBtn = item.querySelector(".history-cancel-btn");
        if (rowCancelBtn) {
            rowCancelBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                cancelJob(job.job_id);
            });
        }

        item.addEventListener("click", () => {
            if (selectedJobId === job.job_id) return;
            selectedJobId = job.job_id;
            
            // Instantly highlight active selection in DOM
            document.querySelectorAll(".history-item").forEach(el => el.classList.remove("active-selection"));
            item.classList.add("active-selection");
            
            streamLogs(job.job_id);
            updateConsoleProgressBar();
        });
        
        hostHistoryList.appendChild(item);
    });
}

// Global Toast Display Helper
let toastTimeout = null;
// Wandelt ein FastAPI-`detail` (String, ODER 422-Liste [{msg,loc}], ODER Objekt) in einen
// lesbaren Text um - verhindert das fruehere "[object Object]" bei Validierungsfehlern.
function errorDetailToMessage(detail, fallback) {
    if (detail === undefined || detail === null || detail === "") return fallback;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
        const msgs = detail.map(e => (e && e.msg) ? e.msg : (typeof e === "string" ? e : JSON.stringify(e)));
        return msgs.join("; ") || fallback;
    }
    if (typeof detail === "object") return detail.msg || detail.detail || JSON.stringify(detail);
    return String(detail);
}

function showToast(message, duration = 4000) {
    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }
    toast.textContent = message;
    toast.classList.remove("hidden");

    toastTimeout = setTimeout(() => {
        toast.classList.add("hidden");
    }, duration);
}

let currentUser = null;
let userDevices = [];
let loginEmail = "";

async function checkAuthStatus() {
    //: Ohne JS-lesbares Begleit-Cookie (as_auth) existiert garantiert keine Sitzung ->
    // den /api/profile-Call (fuer Anonyme immer 401) ueberspringen und direkt den
    // Gast-Zustand setzen. Spart einen ueberfluessigen, fehlschlagenden Request beim Laden.
    const hasSession = document.cookie.split(";").some(c => c.trim().startsWith("as_auth="));
    if (hasSession) {
        try {
            const response = await fetch("/api/profile");
            if (response.ok) {
                currentUser = await response.json();
                updateAuthUI();
                await fetchDevices();
            } else {
                currentUser = null;
                updateAuthUI();
            }
        } catch (err) {
            console.error("Auth check failed:", err);
            currentUser = null;
            updateAuthUI();
        }
    } else {
        currentUser = null;
        updateAuthUI();
    }
    // Playbook-/Preset-Katalog haengt von Login/Rolle ab -> bei Auth-Wechsel neu laden
    // : unabhängig laden — ein Fehler in fetchPresets darf fetchPlaybooks (und damit die
    // eigenen Preset-Kacheln) NICHT überspringen, sonst erscheinen sie erst nach einem Reload.
    try { await fetchPresets(); } catch (e) { console.warn("Preset-Reload nach Auth-Wechsel fehlgeschlagen:", e); }
    try { await fetchPlaybooks(); } catch (e) { console.warn("Playbook-Reload nach Auth-Wechsel fehlgeschlagen:", e); }
    //: Nach Login die (ggf. nach einem vorherigen Logout pausierte) Poll-Schleife
    // wieder anstossen, damit die Jobs des Users live aktualisiert werden. Idempotent.
    startHistoryPolling();
}

function updateAuthUI() {
    const loggedOutView = document.getElementById("logged-out-view");
    const loggedInView = document.getElementById("logged-in-view");
    const userDisplayName = document.getElementById("user-display-name");
    const btnHistory = document.getElementById("nav-btn-history");
    const deviceSelectContainer = document.getElementById("modal-device-select-container");

    if (currentUser) {
        loggedOutView.classList.add("hidden");
        loggedInView.classList.remove("hidden");
        userDisplayName.textContent = currentUser.username;
        // Logs-Button nur aktiv, wenn Jobs/Logs existieren (updateUI ist die Autoritaet).
        if (btnHistory) btnHistory.disabled = !(allJobs && allJobs.length > 0);
        if (deviceSelectContainer) deviceSelectContainer.classList.remove("hidden");
        
        // Populate profile fields
        document.getElementById("profile-username-val").textContent = currentUser.username;
        document.getElementById("profile-email-val").textContent = currentUser.email;
        document.getElementById("profile-tier-val").textContent = currentUser.tier;
        document.getElementById("profile-date-val").textContent = new Date(currentUser.created_at).toLocaleDateString();
        document.getElementById("profile-email-notif").checked = currentUser.email_notifications_enabled;
        const twoFaToggle = document.getElementById("profile-2fa-toggle");
        if (twoFaToggle) twoFaToggle.checked = currentUser.two_factor_enabled || false;
        
        // Pre-fill profile update fields
        const unameField = document.getElementById("profile-update-username");
        unameField.value = currentUser.username;
        // : Benutzername ist unveraenderlich – nur System-Admins duerfen den
        // eigenen Namen aendern. Fuer alle anderen ist das Feld schreibgeschuetzt.
        const unameImmutable = currentUser.role !== "admin";
        unameField.readOnly = unameImmutable;
        unameField.title = unameImmutable ? "Der Benutzername kann nach der Registrierung nicht mehr geändert werden." : "";
        unameField.style.opacity = unameImmutable ? "0.6" : "";
        // : Webhook-URL vorbelegen.
        const webhookField = document.getElementById("profile-webhook-url");
        if (webhookField) webhookField.value = currentUser.webhook_url || "";
        document.getElementById("profile-update-email").value = currentUser.email;

        // Subscription and billing UI updates
        const subStatusVal = document.getElementById("profile-sub-status-val");
        const trialCountdown = document.getElementById("profile-trial-countdown");
        const trialDaysVal = document.getElementById("profile-trial-days");
        const subEndDate = document.getElementById("profile-sub-end-date");
        const subEndVal = document.getElementById("profile-sub-end-val");
        const subscribeNowBtn = document.getElementById("subscribe-now-btn");
        const manageBillingBtn = document.getElementById("manage-billing-btn");

        if (subStatusVal) {
            const status = currentUser.subscription_status || "inactive";
            subStatusVal.textContent = status.toUpperCase();
            
            // Dynamic status coloring
            if (status === "active" || status === "trialing") {
                subStatusVal.style.background = "rgba(46, 204, 113, 0.2)";
                subStatusVal.style.borderColor = "#2ecc71";
                subStatusVal.style.color = "#2ecc71";
            } else if (status === "past_due") {
                subStatusVal.style.background = "rgba(241, 196, 15, 0.2)";
                subStatusVal.style.borderColor = "#f1c40f";
                subStatusVal.style.color = "#f1c40f";
            } else {
                subStatusVal.style.background = "rgba(231, 76, 60, 0.2)";
                subStatusVal.style.borderColor = "#e74c3c";
                subStatusVal.style.color = "#e74c3c";
            }
        }

        if (trialCountdown && trialDaysVal) {
            if (currentUser.trial_ends_at) {
                const trialEnd = new Date(currentUser.trial_ends_at);
                const now = new Date();
                const diffTime = trialEnd - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays > 0) {
                    trialCountdown.style.display = "block";
                    trialDaysVal.textContent = diffDays;
                } else {
                    trialCountdown.style.display = "none";
                }
            } else {
                trialCountdown.style.display = "none";
            }
        }

        if (subEndDate && subEndVal) {
            if (currentUser.subscription_ends_at) {
                subEndDate.style.display = "block";
                subEndVal.textContent = new Date(currentUser.subscription_ends_at).toLocaleDateString();
            } else {
                subEndDate.style.display = "none";
            }
        }

        if (subscribeNowBtn && manageBillingBtn) {
            if (currentUser.role === "guest") {
                subscribeNowBtn.style.display = "none";
                manageBillingBtn.style.display = "none";
            } else if (currentUser.is_subscription_active) {
                subscribeNowBtn.style.display = "none";
                manageBillingBtn.style.display = "block";
            } else {
                subscribeNowBtn.style.display = "block";
                manageBillingBtn.style.display = "none";
            }
        }

        // Fetch user invoices (Gaeste haben keinen Rechnungsverlauf)
        // Rechnungen nur in der Cloud-Edition abrufen (sonst /api/billing/* = 404).
        if (currentUser.role !== "guest" && currentEdition === "cloud") fetchInvoices();

        // Show/hide admin panel button based on role
        const adminBtn = document.getElementById("nav-btn-admin");
        if (adminBtn) {
            if (currentUser.role === "admin") {
                adminBtn.classList.remove("hidden");
            } else {
                adminBtn.classList.add("hidden");
            }
        }

        //  (#A): "My Vault"-Nav-Button fuer eingeloggte Nicht-Gaeste (vereint Eigene Playbooks
        // + Geräte + Presets). Login-only — KEIN Abo-Zwang mehr; das Abo wird pro Tab/Endpoint
        // erzwungen (z. B. Custom-Upload, Preset-Erstellung), nicht durch Ausblenden des Vaults.
        const vaultBtn = document.getElementById("nav-btn-vault");
        if (vaultBtn) {
            vaultBtn.classList.toggle("hidden", currentUser.role === "guest");
            vaultBtn.removeAttribute("disabled");
            vaultBtn.title = "";
        }
        // : Der Subtext "oder als Preset speichern" unter dem Ausführen-Button wurde
        // entfernt (Element gelöscht), daher hier keine Sichtbarkeits-Steuerung mehr.

        ///: "Teams"-Nav-Button für registrierte Nutzer UND Admins (nicht Gast,
        // nicht ausgeloggt). In der On-Premise-Edition sind Teams-Funktionen deaktiviert.
        const teamsBtn = document.getElementById("nav-btn-teams");
        if (teamsBtn) {
            const showTeams = currentUser.role !== "guest" && currentEdition !== "onpremise";
            teamsBtn.classList.toggle("hidden", !showTeams);
        }

        // /: Die frühere separate "Geräte"-Nav (nav-btn-devices) ist im "My Vault"-Tab
        // aufgegangen (Geräte = Vault-Tab; siehe vaultBtn oben). Kein eigener Nav-Button mehr.

        // Show/hide deletion warning (cloud-only : profile-delete-section in Community gestrippt -> null-sicher)
        const delStatusCard = document.getElementById("deletion-queue-status");
        if (delStatusCard) {
            delStatusCard.classList.toggle("hidden", !currentUser.deletion_pending_at);
        }

        // Update AVV signature display status
        const avvDownloadBtn = document.getElementById("profile-avv-download-btn");
        const avvSignBtn = document.getElementById("profile-sign-avv-btn");
        const avvStatusBanner = document.getElementById("profile-avv-status-banner");
        
        if (avvSignBtn && avvStatusBanner && avvDownloadBtn) {
            if (currentUser.avv_accepted_at) {
                avvSignBtn.classList.add("hidden");
                avvStatusBanner.classList.remove("hidden");
                document.getElementById("profile-avv-company").textContent = currentUser.avv_company;
                document.getElementById("profile-avv-representative").textContent = currentUser.avv_representative;
                document.getElementById("profile-avv-date").textContent = new Date(currentUser.avv_accepted_at).toLocaleDateString();
                avvDownloadBtn.innerHTML = '<span class="material-symbols-outlined">download</span> Unterzeichneten AVV herunterladen (PDF)';
            } else {
                avvSignBtn.classList.remove("hidden");
                avvStatusBanner.classList.add("hidden");
                avvDownloadBtn.innerHTML = '<span class="material-symbols-outlined">download</span> AVV-Muster herunterladen (PDF)';
            }
        }

        // Populate Teams/API panels (display is controlled by the tab system, not here)
        if (currentUser.role !== "guest") {
            fetchGuests();
            fetchTokens();
        }

        // --- Rollenabhaengige Profil-Sichtbarkeit (Issue D) ---
        const isGuest = currentUser.role === "guest";
        const isAdmin = currentUser.role === "admin";
        const setDisplay = (id, show, showVal) => {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? (showVal || "") : "none";
        };
        // Business-Tabs nur fuer normale Nutzer (nicht Gast, nicht Admin)
        const showBusinessTabs = !isGuest && !isAdmin;
        setDisplay("ptab-rechnungen", showBusinessTabs);
        setDisplay("ptab-teams", showBusinessTabs);
        // : "Geräte-Gruppen"-Profil-Tab entfernt -> eigene Seite /devices (Nav-Button).
        // : API-Token-Tab auch für den System-Admin (passwortlose Tokens für Bots/CI in
        // jeder Edition; Backend erlaubt Admin-Tokens). Gäste sehen ihn weiterhin nicht.
        setDisplay("ptab-api", !isGuest);
        setDisplay("ptab-dsgvo", showBusinessTabs);
        // Startseite: Gast kann Benutzername/E-Mail nicht aendern; kein Abo-Tier/Datum
        setDisplay("profile-identity-section", !isGuest);
        setDisplay("profile-tier-row", !isGuest && !isAdmin);
        setDisplay("profile-date-row", !isGuest);
        // Sicherheit: weder Gast noch Admin koennen sich selbst loeschen
        setDisplay("profile-delete-section", !isGuest && !isAdmin);
        // Falls ein ausgeblendeter Tab aktiv war, zurueck auf Startseite
        const activeTabBtn = document.querySelector(".profile-tab-btn.active");
        if (activeTabBtn && activeTabBtn.style.display === "none") {
            switchProfileTab("startseite");
        }

        const guestStatusRow = document.getElementById("profile-guest-status-row");
        if (guestStatusRow) {
            guestStatusRow.style.display = isGuest ? "" : "none";
            if (isGuest) {
                const active = !!currentUser.is_subscription_active;
                const badge = document.getElementById("profile-guest-status-val");
                if (badge) {
                    badge.textContent = active ? "Aktiv" : "Inaktiv";
                    badge.style.background = active ? "rgba(46, 204, 113, 0.2)" : "rgba(231, 76, 60, 0.2)";
                    badge.style.border = active ? "1px solid #2ecc71" : "1px solid #e74c3c";
                    badge.style.color = active ? "#2ecc71" : "#e74c3c";
                }
            }
        }
    } else {
        loggedOutView.classList.remove("hidden");
        loggedInView.classList.add("hidden");
        btnHistory.setAttribute("disabled", "true");
        if (deviceSelectContainer) deviceSelectContainer.classList.add("hidden");
        
        const adminBtn = document.getElementById("nav-btn-admin");
        if (adminBtn) adminBtn.classList.add("hidden");

        const vaultBtnOut = document.getElementById("nav-btn-vault");
        if (vaultBtnOut) vaultBtnOut.classList.add("hidden");
        const runPresetHintOut = document.getElementById("run-preset-hint");
        if (runPresetHintOut) runPresetHintOut.classList.add("hidden");
        //: Teams-Nav fuer ausgeloggte Besucher ausblenden.
        const teamsBtnOut = document.getElementById("nav-btn-teams");
        if (teamsBtnOut) teamsBtnOut.classList.add("hidden");

        // Reset manual input fields disabled state just in case
        modalTargetHost.disabled = false;
        modalUsernameInput.disabled = false;
        modalPasswordInput.disabled = false;

        // Fallback to configure tab if an auth-gated page is active after logout.
        //: tab-admin ergaenzt (Admin-Seite ist gesperrt). tab-legal bewusst NICHT,
        // da Rechtsseiten oeffentlich sind - sonst wuerden anonyme Besucher von /impressum
        // & Co. auf "/" geworfen.
        if (["tab-history", "tab-vault", "tab-admin", "tab-teams"].some(c => document.body.classList.contains(c))) {
            setTab("configure");
        }
    }

    //: editionsspezifische UI-Regeln nach jedem Auth-/UI-Refresh anwenden.
    applyEditionRules();
    writeAuthCache(); //: Auth-Status cachen, um Nav-Button-Flackern beim Neuladen zu vermeiden
}

//: Leichter Auth-Cache, um den "Eigene Playbooks"-Nav-Button beim Neuladen sofort
// (synchron) korrekt ein-/auszublenden, statt erst nach dem asynchronen /api/profile-Check.
const AUTH_CACHE_KEY = "ansimate_auth_cache";
function writeAuthCache() {
    try {
        if (currentUser) {
            localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
                loggedIn: true,
                role: currentUser.role,
                subActive: !!currentUser.is_subscription_active,
                edition: currentEdition,  //: Edition mitfuehren (Community blendet den Tab immer aus)
            }));
        } else {
            localStorage.removeItem(AUTH_CACHE_KEY);
        }
    } catch (e) { /* localStorage nicht verfuegbar -> kein Cache, nur (seltenes) Flackern */ }
}
function applyCachedNavVisibility() {
    const btn = document.getElementById("nav-btn-vault");
    if (!btn) return;
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem(AUTH_CACHE_KEY) || "null"); } catch (e) {}
    if (!cache) return; // kein Cache -> Default (hidden) beibehalten, async-Check entscheidet
    //  (#A): "My Vault" ist login-only.
    //: Auch in der Community-Edition sichtbar (eingeschraenkt) -> Edition nicht mehr ausschliessen.
    const showVault = cache.loggedIn && cache.role !== "guest";
    btn.classList.toggle("hidden", !showVault);
}

// Authentication Forms Handlers
async function openRegisterModal() {
    document.getElementById("register-dialog").classList.remove("hidden");
    document.getElementById("register-form").reset();
    resetPasswordRequirements();
    // Load captcha
    try {
        const captchaRes = await fetch("/api/auth/captcha");
        if (captchaRes.ok) {
            const captchaData = await captchaRes.json();
            const container = document.getElementById("register-captcha-container");
            if (captchaData.required) {
                document.getElementById("register-captcha-question").textContent = captchaData.question;
                document.getElementById("register-captcha-id").value = captchaData.captcha_id;
                document.getElementById("register-captcha-answer").value = "";
                if (container) container.classList.remove("hidden");
            } else {
                if (container) container.classList.add("hidden");
            }
        }
    } catch (e) {
        console.warn("Could not load captcha:", e);
    }
}

function closeRegisterModal() {
    document.getElementById("register-dialog").classList.add("hidden");
    document.getElementById("register-form").reset();
    resetPasswordRequirements();
}

function resetPasswordRequirements() {
    ["req-length", "req-upper", "req-number"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove("valid");
    });
    const matchErr = document.getElementById("register-pw-match-error");
    if (matchErr) matchErr.style.display = "none";
}

function updatePasswordRequirements() {
    const pw = document.getElementById("register-password").value;
    const reqLength = document.getElementById("req-length");
    const reqUpper = document.getElementById("req-upper");
    const reqNumber = document.getElementById("req-number");
    if (reqLength) reqLength.classList.toggle("valid", pw.length >= 8);
    if (reqUpper) reqUpper.classList.toggle("valid", /[A-Z]/.test(pw));
    if (reqNumber) reqNumber.classList.toggle("valid", /[0-9]/.test(pw));
    checkPasswordMatch();
}

function checkPasswordMatch() {
    const pw = document.getElementById("register-password").value;
    const confirm = document.getElementById("register-password-confirm").value;
    const matchErr = document.getElementById("register-pw-match-error");
    const submitBtn = document.getElementById("register-submit-btn");
    const mismatch = confirm.length > 0 && pw !== confirm;
    if (matchErr) matchErr.style.display = mismatch ? "block" : "none";
    if (submitBtn) submitBtn.disabled = mismatch;
}

async function handle2FAToggle() {
    const enabled = document.getElementById("profile-2fa-toggle").checked;
    try {
        const response = await fetch("/api/profile/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: currentUser.username,
                email: currentUser.email,
                two_factor_enabled: enabled
            })
        });
        const data = await response.json();
        if (response.ok) {
            showToast(enabled ? "2FA aktiviert." : "2FA deaktiviert.");
            await checkAuthStatus();
        } else {
            showToast(errorDetailToMessage(data.detail, "Fehler beim Ändern der 2FA-Einstellung."));
            document.getElementById("profile-2fa-toggle").checked = !enabled;
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Ändern der 2FA-Einstellung.");
        document.getElementById("profile-2fa-toggle").checked = !enabled;
    }
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const identifier = document.getElementById("login-identifier").value.trim();
    const password = document.getElementById("login-password").value;

    try {
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier, password })
        });

        const data = await response.json();
        if (response.ok && data.status === "otp_sent") {
            loginEmail = data.email;
            document.getElementById("login-dialog").classList.add("hidden");
            document.getElementById("otp-dialog").classList.remove("hidden");
            document.getElementById("login-form").reset();
            showToast("2FA PIN gesendet. Bitte E-Mail prüfen.");
        } else if (response.ok && data.status === "logged_in") {
            document.getElementById("login-dialog").classList.add("hidden");
            document.getElementById("login-form").reset();
            showToast("Erfolgreich angemeldet!");
            // : Login von der Wartungsseite aus -> neu laden, damit das Gate neu
            // greift (Admin -> bypass/App, Nicht-Admin -> bleibt auf der Wartungsseite).
            const mov = document.getElementById("maintenance-overlay");
            if (mov && !mov.classList.contains("hidden")) { window.location.reload(); return; }
            await checkAuthStatus();
        } else if (response.status === 403 && data.detail && data.detail.includes("bestaetigen")) {
            // E-Mail nicht verifiziert: Bestaetigungsmail erneut anbieten
            showToast(errorDetailToMessage(data.detail, "Aktion fehlgeschlagen."));
            if ((await showConfirmDialog({ title: "E-Mail bestätigen", message: "Ihre E-Mail-Adresse ist noch nicht bestätigt. Bestätigungslink erneut senden?", confirmLabel: "Erneut senden" }))) {
                try {
                    await fetch("/api/auth/resend-verification", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ identifier })
                    });
                    showToast("Falls ein unbestätigtes Konto existiert, wurde ein neuer Bestätigungslink gesendet.");
                } catch (e) {
                    showToast("Netzwerkfehler beim erneuten Senden.");
                }
            }
        } else {
            showToast(errorDetailToMessage(data.detail, "Anmeldung fehlgeschlagen."));
        }
    } catch (err) {
        showToast("Netzwerkfehler bei Anmeldung.");
    }
}

async function handleOtpSubmit(e) {
    e.preventDefault();
    const otpCode = document.getElementById("otp-code").value.trim();

    try {
        const response = await fetch("/api/auth/verify-2fa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: loginEmail, otp_code: otpCode })
        });

        const data = await response.json();
        if (response.ok) {
            document.getElementById("otp-dialog").classList.add("hidden");
            document.getElementById("otp-form").reset();
            showToast("Erfolgreich angemeldet!");
            await checkAuthStatus();
        } else {
            showToast(errorDetailToMessage(data.detail, "Ungültiger OTP-Code."));
        }
    } catch (err) {
        showToast("Netzwerkfehler bei 2FA Verifizierung.");
    }
}

// ---- Password visibility toggles ----
function setupPasswordToggles() {
    document.querySelectorAll(".password-toggle-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const input = btn.parentElement.querySelector("input");
            if (!input) return;
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            const icon = btn.querySelector(".material-symbols-outlined");
            if (icon) icon.textContent = show ? "visibility_off" : "visibility";
            btn.setAttribute("aria-label", show ? "Passwort verbergen" : "Passwort anzeigen");
        });
    });
}

// ---- Generic modal dismissal (ESC key + backdrop click) ----
function enableModalDismiss(dialogId, closeFn) {
    const dialog = document.getElementById(dialogId);
    if (!dialog) return;
    dialog.addEventListener("click", (e) => {
        if (e.target === dialog) closeFn();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !dialog.classList.contains("hidden")) closeFn();
    });
}

// : ESC/Backdrop-Schließen für Admin-Formular-Dialoge MIT Dirty-Warnung. Eingaben
// markieren den Dialog als „dirty"; das jeweilige open*-Dialog setzt dataset.dirty zurück.
function enableAdminDialogDismiss(dialogId, closeFn) {
    const dlg = document.getElementById(dialogId);
    if (!dlg) return;
    dlg.addEventListener("input", () => { dlg.dataset.dirty = "1"; });
    const tryClose = async () => {
        if (dlg.classList.contains("hidden") || dlg.dataset.closing === "1") return;
        if (dlg.dataset.dirty === "1") {
            dlg.dataset.closing = "1";
            let ok = false;
            try {
                ok = await showConfirmDialog({ title: "Änderungen verwerfen?", message: "Sie haben ungespeicherte Eingaben. Dialog wirklich schließen?", confirmLabel: "Verwerfen" });
            } finally { dlg.dataset.closing = ""; }
            if (!ok) return;
        }
        closeFn();
    };
    dlg.addEventListener("click", (e) => { if (e.target === dlg) tryClose(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !dlg.classList.contains("hidden")) tryClose(); });
}

// ---- Forgot / Reset password ----
async function loadCaptchaInto(questionId, idFieldId, answerFieldId, containerId) {
    try {
        const res = await fetch("/api/auth/captcha");
        if (!res.ok) return;
        const data = await res.json();
        const container = document.getElementById(containerId);
        if (data.required) {
            document.getElementById(questionId).textContent = data.question;
            document.getElementById(idFieldId).value = data.captcha_id;
            document.getElementById(answerFieldId).value = "";
            if (container) container.classList.remove("hidden");
        } else if (container) {
            container.classList.add("hidden");
        }
    } catch (e) {
        console.warn("Could not load captcha:", e);
    }
}

async function openForgotModal() {
    document.getElementById("login-dialog").classList.add("hidden");
    document.getElementById("forgot-form").reset();
    document.getElementById("forgot-dialog").classList.remove("hidden");
    await loadCaptchaInto("forgot-captcha-question", "forgot-captcha-id", "forgot-captcha-answer", "forgot-captcha-container");
}

function closeForgotModal() {
    document.getElementById("forgot-dialog").classList.add("hidden");
    document.getElementById("forgot-form").reset();
}

async function handleForgotSubmit(e) {
    e.preventDefault();
    const identifier = document.getElementById("forgot-identifier").value.trim();
    if (!identifier) return;
    const captchaContainer = document.getElementById("forgot-captcha-container");
    const captchaRequired = captchaContainer && !captchaContainer.classList.contains("hidden");
    const captchaId = captchaRequired ? document.getElementById("forgot-captcha-id").value : null;
    const captchaAnswer = captchaRequired ? document.getElementById("forgot-captcha-answer").value.trim() : null;

    try {
        const response = await fetch("/api/auth/reset-password-request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier, captcha_id: captchaId, captcha_answer: captchaAnswer })
        });
        const data = await response.json();
        if (response.ok) {
            closeForgotModal();
            showToast(data.message || "Wenn das Konto existiert, wurde ein Link gesendet.");
        } else {
            showToast(errorDetailToMessage(data.detail, "Anforderung fehlgeschlagen."));
            // refresh captcha after a failed attempt
            await loadCaptchaInto("forgot-captcha-question", "forgot-captcha-id", "forgot-captcha-answer", "forgot-captcha-container");
        }
    } catch (err) {
        showToast("Netzwerkfehler bei der Passwort-Anforderung.");
    }
}

let resetToken = null;

function openResetModalFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (window.location.pathname === "/reset-password" && token) {
        resetToken = token;
        document.getElementById("reset-form").reset();
        resetResetRequirements();
        document.getElementById("reset-dialog").classList.remove("hidden");
        // Clean the URL so the token does not linger in history/referer
        history.replaceState({}, "", "/");
    }
}

function closeResetModal() {
    document.getElementById("reset-dialog").classList.add("hidden");
    document.getElementById("reset-form").reset();
    resetResetRequirements();
    resetToken = null;
}

function resetResetRequirements() {
    ["reset-req-length", "reset-req-upper", "reset-req-number"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove("valid");
    });
    const matchErr = document.getElementById("reset-pw-match-error");
    if (matchErr) matchErr.style.display = "none";
}

function updateResetRequirements() {
    const pw = document.getElementById("reset-password").value;
    const reqLength = document.getElementById("reset-req-length");
    const reqUpper = document.getElementById("reset-req-upper");
    const reqNumber = document.getElementById("reset-req-number");
    if (reqLength) reqLength.classList.toggle("valid", pw.length >= 8);
    if (reqUpper) reqUpper.classList.toggle("valid", /[A-Z]/.test(pw));
    if (reqNumber) reqNumber.classList.toggle("valid", /[0-9]/.test(pw));
    checkResetMatch();
}

function checkResetMatch() {
    const pw = document.getElementById("reset-password").value;
    const confirm = document.getElementById("reset-password-confirm").value;
    const matchErr = document.getElementById("reset-pw-match-error");
    const submitBtn = document.getElementById("reset-submit-btn");
    const mismatch = confirm.length > 0 && pw !== confirm;
    if (matchErr) matchErr.style.display = mismatch ? "block" : "none";
    if (submitBtn) submitBtn.disabled = mismatch;
}

async function handleResetSubmit(e) {
    e.preventDefault();
    const pw = document.getElementById("reset-password").value;
    const confirm = document.getElementById("reset-password-confirm").value;
    if (pw !== confirm) {
        showToast("Passwörter stimmen nicht überein.");
        return;
    }
    if (!resetToken) {
        showToast("Kein gültiger Reset-Token. Bitte fordern Sie einen neuen Link an.");
        return;
    }
    try {
        const response = await fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: resetToken, new_password: pw })
        });
        const data = await response.json();
        if (response.ok) {
            closeResetModal();
            showToast("Passwort erfolgreich geändert. Sie können sich jetzt anmelden.");
            document.getElementById("login-dialog").classList.remove("hidden");
        } else {
            showToast(errorDetailToMessage(data.detail, "Zurücksetzen fehlgeschlagen."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Zurücksetzen.");
    }
}

// ---- Change password (profile) ----
function resetPwChangeRequirements() {
    ["pwc-req-length", "pwc-req-upper", "pwc-req-number"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove("valid");
    });
    const matchErr = document.getElementById("pw-change-match-error");
    if (matchErr) matchErr.style.display = "none";
}

function updatePwChangeRequirements() {
    const pw = document.getElementById("pw-change-new").value;
    const reqLength = document.getElementById("pwc-req-length");
    const reqUpper = document.getElementById("pwc-req-upper");
    const reqNumber = document.getElementById("pwc-req-number");
    if (reqLength) reqLength.classList.toggle("valid", pw.length >= 8);
    if (reqUpper) reqUpper.classList.toggle("valid", /[A-Z]/.test(pw));
    if (reqNumber) reqNumber.classList.toggle("valid", /[0-9]/.test(pw));
    checkPwChangeMatch();
}

function checkPwChangeMatch() {
    const pw = document.getElementById("pw-change-new").value;
    const confirm = document.getElementById("pw-change-confirm").value;
    const matchErr = document.getElementById("pw-change-match-error");
    const submitBtn = document.getElementById("pw-change-submit");
    const mismatch = confirm.length > 0 && pw !== confirm;
    if (matchErr) matchErr.style.display = mismatch ? "block" : "none";
    if (submitBtn) submitBtn.disabled = mismatch;
}

async function handlePasswordChange(e) {
    e.preventDefault();
    const current = document.getElementById("pw-change-current").value;
    const newPw = document.getElementById("pw-change-new").value;
    const confirm = document.getElementById("pw-change-confirm").value;
    if (newPw !== confirm) {
        showToast("Passwörter stimmen nicht überein.");
        return;
    }
    try {
        const response = await fetch("/api/profile/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_password: current, new_password: newPw })
        });
        const data = await response.json();
        if (response.ok) {
            document.getElementById("profile-password-form").reset();
            resetPwChangeRequirements();
            showToast("Passwort erfolgreich geändert.");
        } else {
            showToast(errorDetailToMessage(data.detail, "Passwort konnte nicht geändert werden."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Ändern des Passworts.");
    }
}

async function handleRegisterSubmit(e) {
    e.preventDefault();
    const username = document.getElementById("register-username").value.trim();
    const email = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;
    const passwordConfirm = document.getElementById("register-password-confirm").value;
    const agb = document.getElementById("register-agb").checked;
    const dsgvo = document.getElementById("register-dsgvo").checked;

    if (password !== passwordConfirm) {
        showToast("Passwörter stimmen nicht überein.");
        return;
    }

    const captchaContainer = document.getElementById("register-captcha-container");
    const captchaRequired = captchaContainer && !captchaContainer.classList.contains("hidden");
    const captchaId = captchaRequired ? document.getElementById("register-captcha-id").value : null;
    const captchaAnswer = captchaRequired ? document.getElementById("register-captcha-answer").value.trim() : null;

    // : Browser-Fingerabdruck erfassen (best effort – null bei Fehlschlag).
    const browserFingerprint = await computeBrowserFingerprint();

    try {
        const response = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username,
                email,
                password,
                dsgvo_consent: dsgvo,
                agb_consent: agb,
                captcha_id: captchaId,
                captcha_answer: captchaAnswer,
                browser_fingerprint: browserFingerprint
            })
        });

        const data = await response.json();
        if (response.ok) {
            closeRegisterModal();
            // : einmaliger Hinweis, falls auf diesem Geraet bereits eine
            // Testphase in Anspruch genommen wurde (keine neue Gratis-Probezeit).
            if (data.fingerprint_seen) {
                showToast("Konto erstellt. Hinweis: Auf diesem Gerät wurde bereits eine kostenlose Testphase genutzt – das neue Konto startet daher ohne Probezeit.", 9000);
            } else {
                showToast(data.message || "Konto erfolgreich erstellt!");
            }
            // Bei aktivierter E-Mail-Verifikation NICHT direkt zum Login leiten.
            if (!data.verification_required) {
                document.getElementById("login-dialog").classList.remove("hidden");
            }
        } else {
            showToast(errorDetailToMessage(data.detail, "Registrierung fehlgeschlagen."));
        }
    } catch (err) {
        showToast("Netzwerkfehler bei Registrierung.");
    }
}

// Verarbeitet den E-Mail-Bestaetigungslink (/verify-email?token=...)
async function handleVerifyEmailFromUrl() {
    if (window.location.pathname !== "/verify-email") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    history.replaceState({}, "", "/");
    if (!token) return;
    try {
        const response = await fetch("/api/auth/verify-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
        });
        const data = await response.json();
        if (response.ok) {
            showToast(data.message || "E-Mail-Adresse bestätigt. Sie können sich jetzt anmelden.");
            document.getElementById("login-dialog").classList.remove("hidden");
        } else {
            showToast(errorDetailToMessage(data.detail, "Bestätigung fehlgeschlagen."));
        }
    } catch (err) {
        showToast("Netzwerkfehler bei der E-Mail-Bestätigung.");
    }
}

//: Nach dem Logout duerfen weder die Job-History weiter gepollt noch die Jobs des
// abgemeldeten Users angezeigt werden. Polling + aktiven Log-Stream stoppen und den
// Workspace zurueck in den Landing-Mode versetzen.
function resetWorkspaceAfterLogout() {
    stopHistoryPolling();
    if (logController) {
        logController.abort();
        logController = null;
    }
    currentlyStreamingJobId = null;
    selectedJobId = null;
    activeHost = null;
    allJobs = [];
    updateUI();
}

async function handleLogout() {
    try {
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (response.ok) {
            showToast("Erfolgreich abgemeldet.");
            currentUser = null;
            userDevices = [];
            resetWorkspaceAfterLogout();
            updateAuthUI();
            //: Katalog/Presets haengen von Login & Rolle ab -> nach Logout neu laden,
            // sonst bleiben die personalisierten Kacheln des Vorgaengers sichtbar.
            try { await fetchPresets(); await fetchPlaybooks(); }
            catch (e) { console.warn("Katalog-Reload nach Logout fehlgeschlagen:", e); }
        }
    } catch (err) {
        showToast("Fehler beim Abmelden.");
    }
}

async function handleLogoutAll() {
    if (!(await showConfirmDialog({ title: "Von allen Geräten abmelden?", message: "Möchten Sie sich wirklich von allen Geräten abmelden?", confirmLabel: "Abmelden" }))) return;
    try {
        const response = await fetch("/api/auth/logout-all", { method: "POST" });
        if (response.ok) {
            document.getElementById("profile-dialog").classList.add("hidden");
            showToast("Erfolgreich von allen Geräten abgemeldet.");
            currentUser = null;
            userDevices = [];
            resetWorkspaceAfterLogout();
            updateAuthUI();
            //: Katalog/Presets nach Logout neu laden (Gast-Katalog rendern)
            try { await fetchPresets(); await fetchPlaybooks(); }
            catch (e) { console.warn("Katalog-Reload nach Logout fehlgeschlagen:", e); }
        }
    } catch (err) {
        showToast("Fehler beim Abmelden.");
    }
}

// Profile Settings Handlers
async function handleNotificationToggle(e) {
    const enabled = e.target.checked;
    try {
        const response = await fetch("/api/profile/notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled })
        });
        if (response.ok) {
            currentUser.email_notifications_enabled = enabled;
            showToast("Benachrichtigungseinstellung aktualisiert.");
        }
    } catch (err) {
        showToast("Fehler beim Ändern der Benachrichtigungseinstellung.");
        e.target.checked = !enabled;
    }
}

// : Webhook-URL fuer Status-Benachrichtigungen speichern.
async function handleWebhookSave() {
    const field = document.getElementById("profile-webhook-url");
    if (!field) return;
    const webhook_url = field.value.trim();
    try {
        const response = await fetch("/api/profile/webhook", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ webhook_url })
        });
        const data = await response.json();
        if (response.ok) {
            currentUser.webhook_url = data.webhook_url || "";
            field.value = currentUser.webhook_url;
            showToast(data.message || "Webhook gespeichert.");
        } else {
            showToast(errorDetailToMessage(data.detail, "Fehler beim Speichern des Webhooks."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Speichern des Webhooks.");
    }
}

// ---- Profile tabs ----
function switchProfileTab(name) {
    document.querySelectorAll(".profile-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.ptab === name));
    document.querySelectorAll(".profile-tab-panel").forEach(p => p.classList.toggle("active", p.dataset.ppanel === name));
}

function setupProfileTabs() {
    document.querySelectorAll(".profile-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => switchProfileTab(btn.dataset.ptab));
    });
}

function openProfileDialog() {
    document.getElementById("profile-dialog").classList.remove("hidden");
    switchProfileTab("startseite");
    fetchSessions();
}

// ---- Active sessions ----
async function fetchSessions() {
    const container = document.getElementById("sessions-list-container");
    if (!container) return;
    try {
        const res = await fetch("/api/profile/sessions");
        if (!res.ok) {
            container.innerHTML = '<p style="color: var(--text-muted); font-size:13px;">Sitzungen konnten nicht geladen werden.</p>';
            return;
        }
        renderSessions(await res.json());
    } catch (e) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size:13px;">Netzwerkfehler.</p>';
    }
}

function renderSessions(sessions) {
    const container = document.getElementById("sessions-list-container");
    if (!container) return;
    if (!sessions || sessions.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size:13px;">Keine aktiven Sitzungen.</p>';
        return;
    }
    container.innerHTML = "";
    sessions.forEach(s => {
        const div = document.createElement("div");
        div.className = "session-item" + (s.current ? " current" : "");
        const created = s.created_at ? new Date(s.created_at).toLocaleString() : "-";
        const ua = (s.user_agent || "Unbekanntes Gerät").slice(0, 70);
        const left = document.createElement("div");
        left.innerHTML = `<div>${escapeHtml(ua)}${s.current ? ' <span style="color:var(--md-sys-color-primary);">(diese Sitzung)</span>' : ''}</div>` +
            `<div style="color: var(--text-muted); font-size:12px;">IP: ${escapeHtml(s.ip_address || '-')} &middot; ${escapeHtml(created)}</div>`;
        div.appendChild(left);
        if (!s.current) {
            const btn = document.createElement("button");
            btn.className = "btn btn-secondary btn-small";
            btn.textContent = "Beenden";
            btn.addEventListener("click", () => revokeSession(s.id));
            div.appendChild(btn);
        }
        container.appendChild(div);
    });
}

async function revokeSession(id) {
    try {
        const res = await fetch(`/api/profile/sessions/${id}`, { method: "DELETE" });
        if (res.ok) {
            showToast("Sitzung beendet.");
            fetchSessions();
        } else {
            const d = await res.json();
            showToast(d.detail || "Konnte Sitzung nicht beenden.");
        }
    } catch (e) {
        showToast("Netzwerkfehler beim Beenden der Sitzung.");
    }
}

// ---- Device groups ----
let editingDeviceGroup = null;

async function loadDeviceGroupsTab() {
    resetDeviceGroupForm();
    try {
        const [devRes, guests, groupRes] = await Promise.all([
            fetch("/api/devices"),
            fetchGuestList(),
            fetch("/api/profile/device-groups")
        ]);
        const devices = devRes.ok ? await devRes.json() : [];
        const groups = groupRes.ok ? await groupRes.json() : [];
        window._dgDevices = devices;
        window._dgGuests = guests;
        renderDeviceGroupForm(devices, guests, [], [], []);
        renderDeviceGroupsList(groups);
    } catch (e) {
        document.getElementById("device-groups-list").innerHTML = '<p style="color:var(--md-sys-color-error);">Netzwerkfehler beim Laden.</p>';
    }
}

function renderDeviceGroupForm(devices, guests, selDevIds, selGuestIds, selPlaybookIds) {
    const dc = document.getElementById("device-group-devices");
    const gc = document.getElementById("device-group-guests");
    renderDeviceGroupPlaybooks(selPlaybookIds || []);
    const dSel = new Set(selDevIds || []);
    const gSel = new Set(selGuestIds || []);
    if (!devices || devices.length === 0) {
        dc.innerHTML = '<p style="color: var(--text-muted); margin:0;">Keine Geräte vorhanden.</p>';
    } else {
        dc.innerHTML = "";
        devices.forEach(d => {
            const row = document.createElement("label");
            row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:5px; cursor:pointer;";
            const cb = document.createElement("input");
            cb.type = "checkbox"; cb.className = "styled-checkbox dg-device"; cb.value = d.id;
            cb.checked = dSel.has(d.id);
            row.appendChild(cb);
            const span = document.createElement("span");
            span.textContent = `${d.name} (${d.host})`;
            row.appendChild(span);
            dc.appendChild(row);
        });
    }
    if (!guests || guests.length === 0) {
        gc.innerHTML = '<p style="color: var(--text-muted); margin:0;">Keine Teammitglieder vorhanden.</p>';
    } else {
        gc.innerHTML = "";
        guests.forEach(g => {
            const row = document.createElement("label");
            row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:5px; cursor:pointer;";
            const cb = document.createElement("input");
            cb.type = "checkbox"; cb.className = "styled-checkbox dg-guest"; cb.value = g.id;
            cb.checked = gSel.has(g.id);
            row.appendChild(cb);
            const span = document.createElement("span");
            span.textContent = `${g.username} (${g.email})`;
            row.appendChild(span);
            gc.appendChild(row);
        });
    }
}

// : Playbook-Mehrfachauswahl der Szenario-Vorlage rendern. Die Auswahl bleibt
// beim Filtern erhalten (es werden nur Zeilen ein-/ausgeblendet, nie neu gerendert).
function renderDeviceGroupPlaybooks(selPlaybookIds) {
    const pc = document.getElementById("device-group-playbooks");
    if (!pc) return;
    const sel = new Set(selPlaybookIds || []);
    const list = (allPlaybooks || []).slice()
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de", { sensitivity: "base" }));
    if (list.length === 0) {
        pc.innerHTML = '<p style="color: var(--text-muted); margin:0;">Keine Playbooks verfügbar.</p>';
        return;
    }
    pc.innerHTML = "";
    list.forEach(pb => {
        const row = document.createElement("label");
        row.className = "dg-pb-row";
        row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:5px; cursor:pointer;";
        row.dataset.search = `${pb.name || ""} ${pb.category || ""} ${pb.file || ""}`.toLowerCase();
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "styled-checkbox dg-playbook"; cb.value = pb.file;
        cb.checked = sel.has(pb.file);
        row.appendChild(cb);
        const span = document.createElement("span");
        span.textContent = pb.category ? `${pb.name} — ${pb.category}` : pb.name;
        row.appendChild(span);
        pc.appendChild(row);
    });
}

// : Filter fuer die Szenario-Playbook-Liste (blendet nur Zeilen aus).
function filterDeviceGroupPlaybooks(term) {
    const q = (term || "").trim().toLowerCase();
    document.querySelectorAll("#device-group-playbooks .dg-pb-row").forEach(row => {
        row.style.display = (!q || (row.dataset.search || "").includes(q)) ? "flex" : "none";
    });
}

// : Szenario starten - Playbooks der Gruppe im Katalog vorwaehlen, Gruppe als
// Ziel setzen und das Ausfuehren-Modal oeffnen. Beschleunigt die manuelle Einrichtung.
function launchGroupScenario(g) {
    const ids = (g && g.default_playbook_ids) || [];
    if (!ids.length) {
        showToast("Diese Gruppe hat keine Szenario-Playbooks hinterlegt.");
        return;
    }
    // Profil-Dialog schliessen und zur Startseite wechseln (dort liegt der Katalog).
    const profileDialog = document.getElementById("profile-dialog");
    if (profileDialog && typeof profileDialog.close === "function" && profileDialog.open) profileDialog.close();
    navigateTo("/");
    // Auswahl im Katalog setzen (zuerst alles abwaehlen, dann Szenario aktivieren).
    document.querySelectorAll('#playbooks-list input[name="playbooks"]:checked').forEach(cb => { cb.checked = false; });
    let matched = 0;
    const missing = [];
    ids.forEach(file => {
        const cb = playbooksList.querySelector(`input[name="playbooks"][value="${cssEscape(file)}"]`);
        if (cb) {
            cb.checked = true;
            matched++;
            checkPlaybookAndDependencies(cb);
        } else {
            missing.push(playbookNameMap[file] || file);
        }
    });
    updatePresetHighlights();
    if (matched === 0) {
        showToast("Die Szenario-Playbooks sind aktuell nicht im Katalog verfügbar.");
        return;
    }
    if (missing.length) {
        showToast(`${missing.length} Playbook(s) der Vorlage nicht verfügbar: ${missing.join(", ")}`);
    }
    // Gruppe als Ziel vorwaehlen und Modal oeffnen.
    showCredentialsModal();
    const deviceSelect = document.getElementById("modal-device-select");
    if (deviceSelect) {
        deviceSelect.value = `group:${g.id}`;
        deviceSelect.dispatchEvent(new Event("change"));
    }
}

// CSS.escape-Fallback fuer aeltere Umgebungen (Attribut-Selektor mit Pfad-IDs absichern).
function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/["\\\]]/g, "\\$&");
}

function renderDeviceGroupsList(groups) {
    const c = document.getElementById("device-groups-list");
    if (!groups || groups.length === 0) {
        c.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">Keine Geräte-Gruppen angelegt.</p>';
        return;
    }
    c.innerHTML = "";
    groups.forEach(g => {
        const div = document.createElement("div");
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; background:rgba(255,255,255,0.02); font-size:13px;";
        const left = document.createElement("div");
        const devNames = (g.devices || []).map(d => d.name).join(", ") || "keine Geräte";
        const pbCount = (g.default_playbook_ids || []).length;
        left.innerHTML = `<div style="font-weight:bold; color:var(--md-sys-color-primary);">${escapeHtml(g.name)}</div>` +
            `<div style="color:var(--text-secondary); font-size:12px;">${escapeHtml(devNames)}</div>` +
            `<div style="color:var(--text-muted); font-size:11px;">${guestShareLabel((g.guest_access||[]).length)}` +
            `${pbCount ? ` &middot; ${pbCount} Szenario-Playbook${pbCount === 1 ? "" : "s"}` : ""}</div>`;
        div.appendChild(left);
        const actions = document.createElement("div");
        actions.style.whiteSpace = "nowrap";
        // : Szenario direkt starten, sofern Playbooks hinterlegt sind.
        if (pbCount > 0) {
            const run = document.createElement("button");
            run.type = "button"; run.className = "btn btn-primary btn-small"; run.textContent = "Szenario starten"; run.style.marginRight = "6px";
            run.addEventListener("click", () => launchGroupScenario(g));
            actions.appendChild(run);
        }
        const edit = document.createElement("button");
        edit.type = "button"; edit.className = "btn btn-secondary btn-small"; edit.textContent = "Bearbeiten"; edit.style.marginRight = "6px";
        edit.addEventListener("click", () => editDeviceGroup(g));
        const del = document.createElement("button");
        del.type = "button"; del.className = "btn btn-small"; del.textContent = "Löschen";
        del.style.cssText = "background: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent); border-color: color-mix(in srgb, var(--md-sys-color-primary) 50%, transparent); color: var(--md-sys-color-primary);";
        del.addEventListener("click", () => deleteDeviceGroupById(g.id, g.name));
        actions.appendChild(edit); actions.appendChild(del);
        div.appendChild(actions);
        c.appendChild(div);
    });
}

//: Standardwert-Felder der Gruppen-Form befuellen/leeren
function setDeviceGroupDefaults(g) {
    const usr = document.getElementById("device-group-default-user");
    const ctype = document.getElementById("device-group-default-credtype");
    const cred = document.getElementById("device-group-default-credential");
    const hint = document.getElementById("device-group-cred-hint");
    const base = document.getElementById("device-group-default-basedir");
    const tz = document.getElementById("device-group-default-tz");
    const clearRow = document.getElementById("device-group-clear-cred-row");
    const clearCb = document.getElementById("device-group-clear-cred");
    if (!usr) return;
    usr.value = (g && g.default_ssh_user) || "";
    ctype.value = (g && g.default_credential_type) || "";
    cred.value = "";   // Klartext wird nie zurueckgeliefert
    base.value = (g && g.default_base_directory) || "";
    tz.value = (g && g.default_timezone) || "";
    //: Standard-Variablen als "name=wert"-Zeilen darstellen.
    const dv = document.getElementById("device-group-default-variables");
    if (dv) {
        const vars = (g && g.default_variables) || {};
        dv.value = Object.keys(vars).map(k => `${k}=${vars[k]}`).join("\n");
    }
    const hasCred = !!(g && g.has_default_credential);
    if (hint) hint.style.display = hasCred ? "block" : "none";
    // Lösch-Checkbox nur anbieten, wenn ein Credential gespeichert ist
    if (clearCb) clearCb.checked = false;
    if (clearRow) clearRow.style.display = hasCred ? "flex" : "none";
}

function editDeviceGroup(g) {
    editingDeviceGroup = g.id;
    document.getElementById("device-group-id").value = g.id;
    document.getElementById("device-group-name").value = g.name;
    document.getElementById("device-group-form-title").textContent = "Geräte-Gruppe bearbeiten";
    document.getElementById("device-group-cancel-btn").style.display = "";
    setDeviceGroupDefaults(g);
    renderDeviceGroupForm(window._dgDevices || [], window._dgGuests || [], g.device_ids || [], g.guest_access || [], g.default_playbook_ids || []);
}

function resetDeviceGroupForm() {
    editingDeviceGroup = null;
    const idEl = document.getElementById("device-group-id");
    if (idEl) idEl.value = "";
    const nameEl = document.getElementById("device-group-name");
    if (nameEl) nameEl.value = "";
    const title = document.getElementById("device-group-form-title");
    if (title) title.textContent = "Neue Geräte-Gruppe";
    const cancel = document.getElementById("device-group-cancel-btn");
    if (cancel) cancel.style.display = "none";
    setDeviceGroupDefaults(null);
    const det = document.getElementById("device-group-defaults");
    if (det) det.open = false;
    const pf = document.getElementById("device-group-playbook-filter");
    if (pf) pf.value = "";
    if (window._dgDevices) renderDeviceGroupForm(window._dgDevices, window._dgGuests || [], [], [], []);
}

async function saveDeviceGroup() {
    const name = document.getElementById("device-group-name").value.trim();
    if (!name) { showToast("Bitte einen Gruppennamen eingeben."); return; }
    const device_ids = Array.from(document.querySelectorAll("#device-group-devices .dg-device:checked")).map(c => c.value);
    const guest_access = Array.from(document.querySelectorAll("#device-group-guests .dg-guest:checked")).map(c => c.value);
    // : vorausgewaehlte Szenario-Playbooks mitsenden.
    const default_playbook_ids = Array.from(document.querySelectorAll("#device-group-playbooks .dg-playbook:checked")).map(c => c.value);
    const payload = { name, device_ids, guest_access, default_playbook_ids };
    //: Standardwerte mitsenden (leer = nicht gesetzt)
    const dgUser = document.getElementById("device-group-default-user");
    if (dgUser) {
        payload.default_ssh_user = dgUser.value.trim();
        payload.default_credential_type = document.getElementById("device-group-default-credtype").value;
        payload.default_base_directory = document.getElementById("device-group-default-basedir").value.trim();
        payload.default_timezone = document.getElementById("device-group-default-tz").value.trim();
        //: Standard-Variablen aus "name=wert"-Zeilen parsen.
        const dvEl = document.getElementById("device-group-default-variables");
        if (dvEl) {
            const vars = {};
            dvEl.value.split(/\r?\n/).forEach(line => {
                const idx = line.indexOf("=");
                if (idx <= 0) return;
                const k = line.slice(0, idx).trim();
                const v = line.slice(idx + 1).trim();
                if (k) vars[k] = v;
            });
            payload.default_variables = vars;
        }
        const credVal = document.getElementById("device-group-default-credential").value;
        const clearCb = document.getElementById("device-group-clear-cred");
        const wantClear = clearCb && clearCb.checked;
        // Credential-Semantik: neues Secret -> setzen; "Entfernen" angehakt oder Neuanlage -> "" (loeschen/leer);
        // beim Bearbeiten ohne Eingabe -> Feld weglassen (Backend behaelt bestehenden Wert + Typ unveraendert).
        if (credVal) payload.default_credential = credVal;
        else if (wantClear || !editingDeviceGroup) payload.default_credential = "";
    }
    const path = editingDeviceGroup ? `/api/profile/device-groups/${editingDeviceGroup}` : "/api/profile/device-groups";
    try {
        const res = await fetch(path, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            showToast(editingDeviceGroup ? "Geräte-Gruppe aktualisiert." : "Geräte-Gruppe erstellt.");
            await loadDeviceGroupsTab();
        } else {
            showToast(errorDetailToMessage(data.detail, "Speichern fehlgeschlagen."));
        }
    } catch (e) { showToast("Netzwerkfehler beim Speichern."); }
}

async function deleteDeviceGroupById(id, name) {
    // : konkreten Namen fett in der Bestätigungsfrage zeigen.
    const msgHtml = name ? `Möchten Sie die Geräte-Gruppe <b>${escapeHtml(name)}</b> wirklich löschen?` : "Geräte-Gruppe wirklich löschen?";
    if (!(await showConfirmDialog({ title: "Geräte-Gruppe löschen?", messageHtml: msgHtml, confirmLabel: "Löschen" }))) return;
    try {
        const res = await fetch(`/api/profile/device-groups/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) { showToast("Geräte-Gruppe gelöscht."); await loadDeviceGroupsTab(); }
        else showToast(errorDetailToMessage(data.detail, "Löschen fehlgeschlagen."));
    } catch (e) { showToast("Netzwerkfehler beim Löschen."); }
}

// =====  (#C): Verwaltete Einzelgeraete (Vault-Geraete-Tab) =====
// Ein "Gerät" = ein Device in einer 1er-DeviceGroup (Backend devices-unified). Die Liste zeigt
// nur managed Gruppen; Verbindungsdaten liegen am Device, Run-Defaults/Freigabe an der Gruppe.
let editingManagedDevice = null;

async function loadManagedDevicesTab() {
    resetManagedDeviceForm();
    const listEl = document.getElementById("managed-devices-list");
    try {
        // (Device-Flatten): Geraeteliste direkt aus /api/profile/devices-unified (flach).
        const res = await fetch("/api/profile/devices-unified");
        const devices = res.ok ? await res.json() : [];
        renderManagedDevicesList(devices);
    } catch (e) {
        if (listEl) listEl.innerHTML = '<p style="color:var(--md-sys-color-error); font-size:13px;">Netzwerkfehler beim Laden.</p>';
    }
}

function renderManagedDevicesList(devices) {
    const c = document.getElementById("managed-devices-list");
    if (!c) return;
    if (!devices || devices.length === 0) {
        c.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">Keine Geräte angelegt.</p>';
        return;
    }
    c.innerHTML = "";
    devices.forEach(g => {
        const md = g.managed_device || {};
        const div = document.createElement("div");
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; background:rgba(255,255,255,0.02); font-size:13px;";
        // : Linke Gruppe = Buttons (Freigeben/Bearbeiten) vor Name + Meta; rechts nur
        // Löschen — gespiegelt von der Preset-Liste.
        const leftGroup = document.createElement("div");
        leftGroup.style.cssText = "display:flex; align-items:center; gap:8px; min-width:0;";
        //: In der Community-Edition kein „Freigeben" (keine weiteren Benutzer/Teams).
        if (currentEdition !== "community") {
            const share = vaultActionButton("Freigeben", "share", "primary");
            share.addEventListener("click", () => openManagedDeviceShare(g));
            leftGroup.appendChild(share);
        }
        const edit = vaultActionButton("Bearbeiten", "edit", "secondary");
        edit.addEventListener("click", () => editManagedDevice(g));
        leftGroup.appendChild(edit);
        const info = document.createElement("div");
        info.style.minWidth = "0";
        const conn = (md.username ? md.username + "@" : "") + (md.host || "");
        //: Freigabe-Label nur ausserhalb der Community-Edition (dort gibt es keine Freigaben).
        const shareLabelHtml = currentEdition === "community"
            ? ""
            : `<div style="color:var(--text-muted); font-size:11px;">${guestShareLabel((g.guest_access || []).length)}</div>`;
        info.innerHTML = `<div style="font-weight:bold; color:var(--md-sys-color-primary);">${escapeHtml(g.name)}</div>` +
            `<div style="color:var(--text-secondary); font-size:12px;">${escapeHtml(conn || "—")}</div>` +
            shareLabelHtml;
        leftGroup.appendChild(info);
        div.appendChild(leftGroup);
        const right = document.createElement("div");
        right.style.whiteSpace = "nowrap";
        const del = vaultActionButton("Löschen", "delete", "danger");
        del.addEventListener("click", () => deleteManagedDevice(g.id, g.name));
        right.appendChild(del);
        div.appendChild(right);
        c.appendChild(div);
    });
}

// : Datei (SSH-Key) als Text einlesen.
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error || new Error("read error"));
        r.readAsText(file);
    });
}

function _resetManagedKeyUpload() {
    const keyFile = document.getElementById("managed-device-key-file");
    if (keyFile) keyFile.value = "";
    const keyLbl = document.getElementById("managed-device-key-filename-lbl");
    if (keyLbl) keyLbl.textContent = "Keine Datei ausgewählt";
}

function resetManagedDeviceForm() {
    editingManagedDevice = null;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    ["managed-device-id", "managed-device-name", "managed-device-host", "managed-device-user",
     "managed-device-credential", "managed-device-become", "managed-device-basedir"].forEach(id => set(id, ""));
    // : Zeitzone beim Neuanlegen mit der Browser-Zeitzone vorbelegen.
    let browserTz = "";
    try { browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    set("managed-device-tz", browserTz);
    _resetManagedKeyUpload();
    const title = document.getElementById("managed-device-form-title");
    if (title) title.textContent = "Neues Gerät";
    // : Neuanlage -> Geräte-Icon (kein Stift).
    const icon = document.getElementById("managed-device-form-icon");
    if (icon) icon.textContent = "devices";
    // : Abbrechen ist im Dialog immer sichtbar (schließt den Dialog).
    const hint = document.getElementById("managed-device-cred-hint");
    if (hint) hint.style.display = "none";
    // : Platzhalter-Status zurücksetzen (Neuanlage = leeres Feld, kein Platzhalter).
    const credEl = document.getElementById("managed-device-credential");
    if (credEl) credEl.dataset.placeholder = "";
    //: Sudo-Passwort-Feld + Platzhalter/Hint zurücksetzen (Neuanlage = leer).
    const becomeEl = document.getElementById("managed-device-become");
    if (becomeEl) becomeEl.dataset.placeholder = "";
    const becomeHint = document.getElementById("managed-device-become-hint");
    if (becomeHint) becomeHint.style.display = "none";
    // : Autofill-Sperre des Basisverzeichnisses zurücksetzen (Neuanlage = Folgemodus aktiv).
    const baseEl = document.getElementById("managed-device-basedir");
    if (baseEl) baseEl.dataset.edited = "false";
    // : Dirty-Flag des Dialogs zurücksetzen (frischer Stand -> kein Verwerfen-Hinweis).
    const dlg = document.getElementById("managed-device-dialog");
    if (dlg) dlg.dataset.dirty = "";
}

// : Platzhalter im Passwortfeld eines bearbeiteten Geräts (zeigt "Anmeldedaten hinterlegt").
const MANAGED_CRED_PLACEHOLDER = "••••••••••";

function editManagedDevice(g) {
    const md = g.managed_device || {};
    editingManagedDevice = g.id;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set("managed-device-id", g.id);
    set("managed-device-name", g.name || "");
    set("managed-device-host", md.host || "");
    set("managed-device-user", md.username || "");
    set("managed-device-basedir", g.base_directory || "");
    // : vorhandenes Basisverzeichnis als „bearbeitet" markieren, damit eine
    // spätere Benutzer-Änderung es nicht überschreibt (leeres Feld bleibt im Folgemodus).
    const baseEl = document.getElementById("managed-device-basedir");
    if (baseEl) baseEl.dataset.edited = g.base_directory ? "true" : "false";
    set("managed-device-tz", g.timezone || "");
    _resetManagedKeyUpload();
    const title = document.getElementById("managed-device-form-title");
    if (title) title.textContent = "Gerät bearbeiten";
    // : Bearbeiten -> Stift-Icon im Header.
    const icon = document.getElementById("managed-device-form-icon");
    if (icon) icon.textContent = "edit";
    // : Platzhalter-Passwort statt Lösch-Checkbox. Unverändert -> behalten,
    // überschreiben -> ändern, leeren -> löschen (Erkennung via dataset.placeholder).
    const hasCred = !!md.has_credential;
    const credEl = document.getElementById("managed-device-credential");
    if (credEl) {
        credEl.value = hasCred ? MANAGED_CRED_PLACEHOLDER : "";
        credEl.dataset.placeholder = hasCred ? "1" : "";
    }
    const hint = document.getElementById("managed-device-cred-hint");
    if (hint) hint.style.display = hasCred ? "block" : "none";
    //: Sudo-Passwort analog per Platzhalter (hinterlegt -> Punkte, unverändert = behalten).
    const hasBecome = !!md.has_become_credential;
    const becomeEl = document.getElementById("managed-device-become");
    if (becomeEl) {
        becomeEl.value = hasBecome ? MANAGED_CRED_PLACEHOLDER : "";
        becomeEl.dataset.placeholder = hasBecome ? "1" : "";
    }
    const becomeHint = document.getElementById("managed-device-become-hint");
    if (becomeHint) becomeHint.style.display = hasBecome ? "block" : "none";
    // : Bearbeiten im Dialog öffnen.
    openManagedDeviceDialog();
}

async function saveManagedDevice() {
    const name = document.getElementById("managed-device-name").value.trim();
    const host = document.getElementById("managed-device-host").value.trim();
    if (!name) { showToast("Bitte einen Gerätenamen eingeben."); return; }
    if (!host) { showToast("Bitte einen Host / eine IP eingeben."); return; }
    const payload = {
        name, host,
        default_ssh_user: document.getElementById("managed-device-user").value.trim(),
        default_base_directory: document.getElementById("managed-device-basedir").value.trim(),
        default_timezone: document.getElementById("managed-device-tz").value.trim(),
    };
    // : Anmeldeart aus den Feldern ableiten — hochgeladener SSH-Key => key,
    // sonst Passwort. Kontrakt: neues Secret -> setzen; "Entfernen"/Neuanlage -> "" (loeschen);
    // Bearbeiten ohne Eingabe -> Felder weglassen (Backend behaelt bestehenden Wert + Typ).
    //: keine freien Standard-Variablen mehr -> default_variables wird nicht gesendet.
    const keyInput = document.getElementById("managed-device-key-file");
    const keyFile = keyInput && keyInput.files && keyInput.files[0];
    const credEl = document.getElementById("managed-device-credential");
    const credVal = credEl.value;
    // : Platzhalter-Passwort. Unangetastet (dataset.placeholder==="1") -> Secret behalten
    // (keine Credential-Felder senden -> Backend lässt None unverändert); überschrieben -> setzen;
    // geleert -> löschen (""). Ein hochgeladener SSH-Key hat Vorrang.
    const credUntouched = credEl.dataset.placeholder === "1";
    if (keyFile) {
        let keyText;
        try { keyText = await readFileAsText(keyFile); }
        catch (e) { showToast("SSH-Key konnte nicht gelesen werden."); return; }
        if (!keyText || !keyText.trim()) { showToast("Die gewählte Key-Datei ist leer."); return; }
        payload.default_credential = keyText;
        payload.default_credential_type = "key";
    } else if (credUntouched) {
        // Platzhalter nicht angefasst -> bestehendes Secret unverändert lassen.
    } else if (credVal) {
        payload.default_credential = credVal;
        payload.default_credential_type = "password";
    } else {
        payload.default_credential = "";
        payload.default_credential_type = null;
    }
    //: Sudo-/Become-Passwort mit demselben Platzhalter-Kontrakt: unangetastet -> nicht senden
    // (Backend behält bestehenden Wert), überschrieben -> setzen, geleert -> "" (löschen).
    const becomeEl = document.getElementById("managed-device-become");
    if (becomeEl) {
        const becomeVal = becomeEl.value;
        if (becomeEl.dataset.placeholder === "1") {
            // Platzhalter unverändert -> bestehendes Sudo-Passwort behalten (Feld weglassen).
        } else if (becomeVal) {
            payload.default_become_password = becomeVal;
        } else {
            payload.default_become_password = "";
        }
    }
    const path = editingManagedDevice ? `/api/profile/devices-unified/${editingManagedDevice}` : "/api/profile/devices-unified";
    const method = editingManagedDevice ? "PUT" : "POST";
    try {
        const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            showToast(editingManagedDevice ? "Gerät aktualisiert." : "Gerät erstellt.");
            closeManagedDeviceDialog();  // 
            await loadManagedDevicesTab();
            if (typeof fetchDevices === "function") fetchDevices();  // Run-Dropdown synchron halten
        } else {
            showToast(errorDetailToMessage(data.detail, "Speichern fehlgeschlagen."));
        }
    } catch (e) { showToast("Netzwerkfehler beim Speichern."); }
}

async function deleteManagedDevice(id, name) {
    // : Gerätename fett in der Bestätigungsfrage.
    const msgHtml = name ? `Möchten Sie das Gerät <b>${escapeHtml(name)}</b> wirklich löschen?` : "Gerät wirklich löschen?";
    if (!(await showConfirmDialog({ title: "Gerät löschen?", messageHtml: msgHtml, confirmLabel: "Löschen" }))) return;
    try {
        const res = await fetch(`/api/profile/devices-unified/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            showToast("Gerät gelöscht.");
            await loadManagedDevicesTab();
            if (typeof fetchDevices === "function") fetchDevices();
        } else {
            showToast(errorDetailToMessage(data.detail, "Löschen fehlgeschlagen."));
        }
    } catch (e) { showToast("Netzwerkfehler beim Löschen."); }
}

let sharingManagedDevice = null;
async function openManagedDeviceShare(g) {
    sharingManagedDevice = g.id;
    document.getElementById("managed-device-share-name").textContent = g.name || "";
    const container = document.getElementById("managed-device-share-guests");
    container.innerHTML = '<p style="color: var(--text-muted); margin:0;">Lade Teammitglieder...</p>';
    document.getElementById("managed-device-share-dialog").classList.remove("hidden");
    try {
        const guests = await fetchGuestList();
        if (!guests || guests.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); margin:0;">Keine Teammitglieder vorhanden. Legen Sie zuerst im Team-Bereich welche an.</p>';
            return;
        }
        const enabled = new Set(g.guest_access || []);
        container.innerHTML = "";
        guests.forEach(gu => {
            const row = document.createElement("label");
            row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer;";
            const cb = document.createElement("input");
            cb.type = "checkbox"; cb.className = "styled-checkbox md-share-guest"; cb.value = gu.id;
            cb.checked = enabled.has(gu.id);
            row.appendChild(cb);
            const span = document.createElement("span");
            span.textContent = `${gu.username} (${gu.email})`;
            row.appendChild(span);
            container.appendChild(row);
        });
    } catch (e) {
        container.innerHTML = '<p style="color:var(--md-sys-color-error); margin:0;">Teammitglieder konnten nicht geladen werden.</p>';
    }
}

function closeManagedDeviceShare() {
    document.getElementById("managed-device-share-dialog").classList.add("hidden");
    sharingManagedDevice = null;
}

async function saveManagedDeviceShare() {
    if (!sharingManagedDevice) return;
    const checked = Array.from(document.querySelectorAll("#managed-device-share-guests .md-share-guest:checked")).map(c => c.value);
    try {
        const res = await fetch(`/api/profile/devices-unified/${sharingManagedDevice}/share`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guest_access: checked })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            showToast("Freigabe gespeichert.");
            closeManagedDeviceShare();
            await loadManagedDevicesTab();
        } else {
            showToast(errorDetailToMessage(data.detail, "Speichern fehlgeschlagen."));
        }
    } catch (e) { showToast("Netzwerkfehler beim Speichern."); }
}

// ===== : Benutzerdefinierte Presets (Verwaltung + Ausfuehrung) =====
let editingPreset = null;
window._presetGuests = [];
window._presetDevices = [];

async function loadPresets() {
    const listEl = document.getElementById("presets-list");
    if (!listEl) return;
    try {
        const [presetsRes, guestsArr, devicesRes] = await Promise.all([
            fetch("/api/profile/presets"),
            fetchGuestList(),
            fetch("/api/devices"),
        ]);
        const presets = presetsRes.ok ? await presetsRes.json() : [];
        window._presetGuests = guestsArr;
        // (Device-Flatten): Zielgeraete-Auswahl aus der flachen Geraeteliste.
        window._presetDevices = devicesRes.ok ? await devicesRes.json() : [];
        renderPresetDevices([]);
        renderPresetPlaybooks([]);
        renderPresetShares([]);
        renderPresetsList(presets);
        //: Katalog-Kacheln synchron halten (z. B. nach Speichern/Loeschen).
        userCustomPresets = presets;
        if (typeof renderPlaybooks === "function" && allPlaybooks && allPlaybooks.length) renderPlaybooks();
    } catch (e) {
        listEl.innerHTML = '<p style="color:var(--md-sys-color-error);">Netzwerkfehler beim Laden der Presets.</p>';
    }
}

function renderPresetPlaybooks(selIds) {
    const pc = document.getElementById("preset-playbooks");
    if (!pc) return;
    const sel = new Set(selIds || []);
    const list = (allPlaybooks || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "de", { sensitivity: "base" }));
    if (!list.length) { pc.innerHTML = '<p style="color: var(--text-muted); margin:0;">Keine Playbooks verfügbar.</p>'; return; }
    pc.innerHTML = "";
    list.forEach(pb => {
        const row = document.createElement("label");
        row.className = "preset-pb-row";
        row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:5px; cursor:pointer;";
        row.dataset.search = `${pb.name || ""} ${pb.category || ""} ${pb.file || ""}`.toLowerCase();
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "styled-checkbox preset-playbook"; cb.value = pb.file;
        cb.checked = sel.has(pb.file);
        row.appendChild(cb);
        const span = document.createElement("span");
        span.textContent = pb.category ? `${pb.name} — ${pb.category}` : pb.name;
        row.appendChild(span);
        pc.appendChild(row);
    });
}

function filterPresetPlaybooks(term) {
    const q = (term || "").trim().toLowerCase();
    document.querySelectorAll("#preset-playbooks .preset-pb-row").forEach(row => {
        row.style.display = (!q || (row.dataset.search || "").includes(q)) ? "flex" : "none";
    });
}

function renderPresetDevices(selIds) {
    // (Device-Flatten): Mehrfachauswahl der Zielgeraete (Checkboxen) statt Einzel-Gruppe.
    const c = document.getElementById("preset-devices");
    if (!c) return;
    const sel = new Set(selIds || []);
    const devices = window._presetDevices || [];
    if (!devices.length) {
        c.innerHTML = '<p style="color: var(--text-muted); margin:0; font-size:12px;">Keine Geräte angelegt.</p>';
        return;
    }
    c.innerHTML = "";
    devices.forEach(d => {
        const row = document.createElement("label");
        row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:5px; cursor:pointer;";
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "styled-checkbox preset-device"; cb.value = d.id;
        cb.checked = sel.has(d.id);
        row.appendChild(cb);
        const span = document.createElement("span");
        span.textContent = `${d.name} (${d.host})`;
        row.appendChild(span);
        c.appendChild(row);
    });
}

// Freigabe-Liste: pro Gast eine Checkbox + Strikt/Flexibel-Auswahl.
function renderPresetShares(shares) {
    const sc = document.getElementById("preset-shares");
    if (!sc) return;
    const guests = window._presetGuests || [];
    const byGuest = {};
    (shares || []).forEach(s => { byGuest[s.guest_id] = s.permission || "strict"; });
    if (!guests.length) { sc.innerHTML = '<p style="color: var(--text-muted); margin:0;">Keine Teammitglieder vorhanden.</p>'; return; }
    sc.innerHTML = "";
    guests.forEach(g => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:6px;";
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "styled-checkbox preset-share-cb"; cb.value = g.id;
        cb.checked = byGuest[g.id] !== undefined;
        const name = document.createElement("span");
        name.style.cssText = "flex:1; min-width:0;";
        name.textContent = `${g.username} (${g.email})`;
        const perm = document.createElement("select");
        perm.className = "preset-share-perm"; perm.dataset.guest = g.id;
        perm.style.cssText = "padding:4px 6px; font-size:12px; background:rgba(0,0,0,0.2); color:#fff; border:1px solid rgba(255,255,255,0.15); border-radius:6px;";
        perm.innerHTML = '<option value="strict">strikt (nur ausführen)</option><option value="flexible">flexibel (anpassbar)</option>';
        perm.value = byGuest[g.id] || "strict";
        row.appendChild(cb); row.appendChild(name); row.appendChild(perm);
        sc.appendChild(row);
    });
}

function renderPresetsList(presets) {
    const c = document.getElementById("presets-list");
    if (!c) return;
    if (!presets || !presets.length) {
        c.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">Keine Presets angelegt.</p>';
        return;
    }
    c.innerHTML = "";
    presets.forEach(p => {
        const div = document.createElement("div");
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; background:rgba(255,255,255,0.02); font-size:13px;";
        // : Linke Gruppe = Buttons (Freigeben/Bearbeiten) vor Name + Meta; rechts nur Löschen.
        const leftGroup = document.createElement("div");
        leftGroup.style.cssText = "display:flex; align-items:center; gap:8px; min-width:0;";
        if (p.is_owner) {
            const share = vaultActionButton("Freigeben", "share", "primary");
            share.addEventListener("click", () => openPresetModal(p));
            const edit = vaultActionButton("Bearbeiten", "edit", "secondary");
            edit.addEventListener("click", () => openPresetModal(p));
            leftGroup.appendChild(share); leftGroup.appendChild(edit);
        }
        const info = document.createElement("div");
        info.style.minWidth = "0";
        const pbCount = (p.playbook_ids || []).length;
        const shareCount = (p.shares || []).length;
        const meta = [`${pbCount} Playbook${pbCount === 1 ? "" : "s"}`];
        if (p.is_owner && shareCount) meta.push(`${shareCount} Freigabe${shareCount === 1 ? "" : "n"}`);
        if (!p.is_owner) meta.push(p.permission === "flexible" ? "flexibel freigegeben" : "strikt freigegeben");
        info.innerHTML = `<div style="font-weight:bold; color:var(--md-sys-color-primary);">${escapeHtml(p.name)}</div>` +
            `<div style="color:var(--text-secondary); font-size:12px;">${escapeHtml(meta.join(" · "))}</div>`;
        leftGroup.appendChild(info);
        div.appendChild(leftGroup);
        const right = document.createElement("div");
        right.style.whiteSpace = "nowrap";
        if (p.is_owner) {
            const del = vaultActionButton("Löschen", "delete", "danger");
            del.addEventListener("click", () => deletePresetById(p.id, p.name));
            right.appendChild(del);
        }
        div.appendChild(right);
        c.appendChild(div);
    });
}

function editPreset(p) {
    editingPreset = p.id;
    document.getElementById("preset-id").value = p.id;
    document.getElementById("preset-name").value = p.name || "";
    document.getElementById("preset-form-title").textContent = "Preset bearbeiten";
    document.getElementById("preset-cancel-btn").style.display = "";
    const vars = p.variables || {};
    document.getElementById("preset-variables").value = Object.keys(vars).map(k => `${k}=${vars[k]}`).join("\n");
    renderPresetPlaybooks(p.playbook_ids || []);
    renderPresetDevices(p.device_ids || []);
    renderPresetShares(p.shares || []);
}

function resetPresetForm() {
    editingPreset = null;
    const id = document.getElementById("preset-id"); if (id) id.value = "";
    const name = document.getElementById("preset-name"); if (name) name.value = "";
    const vars = document.getElementById("preset-variables"); if (vars) vars.value = "";
    const title = document.getElementById("preset-form-title"); if (title) title.textContent = "Neues Preset";
    const pf = document.getElementById("preset-playbook-filter"); if (pf) pf.value = "";
    renderPresetPlaybooks([]);
    renderPresetDevices([]);
    renderPresetShares([]);
}

//  (#D): Preset-Editor laeuft als Modal. Oeffnen im Erstell- (p=null) oder Bearbeiten-Modus;
// Felder/IDs sind unveraendert, daher greifen editPreset/savePreset/renderPreset* wie zuvor.
function openPresetModal(p) {
    if (p) editPreset(p); else resetPresetForm();
    const dlg = document.getElementById("preset-edit-dialog");
    if (dlg) dlg.classList.remove("hidden");
    const nameEl = document.getElementById("preset-name");
    if (nameEl) { try { nameEl.focus(); } catch (e) {} }
}
function closePresetModal() {
    const dlg = document.getElementById("preset-edit-dialog");
    if (dlg) dlg.classList.add("hidden");
    resetPresetForm();
}

async function savePreset() {
    const name = document.getElementById("preset-name").value.trim();
    if (!name) { showToast("Bitte einen Preset-Namen eingeben."); return; }
    const playbook_ids = Array.from(document.querySelectorAll("#preset-playbooks .preset-playbook:checked")).map(c => c.value);
    if (!playbook_ids.length) { showToast("Bitte mindestens ein Playbook auswählen."); return; }
    const variables = {};
    document.getElementById("preset-variables").value.split(/\r?\n/).forEach(line => {
        const idx = line.indexOf("=");
        if (idx <= 0) return;
        const k = line.slice(0, idx).trim(); const v = line.slice(idx + 1).trim();
        if (k) variables[k] = v;
    });
    const device_ids = Array.from(document.querySelectorAll("#preset-devices .preset-device:checked")).map(c => c.value);
    const shares = Array.from(document.querySelectorAll("#preset-shares .preset-share-cb:checked")).map(cb => {
        const permEl = document.querySelector(`.preset-share-perm[data-guest="${cssEscape(cb.value)}"]`);
        return { guest_id: cb.value, permission: (permEl && permEl.value) || "strict" };
    });
    const payload = { name, playbook_ids, variables, device_ids, shares };
    const path = editingPreset ? `/api/profile/presets/${editingPreset}` : "/api/profile/presets";
    try {
        const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (res.ok) { showToast(editingPreset ? "Preset aktualisiert." : "Preset erstellt."); closePresetModal(); await loadPresets(); }
        else showToast(errorDetailToMessage(data.detail, "Speichern fehlgeschlagen."));
    } catch (e) { showToast("Netzwerkfehler beim Speichern."); }
}

async function deletePresetById(id, name) {
    // : Preset-Name fett in der Bestätigungsfrage.
    const msgHtml = name ? `Möchten Sie das Preset <b>${escapeHtml(name)}</b> wirklich löschen?` : "Preset wirklich löschen?";
    if (!(await showConfirmDialog({ title: "Preset löschen?", messageHtml: msgHtml, confirmLabel: "Löschen" }))) return;
    try {
        const res = await fetch(`/api/profile/presets/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) { showToast("Preset gelöscht."); await loadPresets(); }
        else showToast(errorDetailToMessage(data.detail, "Löschen fehlgeschlagen."));
    } catch (e) { showToast("Netzwerkfehler beim Löschen."); }
}

// Preset ausfuehren: Playbooks im Katalog vorwaehlen, Geraete-Gruppe als Ziel setzen, Run-Modal
// oeffnen. custom_preset_id wird mitgesendet -> der Server loest Playbooks/Variablen/Gruppe auf
// und erzwingt Berechtigung (strict/flexible) + Premium-Gate.
function launchPreset(p) {
    const ids = p.playbook_ids || [];
    if (!ids.length) { showToast("Dieses Preset hat keine Playbooks."); return; }
    const profileDialog = document.getElementById("profile-dialog");
    if (profileDialog && typeof profileDialog.close === "function" && profileDialog.open) profileDialog.close();
    navigateTo("/");
    document.querySelectorAll('#playbooks-list input[name="playbooks"]:checked').forEach(cb => { cb.checked = false; });
    let matched = 0; const missing = [];
    ids.forEach(file => {
        const cb = playbooksList.querySelector(`input[name="playbooks"][value="${cssEscape(file)}"]`);
        if (cb) { cb.checked = true; matched++; checkPlaybookAndDependencies(cb); }
        else missing.push(playbookNameMap[file] || file);
    });
    updatePresetHighlights();
    if (!matched) { showToast("Die Preset-Playbooks sind aktuell nicht im Katalog verfügbar."); return; }
    if (missing.length) showToast(`${missing.length} Playbook(s) nicht verfügbar: ${missing.join(", ")}`);
    // : Eigenes Preset verhält sich wie ein System-Preset — nur Playbooks vorwählen, KEIN
    // Dialog. Die gespeicherten Einstellungen werden beim Öffnen des Run-Dialogs übernommen
    // (showCredentialsModal bezieht userCustomPresets in die activeVariables ein).
    if (p.is_owner) {
        window._activePresetId = null;
        return;
    }
    // Freigegebenes (fremdes) Preset: Dialog öffnen + Server-Bindung (strict/flexible-Durchsetzung).
    window._activePresetId = p.id;
    if (p.permission === "strict") showToast("Strikt freigegebenes Preset – die hinterlegten Werte sind fest.");
    showCredentialsModal();
    // (Device-Flatten): Bei genau EINEM gebundenen Geraet dieses im Dropdown vorwaehlen.
    // Bei mehreren (oder keinem) loest der Server die Zielgeraete aus preset.device_ids auf
    // (custom_preset_id wird mitgesendet) — das Einzel-Dropdown kann Multi-Host nicht abbilden.
    const deviceSelect = document.getElementById("modal-device-select");
    const boundDevs = p.device_ids || [];
    if (deviceSelect && boundDevs.length === 1) {
        deviceSelect.value = boundDevs[0];
        deviceSelect.dispatchEvent(new Event("change"));
    }
}

async function handleProfileUpdateSubmit(e) {
    e.preventDefault();
    const username = document.getElementById("profile-update-username").value.trim();
    const email = document.getElementById("profile-update-email").value.trim();

    try {
        const response = await fetch("/api/profile/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, email })
        });

        const data = await response.json();
        if (response.ok) {
            showToast("Profil erfolgreich aktualisiert.");
            await checkAuthStatus();
        } else {
            showToast(errorDetailToMessage(data.detail, "Profil-Update fehlgeschlagen."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Aktualisieren des Profils.");
    }
}

async function handleProfileExport() {
    try {
        const response = await fetch("/api/profile/export");
        if (response.ok) {
            const data = await response.json();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `ansimate_data_export_${currentUser.username}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            showToast("Datenexport erfolgreich heruntergeladen.");
        }
    } catch (err) {
        showToast("Fehler beim Datenexport.");
    }
}

async function handleDeleteConfirmSubmit(e) {
    e.preventDefault();
    const currentPassword = document.getElementById("delete-confirm-password").value;

    try {
        const response = await fetch("/api/profile/delete-request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_password: currentPassword })
        });

        const data = await response.json();
        if (response.ok) {
            document.getElementById("delete-confirm-dialog").classList.add("hidden");
            document.getElementById("profile-dialog").classList.add("hidden");
            document.getElementById("delete-confirm-form").reset();
            showToast("Konto erfolgreich zur Löschung vorgemerkt.");
            currentUser = null;
            userDevices = [];
            updateAuthUI();
        } else {
            showToast(errorDetailToMessage(data.detail, "Passwort ungültig."));
        }
    } catch (err) {
        showToast("Fehler beim Einleiten der Kontolöschung.");
    }
}

async function handleCancelDeletion() {
    try {
        const response = await fetch("/api/profile/delete-cancel", { method: "POST" });
        const data = await response.json();
        if (response.ok) {
            showToast("Löschungsanfrage erfolgreich storniert.");
            await checkAuthStatus();
        } else {
            showToast(errorDetailToMessage(data.detail, "Stornierung fehlgeschlagen."));
        }
    } catch (err) {
        showToast("Fehler beim Stornieren der Löschung.");
    }
}

// Saved Devices CRUD Handlers
let userDeviceGroups = [];

async function fetchDevices() {
    if (!currentUser) return;
    try {
        const response = await fetch("/api/devices");
        if (response.ok) {
            userDevices = await response.json();
        }
        populateDeviceDropdown();
    } catch (err) {
        console.error("Failed to fetch devices:", err);
    }
}

function populateDeviceDropdown() {
    const select = document.getElementById("modal-device-select");
    if (!select) return;
    // (Device-Flatten): ein Host pro Geraet -> das Dropdown listet Geraete direkt (device_id).
    // Multi-Host laeuft ueber Szenarien (Mehrfachauswahl), nicht ueber dieses Einzel-Dropdown.
    select.innerHTML = '<option value="">-- Manuelle Eingabe --</option>';
    (userDevices || []).forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.id;
        opt.textContent = `${d.name} (${d.host})`;
        select.appendChild(opt);
    });
}

function renderDeviceList() {
    const container = document.getElementById("device-items-list");
    if (!container) return;

    //  (#C): verwaltete Geraete haben ihren eigenen Vault-Tab; im Legacy-#devices-dialog ausblenden.
    const managedDeviceIds = new Set();
    (userDeviceGroups || []).forEach(g => { if (g.managed) (g.device_ids || []).forEach(id => managedDeviceIds.add(id)); });
    const visibleDevices = userDevices.filter(d => !managedDeviceIds.has(d.id));

    if (visibleDevices.length === 0) {
        container.innerHTML = '<div class="no-devices-msg" style="color: var(--text-muted); text-align: center; padding: 40px 0;">Keine Geräte registriert.</div>';
        return;
    }

    container.innerHTML = "";
    visibleDevices.forEach(d => {
        const card = document.createElement("div");
        card.className = "device-item-card";
        card.innerHTML = `
            <div class="device-item-info">
                <span class="device-item-label">${escapeHtml(d.name)}</span>
                <span class="device-item-details">${escapeHtml(d.username || 'default')}@${escapeHtml(d.host)}:${d.port} (${escapeHtml(d.credential_type || 'Kein Login')})</span>
            </div>
            <div class="device-item-actions">
                <button type="button" class="btn-edit-device" data-id="${d.id}" title="Bearbeiten">
                    <span class="material-symbols-outlined">edit</span>
                </button>
                <button type="button" class="btn-delete-device" data-id="${d.id}" title="Löschen">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            </div>
        `;

        card.querySelector(".btn-edit-device").addEventListener("click", () => editDevice(d.id));
        card.querySelector(".btn-delete-device").addEventListener("click", () => deleteDevice(d.id));

        container.appendChild(card);
    });
}

function handleDeviceCredTypeChange() {
    const type = document.getElementById("device-cred-type").value;
    const container = document.getElementById("device-cred-container");
    const textarea = document.getElementById("device-credential");
    const label = document.getElementById("device-cred-label");

    if (type === "password") {
        container.classList.remove("hidden");
        textarea.type = "password";
        textarea.required = true;
        label.textContent = "SSH-Passwort";
    } else if (type === "key") {
        container.classList.remove("hidden");
        textarea.type = "text";
        textarea.required = true;
        label.textContent = "SSH Private Key (PEM)";
    } else {
        container.classList.add("hidden");
        textarea.required = false;
        textarea.value = "";
    }
}

function resetDeviceForm() {
    document.getElementById("device-edit-form").reset();
    document.getElementById("device-id-field").value = "";
    document.getElementById("device-form-title").textContent = "Neues Gerät hinzufügen";
    document.getElementById("device-cancel-edit-btn").classList.add("hidden");
    document.getElementById("device-cred-container").classList.add("hidden");
    //: Become-Feld-Placeholder aus einem evtl. vorherigen Edit zurücksetzen.
    const becomeInput = document.getElementById("device-become-password");
    if (becomeInput) becomeInput.placeholder = "";
}

function editDevice(id) {
    const dev = userDevices.find(d => d.id === id);
    if (!dev) return;

    document.getElementById("device-id-field").value = dev.id;
    document.getElementById("device-name").value = dev.name;
    document.getElementById("device-host").value = dev.host;
    document.getElementById("device-username").value = dev.username || "";
    document.getElementById("device-port").value = dev.port;
    document.getElementById("device-cred-type").value = dev.credential_type || "";
    
    handleDeviceCredTypeChange();
    
    // Credentials field does not fill with plain values for security, but allow replacing
    const textarea = document.getElementById("device-credential");
    if (dev.has_credential) {
        textarea.placeholder = "Anmeldedaten verschlüsselt hinterlegt. Leer lassen, um sie nicht zu ändern.";
        textarea.required = false;
    } else {
        textarea.placeholder = "";
    }

    //: Become-Passwort wird nie im Klartext zurückgegeben; nur Hinweis, ob hinterlegt.
    const becomeInput = document.getElementById("device-become-password");
    if (becomeInput) {
        becomeInput.value = "";
        becomeInput.placeholder = dev.has_become_credential
            ? "Sudo-Passwort hinterlegt. Leer lassen, um es nicht zu ändern."
            : "";
    }

    document.getElementById("device-form-title").textContent = "Gerät bearbeiten";
    document.getElementById("device-cancel-edit-btn").classList.remove("hidden");
}

async function handleDeviceFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("device-id-field").value;
    const name = document.getElementById("device-name").value.trim();
    const host = document.getElementById("device-host").value.trim();
    const username = document.getElementById("device-username").value.trim();
    const port = parseInt(document.getElementById("device-port").value) || 22;
    const credentialType = document.getElementById("device-cred-type").value;
    const credential = document.getElementById("device-credential").value;
    const becomePassword = document.getElementById("device-become-password").value;

    const payload = { name, host, username, port };
    if (credentialType) {
        payload.credential_type = credentialType;
        if (credential) {
            payload.credential = credential;
        }
    } else {
        payload.credential = ""; // Clear credential
    }
    //: Sudo-/Become-Passwort nur senden, wenn eingegeben (leer = unverändert lassen).
    if (becomePassword) {
        payload.become_password = becomePassword;
    }

    try {
        let response;
        if (id) {
            response = await fetch(`/api/devices/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } else {
            response = await fetch("/api/devices", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        }

        const data = await response.json();
        if (response.ok) {
            showToast("Gerät erfolgreich gespeichert.");
            resetDeviceForm();
            await fetchDevices();
        } else {
            showToast(errorDetailToMessage(data.detail, "Fehler beim Speichern des Geräts."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Speichern des Geräts.");
    }
}

async function deleteDevice(id) {
    if (!(await showConfirmDialog({ title: "Gerät löschen?", message: "Möchten Sie dieses Gerät wirklich aus Ihrer Registrierung löschen?", confirmLabel: "Löschen" }))) return;
    try {
        const response = await fetch(`/api/devices/${id}`, { method: "DELETE" });
        if (response.ok) {
            showToast("Gerät erfolgreich gelöscht.");
            await fetchDevices();
        } else {
            const data = await response.json();
            showToast(errorDetailToMessage(data.detail, "Fehler beim Löschen des Geräts."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Löschen des Geräts.");
    }
}

// Stripe Subscriptions & Invoices Handlers






// Admin Control Panel Handlers
function openAdminDashboard() {
    // Admin-Panel ist jetzt eine Inline-Seite (Routing in routePage); nur Tab setzen.
    switchAdminTab("dashboard");
}

function formatBytes(bytes) {
    if (!bytes) return "0 KB";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}





// : Chart-Instanzen + aktiver Zeitraum-Filter für das Dashboard.
const _adminCharts = {};
let _adminChartRange = "7d";
//  (-Feedback): Dashboard-Daten werden EINMAL geladen und gecacht. Die Snapshots
// entstehen serverseitig nur stündlich (capture_stats_snapshot) — ein erneuter Abruf bei
// jedem Tab-Wechsel bzw. routePage-Re-Run wäre reine Verschwendung und trug zu den
// Rate-Limit-/IP-Sperren bei. Aktualisierung nur noch explizit über den „Aktualisieren"-Button.
let _adminStatsCache = null;
const _adminTimeseriesCache = {};  // pro Zeitraum (24h/7d/30d) gecacht

function _destroyChart(key) {
    if (_adminCharts[key]) { _adminCharts[key].destroy(); delete _adminCharts[key]; }
}

//  (-Feedback): Chart-Text/-Gitter aus den AKTIVEN Theme-Variablen lesen, damit die
// Diagramme in Light- UND Dark-Theme lesbar sind. Vorher waren Legende/Achsen fix auf #ccc/
// (für Dark gedacht) — im Light-Theme nahezu unsichtbar. Wird bei jedem (Neu-)Rendern gelesen.
function _chartThemeColors() {
    const cs = getComputedStyle(document.body);
    const v = (name, fb) => (cs.getPropertyValue(name).trim() || fb);
    return {
        text: v("--md-sys-color-on-surface-variant", "#999"),
        grid: v("--md-sys-color-outline-variant", "rgba(128,128,128,0.2)"),
    };
}

// Pie-Diagramme (aktueller Stand) aus den Live-Stats rendern.
function renderDashboardPies(s) {
    const tc = _chartThemeColors();
    const usersPie = document.getElementById("chart-users-pie");
    if (usersPie) {
        _destroyChart("usersPie");
        _adminCharts.usersPie = new Chart(usersPie, {
            type: "doughnut",
            data: {
                labels: ["Aktiv (Paid)", "Aktiv (Trial)", "Inaktiv"],
                datasets: [{ data: [s.active_paid || 0, s.active_trial || 0, s.inactive || 0], backgroundColor: ["#2ecc71", "#f1c40f", "#e74c3c"], borderWidth: 0 }],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: tc.text, boxWidth: 12, font: { size: 11 } } } } },
        });
    }
    const ipPie = document.getElementById("chart-ip-pie");
    if (ipPie) {
        _destroyChart("ipPie");
        const ip = s.ip_blocks || { auto: 0, manual: 0 };
        _adminCharts.ipPie = new Chart(ipPie, {
            type: "doughnut",
            data: {
                labels: ["Automatisch (Rate-Limit)", "Manuell (Admin)"],
                datasets: [{ data: [ip.auto || 0, ip.manual || 0], backgroundColor: ["#3498db", "#9b59b6"], borderWidth: 0 }],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: tc.text, boxWidth: 12, font: { size: 11 } } } } },
        });
    }
}

// Verlaufsgraphen (Linien) aus den Snapshots im gewählten Zeitraum.
//  (-Feedback): pro Zeitraum gecacht — beim ersten Anzeigen einer Range einmal
// laden, danach aus dem Cache rendern. `force` (Aktualisieren-Button) umgeht den Cache.
async function loadDashboardTimeseries(force = false) {
    if (!force && _adminTimeseriesCache[_adminChartRange]) {
        renderDashboardTimeseries(_adminTimeseriesCache[_adminChartRange]);
        return;
    }
    let rows = [];
    try {
        const r = await fetch(`/api/admin/stats/timeseries?range=${encodeURIComponent(_adminChartRange)}`);
        if (r.ok) rows = await r.json();
    } catch (e) { /* leer lassen */ }
    _adminTimeseriesCache[_adminChartRange] = rows;
    renderDashboardTimeseries(rows);
}

function renderDashboardTimeseries(rows) {
    const tc = _chartThemeColors();
    const labels = rows.map(x => new Date(x.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" }));
    const lineOpts = { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom", labels: { color: tc.text, boxWidth: 12, font: { size: 11 } } } },
        scales: { x: { ticks: { color: tc.text, maxTicksLimit: 8, font: { size: 10 } }, grid: { color: tc.grid } },
                  y: { beginAtZero: true, ticks: { color: tc.text, font: { size: 10 } }, grid: { color: tc.grid } } } };
    const mkLine = (canvasId, key, datasets) => {
        const el = document.getElementById(canvasId);
        if (!el) return;
        _destroyChart(key);
        _adminCharts[key] = new Chart(el, { type: "line", data: { labels, datasets }, options: lineOpts });
    };
    const ds = (label, field, color) => ({ label, data: rows.map(x => x[field]), borderColor: color, backgroundColor: color + "33", tension: 0.3, pointRadius: rows.length > 30 ? 0 : 2, borderWidth: 2 });
    mkLine("chart-users-line", "usersLine", [
        ds("Gesamt", "total", "#1abc9c"), ds("Paid", "paid", "#2ecc71"), ds("Trial", "trial", "#f1c40f"), ds("Inaktiv", "inactive", "#e74c3c"),
    ]);
    mkLine("chart-ip-line", "ipLine", [ ds("IP-Sperren", "ip_total", "#3498db") ]);
    mkLine("chart-storage-line", "storageLine", [
        { label: "Speicher (MB)", data: rows.map(x => Math.round((x.storage || 0) / 1024 / 1024 * 10) / 10), borderColor: "#9b59b6", backgroundColor: "#9b59b633", tension: 0.3, pointRadius: rows.length > 30 ? 0 : 2, borderWidth: 2 },
    ]);
}

async function fetchAdminStats(force = false) {
    const cfg = document.getElementById("admin-config-status");
    //  (-Feedback): einmal laden, danach aus dem Cache rendern — kein erneuter Abruf
    // bei jedem Dashboard-Aufruf bzw. routePage-Re-Run. `force` = Aktualisieren-Button.
    if (!force && _adminStatsCache) {
        renderAdminStats(_adminStatsCache, false);
        return;
    }
    try {
        const res = await fetch("/api/admin/stats");
        if (!res.ok) { if (cfg) cfg.innerHTML = '<p style="color:var(--md-sys-color-error);">Fehler beim Laden.</p>'; return; }
        const s = await res.json();
        _adminStatsCache = s;
        renderAdminStats(s, force);
    } catch (e) {
        if (cfg) cfg.innerHTML = '<p style="color:var(--md-sys-color-error);">Netzwerkfehler.</p>';
    }
}

function renderAdminStats(s, force = false) {
    const cfg = document.getElementById("admin-config-status");
    // : statische Text-Kacheln durch Diagramme ersetzt (Pies + Verlauf).
    renderDashboardPies(s);
    loadDashboardTimeseries(force);

        const chip = (label, ok, okText, badText) => {
            const color = ok ? "#2ecc71" : "#e74c3c";
            const txt = ok ? (okText || "aktiv") : (badText || "inaktiv");
            return `<div style="display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:8px 12px;">
                <span style="width:9px; height:9px; border-radius:50%; background:${color}; display:inline-block;"></span>
                <span style="font-size:13px;">${label}: <strong style="color:${color};">${txt}</strong></span></div>`;
        };
        const cf = s.config || {};
        // : farbiger Chip mit beliebiger Ampel-Farbe (grün/gelb/rot).
        const chipColored = (label, color, txt) => `<div style="display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:8px 12px;">
                <span style="width:9px; height:9px; border-radius:50%; background:${color}; display:inline-block;"></span>
                <span style="font-size:13px;">${label}: <strong style="color:${color};">${escapeHtml(txt)}</strong></span></div>`;
        // : die 3 Stripe-Kacheln (Modus/Verbindung/Signaturprüfung) zu EINER Ampel
        // konsolidiert. Grün = Live + Webhook + Verbindung ok; Gelb = ok aber Test/Webhook fehlt;
        // Rot = Mock/keine Schlüssel oder Verbindungsfehler.
        const sconn = cf.stripe_connection || {};
        let stColor, stTxt;
        if (cf.stripe_mock) {
            stColor = "#e74c3c"; stTxt = "Inaktiv (Mock / keine Schlüssel)";
        } else if (sconn.status === "error") {
            stColor = "#e74c3c"; stTxt = "Fehler" + (sconn.detail ? `: ${String(sconn.detail).slice(0, 80)}` : "");
        } else if (sconn.status === "ok") {
            if (cf.stripe_livemode && cf.stripe_signature_check) {
                stColor = "#2ecc71"; stTxt = "Aktiv – Live" + (sconn.account ? ` (${sconn.account})` : "");
            } else {
                stColor = "#f1c40f"; stTxt = cf.stripe_livemode ? "Live – Webhook fehlt" : "Aktiv – Test";
            }
        } else {
            stColor = "#e74c3c"; stTxt = "Inaktiv / unbekannt";
        }
        //  (Community): editionsabhängige Status-Kacheln.
        //  - Stripe: nur Cloud (Billing existiert nur dort).
        //  - Captcha: nur Cloud.
        //  - E-Mail-Verifikation: Cloud + On-Premise (in Community ausgeblendet).
        let _chips = chip("SMTP", cf.smtp, "konfiguriert", "nicht konfiguriert");
        if (currentEdition === "cloud") _chips += chipColored("Stripe", stColor, stTxt);
        if (currentEdition === "cloud") _chips += chip("Captcha", cf.captcha, "an", "aus");
        if (currentEdition !== "community") _chips += chip("E-Mail-Verifikation", cf.email_verification, "an", "aus");
        _chips += chip("API-Docs", cf.api_docs, "an", "aus");
        cfg.innerHTML = _chips;
            // : Wartungsmodus-Kachel entfernt (durch Banner + Tab-Indikatoren abgedeckt).
        //: auffaelliger Banner oben, sichtbar wenn der Stripe-Mock-/Demo-Modus aktiv ist.
        // Stripe-/Billing-Mock-Banner nur in der Cloud-Edition; Community/On-Premise haben kein
        // Billing (zusaetzlich blendet die .cloud-only-Klasse ihn editionsweit aus).
        const mockBanner = document.getElementById("admin-mock-banner");
        if (mockBanner) mockBanner.classList.toggle("hidden", !(cf.stripe_mock && currentEdition === "cloud"));
}

function switchAdminTab(tabName) {
    //  (Community): kein Benutzer-Tab -> Auswahl auf die Startseite umleiten.
    if (currentEdition === "community" && tabName === "users") tabName = "dashboard";
    const contents = document.querySelectorAll(".admin-tab-content");
    contents.forEach(c => c.classList.add("hidden"));

    const buttons = document.querySelectorAll(".tab-btn");
    buttons.forEach(btn => {
        if (btn.id.startsWith("admin-tab-")) {
            btn.classList.remove("active");
            btn.style.color = "rgba(255,255,255,0.7)";
            btn.style.borderBottom = "none";
        }
    });

    const activeContent = document.getElementById(`admin-tab-${tabName}`);
    if (activeContent) {
        activeContent.classList.remove("hidden");
    }

    const activeBtn = document.getElementById(`admin-tab-${tabName}-btn`);
    if (activeBtn) {
        activeBtn.classList.add("active");
        activeBtn.style.color = "var(--md-sys-color-primary)";
        activeBtn.style.borderBottom = "2px solid var(--md-sys-color-primary)";
    }

    // : Admin-FAB je Tab konfigurieren (Aktion via onAdminFab).
    currentAdminTab = tabName;
    updateAdminFab(tabName);

    if (tabName === "dashboard") {
        fetchAdminStats();
    } else if (tabName === "users") {
        fetchAdminUsers();
    } else if (tabName === "config") {
        fetchAdminConfig();
    } else if (tabName === "ip") {
        fetchAdminIPBlocks();
    } else if (tabName === "security") {
        // : Tab „Protokolle" lädt beide Sektionen (Ungewöhnliche Aktivitäten + Audit-Log).
        fetchSecurityAlerts();
        fetchAuditLog();
        fetchAdminIPBlocks();  // : IP-Sperren-Verlauf liegt jetzt in diesem Tab.
        prefillGobdDates();  // : GoBD-Export liegt jetzt in diesem Tab.
    } else if (tabName === "tariffs") {
        fetchTariffs();
    } else if (tabName === "coupons") {
        fetchCoupons();
    } else if (tabName === "billing") {
        fetchBillingInvoices();  // : Stripe-Buchungen (Cloud)
    }
}

// : aktiver Admin-Tab + FAB-Steuerung (Label/Icon/Sichtbarkeit je Tab).
let currentAdminTab = "dashboard";

// Pro Tab: Icon, Label und Aktion des Admin-FAB. Tabs ohne Eintrag -> FAB ausgeblendet (.fab-off).
const ADMIN_FAB_CONFIG = {
    users: { icon: "person_add", label: "Benutzer erstellen" },
    security: { icon: "download", label: "Protokolle exportieren" },
    tariffs: { icon: "add", label: "Tarif erstellen" },
    coupons: { icon: "add", label: "Gutschein erstellen" },
    ip: { icon: "block", label: "IP-Sperre hinzufügen" },  // 
    config: { icon: "save", label: "Einstellungen speichern" },  // : speichert direkt
};

function updateAdminFab(tabName) {
    const fab = document.getElementById("admin-fab");
    if (!fab) return;
    const cfg = ADMIN_FAB_CONFIG[tabName];
    if (!cfg) { fab.classList.add("fab-off"); return; }
    fab.classList.remove("fab-off");
    const icon = document.getElementById("admin-fab-icon");
    const label = document.getElementById("admin-fab-label");
    if (icon) icon.textContent = cfg.icon;
    if (label) label.textContent = cfg.label;
}

function onAdminFab() {
    if (currentAdminTab === "users") openAdminUserCreateDialog();
    else if (currentAdminTab === "security") openAdminExportDialog();
    else if (currentAdminTab === "tariffs") { if (typeof openTariffCreateDialog === "function") openTariffCreateDialog(); }
    else if (currentAdminTab === "coupons") { if (typeof openCouponCreateDialog === "function") openCouponCreateDialog(); }
    else if (currentAdminTab === "ip") openIpBlockDialog();  // 
    else if (currentAdminTab === "config") handleAdminConfigSubmit({ preventDefault() {} });  // : direkt speichern
}

// : IP-Sperre-Dialog.
function openIpBlockDialog() {
    const f = document.getElementById("admin-ip-ban-form");
    if (f) f.reset();
    const dlg = document.getElementById("admin-ip-dialog");
    if (dlg) { dlg.dataset.dirty = ""; dlg.classList.remove("hidden"); }
}
function closeIpBlockDialog() {
    const dlg = document.getElementById("admin-ip-dialog");
    if (dlg) dlg.classList.add("hidden");
}

//  (#A): Tab-Wechsel innerhalb von "My Vault". Klon von switchAdminTab (gleiche tab-btn-
// Inline-Style-Konvention), ABER mit history.replaceState statt rekursivem routePage-Aufruf —
// sonst Bounce-Risiko mit dem 5s-History-Poll (vgl.). Per-Tab-Loader laden den Inhalt.
// ===========================================================================
// : Szenarios — ein Preset (Rezept) + ein festes Zielgerät, 1-Klick-Deployment.
// Ausgeführt über den bestehenden /api/run-Pfad (custom_preset_id + device_group_id).
// ===========================================================================
let editingScenario = null;
let userScenarioPresets = [];
// (Device-Flatten): Zielgeraete-Auswahl aus der flachen Geraeteliste (statt Gruppen).
let userScenarioDevices = [];

async function loadScenarios() {
    if (!currentUser) return;
    const listEl = document.getElementById("scenarios-list");
    try {
        const [scRes, pRes, dRes, scenarioGuests] = await Promise.all([
            fetch("/api/profile/scenarios"),
            fetch("/api/profile/presets"),
            fetch("/api/devices"),
            fetchGuestList(),
        ]);
        const scenarios = scRes.ok ? await scRes.json() : [];
        userScenarioPresets = pRes.ok ? await pRes.json() : [];
        userScenarioDevices = dRes.ok ? await dRes.json() : [];
        window._scenarioGuests = scenarioGuests;
        populateScenarioSelects();
        renderScenariosList(scenarios);
        //: Startseiten-Abschnitt "Szenarios" synchron halten (nach Anlegen/Bearbeiten/Löschen).
        userScenarios = scenarios;
        if (typeof renderPlaybooks === "function" && allPlaybooks && allPlaybooks.length) renderPlaybooks();
        //: nur das Preset ist Voraussetzung; Zielgeraete sind optional (geräteloses Szenario).
        const missing = !userScenarioPresets.length;
        const hint = document.getElementById("scenario-empty-hint");
        //: In der Community-Edition verweist der Hinweis auf den ausgeblendeten Presets-Tab und
        // ist irrefuehrend — Szenarien entstehen dort komplett ueber den Wizard (Gerät optional). Aus.
        if (hint) hint.classList.toggle("hidden", !missing || currentEdition === "community");
        const saveBtn = document.getElementById("scenario-save-btn");
        if (saveBtn) saveBtn.disabled = missing;
    } catch (e) {
        if (listEl) listEl.innerHTML = '<p style="color:var(--md-sys-color-error);">Netzwerkfehler beim Laden der Szenarien.</p>';
    }
}

function populateScenarioSelects() {
    //: nur noch das Preset-Select (die Geraeteauswahl laeuft ueber den Wizard-Schritt 3).
    const pSel = document.getElementById("scenario-preset-select");
    if (pSel) {
        const cur = pSel.value;
        pSel.innerHTML = userScenarioPresets.length
            ? userScenarioPresets.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")
            : '<option value="">— kein Preset vorhanden —</option>';
        if (cur) pSel.value = cur;
    }
}

// : Freigabe-Steuerung im Szenario-Formular (gespiegelt von renderPresetShares).
// : Freigabe-Liste des Szenario-Freigabe-Dialogs (#scenario-share-list).
function renderScenarioShareList(shares) {
    const sc = document.getElementById("scenario-share-list");
    if (!sc) return;
    const guests = window._scenarioGuests || [];
    const byGuest = {};
    (shares || []).forEach(s => { byGuest[s.guest_id] = s.permission || "strict"; });
    if (!guests.length) { sc.innerHTML = '<p style="color: var(--text-muted); font-size: 12px;">Keine Teammitglieder vorhanden.</p>'; return; }
    sc.innerHTML = "";
    guests.forEach(g => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:6px;";
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "styled-checkbox scenario-share-cb"; cb.value = g.id;
        cb.checked = byGuest[g.id] !== undefined;
        const name = document.createElement("span");
        name.style.cssText = "flex:1; min-width:0; font-size:12px;";
        name.textContent = `${g.username} (${g.email})`;
        const perm = document.createElement("select");
        perm.className = "scenario-share-perm"; perm.dataset.guest = g.id;
        perm.style.cssText = "padding:4px 6px; font-size:12px; background: rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:4px; color:#fff;";
        perm.innerHTML = '<option value="strict">strikt (nur ausführen)</option><option value="flexible">flexibel (anpassbar)</option>';
        perm.value = byGuest[g.id] || "strict";
        row.appendChild(cb); row.appendChild(name); row.appendChild(perm);
        sc.appendChild(row);
    });
}

// : Aktions-Button mit Icon für die My-Vault-Listen (Freigeben/Bearbeiten/Löschen).
function vaultActionButton(label, icon, variant) {
    const b = document.createElement("button");
    b.type = "button";
    if (variant === "danger") {
        b.className = "btn btn-small";
        b.style.cssText = "background: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent); border-color: color-mix(in srgb, var(--md-sys-color-primary) 50%, transparent); color: var(--md-sys-color-primary);";
    } else {
        b.className = "btn btn-" + (variant || "secondary") + " btn-small";
    }
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; margin-right:4px;">${icon}</span>${escapeHtml(label)}`;
    return b;
}

// : einheitliches Zielgerät-Label für Liste UND Startseiten-Kacheln.
// Gerät zugewiesen -> Gerätename; gerätelos -> „beim Ausführen festlegen".
function scenarioTargetLabel(s) {
    return s.device_optional ? "beim Ausführen festlegen" : (s.device_name || "?");
}

function renderScenariosList(scenarios) {
    const c = document.getElementById("scenarios-list");
    if (!c) return;
    if (!scenarios || !scenarios.length) {
        c.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">Keine Szenarien angelegt.</p>';
        return;
    }
    c.innerHTML = "";
    scenarios.forEach(s => {
        const div = document.createElement("div");
        // : kein margin-bottom -> Abstand nur über den Container-gap (8px), exakt wie
        // die Playbooks-/Geräte-Liste (sonst doppelter Abstand: gap + margin).
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; background:rgba(255,255,255,0.02); font-size:13px;";
        // /: Freigeben (eigener Dialog) + Bearbeiten links, Löschen rechts,
        // mit Icons. Ausführen läuft über die Startseite.
        const leftGroup = document.createElement("div");
        leftGroup.style.cssText = "display:flex; align-items:center; gap:8px; min-width:0;";
        //: In der Community-Edition kein „Freigeben" (keine weiteren Benutzer/Teams).
        if (currentEdition !== "community") {
            const share = vaultActionButton("Freigeben", "share", "primary");
            share.addEventListener("click", () => openScenarioShareDialog(s));
            leftGroup.appendChild(share);
        }
        const edit = vaultActionButton("Bearbeiten", "edit", "secondary");
        edit.addEventListener("click", () => editScenario(s));
        leftGroup.appendChild(edit);
        const info = document.createElement("div");
        info.style.minWidth = "0";
        // : gerätelos -> "Gerät beim Ausführen" statt "?".
        // : Subtitel nur „→ Zielgerät" (Preset-Name nicht mehr wiederholen).
        const meta = s.valid
            ? `→ ${escapeHtml(scenarioTargetLabel(s))}`
            : "Preset oder Gerät gelöscht – bitte bearbeiten";
        // : kompakte Metadaten (Anzahl Playbooks/Geräte/freigegebene Benutzer) wie in anderen Listen.
        const counts = [];
        if (typeof s.playbook_count === "number") counts.push(`${s.playbook_count} Playbook${s.playbook_count === 1 ? "" : "s"}`);
        if (!s.device_optional && typeof s.device_count === "number") counts.push(`${s.device_count} Gerät${s.device_count === 1 ? "" : "e"}`);
        if (currentEdition !== "community" && typeof s.shared_count === "number") counts.push(`für ${s.shared_count} Benutzer freigegeben`);
        const countsHtml = counts.length
            ? `<div style="color:var(--text-muted); font-size:11px;">${counts.join(" &middot; ")}</div>`
            : "";
        info.innerHTML = `<div style="font-weight:bold; color:var(--md-sys-color-primary);">${escapeHtml(s.name)}</div>` +
            `<div style="color:var(--text-secondary); font-size:12px;">${meta}</div>` +
            countsHtml;
        leftGroup.appendChild(info);
        div.appendChild(leftGroup);
        const right = document.createElement("div");
        right.style.whiteSpace = "nowrap";
        const del = vaultActionButton("Löschen", "delete", "danger");
        del.addEventListener("click", () => deleteScenarioById(s.id, s.name));
        right.appendChild(del);
        div.appendChild(right);
        c.appendChild(div);
    });
}

function resetScenarioForm() {
    editingScenario = null;
    const name = document.getElementById("scenario-name");
    if (name) name.value = "";
    const title = document.getElementById("scenario-form-title");
    if (title) title.textContent = "Neues Szenario";
    const saveBtn = document.getElementById("scenario-save-btn");
    if (saveBtn) saveBtn.textContent = "Speichern";
    // : Abbrechen ist im Dialog immer sichtbar (schließt den Dialog).
}

// : Bearbeiten öffnet denselben Wizard wie das Erstellen, mit vorbefüllten Werten
// (Name, Playbooks, Variablen, Gerät, Freigaben). Der alte #scenario-dialog wird nicht mehr genutzt.
function editScenario(s) {
    if (s.valid === false && !s.preset_name) {
        // Preset gelöscht -> Playbooks/Variablen lassen sich nicht vorbefüllen; trotzdem bearbeitbar
        // (der Wizard legt beim Speichern ein neues Preset an).
        showToast("Das Preset dieses Szenarios fehlt – bitte Playbooks neu auswählen.");
    }
    openScenarioWizard(s);
}

async function saveScenario() {
    const name = (document.getElementById("scenario-name").value || "").trim();
    const presetId = document.getElementById("scenario-preset-select").value;
    const deviceGroupId = document.getElementById("scenario-device-select").value;
    if (!name) { showToast("Bitte einen Namen vergeben."); return; }
    // : Zielgerät optional (leer = geräteloses Szenario); nur das Preset ist Pflicht.
    if (!presetId) { showToast("Bitte ein Preset wählen."); return; }
    // : Freigaben laufen über den eigenen Freigabe-Dialog -> hier NICHT mitsenden
    // (Backend lässt shares bei None unverändert). Beim Neuanlegen startet das Szenario ohne Freigaben.
    const payload = { name, preset_id: presetId, device_group_id: deviceGroupId || null };
    const url = editingScenario ? `/api/profile/scenarios/${editingScenario}` : "/api/profile/scenarios";
    try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(errorDetailToMessage(d.detail, "Speichern fehlgeschlagen.")); }
        showToast(editingScenario ? "Szenario aktualisiert." : "Szenario erstellt.");
        closeScenarioDialog();  // 
        await loadScenarios();
    } catch (e) {
        showToast(e.message);
    }
}

async function deleteScenarioById(id, name) {
    // : Szenario-Name fett in der Bestätigungsfrage.
    const msgHtml = name ? `Möchten Sie das Szenario <b>${escapeHtml(name)}</b> wirklich löschen?` : "Szenario wirklich löschen?";
    if (!(await showConfirmDialog({ title: "Szenario löschen?", messageHtml: msgHtml, confirmLabel: "Löschen" }))) return;
    try {
        const res = await fetch(`/api/profile/scenarios/${id}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(errorDetailToMessage(d.detail, "Löschen fehlgeschlagen.")); }
        showToast("Szenario gelöscht.");
        if (editingScenario === id) resetScenarioForm();
        await loadScenarios();
    } catch (e) {
        showToast(e.message);
    }
}

// /: 1-Klick-Ausführung über scenario_id — der Server löst Preset (Playbooks +
// Variablen) und festes Zielgerät auf und erzwingt Freigabe/Berechtigung (auch für Gäste).
// : Bestätigungs-Dialog vor dem Start;: geräteloses Szenario -> Einmal-Geräte-Dialog.
async function runScenario(s) {
    if (s.valid === false) { showToast("Preset oder Gerät fehlt – bitte das Szenario bearbeiten."); return; }
    // : Szenario-Name und Zielgerät in Akzentfarbe hervorheben (Werte via escapeHtml entschärft).
    const accent = (txt) => `<b style="color: var(--md-sys-color-primary);">${escapeHtml(txt)}</b>`;
    const messageHtml = s.device_optional
        ? `Szenario ${accent(s.name)} jetzt ausführen? Das Zielgerät wird im nächsten Schritt eingegeben.`
        : `Szenario ${accent(s.name)} jetzt auf ${accent(s.device_name || "dem hinterlegten Gerät")} ausführen?`;
    const ok = await showConfirmDialog({ title: "Szenario ausführen", messageHtml, confirmLabel: "Ausführen" });
    if (!ok) return;
    if (s.device_optional) { openScenarioRunDeviceDialog(s); return; }
    await executeScenarioRun(s, {});
}

// : geräteloses Szenario -> Host/SSH einmalig erfragen (nicht persistiert) und mitsenden.
let scenarioRunPending = null;
function openScenarioRunDeviceDialog(s) {
    scenarioRunPending = s;
    const t = document.getElementById("scenario-run-device-title");
    if (t) t.textContent = `Szenario „${s.name}" ausführen`;
    ["scenario-run-host", "scenario-run-user", "scenario-run-password", "scenario-run-basedir"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    // Autofill-Sperre zuruecksetzen: base_dir leitet sich wieder vom Benutzernamen ab.
    const _srBaseDir = document.getElementById("scenario-run-basedir");
    if (_srBaseDir) _srBaseDir.dataset.edited = "false";
    _resetScenarioRunKeyUpload();  // 
    const dlg = document.getElementById("scenario-run-device-dialog"); if (dlg) dlg.classList.remove("hidden");
}
// : Key-Upload des Einmal-Geräte-Dialogs zurücksetzen (Auswahl leeren + Entfernen-Button verstecken).
function _resetScenarioRunKeyUpload() {
    const keyFile = document.getElementById("scenario-run-key-file");
    if (keyFile) keyFile.value = "";
    const lbl = document.getElementById("scenario-run-key-filename-lbl");
    if (lbl) lbl.textContent = "Keine Datei ausgewählt";
    const reset = document.getElementById("scenario-run-key-reset");
    if (reset) reset.classList.add("hidden");
}
function closeScenarioRunDeviceDialog() {
    const dlg = document.getElementById("scenario-run-device-dialog"); if (dlg) dlg.classList.add("hidden");
    scenarioRunPending = null;
}
async function submitScenarioRunDevice() {
    if (!scenarioRunPending) return;
    const host = (document.getElementById("scenario-run-host").value || "").trim();
    const user = (document.getElementById("scenario-run-user").value || "").trim();
    const password = document.getElementById("scenario-run-password").value || "";
    //: optionales Sudo-/Become-Passwort für diesen Lauf.
    const becomeEl = document.getElementById("scenario-run-become");
    const becomePassword = becomeEl ? (becomeEl.value || "") : "";
    if (!host) { showToast("Bitte Host/IP angeben."); return; }
    if (!user) { showToast("Bitte SSH-Benutzer angeben."); return; }
    // : optionaler SSH-Key (Vorrang vor Passwort); nur für diesen Lauf, nicht gespeichert.
    let ssh_key = "";
    const keyInput = document.getElementById("scenario-run-key-file");
    const keyFile = keyInput && keyInput.files && keyInput.files[0];
    if (keyFile) {
        try { ssh_key = await readFileAsText(keyFile); }
        catch (e) { showToast("SSH-Key konnte nicht gelesen werden."); return; }
        if (!ssh_key || !ssh_key.trim()) { showToast("Die gewählte Key-Datei ist leer."); return; }
    }
    if (!password && !ssh_key) { showToast("Bitte ein Passwort eingeben oder einen SSH-Key hochladen."); return; }
    // Basisverzeichnis ist optional; leer lassen wir weg, damit der Server auf das
    // Heimatverzeichnis des SSH-Benutzers zurueckfallen kann.
    const baseDir = (document.getElementById("scenario-run-basedir").value || "").trim();
    const s = scenarioRunPending;
    closeScenarioRunDeviceDialog();
    await executeScenarioRun(s, { target_host: host, username: user, password, ssh_key, become_password: becomePassword, base_dir: baseDir });
}

async function executeScenarioRun(s, extra) {
    try {
        // base_dir gehoert in die Run-Variablen (nicht als Top-Level-Feld); der Server merged es
        // bei flexibler Berechtigung ueber die Preset-Variablen. Leeres base_dir weglassen, damit
        // serverseitig der Heimatverzeichnis-Fallback greift.
        const { base_dir, ...rest } = extra || {};
        const variables = base_dir ? { base_dir } : undefined;
        const res = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // playbooks ist im RunRequest Pflichtfeld (Pydantic-Validierung vor dem Handler);
            // der Server ersetzt es serverseitig durch die Playbooks des Szenario-Presets.
            body: JSON.stringify({ playbooks: [], scenario_id: s.id, session_id: sessionId, ...rest, ...(variables ? { variables } : {}) })
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(errorDetailToMessage(d.detail, "Start fehlgeschlagen.")); }
        const result = await res.json();
        showToast(`Szenario „${s.name}" gestartet.`);
        const btnHistory = document.getElementById("nav-btn-history");
        if (btnHistory) btnHistory.disabled = false;
        selectedJobId = result.job_id;
        streamLogs(result.job_id);
        setTab("history");
        await refreshHistory();
        startHistoryPolling();
    } catch (e) {
        showToast(e.message);
    }
}

// : eigener Freigabe-Dialog fuer ein Szenario (entkoppelt vom Bearbeiten).
let sharingScenario = null;
function openScenarioShareDialog(s) {
    sharingScenario = s;
    const nm = document.getElementById("scenario-share-name");
    if (nm) nm.textContent = s.name;
    renderScenarioShareList(s.shares || []);
    const dlg = document.getElementById("scenario-share-dialog");
    if (dlg) dlg.classList.remove("hidden");
}

function closeScenarioShareDialog() {
    const dlg = document.getElementById("scenario-share-dialog");
    if (dlg) dlg.classList.add("hidden");
    sharingScenario = null;
}

async function saveScenarioShares() {
    if (!sharingScenario) return;
    const shares = Array.from(document.querySelectorAll("#scenario-share-list .scenario-share-cb:checked")).map(cb => {
        const permEl = document.querySelector(`.scenario-share-perm[data-guest="${cssEscape(cb.value)}"]`);
        return { guest_id: cb.value, permission: (permEl && permEl.value) || "strict" };
    });
    try {
        const res = await fetch(`/api/profile/scenarios/${sharingScenario.id}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: sharingScenario.name, preset_id: sharingScenario.preset_id, device_ids: sharingScenario.device_ids || [], shares })
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(errorDetailToMessage(d.detail, "Freigabe fehlgeschlagen.")); }
        showToast("Freigabe gespeichert.");
        closeScenarioShareDialog();
        await loadScenarios();
    } catch (e) {
        showToast(e.message);
    }
}

function switchVaultTab(tabName) {
    // : Presets-Tab vorerst deaktiviert/ausgeblendet -> nicht mehr ansteuerbar
    // (auch nicht über /vault/presets); Aufrufe landen auf dem Default-Tab „Szenarios".
    //: In der Community-Edition entfaellt zusaetzlich der Playbooks-Tab (Custom-Upload
    // Backend-gesperrt) -> nur Szenarien + Geraete sind ansteuerbar.
    const valid = currentEdition === "community" ? ["scenarios", "devices"] : ["scenarios", "playbooks", "devices"];
    if (!valid.includes(tabName)) tabName = "scenarios";

    document.querySelectorAll(".vault-tab-content").forEach(c => c.classList.add("hidden"));
    document.querySelectorAll(".tab-btn").forEach(btn => {
        if (btn.id.startsWith("vault-tab-")) {
            btn.classList.remove("active");
            btn.style.color = "rgba(255,255,255,0.7)";
            btn.style.borderBottom = "none";
        }
    });

    const activeContent = document.getElementById(`vault-tab-${tabName}`);
    if (activeContent) activeContent.classList.remove("hidden");
    const activeBtn = document.getElementById(`vault-tab-${tabName}-btn`);
    if (activeBtn) {
        activeBtn.classList.add("active");
        activeBtn.style.color = "var(--md-sys-color-primary)";
        activeBtn.style.borderBottom = "2px solid var(--md-sys-color-primary)";
    }

    // URL auf /vault/<tab> spiegeln, OHNE routePage erneut aufzurufen (kein Rekursions-/Bounce-Bug).
    const wanted = `/vault/${tabName}`;
    if (window.location.pathname !== wanted) history.replaceState({}, "", wanted);

    // Per-Tab-Inhalt laden.
    if (tabName === "playbooks") {
        fetchCustomPlaybooks();
    } else if (tabName === "devices") {
        loadManagedDevicesTab();
    } else if (tabName === "presets") {
        //  (#D): Eigene-Presets-Liste (jetzt im Vault) laden; Editor laeuft als Modal #preset-edit-dialog.
        loadPresets();
    } else if (tabName === "scenarios") {
        // : Szenarien laden + Preset-/Geräte-Auswahl des Formulars befüllen.
        loadScenarios();
    }
    // : FAB-Beschriftung je Tab + aktiven Tab merken (für die FAB-Aktion).
    currentVaultTab = tabName;
    const fabLabel = document.getElementById("vault-fab-label");
    if (fabLabel) {
        const labels = { playbooks: "Playbook hochladen", devices: "Gerät hinzufügen", presets: "Preset erstellen", scenarios: "Szenario erstellen" };
        fabLabel.textContent = labels[tabName] || "Hinzufügen";
    }
}

// : aktiver My-Vault-Tab (steuert die FAB-Aktion).
let currentVaultTab = "playbooks";

function onVaultFab() {
    if (currentVaultTab === "playbooks") openCustomPbCreateDialog();
    else if (currentVaultTab === "devices") openManagedDeviceCreate();
    else if (currentVaultTab === "presets") openPresetWizard();  // : Erstellen über den Wizard
    else if (currentVaultTab === "scenarios") openScenarioWizard();  // : Erstellen über den Szenario-Wizard
}

// --- Playbook-Hochladen-Dialog ---
function openCustomPbCreateDialog() {
    const form = document.getElementById("custom-playbook-upload-form");
    if (form) form.reset();
    const fl = document.getElementById("custom-playbook-filename-lbl"); if (fl) fl.textContent = "Keine Datei ausgewählt";
    const il = document.getElementById("custom-pb-icon-filename-lbl"); if (il) il.textContent = "Keine Datei ausgewählt";
    ["custom-playbook-reset", "custom-pb-icon-reset"].forEach(id => { const b = document.getElementById(id); if (b) b.classList.add("hidden"); });
    const d = document.getElementById("custom-pb-create-dialog"); if (d) d.classList.remove("hidden");
}
function closeCustomPbCreateDialog() {
    const d = document.getElementById("custom-pb-create-dialog"); if (d) d.classList.add("hidden");
}

// --- Geräte-Dialog ---
function openManagedDeviceDialog() { const d = document.getElementById("managed-device-dialog"); if (d) d.classList.remove("hidden"); }
function closeManagedDeviceDialog() { const d = document.getElementById("managed-device-dialog"); if (d) d.classList.add("hidden"); resetManagedDeviceForm(); }
function openManagedDeviceCreate() { resetManagedDeviceForm(); openManagedDeviceDialog(); }

// --- Szenario-Dialog ---
function openScenarioDialog() { const d = document.getElementById("scenario-dialog"); if (d) d.classList.remove("hidden"); }
function closeScenarioDialog() { const d = document.getElementById("scenario-dialog"); if (d) d.classList.add("hidden"); resetScenarioForm(); }
function openScenarioCreate() { resetScenarioForm(); populateScenarioSelects(); openScenarioDialog(); }

// ===========================================================================
// : Preset-Erstell-Wizard — Schritt 1 Playbooks, 2 Einstellungen, 3 Freigeben.
// Erstellen-only; Bearbeiten/Freigeben bestehender Presets läuft weiter über #preset-edit-dialog.
// ===========================================================================
let presetWizardStep = 1;
let presetWizardSelected = new Set();

function openPresetWizard() {
    presetWizardStep = 1;
    presetWizardSelected = new Set();
    const nm = document.getElementById("preset-wizard-name"); if (nm) nm.value = "";
    const f = document.getElementById("preset-wizard-pb-filter"); if (f) f.value = "";
    renderWizardPlaybooks("");
    const cfg = document.getElementById("preset-wizard-config"); if (cfg) cfg.innerHTML = "";
    const sh = document.getElementById("preset-wizard-shares"); if (sh) sh.innerHTML = "";
    presetWizardGoTo(1);
    const dlg = document.getElementById("preset-wizard-dialog"); if (dlg) dlg.classList.remove("hidden");
}
function closePresetWizard() {
    const dlg = document.getElementById("preset-wizard-dialog"); if (dlg) dlg.classList.add("hidden");
}
function presetWizardGoTo(step) {
    presetWizardStep = step;
    [1, 2, 3].forEach(n => { const el = document.getElementById("preset-wizard-step-" + n); if (el) el.classList.toggle("hidden", n !== step); });
    const titles = { 1: "Neues Preset – Playbooks", 2: "Neues Preset – Einstellungen", 3: "Neues Preset – Freigeben (optional)" };
    const t = document.getElementById("preset-wizard-title"); if (t) t.textContent = titles[step];
    const back = document.getElementById("preset-wizard-back"); if (back) back.style.display = step > 1 ? "" : "none";
    const next = document.getElementById("preset-wizard-next"); if (next) next.style.display = step < 3 ? "" : "none";
    const finish = document.getElementById("preset-wizard-finish"); if (finish) finish.style.display = step === 3 ? "" : "none";
}

// : Kontext-Objekte, damit Preset- und Szenario-Wizard dieselben Renderer teilen.
// Default = Preset-Wizard -> alle bestehenden Aufrufstellen bleiben unverändert.
function presetWizardCtx() {
    return { pb: "preset-wizard-playbooks", cfg: "preset-wizard-config", shares: "preset-wizard-shares",
             prefix: "wizard-", pbClass: "wizard-pb", selected: presetWizardSelected,
             guests: window._presetGuests || [] };
}
function scenarioWizardCtx() {
    // : Szenario-Freigaben nutzen dieselbe Gästeliste wie loadScenarios (window._scenarioGuests);
    // der Presets-Tab (der window._presetGuests füllte) ist seit ausgeblendet.
    return { pb: "scenario-wizard-playbooks", cfg: "scenario-wizard-config", shares: "scenario-wizard-shares",
             prefix: "scwiz-", pbClass: "scwiz-pb", selected: scenarioWizardSelected,
             guests: window._scenarioGuests || [] };
}

function renderWizardPlaybooks(filter, ctx = presetWizardCtx()) {
    const c = document.getElementById(ctx.pb);
    if (!c) return;
    const ftxt = (filter || "").toLowerCase();
    const list = (allPlaybooks || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "de", { sensitivity: "base" }));
    if (!list.length) { c.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Keine Playbooks verfügbar.</p>'; return; }
    c.innerHTML = "";
    list.forEach(pb => {
        const hay = `${pb.name || ""} ${pb.category || ""} ${pb.file || ""}`.toLowerCase();
        if (ftxt && !hay.includes(ftxt)) return;
        const row = document.createElement("label");
        row.style.cssText = "display:flex; align-items:center; gap:10px; cursor:pointer; padding:8px; border:1px solid rgba(255,255,255,0.06); border-radius:6px;";
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = ctx.pbClass; cb.value = pb.file;
        cb.checked = ctx.selected.has(pb.file);
        cb.addEventListener("change", () => { if (cb.checked) ctx.selected.add(pb.file); else ctx.selected.delete(pb.file); });
        const icon = document.createElement("span"); icon.innerHTML = playbookIconHtml(pb);
        const info = document.createElement("div"); info.style.minWidth = "0";
        info.innerHTML = `<div style="font-weight:bold;">${escapeHtml(pb.name || pb.file)}</div>` + (pb.category ? `<div style="color:var(--text-secondary); font-size:12px;">${escapeHtml(pb.category)}</div>` : "");
        row.appendChild(cb); row.appendChild(icon); row.appendChild(info);
        c.appendChild(row);
    });
}

// Schritt 2: aufklappbare Config-Sektionen wie im Ausführen-Dialog (gespiegelte Accordion-Logik).
function renderWizardConfig(ctx = presetWizardCtx()) {
    const container = document.getElementById(ctx.cfg);
    if (!container) return;
    container.innerHTML = "";
    let tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    const general = document.createElement("div");
    general.style.cssText = "margin-bottom:14px;";
    general.innerHTML =
        `<div class="text-field" style="margin-bottom:10px; width:100%;"><input type="text" id="${ctx.prefix}base-dir" placeholder=" " style="width:100%;"><label for="${ctx.prefix}base-dir">Basisverzeichnis (optional)</label></div>` +
        `<div class="text-field" style="margin-bottom:10px; width:100%;"><input type="text" id="${ctx.prefix}timezone" placeholder=" " value="${escapeHtml(tz)}" style="width:100%;"><label for="${ctx.prefix}timezone">Zeitzone</label></div>` +
        `<label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; margin-bottom:6px;"><input type="checkbox" id="${ctx.prefix}use-traefik" class="styled-checkbox" checked> Traefik verwenden (Domains statt Ports)</label>`;
    container.appendChild(general);
    Array.from(ctx.selected).forEach(pbPath => {
        const baseName = pbPath.split("/").pop();
        const cfgs = (typeof playbookDomainConfigs !== "undefined") ? playbookDomainConfigs[baseName] : null;
        if (!cfgs || !cfgs.length) return;
        const meta = (typeof playbookMetadataMap !== "undefined" && (playbookMetadataMap[pbPath] || playbookMetadataMap[baseName])) || { name: baseName };
        const serviceGroup = meta.service_group || baseName;
        const details = document.createElement("details");
        details.className = "modal-config-accordion";
        const summary = document.createElement("summary");
        summary.className = "modal-config-accordion-summary";
        summary.innerHTML = `<span class="modal-config-accordion-label">${playbookIconHtml({ icon: meta.icon, icon_value: meta.icon_value })}<span>${escapeHtml(meta.name || baseName)}</span></span><span class="modal-config-accordion-count"></span>`;
        details.appendChild(summary);
        const body = document.createElement("div");
        body.className = "modal-config-accordion-body";
        cfgs.forEach(cfg => {
            const scope = cfg.scope || (cfg.variable.endsWith("_domain") ? "domain" : (cfg.variable.endsWith("_port") ? "port" : "general"));
            const div = document.createElement("div");
            div.dataset.scope = scope; div.dataset.serviceGroup = serviceGroup;
            if (cfg.type === "bool") {
                //: Wahrheitswerte als Umschalt-Checkbox (Vorbelegung via applyWizardVariables / cfg.default).
                div.className = "config-field bool-field";
                div.innerHTML = `<label class="checkbox-label bool-field-label"><input type="checkbox" class="styled-checkbox" id="${ctx.prefix}variable-${cfg.variable}" data-variable="${cfg.variable}" data-scope="${scope}"${cfg.default ? " checked" : ""}><span>${escapeHtml(cfg.label)}</span></label>`;
            } else {
                //: Beispielwert als grauer HTML-Placeholder (Label schwebt via .config-field dauerhaft oben).
                const type = cfg.type || "text";
                const ph = cfg.placeholder ? escapeHtml(cfg.placeholder) : " ";
                div.className = "text-field config-field";
                div.innerHTML = `<input type="${type}" id="${ctx.prefix}variable-${cfg.variable}" data-variable="${cfg.variable}" data-scope="${scope}" placeholder="${ph}"><label for="${ctx.prefix}variable-${cfg.variable}">${escapeHtml(cfg.label)}</label>`;
            }
            body.appendChild(div);
        });
        details.appendChild(body);
        container.appendChild(details);
    });
    const traefik = document.getElementById(`${ctx.prefix}use-traefik`);
    const applyVis = () => {
        const t = traefik.checked;
        container.querySelectorAll(".modal-config-accordion").forEach(acc => {
            let visible = 0;
            acc.querySelectorAll(".config-field").forEach(field => {
                const scope = field.dataset.scope;
                const vis = scope === "general" || (scope === "domain" ? t : (scope === "port" ? !t : true));
                field.style.display = vis ? "" : "none";
                if (vis) visible++;
            });
            acc.style.display = visible > 0 ? "" : "none";
            const cnt = acc.querySelector(".modal-config-accordion-count");
            if (cnt) cnt.textContent = `${visible} Einstellung${visible === 1 ? "" : "en"}`;
        });
    };
    if (traefik) { traefik.onchange = applyVis; applyVis(); }
    if (!container.querySelector(".modal-config-accordion")) {
        const note = document.createElement("p");
        note.style.cssText = "color:var(--text-muted); font-size:12px;";
        note.textContent = "Für die gewählten Playbooks gibt es keine zusätzlichen Einstellungen.";
        container.appendChild(note);
    }
}

function collectWizardVariables(ctx = presetWizardCtx()) {
    const vars = {};
    const bd = document.getElementById(`${ctx.prefix}base-dir`);
    if (bd && bd.value.trim()) vars["base_dir"] = bd.value.trim();
    const tz = document.getElementById(`${ctx.prefix}timezone`);
    if (tz && tz.value.trim()) vars["timezone"] = tz.value.trim();
    const traefik = document.getElementById(`${ctx.prefix}use-traefik`);
    vars["use_traefik"] = (traefik && traefik.checked) ? "true" : "false";
    document.querySelectorAll(`#${ctx.cfg} .modal-config-accordion .config-field`).forEach(field => {
        if (field.style.display === "none") return;
        const inp = field.querySelector("input");
        if (!inp || !inp.dataset.variable) return;
        //: Bool-Checkbox -> expliziter true/false-String; Textfeld nur wenn befüllt.
        if (inp.type === "checkbox") vars[inp.dataset.variable] = inp.checked ? "true" : "false";
        else if (inp.value.trim()) vars[inp.dataset.variable] = inp.value.trim();
    });
    return vars;
}

// : `selected` (Liste vorhandener Freigaben {guest_id, permission}) blendet bestehende
// Freigaben beim Bearbeiten vor (Checkbox an, Berechtigung gesetzt). Beim Erstellen = null.
function renderWizardShares(ctx = presetWizardCtx(), selected = null) {
    const sc = document.getElementById(ctx.shares);
    if (!sc) return;
    const guests = (ctx.guests && ctx.guests.length ? ctx.guests : (window._presetGuests || []));
    if (!guests.length) { sc.innerHTML = '<p style="color:var(--text-muted); font-size:12px;">Keine Teammitglieder vorhanden.</p>'; return; }
    const byGuest = {};
    (selected || []).forEach(s => { byGuest[s.guest_id] = s.permission || "strict"; });
    sc.innerHTML = "";
    guests.forEach(g => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:6px;";
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.className = "styled-checkbox wizard-share-cb"; cb.value = g.id;
        cb.checked = byGuest[g.id] !== undefined;
        const name = document.createElement("span"); name.style.cssText = "flex:1; min-width:0; font-size:12px;"; name.textContent = `${g.username} (${g.email})`;
        const perm = document.createElement("select"); perm.className = "wizard-share-perm"; perm.dataset.guest = g.id;
        perm.style.cssText = "padding:4px 6px; font-size:12px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:4px; color:#fff;";
        perm.innerHTML = '<option value="strict">strikt (nur ausführen)</option><option value="flexible">flexibel (anpassbar)</option>';
        perm.value = byGuest[g.id] || "strict";
        row.appendChild(cb); row.appendChild(name); row.appendChild(perm);
        sc.appendChild(row);
    });
}

// : gespeicherte Variablen eines Presets in die (bereits gerenderten) Wizard-Schritt-2-Felder
// übernehmen. Muss NACH renderWizardConfig laufen.
function applyWizardVariables(ctx, vars) {
    if (!vars) return;
    const bd = document.getElementById(`${ctx.prefix}base-dir`);
    if (bd && vars.base_dir != null) bd.value = vars.base_dir;
    const tz = document.getElementById(`${ctx.prefix}timezone`);
    if (tz && vars.timezone != null) tz.value = vars.timezone;
    const traefik = document.getElementById(`${ctx.prefix}use-traefik`);
    if (traefik && vars.use_traefik != null) {
        traefik.checked = String(vars.use_traefik) === "true";
        if (typeof traefik.onchange === "function") traefik.onchange();  // Sichtbarkeit (Domain/Port) neu anwenden
    }
    document.querySelectorAll(`#${ctx.cfg} .modal-config-accordion .config-field input[data-variable]`).forEach(inp => {
        const key = inp.dataset.variable;
        if (vars[key] == null) return;
        //: gespeicherten Bool-String in den Checkbox-Zustand übernehmen.
        if (inp.type === "checkbox") inp.checked = String(vars[key]) === "true";
        else inp.value = vars[key];
    });
}

function presetWizardNext() {
    if (presetWizardStep === 1) {
        const name = (document.getElementById("preset-wizard-name").value || "").trim();
        if (!name) { showToast("Bitte einen Preset-Namen eingeben."); return; }
        if (!presetWizardSelected.size) { showToast("Bitte mindestens ein Playbook auswählen."); return; }
        renderWizardConfig();
        presetWizardGoTo(2);
    } else if (presetWizardStep === 2) {
        renderWizardShares();
        presetWizardGoTo(3);
    }
}
function presetWizardBack() {
    if (presetWizardStep === 3) presetWizardGoTo(2);
    else if (presetWizardStep === 2) presetWizardGoTo(1);
}
async function presetWizardFinish() {
    const name = (document.getElementById("preset-wizard-name").value || "").trim();
    const playbook_ids = Array.from(presetWizardSelected);
    if (!name || !playbook_ids.length) { showToast("Name und mindestens ein Playbook erforderlich."); return; }
    const variables = collectWizardVariables();
    const shares = Array.from(document.querySelectorAll("#preset-wizard-shares .wizard-share-cb:checked")).map(cb => {
        const permEl = document.querySelector(`#preset-wizard-shares .wizard-share-perm[data-guest="${cssEscape(cb.value)}"]`);
        return { guest_id: cb.value, permission: (permEl && permEl.value) || "strict" };
    });
    const payload = { name, playbook_ids, variables, device_ids: [], shares };
    try {
        const res = await fetch("/api/profile/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(errorDetailToMessage(d.detail, "Erstellen fehlgeschlagen."));
        showToast("Preset erstellt.");
        closePresetWizard();
        await loadPresets();
    } catch (e) {
        showToast(e.message);
    }
}

// ===========================================================================
// : Szenario-Erstell-Wizard — Playbooks → Einstellungen → Geräte → Freigeben.
// Legt im Hintergrund ein Preset (Schritt 1+2) an und verknüpft es als Szenario mit dem in
// Schritt 3 gewählten Gerät (oder "kein festes Gerät" für) + Freigaben aus Schritt 4.
// ===========================================================================
let scenarioWizardStep = 1;
let scenarioWizardSelected = new Set();
let scenarioWizardDevices = [];   //: Liste gewaehlter Device-IDs ([] = geräteloses Szenario)
// : Bearbeiten-Modus des Szenario-Wizards.
let scenarioWizardEditing = null;       // Szenario-ID (null = Neuanlage)
let scenarioWizardEditPresetId = null;  // zu aktualisierendes Preset (null = neues Preset anlegen)
let scenarioWizardEditVars = null;      // Variablen zum Vorbefüllen von Schritt 2
let scenarioWizardEditShares = null;    // bestehende Freigaben für Schritt 4
let scenarioWizardVarsApplied = false;  // Schritt-2-Vorbefüllung nur einmal anwenden

// : Neuanlage.: mit Szenario-Objekt = Bearbeiten (Werte vorbefüllt).
function openScenarioWizard(s = null) {
    scenarioWizardStep = 1;
    scenarioWizardSelected = new Set();
    scenarioWizardDevices = [];
    scenarioWizardEditing = null;
    scenarioWizardEditPresetId = null;
    scenarioWizardEditVars = null;
    scenarioWizardEditShares = null;
    scenarioWizardVarsApplied = false;

    if (s) {
        // : Bearbeiten — Name, Playbooks, Variablen, Gerät und Freigaben aus dem Szenario
        // (bzw. dessen Preset) vorbefüllen. Das Preset liefert Playbooks + Variablen.
        scenarioWizardEditing = s.id;
        const preset = (userScenarioPresets || []).find(p => p.id === s.preset_id) || null;
        scenarioWizardEditPresetId = preset ? preset.id : null;  // fehlt das Preset -> beim Speichern neu anlegen
        scenarioWizardSelected = new Set(preset ? (preset.playbook_ids || []) : []);
        scenarioWizardEditVars = preset ? (preset.variables || {}) : {};
        //: nur noch existierende Geraete vorauswählen; unbekannte IDs (geloescht) verwerfen.
        const known = new Set((userScenarioDevices || []).map(d => d.id));
        scenarioWizardDevices = (s.device_ids || []).filter(id => known.has(id));
        scenarioWizardEditShares = s.shares || [];
    }

    const nm = document.getElementById("scenario-wizard-name"); if (nm) nm.value = s ? (s.name || "") : "";
    const f = document.getElementById("scenario-wizard-pb-filter"); if (f) f.value = "";
    renderWizardPlaybooks("", scenarioWizardCtx());
    const cfg = document.getElementById("scenario-wizard-config"); if (cfg) cfg.innerHTML = "";
    const dv = document.getElementById("scenario-wizard-devices"); if (dv) dv.innerHTML = "";
    const sh = document.getElementById("scenario-wizard-shares"); if (sh) sh.innerHTML = "";
    scenarioWizardGoTo(1);
    const dlg = document.getElementById("scenario-wizard-dialog");
    // : Dirty-Flag zurücksetzen, damit das frisch geöffnete Dialog nicht sofort als „geändert" gilt.
    if (dlg) { dlg.dataset.dirty = ""; dlg.classList.remove("hidden"); }
}
function closeScenarioWizard() {
    const dlg = document.getElementById("scenario-wizard-dialog"); if (dlg) dlg.classList.add("hidden");
}
function scenarioWizardGoTo(step) {
    scenarioWizardStep = step;
    [1, 2, 3, 4].forEach(n => { const el = document.getElementById("scenario-wizard-step-" + n); if (el) el.classList.toggle("hidden", n !== step); });
    // : Titel/Icon/Buttons spiegeln Neuanlage vs. Bearbeiten.
    const editing = !!scenarioWizardEditing;
    const prefix = editing ? "Szenario bearbeiten" : "Neues Szenario";
    const titles = { 1: `${prefix} – Playbooks`, 2: `${prefix} – Einstellungen`, 3: `${prefix} – Gerät`, 4: `${prefix} – Freigeben (optional)` };
    const t = document.getElementById("scenario-wizard-title"); if (t) t.textContent = titles[step];
    const icon = document.getElementById("scenario-wizard-icon"); if (icon) icon.textContent = editing ? "edit" : "rocket_launch";  //
    //: In der Community-Edition entfaellt der Freigabe-Schritt (Schritt 4) — keine weiteren Benutzer.
    const lastStep = currentEdition === "community" ? 3 : 4;
    const back = document.getElementById("scenario-wizard-back"); if (back) back.style.display = step > 1 ? "" : "none";
    const next = document.getElementById("scenario-wizard-next"); if (next) next.style.display = step < lastStep ? "" : "none";
    const finish = document.getElementById("scenario-wizard-finish");
    if (finish) { finish.style.display = step === lastStep ? "" : "none"; finish.textContent = editing ? "Änderungen speichern" : "Szenario erstellen"; }
}

// Schritt 3: (Device-Flatten): Mehrfachauswahl der Zielgeraete (Checkboxen). Keine Auswahl
// = geräteloses Szenario (Gerät wird beim Ausführen einmalig eingegeben).
function renderScenarioWizardDevices() {
    const c = document.getElementById("scenario-wizard-devices");
    if (!c) return;
    c.innerHTML = "";
    const note = document.createElement("p");
    note.style.cssText = "color:var(--text-secondary); font-size:12px; margin:0 0 8px 0;";
    note.textContent = "Ohne Auswahl wird das Zielgerät beim Ausführen einmalig eingegeben (geräteloses Szenario).";
    c.appendChild(note);
    const selected = new Set(scenarioWizardDevices || []);
    const devices = userScenarioDevices || [];
    if (!devices.length) {
        const empty = document.createElement("p");
        empty.style.cssText = "color:var(--text-muted); font-size:12px; margin:0;";
        empty.textContent = "Keine Geräte angelegt – das Szenario läuft gerätelos.";
        c.appendChild(empty);
        return;
    }
    devices.forEach(d => {
        const row = document.createElement("label");
        row.style.cssText = "display:flex; align-items:center; gap:10px; cursor:pointer; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; margin-bottom:6px;";
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "styled-checkbox scwiz-device"; cb.value = d.id;
        cb.checked = selected.has(d.id);
        cb.addEventListener("change", () => {
            if (cb.checked) { if (!scenarioWizardDevices.includes(d.id)) scenarioWizardDevices.push(d.id); }
            else { scenarioWizardDevices = scenarioWizardDevices.filter(x => x !== d.id); }
        });
        const info = document.createElement("div"); info.style.minWidth = "0";
        info.innerHTML = `<div style="font-weight:bold;">${escapeHtml(d.name)}</div><div style="color:var(--text-secondary); font-size:12px;">${escapeHtml(d.host || "")}</div>`;
        row.appendChild(cb); row.appendChild(info);
        c.appendChild(row);
    });
}

function scenarioWizardNext() {
    if (scenarioWizardStep === 1) {
        const name = (document.getElementById("scenario-wizard-name").value || "").trim();
        if (!name) { showToast("Bitte einen Szenario-Namen eingeben."); return; }
        if (!scenarioWizardSelected.size) { showToast("Bitte mindestens ein Playbook auswählen."); return; }
        renderWizardConfig(scenarioWizardCtx());
        // : gespeicherte Variablen einmalig vorbefüllen (nur im Bearbeiten-Modus).
        if (scenarioWizardEditing && !scenarioWizardVarsApplied) {
            applyWizardVariables(scenarioWizardCtx(), scenarioWizardEditVars);
            scenarioWizardVarsApplied = true;
        }
        scenarioWizardGoTo(2);
    } else if (scenarioWizardStep === 2) {
        renderScenarioWizardDevices();
        scenarioWizardGoTo(3);
    } else if (scenarioWizardStep === 3) {
        //: In der Community-Edition ist Schritt 3 der letzte Schritt (kein Freigeben);
        // der „Weiter"-Button ist dort ausgeblendet, dieser Guard ist die Absicherung.
        if (currentEdition === "community") return;
        // : im Bearbeiten-Modus bestehende Freigaben vorblenden.
        renderWizardShares(scenarioWizardCtx(), scenarioWizardEditing ? scenarioWizardEditShares : null);
        scenarioWizardGoTo(4);
    }
}
function scenarioWizardBack() {
    if (scenarioWizardStep > 1) scenarioWizardGoTo(scenarioWizardStep - 1);
}

async function scenarioWizardFinish() {
    const name = (document.getElementById("scenario-wizard-name").value || "").trim();
    const playbook_ids = Array.from(scenarioWizardSelected);
    if (!name || !playbook_ids.length) { showToast("Name und mindestens ein Playbook erforderlich."); return; }
    const variables = collectWizardVariables(scenarioWizardCtx());
    //: In der Community-Edition gibt es keinen Freigabe-Schritt -> nie Freigaben mitsenden.
    const shares = currentEdition === "community" ? [] : Array.from(document.querySelectorAll("#scenario-wizard-shares .wizard-share-cb:checked")).map(cb => {
        const permEl = document.querySelector(`#scenario-wizard-shares .wizard-share-perm[data-guest="${cssEscape(cb.value)}"]`);
        return { guest_id: cb.value, permission: (permEl && permEl.value) || "strict" };
    });
    try {
        //  Option A: aus Schritt 1+2 ein wiederverwendbares Preset (Rezept) anlegen bzw.
        // beim Bearbeiten das bestehende Preset des Szenarios aktualisieren.
        let presetId;
        if (scenarioWizardEditing && scenarioWizardEditPresetId) {
            // Bestehende Preset-Freigaben unverändert lassen (Sharing des Szenarios läuft über Schritt 4).
            const existingPreset = (userScenarioPresets || []).find(p => p.id === scenarioWizardEditPresetId);
            const presetShares = (existingPreset && existingPreset.shares) || [];
            const presetRes = await fetch(`/api/profile/presets/${scenarioWizardEditPresetId}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, playbook_ids, variables, device_ids: [], shares: presetShares })
            });
            const presetData = await presetRes.json().catch(() => ({}));
            if (!presetRes.ok) throw new Error(errorDetailToMessage(presetData.detail, "Speichern fehlgeschlagen."));
            presetId = presetData.id;
        } else {
            // Neuanlage – oder Bearbeiten eines Szenarios, dessen Preset zwischenzeitlich gelöscht wurde.
            const presetRes = await fetch("/api/profile/presets", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, playbook_ids, variables, device_ids: [], shares: [] })
            });
            const presetData = await presetRes.json().catch(() => ({}));
            if (!presetRes.ok) throw new Error(errorDetailToMessage(presetData.detail, "Erstellen fehlgeschlagen."));
            presetId = presetData.id;
        }
        // ... dann das Szenario, das das Preset mit dem gewählten Gerät (oder geräteslos) verknüpft.
        const scenarioUrl = scenarioWizardEditing ? `/api/profile/scenarios/${scenarioWizardEditing}` : "/api/profile/scenarios";
        const scenarioRes = await fetch(scenarioUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, preset_id: presetId, device_ids: scenarioWizardDevices, shares })
        });
        const scenarioData = await scenarioRes.json().catch(() => ({}));
        if (!scenarioRes.ok) throw new Error(errorDetailToMessage(scenarioData.detail, scenarioWizardEditing ? "Szenario konnte nicht gespeichert werden." : "Szenario konnte nicht erstellt werden."));
        showToast(scenarioWizardEditing ? "Szenario aktualisiert." : "Szenario erstellt.");
        closeScenarioWizard();
        await loadScenarios();
    } catch (e) {
        showToast(e.message);
    }
}

// : Protokoll-Export (TXT/CSV) der gerenderten Tabellen — rein clientseitig.
function _collectTableRows(tbodyId, colCount) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return [];
    const rows = [];
    tbody.querySelectorAll("tr").forEach(tr => {
        const cells = tr.querySelectorAll("td");
        if (cells.length < colCount) return; // Platzhalter-/colspan-Zeilen (Lade…/Keine Einträge) überspringen
        rows.push(Array.from(cells).slice(0, colCount).map(td => td.textContent.trim().replace(/\s+/g, " ")));
    });
    return rows;
}

function _csvEscape(v) {
    return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function _downloadTextFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAdminLog(kind, format) {
    const cfg = kind === "audit"
        ? { tbody: "admin-audit-tbody", headers: ["Zeit", "Benutzer", "Aktion", "Ziel", "Detail", "IP"], base: "audit-log" }
        : { tbody: "admin-security-tbody", headers: ["Zuletzt", "Typ", "Fingerabdruck", "Anzahl", "Detail", "Status"], base: "ungewoehnliche-aktivitaeten" };
    const rows = _collectTableRows(cfg.tbody, cfg.headers.length);
    if (!rows.length) { showToast("Keine Einträge zum Exportieren."); return; }
    // Datumsstempel ohne Date.now-Verbot-Problematik (Browser-Kontext erlaubt new Date()).
    const stamp = new Date().toISOString().slice(0, 10);
    let content, mime, ext;
    if (format === "csv") {
        const lines = [cfg.headers.map(_csvEscape).join(",")];
        rows.forEach(r => lines.push(r.map(_csvEscape).join(",")));
        content = lines.join("\r\n"); mime = "text/csv;charset=utf-8"; ext = "csv";
    } else {
        const headerLine = cfg.headers.join(" | ");
        const lines = [headerLine, "-".repeat(headerLine.length)];
        rows.forEach(r => lines.push(r.join(" | ")));
        content = lines.join("\n"); mime = "text/plain;charset=utf-8"; ext = "txt";
    }
    _downloadTextFile(`${cfg.base}-${stamp}.${ext}`, content, mime);
}

// : zentraler Export-Dialog (Auswahl Log-Typen + Format) statt Inline-Buttons.
function openAdminExportDialog() {
    const dlg = document.getElementById("admin-export-dialog");
    if (dlg) dlg.classList.remove("hidden");
}
function closeAdminExportDialog() {
    const dlg = document.getElementById("admin-export-dialog");
    if (dlg) dlg.classList.add("hidden");
}
function runAdminExport() {
    const wantSecurity = document.getElementById("export-log-security").checked;
    const wantAudit = document.getElementById("export-log-audit").checked;
    if (!wantSecurity && !wantAudit) { showToast("Bitte mindestens ein Protokoll auswählen."); return; }
    const fmtEl = document.querySelector('input[name="admin-export-format"]:checked');
    const format = fmtEl ? fmtEl.value : "csv";
    if (wantSecurity) exportAdminLog("security", format);
    if (wantAudit) exportAdminLog("audit", format);
    closeAdminExportDialog();
}

async function fetchAuditLog() {
    const tbody = document.getElementById("admin-audit-tbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:var(--text-muted);">Lade...</td></tr>`;
    try {
        const res = await fetch("/api/admin/audit-log");
        if (!res.ok) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:var(--md-sys-color-error);">Fehler beim Laden.</td></tr>`; return; }
        const entries = await res.json();
        if (!entries || entries.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:var(--text-muted);">Keine Einträge.</td></tr>`;
            return;
        }
        tbody.innerHTML = entries.map(e => {
            const t = e.timestamp ? new Date(e.timestamp).toLocaleString() : "-";
            return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:6px;">${escapeHtml(t)}</td>
                <td style="padding:6px;">${escapeHtml(e.actor || '-')}</td>
                <td style="padding:6px;">${escapeHtml(e.action || '-')}</td>
                <td style="padding:6px;">${escapeHtml(e.target || '-')}</td>
                <td style="padding:6px;">${escapeHtml(e.detail || '-')}</td>
                <td style="padding:6px;">${escapeHtml(e.ip || '-')}</td>
            </tr>`;
        }).join("");
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:var(--md-sys-color-error);">Netzwerkfehler.</td></tr>`;
    }
}

// : Sicherheitshinweise im Admin-Panel laden und darstellen.
async function fetchSecurityAlerts() {
    // Fingerprint-/Sicherheitshinweise = Trial-Missbrauchs-Erkennung (cloud-only):
    // in Community gestrippt, in On-Premise ausgeblendet -> nur in der Cloud laden.
    if (currentEdition !== "cloud") {
        const sec = document.getElementById("admin-security-alerts-section");
        if (sec) sec.style.display = "none";
        return;
    }
    const tbody = document.getElementById("admin-security-tbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:15px; color:var(--text-muted);">Lade...</td></tr>`;
    try {
        const res = await fetch("/api/admin/security-alerts");
        if (!res.ok) { tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:15px; color:var(--md-sys-color-error);">Fehler beim Laden.</td></tr>`; return; }
        const alerts = await res.json();
        if (!alerts || alerts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:15px; color:var(--text-muted);">Keine Sicherheitshinweise.</td></tr>`;
            return;
        }
        tbody.innerHTML = "";
        alerts.forEach(a => {
            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
            if (!a.acknowledged) tr.style.background = "color-mix(in srgb, var(--md-sys-color-error) 7%, transparent)";
            const last = a.last_seen_at ? new Date(a.last_seen_at).toLocaleString() : "-";
            const fp = a.fingerprint ? (a.fingerprint.slice(0, 16) + "…") : "-";
            const statusHtml = a.acknowledged
                ? `<span style="color: var(--text-muted);">erledigt${a.acknowledged_by ? " (" + escapeHtml(a.acknowledged_by) + ")" : ""}</span>`
                : `<span style="color: var(--md-sys-color-error); font-weight: bold;">offen</span>`;
            tr.innerHTML =
                `<td style="padding:6px;">${escapeHtml(last)}</td>` +
                `<td style="padding:6px;">${escapeHtml(a.type || '-')}</td>` +
                `<td style="padding:6px; font-family: monospace;" title="${escapeHtml(a.fingerprint || '')}">${escapeHtml(fp)}</td>` +
                `<td style="padding:6px;">${escapeHtml(String(a.count != null ? a.count : '-'))}</td>` +
                `<td style="padding:6px;">${escapeHtml(a.detail || '-')}</td>` +
                `<td style="padding:6px;">${statusHtml}</td>`;
            const actTd = document.createElement("td");
            actTd.style.padding = "6px";
            actTd.style.textAlign = "right";
            if (!a.acknowledged) {
                const btn = document.createElement("button");
                btn.className = "btn btn-small";
                btn.textContent = "Erledigt";
                btn.addEventListener("click", () => acknowledgeSecurityAlert(a.id));
                actTd.appendChild(btn);
            }
            tr.appendChild(actTd);
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:15px; color:var(--md-sys-color-error);">Netzwerkfehler.</td></tr>`;
    }
}

async function acknowledgeSecurityAlert(alertId) {
    try {
        const res = await fetch(`/api/admin/security-alerts/${alertId}/acknowledge`, { method: "POST" });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || "Als erledigt markiert.");
            fetchSecurityAlerts();
        } else {
            showToast(errorDetailToMessage(data.detail, "Aktion fehlgeschlagen."));
        }
    } catch (err) {
        showToast("Netzwerkfehler.");
    }
}

// ===========================================================================
// : Tarif- & Gutschein-Verwaltung im Admin-Panel
// ===========================================================================



function fmtPrice(cents, currency) {
    return (Number(cents || 0) / 100).toFixed(2) + " " + String(currency || "eur").toUpperCase();
}










function _numOrNull(id) {
    const v = document.getElementById(id).value.trim();
    return v === "" ? null : parseInt(v, 10);
}

















let allAdminUsers = [];

function renderAdminUsers() {
    const tbody = document.getElementById("admin-users-tbody");
    if (!tbody) return;
    const q = (document.getElementById("admin-user-search").value || "").trim().toLowerCase();
    const sort = document.getElementById("admin-user-sort").value || "username";

    // Nur registrierte Nutzer; Gaeste sind ueber die Verwaltung des Besitzers einsehbar
    let list = allAdminUsers.filter(u => u.role !== "guest").filter(u =>
        !q || (u.username || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q));

    list.sort((a, b) => {
        if (sort === "created_at") return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        if (sort === "active") return (a.is_active === b.is_active) ? 0 : (a.is_active ? 1 : -1);
        return String(a[sort] || "").localeCompare(String(b[sort] || ""));
    });

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 15px; color: var(--text-muted);">Keine Benutzer gefunden.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    list.forEach(user => {
        const isSelf = currentUser && user.username === currentUser.username;
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
        const activeBadge = user.is_active
            ? '<span style="color:#2ecc71;">Ja</span>'
            : '<span style="color:#e74c3c;">Nein</span>';
        // : „Verwalten" (Icon manage_accounts) links neben dem Namen.
        const nameTd = document.createElement("td");
        nameTd.style.cssText = "padding:8px; white-space:nowrap;";
        if (!isSelf) {
            const manage = document.createElement("button");
            manage.type = "button"; manage.className = "btn btn-secondary btn-small"; manage.style.marginRight = "8px";
            manage.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; margin-right:4px;">manage_accounts</span>Verwalten';
            manage.addEventListener("click", () => openAdminEditUser(user.id));
            nameTd.appendChild(manage);
        }
        const nameSpan = document.createElement("span"); nameSpan.textContent = user.username;
        nameTd.appendChild(nameSpan);
        tr.appendChild(nameTd);
        const cell = (html) => { const td = document.createElement("td"); td.style.padding = "8px"; td.innerHTML = html; return td; };
        tr.appendChild(cell(escapeHtml(user.email || '-')));
        tr.appendChild(cell(escapeHtml(user.role)));
        tr.appendChild(cell(escapeHtml(user.tier)));
        tr.appendChild(cell(escapeHtml(user.subscription_status || 'inaktiv')));
        tr.appendChild(cell(activeBadge));
        // : „Löschen" ganz rechts (Warndialog mit fettem Namen).
        const tdAct = document.createElement("td");
        tdAct.style.cssText = "padding:8px; text-align:right; white-space:nowrap;";
        if (isSelf) {
            tdAct.textContent = "—";
        } else {
            const del = document.createElement("button");
            del.type = "button"; del.className = "btn btn-danger btn-small";
            del.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; margin-right:4px;">delete</span>Löschen';
            del.addEventListener("click", () => deleteAdminUserById(user.id, user.username));
            tdAct.appendChild(del);
        }
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
    });
}

// : Benutzer-erstellen-Dialog (Admin) + Anlegen via POST /api/admin/users.
function openAdminUserCreateDialog() {
    const f = document.getElementById("admin-user-create-form");
    if (f) f.reset();
    const dlg = document.getElementById("admin-user-create-dialog");
    if (dlg) { dlg.dataset.dirty = ""; dlg.classList.remove("hidden"); }  // 
}
function closeAdminUserCreateDialog() {
    const dlg = document.getElementById("admin-user-create-dialog");
    if (dlg) dlg.classList.add("hidden");
}
async function handleAdminUserCreate(e) {
    e.preventDefault();
    const username = document.getElementById("admin-new-user-name").value.trim();
    const email = document.getElementById("admin-new-user-email").value.trim();
    const password = document.getElementById("admin-new-user-pass").value;
    const role = document.getElementById("admin-new-user-role").value;
    if (!username || !email || !password) { showToast("Bitte alle Felder ausfüllen."); return; }
    try {
        const res = await fetch("/api/admin/users", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, email, password, role })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(errorDetailToMessage(data.detail, "Erstellen fehlgeschlagen."));
        showToast("Benutzer erstellt.");
        closeAdminUserCreateDialog();
        fetchAdminUsers();
    } catch (err) {
        showToast(err.message);
    }
}

async function fetchAdminUsers() {
    const tbody = document.getElementById("admin-users-tbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 15px; color: var(--text-muted);">Lade Benutzer...</td></tr>`;
    try {
        const response = await fetch("/api/admin/users");
        if (response.ok) {
            allAdminUsers = await response.json();
            renderAdminUsers();
        } else {
            const data = await response.json();
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 15px; color: var(--md-sys-color-error);">Fehler: ${escapeHtml(errorDetailToMessage(data.detail, 'Fehler beim Laden'))}</td></tr>`;
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 15px; color: var(--md-sys-color-error);">Netzwerkfehler beim Laden der Benutzer.</td></tr>`;
    }
}

let currentAdminEditUser = null;
let currentAdminEditUserData = null;   // : zuletzt geladener Benutzer-Datensatz
let adminLimitDefaults = null;          // : globale Standard-Limits für Platzhalter

async function openAdminEditUser(userId) {
    // : globale Standard-Limits einmalig laden (für Limit-Platzhalter)
    if (adminLimitDefaults == null) {
        try {
            const sr = await fetch("/api/admin/settings");
            adminLimitDefaults = sr.ok ? await sr.json() : {};
        } catch (e) { adminLimitDefaults = {}; }
    }
    const dialog = document.getElementById("admin-edit-user-dialog");
    if (!dialog) return;
    currentAdminEditUser = userId;
    currentAdminEditUserData = null;
    document.getElementById("admin-edit-user-id").value = userId;
    document.getElementById("admin-edit-user-header").innerHTML = '<strong id="admin-edit-username-lbl">...</strong>';
    document.getElementById("admin-edit-user-info").innerHTML = '<p style="color: var(--text-muted); margin:0;">Lade...</p>';
    document.getElementById("admin-user-invoices").innerHTML = '<p style="color: var(--text-muted); margin:0;">Lade Rechnungen...</p>';
    dialog.classList.remove("hidden");

    try {
        const res = await fetch(`/api/admin/users/${userId}`);
        if (!res.ok) {
            document.getElementById("admin-edit-user-info").innerHTML = '<p style="color:var(--md-sys-color-error); margin:0;">Konnte Benutzer nicht laden.</p>';
            return;
        }
        const u = await res.json();
        currentAdminEditUserData = u;
        document.getElementById("admin-edit-username-lbl").textContent = u.username;
        const toggleBtn = document.getElementById("admin-toggle-active-btn");
        toggleBtn.textContent = u.is_active ? "Deaktivieren" : "Aktivieren";
        toggleBtn.dataset.active = u.is_active ? "1" : "0";

        // : Rolle-Dropdown vorbelegen
        const roleSel = document.getElementById("admin-edit-role");
        if (roleSel) roleSel.value = u.role;

        // : Benutzername vorbelegen (im Admin-Panel editierbar).
        const unameInput = document.getElementById("admin-edit-username");
        if (unameInput) unameInput.value = u.username || "";

        // : Individuelle Limits — Platzhalter zeigt den globalen Standard
        const defs = adminLimitDefaults || {};
        const setLimit = (id, val, defKey, unit) => {
            const el = document.getElementById(id);
            el.value = (val != null ? val : "");
            const d = defs[defKey];
            el.placeholder = (d != null && d !== "") ? `Standard: ${d}${unit}` : (unit ? `${unit}`.trim() : "");
        };
        setLimit("admin-limit-storage", u.storage_quota_mb, "storage_quota_mb", " MB");
        setLimit("admin-limit-playbooks", u.max_custom_playbooks, "max_custom_playbooks", "");
        setLimit("admin-limit-guests", u.max_guest_accounts, "max_guest_accounts", "");
        //: In der Community-Edition gibt es keine Per-Benutzer-Limits -> Abschnitt ausblenden.
        const limitsSection = document.getElementById("admin-edit-limits-section");
        if (limitsSection) limitsSection.style.display = (currentEdition === "community") ? "none" : "";

        const fmt = (d) => d ? new Date(d).toLocaleString() : "-";
        const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : "-";

        // : Kopf-Badges — Verifizierung, Konto-Status, Premium
        const badge = (txt, color, icon) =>
            `<span style="display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:600; padding:3px 9px; border-radius:99px; background:${color}22; color:${color}; border:1px solid ${color}55;">` +
            (icon ? `<span class="material-symbols-outlined" style="font-size:14px;">${icon}</span>` : "") + `${txt}</span>`;
        const verifyBadge = u.email_verified
            ? badge("Verifiziert", "#2ecc71", "verified")
            : badge("Ausstehend", "#e74c3c", "schedule");
        const statusBadge = u.is_active
            ? badge("Aktiv", "#2ecc71", "check_circle")
            : badge("Deaktiviert", "#e74c3c", "block");
        const premiumBadge = u.is_subscription_active ? badge("Premium", "#f1c40f", "workspace_premium") : "";
        document.getElementById("admin-edit-user-header").innerHTML =
            `<div style="font-size:17px; font-weight:700; margin-bottom:8px;">${escapeHtml(u.username)}</div>` +
            `<div style="display:flex; flex-wrap:wrap; gap:8px;">${verifyBadge}${statusBadge}${premiumBadge}</div>`;

        // : Konto-Informationen — Rolle (nicht Tarif), 2FA als Icon neben E-Mail
        const twofaIcon = u.two_factor_enabled
            ? `<span class="material-symbols-outlined" title="2FA aktiv" style="font-size:15px; color:#2ecc71; vertical-align:middle;">lock</span>`
            : `<span class="material-symbols-outlined" title="2FA inaktiv" style="font-size:15px; color:var(--text-muted); vertical-align:middle;">no_encryption</span>`;
        const roleLabels = { user: "Benutzer", admin: "Administrator", guest: "Gast" };
        document.getElementById("admin-edit-user-info").innerHTML =
            `<div><strong>E-Mail:</strong> ${escapeHtml(u.email)} ${twofaIcon}</div>` +
            `<div><strong>Rolle:</strong> ${escapeHtml(roleLabels[u.role] || u.role)}</div>` +
            `<div><strong>Registriert:</strong> ${fmt(u.created_at)}</div>` +
            `<div><strong>Geräte:</strong> ${u.device_count} &middot; <strong>Gäste:</strong> ${u.guest_count} &middot; <strong>API-Tokens:</strong> ${u.token_count}</div>` +
            (u.avv_accepted_at ? `<div><strong>AVV:</strong> ${escapeHtml(u.avv_company || '')} am ${fmt(u.avv_accepted_at)}</div>` : "");

        // : Aktueller Tarif — Abo-Status, Laufzeitende, Stripe-Kunden-ID
        const endDate = u.subscription_ends_at || u.trial_ends_at;
        document.getElementById("admin-edit-user-tariff").innerHTML =
            `<div><strong>Abo-Status:</strong> ${escapeHtml(u.subscription_status || '-')}${u.is_subscription_active ? ' (aktiv)' : ''}</div>` +
            `<div><strong>Laufzeitende:</strong> ${fmtDate(endDate)}${u.cancels_at_period_end ? ' (endet zum Laufzeitende)' : ''}</div>` +
            `<div><strong>Stripe-Kunden-ID:</strong> ${u.stripe_customer_id ? escapeHtml(u.stripe_customer_id) : '-'}</div>`;

        // Verknuepfte Gast-Accounts
        const gc = document.getElementById("admin-edit-user-guests");
        if (gc) {
            const guests = u.guests || [];
            if (guests.length === 0) {
                gc.innerHTML = '<p style="color: var(--text-muted); margin:0;">Keine Gast-Accounts.</p>';
            } else {
                gc.innerHTML = guests.map(g =>
                    `<div style="display:flex; justify-content:space-between; padding:3px 0;">
                        <span>${escapeHtml(g.username)} <span style="color:var(--text-muted);">(${escapeHtml(g.email)})</span></span>
                        <span style="color:${g.is_active ? '#2ecc71' : '#e74c3c'};">${g.is_active ? 'aktiv' : 'inaktiv'}</span>
                    </div>`).join("");
            }
        }
    } catch (e) {
        document.getElementById("admin-edit-user-info").innerHTML = '<p style="color:var(--md-sys-color-error); margin:0;">Netzwerkfehler.</p>';
    }

    // Rechnungen laden (: nur die letzten 30 Tage)
    try {
        const ir = await fetch(`/api/admin/users/${userId}/invoices`);
        let invoices = ir.ok ? await ir.json() : [];
        if (Array.isArray(invoices)) {
            const cutoff = (Date.now() / 1000) - (30 * 24 * 60 * 60);
            invoices = invoices.filter(inv => {
                const ts = inv.created || inv.created_at || (inv.date ? Date.parse(inv.date) / 1000 : null);
                return ts == null || ts >= cutoff;
            });
        }
        renderInvoicesInto("admin-user-invoices", invoices);
    } catch (e) {
        document.getElementById("admin-user-invoices").innerHTML = '<p style="color:var(--md-sys-color-error); margin:0;">Rechnungen konnten nicht geladen werden.</p>';
    }
}

// : Speichert Rolle + individuelle Limits in einem Schritt.
async function adminSaveChanges() {
    if (!currentAdminEditUser) return;
    const parseOrNull = (id) => {
        const v = document.getElementById(id).value.trim();
        return v === "" ? null : parseInt(v, 10);
    };
    let ok = true;

    // 1) Rolle (nur wenn geändert; Server verbietet Selbst-Änderung)
    const roleSel = document.getElementById("admin-edit-role");
    const newRole = roleSel ? roleSel.value : null;
    const cur = currentAdminEditUserData || {};
    if (newRole && newRole !== cur.role) {
        try {
            const res = await fetch(`/api/admin/users/${currentAdminEditUser}/role`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: newRole, tier: cur.tier })
            });
            const data = await res.json();
            if (!res.ok) { ok = false; showToast(errorDetailToMessage(data.detail, "Fehler beim Ändern der Rolle.")); }
        } catch (e) { ok = false; showToast("Netzwerkfehler beim Ändern der Rolle."); }
    }

    // : Benutzername (nur wenn geändert).
    const unameInput = document.getElementById("admin-edit-username");
    const newUsername = unameInput ? unameInput.value.trim() : null;
    if (newUsername && newUsername !== cur.username) {
        try {
            const res = await fetch(`/api/admin/users/${currentAdminEditUser}/username`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: newUsername })
            });
            const data = await res.json();
            if (!res.ok) { ok = false; showToast(errorDetailToMessage(data.detail, "Fehler beim Ändern des Benutzernamens.")); }
        } catch (e) { ok = false; showToast("Netzwerkfehler beim Ändern des Benutzernamens."); }
    }

    // 2) Limits
    const body = {
        storage_quota_mb: parseOrNull("admin-limit-storage"),
        max_custom_playbooks: parseOrNull("admin-limit-playbooks"),
        max_guest_accounts: parseOrNull("admin-limit-guests")
    };
    try {
        const res = await fetch(`/api/admin/users/${currentAdminEditUser}/limits`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { ok = false; showToast(errorDetailToMessage(data.detail, "Fehler beim Speichern der Limits.")); }
    } catch (e) { ok = false; showToast("Netzwerkfehler beim Speichern der Limits."); }

    if (ok) { showToast("Änderungen gespeichert."); fetchAdminUsers(); }
    openAdminEditUser(currentAdminEditUser);
}

async function adminGrantTime() {
    if (!currentAdminEditUser) return;
    const days = parseInt(document.getElementById("admin-grant-days").value, 10);
    if (!days || days < 1) { showToast("Bitte eine Anzahl Tage eingeben."); return; }
    try {
        const res = await fetch(`/api/admin/users/${currentAdminEditUser}/grant-time`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ days })
        });
        const data = await res.json();
        if (res.ok) { showToast(data.message); openAdminEditUser(currentAdminEditUser); fetchAdminUsers(); }
        else showToast(errorDetailToMessage(data.detail, "Fehler."));
    } catch (e) { showToast("Netzwerkfehler."); }
}

async function adminToggleActive() {
    if (!currentAdminEditUser) return;
    const btn = document.getElementById("admin-toggle-active-btn");
    const newActive = btn.dataset.active === "0";
    try {
        const res = await fetch(`/api/admin/users/${currentAdminEditUser}/active`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: newActive })
        });
        const data = await res.json();
        if (res.ok) { showToast(data.message); openAdminEditUser(currentAdminEditUser); fetchAdminUsers(); }
        else showToast(errorDetailToMessage(data.detail, "Fehler."));
    } catch (e) { showToast("Netzwerkfehler."); }
}

// : Benutzer direkt aus der Liste löschen (Warndialog mit fettem Namen).
async function deleteAdminUserById(id, name) {
    const ok = await showConfirmDialog({ title: "Benutzer löschen?", messageHtml: `Möchten Sie den Benutzer <b>${escapeHtml(name)}</b> und ALLE zugehörigen Daten endgültig löschen?`, confirmLabel: "Endgültig löschen" });
    if (!ok) return;
    try {
        const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (res.ok) { showToast("Benutzer gelöscht."); fetchAdminUsers(); }
        else showToast(errorDetailToMessage(data.detail, "Fehler beim Löschen."));
    } catch (e) { showToast("Netzwerkfehler beim Löschen."); }
}

async function adminDeleteUser() {
    if (!currentAdminEditUser) return;
    const name = (currentAdminEditUserData && currentAdminEditUserData.username) || "diesen Benutzer";
    if (!(await showConfirmDialog({ title: "Benutzer löschen?", messageHtml: `Möchten Sie den Benutzer <b>${escapeHtml(name)}</b> und ALLE zugehörigen Daten endgültig löschen?`, confirmLabel: "Endgültig löschen" }))) return;
    try {
        const res = await fetch(`/api/admin/users/${currentAdminEditUser}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) {
            showToast("Benutzer gelöscht.");
            document.getElementById("admin-edit-user-dialog").classList.add("hidden");
            fetchAdminUsers();
        } else showToast(errorDetailToMessage(data.detail, "Fehler beim Löschen."));
    } catch (e) { showToast("Netzwerkfehler beim Löschen."); }
}

async function fetchAdminConfig() {
    try {
        const response = await fetch("/api/admin/settings");
        if (response.ok) {
            const settings = await response.json();
            document.getElementById("admin-cfg-global-limit").value = settings.rate_limit_global_ip || "";
            document.getElementById("admin-cfg-user-limit").value = settings.rate_limit_user_ip || "";
            document.getElementById("admin-cfg-ban-duration").value = settings.ip_ban_duration || "";
            document.getElementById("admin-cfg-max-tokens").value = settings.max_active_api_tokens || "";
            document.getElementById("admin-cfg-max-guests").value = settings.max_guest_accounts || "";
            document.getElementById("admin-cfg-max-history").value = settings.max_history_count || "";
            document.getElementById("admin-cfg-max-history-age").value = settings.max_history_age || "";
            document.getElementById("admin-cfg-storage-quota").value = settings.storage_quota_mb || "";
            document.getElementById("admin-cfg-max-playbooks").value = settings.max_custom_playbooks || "";
            // Fingerprint-Alert-Schwellen (cloud-only; in Community gestrippt -> null-sicher).
            const fpAlertCount = document.getElementById("admin-cfg-fp-alert-count");
            if (fpAlertCount) fpAlertCount.value = settings.fingerprint_alert_threshold_count || "";
            const fpAlertHours = document.getElementById("admin-cfg-fp-alert-hours");
            if (fpAlertHours) fpAlertHours.value = settings.fingerprint_alert_threshold_hours || "";
            // : Standard-Timeout (Default 3600, falls noch nicht gesetzt).
            document.getElementById("admin-cfg-job-timeout").value = settings.default_job_timeout || "3600";
            //: Verbindungs-/Sudo-Prompt-Timeout (Default 30, falls noch nicht gesetzt).
            document.getElementById("admin-cfg-connection-timeout").value = settings.default_connection_timeout || "30";
            // : Passwortregeln.
            document.getElementById("admin-cfg-pw-min-length").value = settings.password_min_length || "8";
            document.getElementById("admin-cfg-pw-special").checked = String(settings.password_require_special || "false").toLowerCase() === "true";
            document.getElementById("admin-cfg-pw-case").checked = String(settings.password_require_case || "false").toLowerCase() === "true";
            document.getElementById("admin-cfg-pw-digit").checked = String(settings.password_require_digit || "false").toLowerCase() === "true";
            // : Wartungsmodus + Notiz.
            const maintCb = document.getElementById("admin-cfg-maintenance-mode");
            if (maintCb) maintCb.checked = String(settings.maintenance_mode || "false").toLowerCase() === "true";
            const maintNote = document.getElementById("admin-cfg-maintenance-note");
            if (maintNote) maintNote.value = settings.maintenance_note || "";
            // : Registrierungs-Schalter (Default an, falls noch nie gesetzt).
            const regCb = document.getElementById("admin-cfg-registration-enabled");
            if (regCb) regCb.checked = String(settings.registration_enabled || "true").toLowerCase() === "true";
            //: Enterprise-Tarif (cloud-only; Felder in der Community-Edition gestrippt -> null-sicher).
            const entEnabledCb = document.getElementById("admin-cfg-enterprise-enabled");
            if (entEnabledCb) entEnabledCb.checked = String(settings.enterprise_tier_enabled || "true").toLowerCase() !== "false";
            const entTitle = document.getElementById("admin-cfg-enterprise-title");
            if (entTitle) entTitle.value = settings.enterprise_tier_title || "";
            const entDesc = document.getElementById("admin-cfg-enterprise-desc");
            if (entDesc) entDesc.value = settings.enterprise_tier_description || "";
            const entContact = document.getElementById("admin-cfg-enterprise-contact");
            if (entContact) entContact.value = settings.enterprise_contact_email || "";
        } else {
            showToast("Fehler beim Laden der Einstellungen.");
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Laden der Einstellungen.");
    }
    //: In der Community-Edition gelten weder Quota-/Limit- noch Fingerprint-Alert-
    // Einstellungen — die zugehörigen Felder ausblenden (Wrapper .text-field). handleAdminConfigSubmit
    // sendet sie dann nicht mit (Backend behandelt sie als optional), kein 422.
    if (currentEdition === "community") {
        ["admin-cfg-max-guests", "admin-cfg-max-tokens", "admin-cfg-storage-quota", "admin-cfg-max-playbooks"].forEach(id => {
            const el = document.getElementById(id);
            const wrap = el && el.closest(".text-field");
            if (wrap) wrap.style.display = "none";
        });
    }
    // : GoBD-Datumsfelder werden jetzt beim Öffnen des Protokolle-Tabs vorbelegt.
    prefillGobdDates();
}

// : Test-E-Mail zur SMTP-Verifizierung senden.
async function sendAdminTestEmail() {
    const addr = (document.getElementById("admin-test-email-addr").value || "").trim();
    if (!addr) { showToast("Bitte eine Empfänger-E-Mail angeben."); return; }
    const btn = document.getElementById("admin-test-email-btn");
    if (btn) btn.disabled = true;
    try {
        const res = await fetch("/api/admin/config/test-email", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: addr })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) showToast(data.message || "Test-E-Mail gesendet.");
        else showToast(errorDetailToMessage(data.detail, "Test-E-Mail fehlgeschlagen."));
    } catch (e) {
        showToast("Netzwerkfehler beim Senden der Test-E-Mail.");
    } finally {
        if (btn) btn.disabled = false;
    }
}

// /: GoBD-Export-Datumsfelder mit dem laufenden Wirtschaftsjahr vorbelegen.
function prefillGobdDates() {
    const gStart = document.getElementById("gobd-start-date");
    const gEnd = document.getElementById("gobd-end-date");
    if (gStart && gEnd && !gStart.value && !gEnd.value) {
        const year = new Date().getFullYear();
        gStart.value = `${year}-01-01`;
        gEnd.value = `${year}-12-31`;
    }
}

// : GoBD-Export als ZIP herunterladen (GET-Download mit Session-Cookie).
function handleGobdExport() {
    const start = document.getElementById("gobd-start-date").value;
    const end = document.getElementById("gobd-end-date").value;
    if (!start || !end) { showToast("Bitte Start- und Enddatum wählen."); return; }
    if (start > end) { showToast("Das Enddatum muss nach dem Startdatum liegen."); return; }
    const url = `/api/admin/tax-export?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`;
    window.location.href = url;
}

async function handleAdminConfigSubmit(e) {
    e.preventDefault();
    const rate_limit_global_ip = document.getElementById("admin-cfg-global-limit").value;
    const rate_limit_user_ip = document.getElementById("admin-cfg-user-limit").value;
    const ip_ban_duration = document.getElementById("admin-cfg-ban-duration").value;
    const max_active_api_tokens = document.getElementById("admin-cfg-max-tokens").value;
    const max_guest_accounts = document.getElementById("admin-cfg-max-guests").value;
    const max_history_count = document.getElementById("admin-cfg-max-history").value;
    const max_history_age = document.getElementById("admin-cfg-max-history-age").value;
    const storage_quota_mb = document.getElementById("admin-cfg-storage-quota").value;
    const max_custom_playbooks = document.getElementById("admin-cfg-max-playbooks").value;
    // Fingerprint-Alert-Schwellen (cloud-only; in Community gestrippt -> null-sicher, unten bedingt gesendet).
    const fpAlertCountEl = document.getElementById("admin-cfg-fp-alert-count");
    const fpAlertHoursEl = document.getElementById("admin-cfg-fp-alert-hours");
    // : Standard-Timeout für Ausführungen.
    const default_job_timeout = document.getElementById("admin-cfg-job-timeout").value;
    //: Verbindungs-/Sudo-Prompt-Timeout.
    const default_connection_timeout = document.getElementById("admin-cfg-connection-timeout").value;
    // : Passwortregeln.
    const password_min_length = document.getElementById("admin-cfg-pw-min-length").value;
    const password_require_special = document.getElementById("admin-cfg-pw-special").checked ? "true" : "false";
    const password_require_case = document.getElementById("admin-cfg-pw-case").checked ? "true" : "false";
    const password_require_digit = document.getElementById("admin-cfg-pw-digit").checked ? "true" : "false";
    // /: Wartungsmodus + Notiz + Registrierungs-Schalter. In der Community
    // build-gestrippt (community-strip) -> null-sicher und unten nur bedingt gesendet, sonst wuerde
    // die Community diese (dort inerten) Werte bei jedem Speichern unnoetig auf "false" setzen.
    const maintCb = document.getElementById("admin-cfg-maintenance-mode");
    const maintNoteEl = document.getElementById("admin-cfg-maintenance-note");
    const regCb = document.getElementById("admin-cfg-registration-enabled");
    //: Enterprise-Tarif-Felder (cloud-only; in der Community-Edition gestrippt -> null-sicher).
    const entEnabledCb = document.getElementById("admin-cfg-enterprise-enabled");
    const entTitleEl = document.getElementById("admin-cfg-enterprise-title");
    const entDescEl = document.getElementById("admin-cfg-enterprise-desc");
    const entContactEl = document.getElementById("admin-cfg-enterprise-contact");

    const payload = {
        rate_limit_global_ip,
        rate_limit_user_ip,
        ip_ban_duration,
        max_active_api_tokens,
        max_guest_accounts,
        max_history_count,
        max_history_age,
        storage_quota_mb,
        max_custom_playbooks,
        default_job_timeout,
        default_connection_timeout,
        password_min_length,
        password_require_special,
        password_require_case,
        password_require_digit
    };
    //: In der Community-Edition sind diese Felder ausgeblendet (Quota/Limits,
    // Fingerprint-Alerts) — nicht mitsenden (Backend lässt sie unverändert), sonst 422.
    if (currentEdition === "community") {
        ["max_active_api_tokens", "max_guest_accounts", "storage_quota_mb", "max_custom_playbooks"].forEach(k => delete payload[k]);
    }
    //: Enterprise-Felder nur mitsenden, wenn vorhanden (cloud).
    if (entEnabledCb) payload.enterprise_tier_enabled = entEnabledCb.checked ? "true" : "false";
    if (entTitleEl) payload.enterprise_tier_title = entTitleEl.value;
    if (entDescEl) payload.enterprise_tier_description = entDescEl.value;
    if (entContactEl) payload.enterprise_contact_email = entContactEl.value;
    // Fingerprint-Alert-Schwellen nur mitsenden, wenn vorhanden (cloud).
    if (fpAlertCountEl) payload.fingerprint_alert_threshold_count = fpAlertCountEl.value;
    if (fpAlertHoursEl) payload.fingerprint_alert_threshold_hours = fpAlertHoursEl.value;
    // Wartungsmodus/-Notiz + Registrierungs-Schalter nur mitsenden, wenn vorhanden (cloud/onprem;
    // in der Community build-gestrippt -> Werte bleiben unveraendert, kein unnoetiges "false").
    if (maintCb) payload.maintenance_mode = maintCb.checked ? "true" : "false";
    if (maintNoteEl) payload.maintenance_note = maintNoteEl.value;
    if (regCb) payload.registration_enabled = regCb.checked ? "true" : "false";

    try {
        const response = await fetch("/api/admin/settings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (response.ok) {
            showToast("Einstellungen erfolgreich gespeichert.");
            updateMaintenanceBanner();  // : Banner sofort nach Wartungsmodus-Änderung aktualisieren.
        } else {
            showToast(errorDetailToMessage(data.detail, "Fehler beim Speichern der Einstellungen."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Speichern der Einstellungen.");
    }
}

async function fetchAdminIPBlocks() {
    const activeTbody = document.getElementById("admin-active-bans-tbody");
    const historyTbody = document.getElementById("admin-history-bans-tbody");
    if (!activeTbody || !historyTbody) return;

    activeTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--text-muted);">Lade aktive Sperren...</td></tr>`;
    historyTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--text-muted);">Lade Historie...</td></tr>`;

    try {
        const response = await fetch("/api/admin/ip-blocks");
        if (response.ok) {
            const data = await response.json();

            if (data.blocks.length === 0) {
                activeTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--text-muted);">Keine aktiven Sperren.</td></tr>`;
            } else {
                // DOM-Aufbau statt String-Interpolation: kein onclick aus dem (spoofbaren) IP-Wert
                activeTbody.innerHTML = "";
                data.blocks.forEach(b => {
                    const expiryStr = b.expires_at ? new Date(b.expires_at).toLocaleString() : 'Permanent';
                    const tr = document.createElement("tr");
                    tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
                    const td = (txt) => { const c = document.createElement("td"); c.style.padding = "5px"; c.textContent = txt; return c; };
                    tr.appendChild(td(b.ip));
                    tr.appendChild(td(b.reason));
                    tr.appendChild(td(expiryStr));
                    const actTd = document.createElement("td");
                    actTd.style.cssText = "padding:5px; text-align:right;";
                    const btn = document.createElement("button");
                    btn.type = "button"; btn.className = "btn btn-primary btn-small";
                    btn.style.cssText = "background:var(--md-sys-color-error); border-color:var(--md-sys-color-error);";
                    btn.textContent = "Freigeben";
                    btn.addEventListener("click", () => releaseIPBan(b.ip));
                    actTd.appendChild(btn);
                    tr.appendChild(actTd);
                    activeTbody.appendChild(tr);
                });
            }

            if (data.history.length === 0) {
                historyTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--text-muted);">Keine Historie vorhanden.</td></tr>`;
            } else {
                historyTbody.innerHTML = data.history.map(h => {
                    const releasedStr = new Date(h.released_at).toLocaleString();
                    return `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <td style="padding: 5px;">${escapeHtml(h.ip)}</td>
                            <td style="padding: 5px;">${escapeHtml(h.reason)}</td>
                            <td style="padding: 5px;">${releasedStr}</td>
                            <td style="padding: 5px;">${escapeHtml(h.release_method)}</td>
                        </tr>
                    `;
                }).join("");
            }
        } else {
            activeTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--md-sys-color-error);">Fehler beim Laden.</td></tr>`;
            historyTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--md-sys-color-error);">Fehler beim Laden.</td></tr>`;
        }
    } catch (err) {
        activeTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--md-sys-color-error);">Netzwerkfehler.</td></tr>`;
        historyTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--md-sys-color-error);">Netzwerkfehler.</td></tr>`;
    }
}

async function handleAdminIPBanSubmit(e) {
    e.preventDefault();
    const ip = document.getElementById("admin-ban-ip").value.trim();
    const reason = document.getElementById("admin-ban-reason").value.trim();
    const durationInput = document.getElementById("admin-ban-duration").value;
    const duration_seconds = durationInput ? parseInt(durationInput, 10) : null;

    try {
        const response = await fetch("/api/admin/ip-blocks", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ip, reason, duration_seconds })
        });
        const data = await response.json();
        if (response.ok) {
            showToast(`IP ${ip} erfolgreich gesperrt.`);
            document.getElementById("admin-ip-ban-form").reset();
            closeIpBlockDialog();  // 
            fetchAdminIPBlocks();
        } else {
            showToast(errorDetailToMessage(data.detail, "Fehler beim Sperren der IP."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Sperren der IP.");
    }
}

async function releaseIPBan(ip) {
    if (!(await showConfirmDialog({ title: "IP-Sperre aufheben?", message: `Möchten Sie die IP-Sperre für ${ip} wirklich aufheben?`, confirmLabel: "Aufheben" }))) return;

    try {
        const response = await fetch(`/api/admin/ip-blocks/${ip}`, {
            method: "DELETE"
        });
        const data = await response.json();
        if (response.ok) {
            showToast(`IP ${ip} erfolgreich freigegeben.`);
            fetchAdminIPBlocks();
        } else {
            showToast(errorDetailToMessage(data.detail, "Fehler beim Freigeben der IP."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Freigeben der IP.");
    }
}


// Custom Playbooks Handlers
let customPlaybooksData = {};

// : Hello-World-Beispiel-Playbook als YAML-Download generieren, damit Nutzer das
// geforderte Format (hosts: all auf oberster Ebene + einfache Tasks) direkt sehen.
function downloadExamplePlaybook() {
    const yaml = [
        "---",
        "# Hello-World-Beispiel für Ansimate.",
        "# Voraussetzungen: hosts: all auf oberster Ebene; sensible Werte mit no_log: true.",
        "# Die Ausführung erfolgt in einer isolierten Docker-Sandbox.",
        "- name: Hello World",
        "  hosts: all",
        "  gather_facts: false",
        "  tasks:",
        "    - name: Verbindung zum Zielhost testen",
        "      ansible.builtin.ping:",
        "",
        "    - name: Begrüßung ausgeben",
        "      ansible.builtin.debug:",
        '        msg: "Hallo von Ansimate!"',
        "",
    ].join("\n");
    const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hello-world.yml";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function fetchCustomPlaybooks() {
    const listEl = document.getElementById("custom-playbooks-list");
    if (!listEl) return;
    listEl.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">Lade eigene Playbooks...</p>`;

    try {
        // : kein HTTP-Cache -> nach Login/Upload sofort die aktuellen eigenen Playbooks
        // (eine vor dem Login gecachte Antwort ohne Custom-Einträge wird nicht wiederverwendet).
        const response = await fetch("/api/playbooks", { cache: "no-store" });
        if (!response.ok) {
            listEl.innerHTML = `<p style="color: var(--md-sys-color-error); font-size: 13px;">Fehler beim Laden der Playbooks.</p>`;
            return;
        }
        const playbooks = await response.json();
        const custom = playbooks.filter(pb => pb.custom === true);
        customPlaybooksData = {};
        custom.forEach(pb => { customPlaybooksData[pb.filename] = pb; });

        if (custom.length === 0) {
            listEl.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">Keine eigenen Playbooks hochgeladen.</p>`;
            return;
        }

        listEl.innerHTML = "";
        custom.forEach(pb => {
            const row = document.createElement("div");
            // : Abstände exakt wie die Geräte-Liste -> kein margin-bottom (Spacing nur via Container-gap),
            // sonst doppelter Abstand (gap + margin) und unruhigeres Layout als bei "Geräte".
            row.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; background:rgba(255,255,255,0.02); font-size:13px;";
            // : Linke Gruppe = Freigeben + Bearbeiten + Logo/Name/Meta (Layout wie).
            const leftGroup = document.createElement("div");
            leftGroup.style.cssText = "display:flex; align-items:center; gap:8px; min-width:0;";
            const shareBtn = vaultActionButton("Freigeben", "share", "primary");
            shareBtn.addEventListener("click", () => openShareCustomPlaybook(pb.filename));
            const editBtn = vaultActionButton("Bearbeiten", "edit", "secondary");
            editBtn.addEventListener("click", () => openEditCustomPlaybook(pb.filename));
            leftGroup.appendChild(shareBtn); leftGroup.appendChild(editBtn);
            const logoBox = document.createElement("div");
            logoBox.style.cssText = "flex:0 0 auto;";
            if (pb.icon_value) {
                const img = document.createElement("img");
                img.src = pb.icon_value; // data URI or https URL (set as property, no injection)
                img.alt = "";
                img.style.cssText = "width:30px; height:30px; border-radius:5px; object-fit:cover;";
                logoBox.appendChild(img);
            } else {
                logoBox.innerHTML = '<span class="material-symbols-outlined" style="color:var(--md-sys-color-primary);">description</span>';
            }
            const textBox = document.createElement("div");
            textBox.style.minWidth = "0";
            const guestCount = (pb.guest_access || []).length;
            const sizeKb = (pb.size / 1024).toFixed(1) + " KB";
            textBox.innerHTML =
                `<div style="font-weight:bold; color:var(--md-sys-color-primary);">${escapeHtml(pb.name)}</div>` +
                `<div style="color:var(--text-secondary); font-size:12px;">${escapeHtml(pb.description || '')}</div>` +
                `<div style="color:var(--text-muted); font-size:11px;">${sizeKb}${guestCount ? ' &middot; ' + guestShareLabel(guestCount) : ''}</div>`;
            leftGroup.appendChild(logoBox);
            leftGroup.appendChild(textBox);
            row.appendChild(leftGroup);
            const right = document.createElement("div");
            right.style.whiteSpace = "nowrap";
            const delBtn = vaultActionButton("Löschen", "delete", "danger");
            delBtn.addEventListener("click", () => deleteCustomPlaybook(pb.filename, pb.name));
            right.appendChild(delBtn);
            row.appendChild(right);
            listEl.appendChild(row);
        });
    } catch (err) {
        listEl.innerHTML = `<p style="color: var(--md-sys-color-error); font-size: 13px;">Netzwerkfehler beim Laden der Playbooks.</p>`;
    }
}

let editingCustomPlaybook = null;

async function openEditCustomPlaybook(filename) {
    const pb = customPlaybooksData[filename];
    if (!pb) return;
    editingCustomPlaybook = filename;
    document.getElementById("custom-pb-edit-filename").textContent = filename;
    document.getElementById("custom-pb-edit-name").value = pb.name || "";
    document.getElementById("custom-pb-edit-desc").value = pb.description || "";
    document.getElementById("custom-pb-edit-icon-url").value = (pb.icon_type === "url" ? (pb.icon_value || "") : "");
    document.getElementById("custom-pb-edit-icon-file").value = "";
    updateEditIconLbl();   //: Datei-Label der Dropzone zuruecksetzen

    //: Freigaben sind ausgelagert in den dedizierten Freigabe-Dialog.
    document.getElementById("custom-pb-edit-dialog").classList.remove("hidden");
}

//: Datei-Label der Logo-Dropzone im Bearbeiten-Dialog aktualisieren.
function updateEditIconLbl() {
    const editIconInput = document.getElementById("custom-pb-edit-icon-file");
    const lbl = document.getElementById("custom-pb-edit-icon-filename-lbl");
    if (lbl) lbl.textContent = (editIconInput && editIconInput.files.length) ? editIconInput.files[0].name : "Keine Datei ausgewählt";
}

function closeEditCustomPlaybook() {
    document.getElementById("custom-pb-edit-dialog").classList.add("hidden");
    editingCustomPlaybook = null;
}

//: dedizierter Freigabe-Dialog (entkoppelt vom Bearbeiten)
let sharingCustomPlaybook = null;

async function openShareCustomPlaybook(filename) {
    const pb = customPlaybooksData[filename];
    if (!pb) return;
    sharingCustomPlaybook = filename;
    document.getElementById("playbook-share-filename").textContent = filename;
    const container = document.getElementById("playbook-share-guests");
    container.innerHTML = '<p style="color: var(--text-muted); margin:0;">Lade Teammitglieder...</p>';
    document.getElementById("playbook-share-dialog").classList.remove("hidden");
    try {
        const guests = await fetchGuestList();
        if (!guests || guests.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); margin:0;">Keine Teammitglieder vorhanden. Legen Sie zuerst im Team-Bereich welche an.</p>';
            return;
        }
        const enabled = new Set(pb.guest_access || []);
        container.innerHTML = "";
        guests.forEach(g => {
            const row = document.createElement("label");
            row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer;";
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.className = "styled-checkbox pb-share-guest";
            cb.value = g.id;
            cb.checked = enabled.has(g.id);
            row.appendChild(cb);
            const span = document.createElement("span");
            span.textContent = `${g.username} (${g.email})`;
            row.appendChild(span);
            container.appendChild(row);
        });
    } catch (e) {
        container.innerHTML = '<p style="color:var(--md-sys-color-error); margin:0;">Teammitglieder konnten nicht geladen werden.</p>';
    }
}

function closeShareCustomPlaybook() {
    document.getElementById("playbook-share-dialog").classList.add("hidden");
    sharingCustomPlaybook = null;
}

async function saveShareCustomPlaybook() {
    if (!sharingCustomPlaybook) return;
    const checked = Array.from(document.querySelectorAll("#playbook-share-guests .pb-share-guest:checked")).map(c => c.value);
    // Nur Freigaben aktualisieren - Name/Beschreibung/Icon bleiben unberuehrt (entkoppelt).
    const fd = new FormData();
    fd.append("filename", sharingCustomPlaybook);
    fd.append("guest_access", JSON.stringify(checked));
    try {
        const res = await fetch("/api/playbooks/custom-meta", { method: "POST", body: fd });
        const data = await res.json();
        if (res.ok) {
            showToast("Freigabe gespeichert.");
            closeShareCustomPlaybook();
            await fetchCustomPlaybooks();
            await fetchPlaybooks();
        } else {
            showToast(errorDetailToMessage(data.detail, "Speichern fehlgeschlagen."));
        }
    } catch (e) {
        showToast("Netzwerkfehler beim Speichern.");
    }
}

async function saveCustomPlaybookMeta() {
    if (!editingCustomPlaybook) return;
    const fd = new FormData();
    fd.append("filename", editingCustomPlaybook);
    fd.append("name", document.getElementById("custom-pb-edit-name").value.trim());
    fd.append("description", document.getElementById("custom-pb-edit-desc").value.trim());
    const iconUrl = document.getElementById("custom-pb-edit-icon-url").value.trim();
    if (iconUrl) fd.append("icon_url", iconUrl);
    const iconFile = document.getElementById("custom-pb-edit-icon-file").files[0];
    if (iconFile) fd.append("icon", iconFile);
    //: guest_access wird hier NICHT mehr gesendet (eigener Freigabe-Dialog).

    try {
        const res = await fetch("/api/playbooks/custom-meta", { method: "POST", body: fd });
        const data = await res.json();
        if (res.ok) {
            showToast("Playbook-Einstellungen gespeichert.");
            closeEditCustomPlaybook();
            await fetchCustomPlaybooks();
            await fetchPlaybooks();
        } else {
            showToast(errorDetailToMessage(data.detail, "Speichern fehlgeschlagen."));
        }
    } catch (e) {
        showToast("Netzwerkfehler beim Speichern.");
    }
}

async function handleCustomPlaybookUpload(e) {
    e.preventDefault();
    const fileInput = document.getElementById("custom-playbook-file-input");
    if (!fileInput || fileInput.files.length === 0) {
        showToast("Bitte wählen Sie zuerst eine Datei aus.");
        return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("file", file);
    const nm = document.getElementById("custom-pb-name");
    const ds = document.getElementById("custom-pb-desc");
    const iu = document.getElementById("custom-pb-icon-url");
    const ic = document.getElementById("custom-pb-icon-file");
    if (nm && nm.value.trim()) formData.append("name", nm.value.trim());
    if (ds && ds.value.trim()) formData.append("description", ds.value.trim());
    if (iu && iu.value.trim()) formData.append("icon_url", iu.value.trim());
    if (ic && ic.files[0]) formData.append("icon", ic.files[0]);

    try {
        const response = await fetch("/api/playbooks/upload", {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        if (response.ok) {
            showToast("Playbook erfolgreich hochgeladen und validiert.");
            document.getElementById("custom-playbook-upload-form").reset();
            document.getElementById("custom-playbook-filename-lbl").textContent = "Keine Datei ausgewählt";
            //: Logo-Upload-Box-Label ebenfalls zuruecksetzen.
            const iconLbl = document.getElementById("custom-pb-icon-filename-lbl");
            if (iconLbl) iconLbl.textContent = "Keine Datei ausgewählt";
            // : Reset-Buttons der Dropzones nach erfolgreichem Upload wieder ausblenden.
            ["custom-playbook-reset", "custom-pb-icon-reset"].forEach(id => { const b = document.getElementById(id); if (b) b.classList.add("hidden"); });
            closeCustomPbCreateDialog();  // : Hochladen-Dialog nach Erfolg schließen

            await fetchCustomPlaybooks();
            await fetchPlaybooks();
        } else {
            showToast(errorDetailToMessage(data.detail, "Fehler beim Hochladen."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Hochladen des Playbooks.");
    }
}

async function deleteCustomPlaybook(filename, name) {
    // : Playbook-Anzeigename (Fallback Dateiname) fett in der Bestätigungsfrage.
    const label = name || filename;
    if (!(await showConfirmDialog({ title: "Playbook löschen?", messageHtml: `Möchten Sie das Playbook <b>${escapeHtml(label)}</b> wirklich löschen?`, confirmLabel: "Löschen" }))) return;

    try {
        const response = await fetch(`/api/playbooks/custom/${filename}`, {
            method: "DELETE"
        });
        const data = await response.json();
        if (response.ok) {
            showToast("Playbook erfolgreich gelöscht.");
            await fetchCustomPlaybooks();
            await fetchPlaybooks();
        } else {
            showToast(errorDetailToMessage(data.detail, "Fehler beim Löschen."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Löschen des Playbooks.");
    }
}

// Legal & Privacy Helper Functions (: keine window-Bindings noetig – siehe Event-Delegation)
function closeLegalModal(type) {
    const modal = document.getElementById(`${type}-modal`);
    if (modal) modal.classList.add("hidden");
}

// AVV signature helper functions
function openAVVSignatureModal() {
    document.getElementById("avv-signature-modal").classList.remove("hidden");
}

function closeAVVSignatureModal() {
    document.getElementById("avv-signature-modal").classList.add("hidden");
}

async function handleAVVSignFormSubmit(e) {
    e.preventDefault();
    const company = document.getElementById("avv-company-input").value.trim();
    const representative = document.getElementById("avv-representative-input").value.trim();
    const acceptChecked = document.getElementById("avv-checkbox-input").checked;

    if (!company || !representative || !acceptChecked) {
        showToast("Bitte füllen Sie alle Felder aus und bestätigen Sie die Einwilligung.");
        return;
    }

    try {
        const response = await fetch("/api/profile/sign-avv", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ company, representative })
        });
        const data = await response.json();
        
        if (response.ok) {
            showToast("AVV erfolgreich unterzeichnet.");
            closeAVVSignatureModal();
            // Refresh auth status to reload signed AVV status
            await checkAuthStatus();
            
            // Proactively trigger the download of the personalized PDF
            window.location.href = "/api/legal/avv-download";
        } else {
            showToast(errorDetailToMessage(data.detail, "Fehler beim Unterzeichnen des AVVs."));
        }
    } catch (err) {
        showToast("Netzwerkfehler beim Unterzeichnen des AVVs.");
    }
}

// Cookie Consent & Telemetry blocking functions
function initCookieConsent() {
    const consent = localStorage.getItem("ansimate_cookie_consent");
    if (!consent) {
        document.getElementById("cookie-consent-banner").classList.remove("hidden");
    } else {
        const consentObj = JSON.parse(consent);
        if (consentObj.analytics) {
            initializeTelemetry();
        }
    }
}

function showCookiePreferences() {
    document.getElementById("cookie-preferences").classList.remove("hidden");
    document.getElementById("cookie-customize-btn").classList.add("hidden");
    document.getElementById("cookie-decline-btn").classList.add("hidden");
    document.getElementById("cookie-accept-all-btn").classList.add("hidden");
    document.getElementById("cookie-save-pref-btn").classList.remove("hidden");
}

function saveCookieConsent(functional, analytics) {
    const consentObj = { essential: true, functional, analytics };
    localStorage.setItem("ansimate_cookie_consent", JSON.stringify(consentObj));
    document.getElementById("cookie-consent-banner").classList.add("hidden");
    
    if (analytics) {
        initializeTelemetry();
    }
    showToast("Cookie-Einstellungen gespeichert.");
}

function saveCustomCookieConsent() {
    const analytics = document.getElementById("cookie-pref-analytics").checked;
    saveCookieConsent(true, analytics);
}

let telemetryInitialized = false;
function initializeTelemetry() {
    console.log("[Telemetry] Initialisiere anonymisierte Nutzungsstatistiken (opt-in gewährt)...");

    //: Kein dynamisch injiziertes <script> mehr (wurde von der gehärteten CSP
    // script-src 'self' blockiert,). Der Mock-Tracking-Hinweis wird direkt aus dem
    // bereits geladenen JS heraus geloggt – CSP-konform und idempotent.
    if (!telemetryInitialized) {
        telemetryInitialized = true;
        console.log("[Telemetry] Mock-Tracking-Dienst läuft im Hintergrund.");
    }
}

// Collaboration and API Tokens Controllers
let guestsData = {};   //: id -> guest (inkl. revoked_playbooks)

// : menschenlesbare Bezeichnungen fuer die Audit-Aktionscodes.
const AUDIT_ACTION_LABELS = {
    "playbook.run": "Playbook ausgeführt",
    "device_group.create": "Gerätegruppe erstellt",
    "device_group.update": "Gerätegruppe geändert",
    "device_group.delete": "Gerätegruppe gelöscht",
    "guest.create": "Gast-Account angelegt",
    "guest.delete": "Gast-Account gelöscht",
    "guest.update": "Teammitglied bearbeitet",
    "guest.permissions_update": "Freigaben geändert",
    "playbook.share_update": "Playbook-Freigabe geändert",
    "scenario.create": "Szenario erstellt",
    "scenario.update": "Szenario geändert",
    "scenario.delete": "Szenario gelöscht",
};

// : kompakte, sichere Detail-Darstellung (nur Schlüssel/Anzahl, keine Secrets).
function formatAuditDetails(action, details) {
    if (!details || typeof details !== "object") return "";
    const parts = [];
    if (Array.isArray(details.playbooks) && details.playbooks.length) {
        parts.push(`Playbooks: ${details.playbooks.join(", ")}`);
    }
    if (details.target) parts.push(`Ziel: ${details.target}`);
    if (details.variables && typeof details.variables === "object") {
        const keys = Object.keys(details.variables).filter(k => k !== "use_traefik");
        if (keys.length) parts.push(`Variablen: ${keys.join(", ")}`);
    }
    if (typeof details.devices === "number") parts.push(`${details.devices} Geräte`);
    if (typeof details.guests === "number") parts.push(`${details.guests} Freigaben`);
    if (typeof details.playbooks === "number") parts.push(`${details.playbooks} Playbooks`);
    if (typeof details.revoked === "number") parts.push(`${details.revoked} gesperrt`);
    if (typeof details.shared_premium === "number") parts.push(`${details.shared_premium} Premium freigegeben`);
    if (details.email) parts.push(escapeHtml(details.email));
    return parts.map(p => escapeHtml(String(p))).join(" · ");
}

async function loadAuditLog() {
    const tbody = document.getElementById("audit-log-tbody");
    const statusEl = document.getElementById("audit-log-status");
    if (!tbody) return;
    if (statusEl) statusEl.textContent = "Lade…";
    try {
        const res = await fetch("/api/profile/audit-log");
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:10px; color:var(--md-sys-color-error);">Protokoll konnte nicht geladen werden.</td></tr>';
            if (statusEl) statusEl.textContent = "";
            return;
        }
        const entries = await res.json();
        if (!entries.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:10px; color: var(--text-muted);">Noch keine Aktivitäten protokolliert.</td></tr>';
            if (statusEl) statusEl.textContent = "";
            return;
        }
        tbody.innerHTML = entries.map(e => {
            const ts = e.timestamp ? new Date(e.timestamp).toLocaleString("de-DE") : "";
            const actor = escapeHtml(e.actor || "—");
            const action = escapeHtml(AUDIT_ACTION_LABELS[e.action] || e.action || "");
            const target = escapeHtml(e.target || "—");
            const det = formatAuditDetails(e.action, e.details);
            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 8px 5px; white-space: nowrap; color: var(--text-secondary);">${ts}</td>
                    <td style="padding: 8px 5px;">${actor}</td>
                    <td style="padding: 8px 5px;">${action}</td>
                    <td style="padding: 8px 5px;">${target}</td>
                    <td style="padding: 8px 5px; color: var(--text-secondary); font-size: 12px;">${det}</td>
                </tr>`;
        }).join("");
        if (statusEl) statusEl.textContent = `${entries.length} Einträge`;
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:10px; color:var(--md-sys-color-error);">Netzwerkfehler.</td></tr>';
        if (statusEl) statusEl.textContent = "";
    }
}

// Community sperrt /api/profile/guests bewusst (404, kein Mehrbenutzer-/Teammitglieder-Scope).
// Dort den Request gar nicht erst absetzen (sonst 404-Rauschen in der Browser-Konsole),
// sondern eine leere Liste liefern. In Cloud/On-Premise normal abrufen.
async function fetchGuestList() {
    if (currentEdition === "community") return [];
    try {
        const res = await fetch("/api/profile/guests");
        return res.ok ? await res.json() : [];
    } catch (e) { return []; }
}

async function fetchGuests() {
    // Community: keine Teammitglieder -> Endpoint nicht anfragen (404 by design).
    if (currentEdition === "community") { guestsData = {}; return; }
    try {
        const res = await fetch("/api/profile/guests");
        if (res.ok) {
            const guests = await res.json();
            guestsData = {};
            guests.forEach(g => { guestsData[g.id] = g; });
            const listEl = document.getElementById("guests-list");
            if (listEl) {
                if (guests.length === 0) {
                    listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 13px; margin:0;">Keine Teammitglieder angelegt.</p>';
                } else {
                    listEl.innerHTML = guests.map(g => {
                        // : Freigabe-Zähler je Typ (Playbooks/Geräte/Szenarien) als kurzer Überblick.
                        const sh = g.shares || {};
                        const fmt = (o) => o ? `${o.shared}/${o.total}` : "0/0";
                        const counts = `Playbooks ${fmt(sh.playbooks)} · Geräte ${fmt(sh.devices)} · Szenarien ${fmt(sh.scenarios)}`;
                        // : Freigabe- & Verwaltungs-Buttons + Name/Mail neben Freigaben.
                        return `
                        <div class="team-member-row" style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; background:rgba(255,255,255,0.02);">
                            <div style="display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap;">
                                <!-- M52: feste Reihenfolge Szenarios, Playbooks, Geräte, Aktivitäten, Bearbeiten (mit Text). -->
                                <button type="button" class="btn btn-secondary btn-small" data-action="guest-scenarios" data-id="${escapeHtml(g.id)}" title="Szenarien freigeben">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">rocket_launch</span> Szenarien
                                </button>
                                <button type="button" class="btn btn-secondary btn-small" data-action="guest-revoke" data-id="${escapeHtml(g.id)}" title="Playbooks freigeben">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">terminal</span> Playbooks
                                </button>
                                <button type="button" class="btn btn-secondary btn-small" data-action="guest-devices" data-id="${escapeHtml(g.id)}" title="Geräte freigeben">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">devices</span> Geräte
                                </button>
                                <button type="button" class="btn btn-secondary btn-small" data-action="guest-activity" data-id="${escapeHtml(g.id)}" title="Aktivitäten anzeigen">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">history</span> Aktivitäten
                                </button>
                                <button type="button" class="btn btn-secondary btn-small" data-action="guest-edit" data-id="${escapeHtml(g.id)}" title="Teammitglied bearbeiten">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">edit</span> Bearbeiten
                                </button>
                                <div class="team-member-meta">
                                    <span style="font-weight:bold; color:var(--md-sys-color-primary);">${escapeHtml(g.username)} <span style="font-weight:normal; color:var(--text-secondary);">(${escapeHtml(g.email)})</span></span>
                                    <span class="team-member-shares" style="color:var(--text-muted);">${escapeHtml(counts)}</span>
                                </div>
                            </div>
                            <div style="white-space:nowrap;">
                                <button type="button" class="btn btn-small btn-danger" data-action="guest-delete" data-id="${escapeHtml(g.id)}">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">delete</span> Löschen
                                </button>
                            </div>
                        </div>`;
                    }).join('');
                }
            }
        }
    } catch (err) {
        console.error("Failed to fetch guests:", err);
    }
}

// : Geräte-Freigabe je Teammitglied — zeigt die Geräte(-Gruppen) des Besitzers mit
// Checkbox (angehakt = für diesen Gast freigegeben) und setzt die guest_access serverseitig.
let sharingDevicesGuestId = null;
async function openGuestDevicesDialog(guestId) {
    const guest = guestsData[guestId];
    if (!guest) return;
    sharingDevicesGuestId = guestId;
    document.getElementById("guest-devices-username").textContent = guest.username;
    const container = document.getElementById("guest-devices-list");
    container.innerHTML = '<p style="color: var(--text-muted); margin:0;">Lade Geräte...</p>';
    document.getElementById("guest-devices-dialog").classList.remove("hidden");
    try {
        // (Device-Flatten): Freigabe je Geraet (flache Geraeteliste).
        const res = await fetch("/api/profile/devices-unified");
        const devices = res.ok ? await res.json() : [];
        if (!devices.length) {
            container.innerHTML = '<p style="color: var(--text-muted); margin:0;">Keine Geräte vorhanden. Legen Sie zuerst Geräte unter „My Vault → Geräte" an.</p>';
            return;
        }
        container.innerHTML = "";
        devices.forEach(d => {
            const row = document.createElement("label");
            row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer;";
            const cb = document.createElement("input");
            cb.type = "checkbox"; cb.className = "styled-checkbox gd-share"; cb.value = d.id;
            cb.checked = (d.guest_access || []).includes(guestId);
            row.appendChild(cb);
            const span = document.createElement("span");
            span.textContent = d.host ? `${d.name} (${d.host})` : d.name;
            row.appendChild(span);
            container.appendChild(row);
        });
    } catch (e) {
        container.innerHTML = '<p style="color:var(--md-sys-color-error); margin:0;">Geräte konnten nicht geladen werden.</p>';
    }
}
function closeGuestDevicesDialog() {
    document.getElementById("guest-devices-dialog").classList.add("hidden");
    sharingDevicesGuestId = null;
}
async function saveGuestDevicesDialog() {
    if (!sharingDevicesGuestId) return;
    const device_ids = Array.from(document.querySelectorAll("#guest-devices-list .gd-share:checked")).map(c => c.value);
    try {
        const res = await fetch(`/api/profile/guests/${sharingDevicesGuestId}/device-shares`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_ids })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            showToast("Geräte-Freigabe gespeichert.");
            closeGuestDevicesDialog();
            await fetchGuests();  // Zähler aktualisieren
        } else {
            showToast(errorDetailToMessage(data.detail, "Speichern fehlgeschlagen."));
        }
    } catch (e) { showToast("Netzwerkfehler beim Speichern."); }
}

//: Dialog - Besitzer entzieht einem Gast selektiv Playbooks
let revokingGuestId = null;

// : kleines Playbook-Logo/-Icon fuer Listen wie den Freigabe-Dialog.
function playbookIconHtml(pb) {
    let iconSrc = "";
    //: hochgeladenes/verknuepftes Custom-Logo bevorzugen.
    if (pb.icon_value) {
        iconSrc = pb.icon_value;
    } else if (pb.icon) {
        if (pb.icon.includes(".") || pb.icon.includes("/")) iconSrc = `images/${pb.icon}`;
        else if (localIconMap[pb.icon]) iconSrc = `images/${localIconMap[pb.icon]}`;
    }
    if (iconSrc) {
        const img = document.createElement("img");
        img.alt = "";
        img.style.cssText = "width:22px; height:22px; object-fit:contain;";
        img.src = iconSrc;
        return img.outerHTML;
    }
    return `<span class="material-symbols-outlined" style="font-size:20px;">${escapeHtml(pb.icon || 'settings')}</span>`;
}

async function openGuestRevokeDialog(guestId) {
    const guest = guestsData[guestId];
    if (!guest) return;
    revokingGuestId = guestId;
    document.getElementById("guest-revoke-username").textContent = guest.username;
    const container = document.getElementById("guest-revoke-list");
    container.innerHTML = '<p style="color: var(--text-muted); margin:0;">Lade Playbooks...</p>';
    document.getElementById("guest-revoke-dialog").classList.remove("hidden");
    try {
        const res = await fetch("/api/playbooks");
        const all = res.ok ? await res.json() : [];
        // Custom-Playbooks werden ueber ihren eigenen Freigabe-Dialog verwaltet;
        // dieser Dialog steuert den Standardkatalog (Free + Premium).
        const playbooks = all.filter(pb => !pb.custom);
        if (!playbooks.length) {
            container.innerHTML = '<p style="color: var(--text-muted); margin:0;">Keine Playbooks vorhanden.</p>';
            return;
        }
        const revoked = new Set(guest.revoked_playbooks || []);
        const shared = new Set(guest.shared_premium_playbooks || []);
        container.innerHTML = "";

        //: nach Kategorien gruppieren (analog zur Startseite), "Sonstige" zuletzt.
        const grouped = {};
        playbooks.forEach(pb => {
            const cat = (pb.category && pb.category.trim()) ? pb.category.trim() : "Sonstige";
            (grouped[cat] = grouped[cat] || []).push(pb);
        });
        const catNames = Object.keys(grouped).sort((a, b) => {
            if (a === "Sonstige") return 1;
            if (b === "Sonstige") return -1;
            return a.localeCompare(b);
        });

        catNames.forEach(cat => {
            const h = document.createElement("div");
            h.textContent = cat;
            h.style.cssText = "font-weight:600; color:var(--md-sys-color-primary); margin:12px 0 6px;";
            container.appendChild(h);
            grouped[cat].forEach(pb => {
                const isPremium = !!pb.premium;
                //: einheitliche Semantik -> angehakt = Zugriff gewaehrt.
                // Standard: Zugriff, solange NICHT entzogen; Premium: nur bei expliziter Freigabe.
                const checked = isPremium ? shared.has(pb.file) : !revoked.has(pb.file);
                //: Zeilenlayout [Checkbox] -> [Logo] -> [Titel]
                const row = document.createElement("label");
                row.style.cssText = "display:flex; align-items:center; gap:10px; margin-bottom:6px; cursor:pointer;";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.className = "styled-checkbox guest-access-cb";
                cb.value = pb.file;
                cb.checked = checked;
                if (isPremium) cb.dataset.premium = "1";
                row.appendChild(cb);
                const iconWrap = document.createElement("span");
                iconWrap.style.cssText = "display:inline-flex; width:24px; justify-content:center; flex:0 0 auto;";
                iconWrap.innerHTML = playbookIconHtml(pb);
                row.appendChild(iconWrap);
                const span = document.createElement("span");
                span.textContent = pb.name + (isPremium ? " (Premium)" : "");
                row.appendChild(span);
                container.appendChild(row);
            });
        });
    } catch (e) {
        container.innerHTML = '<p style="color:var(--md-sys-color-error); margin:0;">Playbooks konnten nicht geladen werden.</p>';
    }
}

function closeGuestRevokeDialog() {
    document.getElementById("guest-revoke-dialog").classList.add("hidden");
    revokingGuestId = null;
}

async function saveGuestRevoke() {
    if (!revokingGuestId) return;
    // : angehakt = Zugriff. Standard-Playbooks ohne Haken werden entzogen
    // (revoked); Premium-Playbooks mit Haken werden freigegeben (shared).
    const cbs = Array.from(document.querySelectorAll("#guest-revoke-list .guest-access-cb"));
    const revoked = cbs.filter(c => c.dataset.premium !== "1" && !c.checked).map(c => c.value);
    const sharedPremium = cbs.filter(c => c.dataset.premium === "1" && c.checked).map(c => c.value);
    try {
        const res = await fetch(`/api/profile/guests/${revokingGuestId}/revoked-playbooks`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playbooks: revoked, shared_premium: sharedPremium })
        });
        const data = await res.json();
        if (res.ok) {
            showToast("Playbook-Freigaben aktualisiert.");
            closeGuestRevokeDialog();
            fetchGuests();
        } else {
            showToast(errorDetailToMessage(data.detail, "Speichern fehlgeschlagen."));
        }
    } catch (e) {
        showToast("Netzwerkfehler beim Speichern.");
    }
}

async function deleteGuest(id) {
    if (!(await showConfirmDialog({ title: "Teammitglied löschen?", message: "Möchten Sie dieses Teammitglied wirklich löschen?", confirmLabel: "Löschen" }))) return;
    try {
        const res = await fetch(`/api/profile/guests/${id}`, { method: "DELETE" });
        if (res.ok) {
            showToast("Teammitglied erfolgreich gelöscht.");
            fetchGuests();
        } else {
            const err = await res.json();
            showToast(err.detail || "Fehler beim Löschen des Teammitglieds.");
        }
    } catch (err) {
        console.error("Failed to delete guest:", err);
        showToast("Netzwerkfehler.");
    }
}

async function fetchTokens() {
    try {
        const res = await fetch("/api/profile/tokens");
        if (res.ok) {
            const tokens = await res.json();
            const tbody = document.getElementById("tokens-tbody");
            if (tbody) {
                if (tokens.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--text-muted);">Keine API-Token generiert.</td></tr>';
                } else {
                    tbody.innerHTML = tokens.map(t => {
                        const scopesBadges = t.scopes.map(s => {
                            //: run_playbook -> "run", alles andere (read_logs/manage_*) -> "read"-Stil.
                            const scopeClass = s === "run_playbook" ? "run" : "read";
                            return `<span class="scope-badge ${scopeClass}">${escapeHtml(s)}</span>`;
                        }).join('');
                        //: Ablaufdatum anzeigen (falls gesetzt), sonst „unbegrenzt".
                        const expiryLabel = t.expires_at
                            ? escapeHtml(new Date(t.expires_at).toLocaleDateString("de-DE"))
                            : '<span style="color: var(--text-muted);">unbegrenzt</span>';
                        return `
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <td style="padding: 8px 5px;">${escapeHtml(t.name)}</td>
                                <td style="padding: 8px 5px;">${scopesBadges}</td>
                                <td style="padding: 8px 5px; font-size: 12px; color: var(--text-secondary);">${expiryLabel}</td>
                                <td style="padding: 8px 5px; text-align: right;">
                                    <button type="button" class="btn-small-danger" data-action="token-delete" data-id="${escapeHtml(t.id)}">
                                        <span class="material-symbols-outlined" style="font-size: 14px;">link_off</span> Widerrufen
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('');
                }
            }
        }
    } catch (err) {
        console.error("Failed to fetch tokens:", err);
    }
}

async function deleteToken(id) {
    if (!(await showConfirmDialog({ title: "Token widerrufen?", message: "Möchten Sie diesen API-Token wirklich widerrufen?", confirmLabel: "Widerrufen" }))) return;
    try {
        const res = await fetch(`/api/profile/tokens/${id}`, { method: "DELETE" });
        if (res.ok) {
            showToast("API-Token erfolgreich widerrufen.");
            fetchTokens();
        } else {
            const err = await res.json();
            showToast(err.detail || "Fehler beim Widerrufen des Tokens.");
        }
    } catch (err) {
        console.error("Failed to delete token:", err);
        showToast("Netzwerkfehler.");
    }
}

async function handleGuestSubmit() {
    const usernameInput = document.getElementById("guest-username");
    const emailInput = document.getElementById("guest-email");
    const passwordInput = document.getElementById("guest-password");
    
    const username = usernameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    
    if (!username || !email || !password) {
        showToast("Bitte füllen Sie alle Felder aus.");
        return;
    }
    
    try {
        const res = await fetch("/api/profile/guests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, email, password })
        });
        
        if (res.ok) {
            showToast("Teammitglied erfolgreich angelegt.");
            usernameInput.value = "";
            emailInput.value = "";
            passwordInput.value = "";
            closeGuestCreateDialog();   // 
            fetchGuests();
        } else {
            const err = await res.json();
            showToast(err.detail || "Fehler beim Anlegen des Teammitglieds.");
        }
    } catch (err) {
        console.error("Guest creation failed:", err);
        showToast("Netzwerkfehler.");
    }
}

// ===========================================================================
// : Teams-UX — Tabs, Erstellen-/Bearbeiten-/Szenario-/Aktivitäten-Dialoge
// ===========================================================================

// : Tab-Umschaltung Benutzer/Aktivitäten (Muster wie switchVaultTab).
function switchTeamsTab(tabName) {
    if (tabName !== "activity") tabName = "users";
    document.querySelectorAll(".team-tab-content").forEach(c => c.classList.add("hidden"));
    document.querySelectorAll(".tab-btn").forEach(btn => {
        if (btn.id === "team-tab-users-btn" || btn.id === "team-tab-activity-btn") {
            btn.classList.remove("active");
            btn.style.color = "rgba(255,255,255,0.7)";
            btn.style.borderBottom = "none";
        }
    });
    const content = document.getElementById(`team-tab-${tabName}`);
    if (content) content.classList.remove("hidden");
    const btn = document.getElementById(`team-tab-${tabName}-btn`);
    if (btn) {
        btn.classList.add("active");
        btn.style.color = "var(--md-sys-color-primary)";
        btn.style.borderBottom = "2px solid var(--md-sys-color-primary)";
    }
    // FAB nur auf dem Benutzer-Tab (CSS: body.tab-teams.team-activity-tab #team-fab { display:none }).
    document.body.classList.toggle("team-activity-tab", tabName === "activity");
    if (tabName === "activity") loadAuditLog();
}

// : Erstellen-Dialog öffnen/schließen.
function openGuestCreateDialog() {
    ["guest-username", "guest-email", "guest-password"].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = "";
    });
    const dlg = document.getElementById("guest-create-dialog");
    if (dlg) dlg.classList.remove("hidden");
}
function closeGuestCreateDialog() {
    const dlg = document.getElementById("guest-create-dialog");
    if (dlg) dlg.classList.add("hidden");
}

// : Teammitglied bearbeiten.
function openGuestEditDialog(guestId) {
    const g = guestsData[guestId];
    if (!g) return;
    document.getElementById("guest-edit-id").value = guestId;
    document.getElementById("guest-edit-username").value = g.username || "";
    document.getElementById("guest-edit-email").value = g.email || "";
    document.getElementById("guest-edit-password").value = "";
    const dlg = document.getElementById("guest-edit-dialog");
    if (dlg) dlg.classList.remove("hidden");
}
function closeGuestEditDialog() {
    const dlg = document.getElementById("guest-edit-dialog");
    if (dlg) dlg.classList.add("hidden");
}
async function saveGuestEdit() {
    const id = document.getElementById("guest-edit-id").value;
    const username = document.getElementById("guest-edit-username").value.trim();
    const email = document.getElementById("guest-edit-email").value.trim();
    const password = document.getElementById("guest-edit-password").value;
    if (!username || !email) { showToast("Benutzername und E-Mail sind erforderlich."); return; }
    const body = { username, email };
    if (password) body.password = password;
    try {
        const res = await fetch(`/api/profile/guests/${id}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            showToast("Teammitglied aktualisiert.");
            closeGuestEditDialog();
            fetchGuests();
        } else {
            showToast(errorDetailToMessage(data.detail, "Fehler beim Speichern."));
        }
    } catch (e) {
        showToast("Netzwerkfehler beim Speichern.");
    }
}

// : Szenario-Freigabe je Teammitglied. Listet die Szenarien des Besitzers mit
// Checkbox (angehakt = für diesen Gast freigegeben) und schreibt die shares pro Szenario.
let sharingScenariosGuestId = null;
let _guestScenariosCache = [];
async function openGuestScenariosDialog(guestId) {
    const g = guestsData[guestId];
    if (!g) return;
    sharingScenariosGuestId = guestId;
    const nameEl = document.getElementById("guest-scenarios-name");
    if (nameEl) nameEl.textContent = `${g.username} (${g.email})`;
    const list = document.getElementById("guest-scenarios-list");
    if (list) list.innerHTML = '<p style="color: var(--text-muted); font-size: 12px;">Lade…</p>';
    const dlg = document.getElementById("guest-scenarios-dialog");
    if (dlg) dlg.classList.remove("hidden");
    try {
        const res = await fetch("/api/profile/scenarios");
        _guestScenariosCache = res.ok ? await res.json() : [];
    } catch (e) { _guestScenariosCache = []; }
    if (!list) return;
    if (!_guestScenariosCache.length) {
        list.innerHTML = '<p style="color: var(--text-muted); font-size: 12px;">Keine Szenarien vorhanden. Szenarien werden in „My Vault" erstellt.</p>';
        return;
    }
    list.innerHTML = "";
    _guestScenariosCache.forEach(s => {
        const shared = (s.shares || []).some(sh => sh.guest_id === guestId);
        const row = document.createElement("label");
        row.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; cursor:pointer; font-size:13px;";
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "styled-checkbox guest-scenario-cb"; cb.value = s.id; cb.checked = shared;
        const txt = document.createElement("span");
        txt.style.cssText = "flex:1; min-width:0;";
        txt.textContent = s.name;
        row.appendChild(cb); row.appendChild(txt);
        list.appendChild(row);
    });
}
function closeGuestScenariosDialog() {
    const dlg = document.getElementById("guest-scenarios-dialog");
    if (dlg) dlg.classList.add("hidden");
    sharingScenariosGuestId = null;
}
async function saveGuestScenarios() {
    if (!sharingScenariosGuestId) return;
    const guestId = sharingScenariosGuestId;
    const checked = new Set(Array.from(document.querySelectorAll("#guest-scenarios-list .guest-scenario-cb:checked")).map(cb => cb.value));
    let ok = true, changed = 0;
    for (const s of _guestScenariosCache) {
        const currently = (s.shares || []).some(sh => sh.guest_id === guestId);
        const wanted = checked.has(s.id);
        if (currently === wanted) continue;
        changed++;
        let shares = (s.shares || []).filter(sh => sh.guest_id !== guestId);
        if (wanted) shares.push({ guest_id: guestId, permission: "strict" });
        try {
            const res = await fetch(`/api/profile/scenarios/${s.id}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: s.name, preset_id: s.preset_id, device_ids: s.device_ids || [], shares })
            });
            if (!res.ok) ok = false;
        } catch (e) { ok = false; }
    }
    if (ok) showToast(changed ? "Szenario-Freigaben gespeichert." : "Keine Änderungen.");
    else showToast("Einige Freigaben konnten nicht gespeichert werden.");
    closeGuestScenariosDialog();
    fetchGuests();
}

// : Aktivitätsprotokoll eines Teammitglieds (Dialog mit Kopieren & TXT-Export).
let _guestActivityEntries = [];
let _guestActivityName = "";
async function openGuestActivityDialog(guestId) {
    const g = guestsData[guestId];
    if (!g) return;
    _guestActivityName = `${g.username} (${g.email})`;
    const titleEl = document.getElementById("guest-activity-title");
    if (titleEl) titleEl.textContent = `Aktivitäten — ${_guestActivityName}`;
    const tbody = document.getElementById("guest-activity-tbody");
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:10px; color: var(--text-muted);">Lade…</td></tr>';
    const dlg = document.getElementById("guest-activity-dialog");
    if (dlg) dlg.classList.remove("hidden");
    try {
        const res = await fetch(`/api/profile/audit-log?actor_id=${encodeURIComponent(guestId)}`);
        _guestActivityEntries = res.ok ? await res.json() : [];
    } catch (e) { _guestActivityEntries = []; }
    if (!tbody) return;
    if (!_guestActivityEntries.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:10px; color: var(--text-muted);">Keine Aktivitäten protokolliert.</td></tr>';
        return;
    }
    tbody.innerHTML = _guestActivityEntries.map(e => {
        const ts = e.timestamp ? new Date(e.timestamp).toLocaleString("de-DE") : "";
        const action = escapeHtml(AUDIT_ACTION_LABELS[e.action] || e.action || "");
        const target = escapeHtml(e.target || "—");
        const det = formatAuditDetails(e.action, e.details);
        return `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding: 8px 5px; white-space: nowrap; color: var(--text-secondary);">${ts}</td>
            <td style="padding: 8px 5px;">${action}</td>
            <td style="padding: 8px 5px;">${target}</td>
            <td style="padding: 8px 5px; color: var(--text-secondary); font-size: 12px;">${det}</td>
        </tr>`;
    }).join("");
}
function closeGuestActivityDialog() {
    const dlg = document.getElementById("guest-activity-dialog");
    if (dlg) dlg.classList.add("hidden");
}
function _guestActivityAsText() {
    const header = `Aktivitätsprotokoll — ${_guestActivityName}\n${"=".repeat(40)}\n`;
    const lines = _guestActivityEntries.map(e => {
        const ts = e.timestamp ? new Date(e.timestamp).toLocaleString("de-DE") : "";
        const action = AUDIT_ACTION_LABELS[e.action] || e.action || "";
        const target = e.target || "-";
        let det = "";
        try { det = e.details ? JSON.stringify(e.details) : ""; } catch (x) { det = ""; }
        return `[${ts}] ${action} | Ziel: ${target}${det ? " | " + det : ""}`;
    });
    return header + lines.join("\n") + "\n";
}
async function copyGuestActivity() {
    const text = _guestActivityAsText();
    try {
        await navigator.clipboard.writeText(text);
        showToast("Logs in die Zwischenablage kopiert.");
    } catch (e) {
        // Fallback ohne Clipboard-API (z. B. unsicherer Kontext).
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); showToast("Logs kopiert."); }
        catch (x) { showToast("Kopieren nicht möglich."); }
        document.body.removeChild(ta);
    }
}
function exportGuestActivity() {
    const text = _guestActivityAsText();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (_guestActivityName.split(" ")[0] || "teammitglied").replace(/[^a-zA-Z0-9._-]/g, "_");
    a.href = url; a.download = `aktivitaeten-${safe}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function handleTokenSubmit() {
    const nameInput = document.getElementById("token-name");
    const name = nameInput.value.trim();
    if (!name) {
        showToast("Bitte geben Sie einen Token-Namen an.");
        return;
    }
    
    const scopes = [];
    if (document.getElementById("token-scope-run").checked) scopes.push("run_playbook");
    if (document.getElementById("token-scope-read").checked) scopes.push("read_logs");
    //: granulare Scopes für Agent-Verwaltung von Geräten/Szenarien.
    if (document.getElementById("token-scope-devices").checked) scopes.push("manage_devices");
    if (document.getElementById("token-scope-scenarios").checked) scopes.push("manage_scenarios");

    if (scopes.length === 0) {
        showToast("Bitte wählen Sie mindestens einen Scope aus.");
        return;
    }
    
    const expirySelect = document.getElementById("token-expiry");
    const expiryVal = expirySelect.value;
    const expires_in_days = expiryVal === "never" ? null : parseInt(expiryVal, 10);
    
    try {
        const res = await fetch("/api/profile/tokens", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, scopes, expires_in_days })
        });
        
        if (res.ok) {
            const data = await res.json();
            showToast("API-Token erfolgreich generiert.");
            nameInput.value = "";
            
            // Show generated token display
            document.getElementById("generated-token-text").textContent = data.token;
            document.getElementById("token-display-dialog").classList.remove("hidden");
            
            fetchTokens();
        } else {
            const err = await res.json();
            showToast(err.detail || "Fehler beim Generieren des Tokens.");
        }
    } catch (err) {
        console.error("Token generation failed:", err);
        showToast("Netzwerkfehler.");
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

///: Freigabe-Hinweis mit allgemeiner Bezeichnung "Benutzer". Da "Benutzer" im
// Singular wie im Plural identisch ist, entfällt die frühere Gast/Gäste-Pluralisierung.
function guestShareLabel(count) {
    const n = Number(count) || 0;
    return `für ${n} Benutzer freigegeben`;
}

//: Keine window-Bindings mehr noetig – die ehemaligen Inline-onclick-Handler
// (deleteGuest/deleteToken/openGuestRevokeDialog) laufen jetzt ueber Event-Delegation.


// ---------------------------------------------------------------------------
// : Browser-Fingerprinting
// Leichtgewichtige Vanilla-JS-Loesung ohne externe Abhaengigkeit. Kombiniert stabile,
// geraetespezifische Signale (User-Agent, Sprache, Zeitzone, Bildschirm, Canvas, WebGL …)
// zu einem SHA-256-Hash. Dient ausschliesslich der Erschwerung von Trial-Missbrauch –
// keine 100%ige Eindeutigkeit, aber stabil genug, um wiederholte Gratis-Testphasen
// auf demselben Geraet zu erkennen. Jeder Teilschritt ist gekapselt, damit eine
// blockierte API (z. B. Canvas-Schutz im Browser) die Erfassung nicht verhindert.
// ---------------------------------------------------------------------------
function _canvasFingerprint() {
    try {
        const canvas = document.createElement("canvas");
        canvas.width = 220; canvas.height = 40;
        const ctx = canvas.getContext("2d");
        if (!ctx) return "no-canvas";
        ctx.textBaseline = "top";
        ctx.font = "14px 'Arial'";
        ctx.fillStyle = "#f60";
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = "#069";
        ctx.fillText("ansimate-fp-✨", 2, 15);
        ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
        ctx.fillText("ansimate-fp-✨", 4, 17);
        return canvas.toDataURL();
    } catch (e) {
        return "canvas-error";
    }
}

function _webglFingerprint() {
    try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
        if (!gl) return "no-webgl";
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        return `${vendor}~${renderer}`;
    } catch (e) {
        return "webgl-error";
    }
}

async function _sha256Hex(str) {
    // Bevorzugt SubtleCrypto (nur in sicheren Kontexten/HTTPS verfuegbar).
    if (window.crypto && window.crypto.subtle && window.isSecureContext) {
        try {
            const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
        } catch (e) { /* Fallback unten */ }
    }
    // Fallback: einfacher, stabiler 53-Bit-Hash (cyrb53) als Hex – ausreichend als Kennung.
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const num = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return num.toString(16).padStart(14, "0");
}

async function computeBrowserFingerprint() {
    try {
        const nav = window.navigator || {};
        const scr = window.screen || {};
        const signals = [
            nav.userAgent || "",
            nav.language || "",
            (nav.languages || []).join(","),
            nav.platform || "",
            (typeof nav.hardwareConcurrency !== "undefined") ? nav.hardwareConcurrency : "",
            (typeof nav.deviceMemory !== "undefined") ? nav.deviceMemory : "",
            (typeof nav.maxTouchPoints !== "undefined") ? nav.maxTouchPoints : "",
            `${scr.width || 0}x${scr.height || 0}x${scr.colorDepth || 0}`,
            (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } })(),
            new Date().getTimezoneOffset(),
            _canvasFingerprint(),
            _webglFingerprint(),
        ];
        return await _sha256Hex(signals.join("||"));
    } catch (e) {
        // Erfassung fehlgeschlagen -> kein Fingerabdruck (Backend behandelt dies als "unbekannt").
        return null;
    }
}





// : Core-State/Helfer fuer das Billing-Modul (Live-Bindings).
export { _numOrNull, checkAuthStatus, currentEdition, currentUser, errorDetailToMessage, escapeHtml, fmtPrice, navigateTo, openProfileDialog, showConfirmDialog, showToast };
