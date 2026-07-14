// : Chart.js for the admin dashboard charts (pie + trend).
import Chart from "chart.js/auto";

// : i18n engine. Pulled by Vite into the app.js bundle (Community included) and
// keeps its state as a window singleton, so the cloud-only billing chunk also shares the same
// language/dictionary. t()/setLanguage() are available to the rest of the app
// code; the content issues (–) replace hardcoded strings with t(...).
import {
    t, setLanguage, getLanguage, getLocale, applyStaticTranslations,
    initI18n, applyServerLanguage, setLoggedIn, setRenderHook,
} from "./i18n/index.js";

// : Load the billing UI only in the cloud edition. import.meta.env.VITE_EDITION is a
// build-time constant; the dynamic, edition-dependent import is completely removed via
// dead-code elimination in community/onprem builds -> these bundles contain NO
// billing code (no pricing/checkout/tariff/coupon/stripe). The call sites invoke local
// stubs that delegate to the module loaded (in cloud) (stub = no-op without billing).
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
// : Tariff/coupon dialogs (in the billing module, opened via FAB).
function openTariffCreateDialog(...a) { return billingApi.openTariffCreateDialog?.(...a); }
function closeTariffDialog(...a) { return billingApi.closeTariffDialog?.(...a); }
function openCouponCreateDialog(...a) { return billingApi.openCouponCreateDialog?.(...a); }
function closeCouponDialog(...a) { return billingApi.closeCouponDialog?.(...a); }

//  addendum: Playbook categories are translated for display. The (German)
// category value from playbooks/index.yml stays the stable grouping/sorting key; only the
// displayed label goes through i18n. Unknown categories fall back to the raw value, so that
// future categories do not appear as empty text. Keys live in i18n/dict/i18n-gaps.js.
const CATEGORY_I18N_KEYS = {
    "System": "catalog.cat.system",
    "Netzwerk Sicherheit": "catalog.cat.netsec",
    "Gaming": "catalog.cat.gaming",
    "Produktivität": "catalog.cat.productivity",
    "Entwicklung": "catalog.cat.development",
    "Dateiverwaltung": "catalog.cat.files",
    "Multimedia": "catalog.cat.multimedia",
    "Laufzeitumgebung": "catalog.cat.runtime",
    "Kommunikation": "catalog.cat.communication",
    "Browser": "catalog.cat.browser",
    "Netzwerk": "catalog.cat.network",
    "Grafik": "catalog.cat.graphics",
    "Smart Home": "catalog.cat.smarthome",
    "Sonstige": "catalog.cat.other",
};
function catLabel(cat) {
    if (!cat) return cat;
    const key = CATEGORY_I18N_KEYS[cat.trim()];
    return key ? t(key) : cat;
}

//: State of the category filter (empty = all). Holds the German index.yml category
// values (the same keys as the grouping). Takes effect in applyPlaybookSearch together with the
// text search. Rebuilt on every catalog render from the categories actually present.
const selectedCatalogCategories = new Set();

function updateCategoryFilterBadge() {
    const badge = document.getElementById("catalog-filter-count");
    if (!badge) return;
    const n = selectedCatalogCategories.size;
    badge.textContent = n ? String(n) : "";
    badge.classList.toggle("hidden", n === 0);
}

// Builds the checkbox list in the filter dropdown from the currently present categories (translated via
// catLabel; alphabetical, "Sonstige" last). The selection is preserved as long as the category still
// exists. Called from renderPlaybooks.
function populateCategoryFilter(catNames) {
    const opts = document.getElementById("catalog-filter-options");
    if (!opts) return;
    for (const c of Array.from(selectedCatalogCategories)) {
        if (!catNames.includes(c)) selectedCatalogCategories.delete(c);
    }
    opts.innerHTML = "";
    catNames.forEach(cat => {
        const row = document.createElement("label");
        row.className = "catalog-filter-item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "catalog-filter-cb";
        cb.value = cat;
        cb.checked = selectedCatalogCategories.has(cat);
        cb.addEventListener("change", () => {
            if (cb.checked) selectedCatalogCategories.add(cat); else selectedCatalogCategories.delete(cat);
            updateCategoryFilterBadge();
            applyPlaybookSearch();
        });
        const span = document.createElement("span");
        span.textContent = catLabel(cat);
        row.appendChild(cb);
        row.appendChild(span);
        opts.appendChild(row);
    });
    updateCategoryFilterBadge();
}

let activeHost = null;
let selectedJobId = null;
let jobViewMode = "tiles";   //: "tiles" (flow chart, default) or "log" (text console)
let currentlyStreamingJobId = null;
let logController = null;
let logUserScrolledUp = false;   //: pause auto-scroll as soon as the user scrolls up
let logScrollListenerAttached = false; //: attach the scroll listener only once
let pollTimeout = null;
let pollingActive = false; //: prevents duplicate poll loops + allows re-arm after logout
let allJobs = [];
let closedHosts = new Set();  // : host tabs closed by the user (session-wide)
let knownJobIds = new Set();  // : known job_ids -> a new run reopens a closed tab
let playbookNameMap = {};
let playbookMetadataMap = {};
let allPresets = [];
let allPlaybooks = [];
let containerTimezone = "Europe/Berlin";
let currentEdition = "cloud";   // aktive Edition (cloud|onpremise|community), via GET /api/version
let allowAnonymousRun = true;   // : anonymous playbook execution allowed? via GET /api/version
let registrationEnabled = true; // : self-registration allowed? via GET /api/version

// : show/hide the register button depending on the server setting.
function applyRegistrationVisibility() {
    const btn = document.getElementById("register-btn");
    // : the Community edition has no self-registration -> always hide the button.
    if (btn) btn.style.display = (registrationEnabled && currentEdition !== "community") ? "" : "none";
}
// : currentUser is only settled after the auth boot. Until then routePage() makes
// no /admin decision (no premature redirect of admins, no layout flicker).
let authReady = false;
//: target of the footer link ("Project website") in the Community edition.
const COMMUNITY_PROJECT_URL = "https://ansimate.eu";

// Generate or retrieve Session ID
const sessionId = getSessionId();

// ===: Global IP-block detector ===========================================
// The SecurityMiddleware returns a 403 on EVERY request from a blocked IP, with
// {"detail":"IP address is blocked.","expires_at":<iso|null>,"reason":<str|null>}.
// window.fetch is wrapped, exactly this response is detected, and a full-screen
// block screen (with an unblock countdown) is shown instead of a generic error message.
const IP_BLOCK_DETAIL = "IP address is blocked.";
let ipBlockShown = false;
let ipBlockCountdownTimer = null;

// : when maintenance mode is activated, the backend ends non-admin sessions; their
// next request (e.g. the history poll) returns 503 {maintenance:true}. Then reload
// once -> the boot shows the maintenance page (enforceMaintenanceGate).
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
                // No JSON body or a different 403 (e.g. permissions/scope) -> ignore.
            }
        } else if (response.status === 503 && !maintenanceReloadTriggered) {
            // : maintenance mode active -> send non-admins to the maintenance page immediately.
            try {
                const data = await response.clone().json();
                if (data && data.maintenance) {
                    maintenanceReloadTriggered = true;
                    window.location.reload();
                }
            } catch (e) {
                // a different 503 -> ignore.
            }
        }
        return response;
    };
})();

function showIpBlockedScreen(expiresAtIso, reason) {
    const overlay = document.getElementById("ip-block-overlay");
    if (!overlay) return;
    // Already visible? Then don't re-render (don't reset the running countdown).
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
        // Permanent block (manual blacklist) -> no countdown.
        if (cdWrap) cdWrap.classList.add("hidden");
        if (permEl) permEl.classList.remove("hidden");
    }

    // : "Try again" button removed — no direct retry option in the block dialog.

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
            // Auto-reload on expiry, but to guard against reload loops (clock drift client/server)
            // throttle to at most once every 15s; otherwise the user uses the retry button.
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
let modalDirty = false; //: unsaved input in the run dialog
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

//: theme selection (system/light/dark)
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
    // "system": no class -> CSS @media (prefers-color-scheme) applies automatically.
}
function setThemePreference(pref) {
    localStorage.setItem(THEME_KEY, pref);
    applyTheme(pref);
}
function initTheme() {
    applyTheme(getThemePreference());
    // Follow system changes at runtime (CSS does this automatically; listener
    // for robustness/future JS reactions).
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => { if (getThemePreference() === "system") applyTheme("system"); };
    if (mq.addEventListener) mq.addEventListener("change", onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
    // Wire up the dropdown in the profile.
    const sel = document.getElementById("profile-theme-select");
    if (sel) {
        sel.value = getThemePreference();
        sel.addEventListener("change", () => setThemePreference(sel.value));
    }
}

//: accessibility for modal dialogs - ARIA semantics, focus trap and
// focus restore. Centralized via one MutationObserver per .dialog-overlay,
// so that the ~50 ad-hoc open/close call sites (classList.add/remove("hidden"))
// do NOT have to be touched.
const _modalTrap = new Map();
function _isVisible(e) {
    // More robust than offsetParent (also covers position:fixed/absolute).
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
    // Set focus into the modal SYNCHRONOUSLY, BEFORE the trap handler becomes active
    // (prevents a race if Tab is pressed immediately).
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
    // Only restore focus when NO other modal is open (no focus jump
    // on modal-to-modal switches, e.g. login -> otp).
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
        // Set aria-hidden only in the closed state; remove it in the open state,
        // so the dialog (role=dialog on the card) stays visible to AT.
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
    initTheme();   //: as early as possible, to minimize theme flicker
    // : i18n as early as initTheme — determine the language from cache/browser, static
    // text + header switcher/profile select wiring. After the auth boot,
    // checkAuthStatus() takes over the server language if applicable (applyServerLanguage).
    initI18n();
    // Re-render hook: static translations are already handled by setLanguage() itself; dynamic
    // views listen for this event and re-render themselves (the content issues wire this up per
    // area, without having to touch this hook again).
    setRenderHook((lang) => {
        document.dispatchEvent(new CustomEvent("i18n:languagechange", { detail: { lang } }));
    });
    //  addendum: views whose labels are set via JS (category headers in the
    // playbook catalog, admin FAB label, scenario tiles) are NOT covered by applyStaticTranslations
    // and must re-render themselves on a live language switch.
    document.addEventListener("i18n:languagechange", async () => {
        updateAdminFab(currentAdminTab);  // FAB label of the active admin tab (purely client-side)
        // Category headers run through catLabel (client-side); the playbook DESCRIPTIONS are provided
        // by the server language-dependently (?lang=). So with a catalog already loaded, reload
        // it: fetchPresets() first (renderPlaybooks uses allPresets), then fetchPlaybooks()
        // (sets allPlaybooks and re-renders). Before the first boot load, do nothing.
        if (Array.isArray(allPlaybooks) && allPlaybooks.length) {
            await fetchPresets();
            await fetchPlaybooks();
        }
    });
    initModalA11y(); //: ARIA + focus trap for all modals
    setupEventListeners();
    initTabNavigation();
    applyCachedNavVisibility(); //: set the nav button synchronously from the auth cache (no flicker)
    routePage(); // Route to correct view based on current URL
    applyViewMode();

    // : maintenance gate as early as possible — the boot splash (#maintenance-overlay,
    // visible by default) covers the app, so there is no flash of the real page. The
    // admin/community exception is decided by the server (`bypass`), so the decision does NOT have to
    // wait for the full auth/edition boot. Blocked -> the splash shows the maintenance
    // message and the rest of the boot is aborted; otherwise hide the splash and continue normally.
    if (await enforceMaintenanceGate()) return;
    hideBootSplash();

    await verifyConnection();
    await loadBrandConfig(); //: load runtime branding (title/footer) for the dynamic UI
    await loadEdition();   //: determine the active edition before auth/UI is built
    // : Community now has real login (admin + members created by the admin via Teams)
    // a logged-out visitor is a real guest. Therefore, in ALL
    // editions determine the real auth status from the server (no more simulated admin).
    // This also fixes that the admin navigation wrongly appeared in the guest state.
    await checkAuthStatus();
    authReady = true;  // : auth is settled -> routePage may decide /admin definitively.
    // /: decide access to /pricing and /teams definitively only
    // once edition + auth are loaded. The early routePage() call still uses
    // defaults; re-evaluate here if one of these pages is active.
    // : also route /admin definitively only now (show admins, redirect non-admins).
    if (["/pricing", "/teams", "/admin"].includes(window.location.pathname)) routePage();
    updateMaintenanceBanner();  // : admin maintenance banner (if active).
    await fetchTimezone();
    await fetchPresets();
    await fetchPlaybooks();
    await startHistoryPolling();
    //  (Community): GDPR/cookie consent only in the cloud edition. Community/On-Premise
    // run no telemetry and therefore need no consent banner.
    if (currentEdition === "cloud") initCookieConsent();
}

// : maintenance-mode gate. Returns true when the maintenance page was shown (the caller
// aborts the rest of the app build). The admin/community exception (`bypass`) is decided by the
// server, so the gate can run before the full auth/edition boot (no FOUC).
async function enforceMaintenanceGate() {
    //: The Community edition has no maintenance mode (disabled server-side,;
    // /api/maintenance always returns bypass=true there) and the maintenance overlay is stripped from the
    // build. Return immediately here -> no /api/maintenance roundtrip and no brief
    // flash of the boot splash (VITE_EDITION is a build-time constant, see billing import).
    if (import.meta.env.VITE_EDITION === "community") return false;
    try {
        const r = await fetch("/api/maintenance", { cache: "no-store" });
        if (!r.ok) return false;
        const d = await r.json();
        if (d && d.active && !d.bypass) {
            // : redirect non-admins in maintenance mode to "/" (exception: /login),
            // instead of leaving the requested route in the address bar.
            if (window.location.pathname !== "/login" && window.location.pathname !== "/") {
                history.replaceState({}, "", "/");
            }
            showMaintenancePage(d.note);
            return true;
        }
    } catch (e) {
        // On a network error don't lock out (fail-open) — the backend blocks by itself anyway.
    }
    return false;
}

// Hide the boot splash -> the app becomes visible (normal, non-blocked boot path).
function hideBootSplash() {
    const ov = document.getElementById("maintenance-overlay");
    if (ov) ov.classList.add("hidden");
    document.body.style.overflow = "";
}

// Switch the boot splash to the maintenance message (spinner off, maintenance content on) and keep it
// visible. So the visitor never sees the real app, only splash -> maintenance page.
// : persistent maintenance banner for logged-in admins (on all pages).
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
    // : hide the footer links (only allow sign-in).
    document.body.classList.add("maintenance-active");
    // : the sign-in button opens the login dialog ABOVE the maintenance page (higher z-index).
    const loginBtn = document.getElementById("maintenance-login-btn");
    if (loginBtn && !loginBtn.dataset.wired) {
        loginBtn.dataset.wired = "1";
        loginBtn.addEventListener("click", () => {
            const dlg = document.getElementById("login-dialog");
            if (dlg) { dlg.style.zIndex = "100001"; dlg.classList.remove("hidden"); }
        });
    }
}

//: runtime branding (generated at build time from config.yml). Provides the
// configured brand title and footer text dynamically for JS, so that
// UI components (not just the baked-in HTML) can use the brand name.
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
        // No branding runtime present -> keep the default values.
    }
    // Ensure the footer text at runtime (in case the HTML replacement didn't take).
    if (brandConfig.footer_text) {
        const fb = document.querySelector(".footer-brand");
        if (fb) fb.textContent = brandConfig.footer_text;
    }
    if (brandConfig.title) document.title = brandConfig.title;
}

// Load the active edition from the backend. Falls back to "cloud" on error.
async function loadEdition() {
    try {
        const r = await fetch("/api/version");
        if (r.ok) {
            const d = await r.json();
            if (d && d.edition) currentEdition = d.edition;
            // : anonymous execution can be disabled server-side.
            if (d && typeof d.allow_anonymous_run === "boolean") allowAnonymousRun = d.allow_anonymous_run;
            // : registration can be disabled by the admin.
            if (d && typeof d.registration_enabled === "boolean") registrationEnabled = d.registration_enabled;
        }
        applyRegistrationVisibility();
    } catch (e) {
        console.warn("Edition konnte nicht geladen werden, Standard 'cloud':", e);
    }
    document.body.classList.add("edition-" + currentEdition);
}

// Edition-specific UI rules. Called at the end of updateAuthUI(),
// so the rules persist after every UI refresh.
function applyEditionRules() {
    if (currentEdition === "community") {
        // : Community has real login (admin + members created by the admin).
        // The auth bar stays visible (sign-in/profile/sign-out) — previously it was
        // hidden entirely here. Only self-registration is dropped.
        applyRegistrationVisibility();
        //: "My Vault" stays usable for the system admin in the Community edition — but
        // restricted: only scenarios + devices, NO sharing (no additional users/teams).
        // Only "Teams" is hidden. (Supersedes the temporary vault hiding from .)
        ["nav-btn-teams"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add("hidden");
        });
        //: the Playbooks tab in the vault is dropped in Community (custom upload is backend-side
        // locked,) -> only scenarios + devices. The Presets tab is globally off anyway.
        const pbTabBtn = document.getElementById("vault-tab-playbooks-btn");
        if (pbTabBtn) pbTabBtn.style.display = "none";
        //: tab descriptions without team/share references (not applicable in Community).
        const devDesc = document.getElementById("vault-devices-desc");
        if (devDesc) devDesc.textContent = t("core.vaultDevicesDescCommunity");
        const scnDesc = document.getElementById("vault-scenarios-desc");
        if (scnDesc) scnDesc.textContent = t("core.vaultScenariosDescCommunity");
        //  (Community): hide elements that apply only to Cloud/On-Premise.
        // Note: maintenance config, self-registration toggle, account statistics charts and the
        // webhook block are now removed at build time (class community-strip), no
        // longer hidden here via JS. Only pure JS hides remain here:
        //  - Admin: users tab (#admin-tab-users-btn via .community-hide-tab);
        //  - Admin config: the "System" category heading (.community-hide), so that above the
        //    remaining SMTP test there is no empty heading;
        //  - Login: only "Forgot password?" — requires working SMTP
        //    (Community usually has none; without SMTP it would lock accounts out), so
        //    deliberately only hidden (usable with SMTP), not stripped. 2FA (email OTP, also
        //    SMTP-dependent) is now stripped AT BUILD TIME (.community-strip, enterprise-only).
        document.querySelectorAll(".community-hide-tab").forEach(el => { el.style.display = "none"; });
        document.querySelectorAll(".community-hide").forEach(el => { el.style.display = "none"; });
        ["forgot-password-link"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = "none";
        });
        //: The right-hand footer links (Impressum/AGB/Datenschutz) are, in the
        // Community edition, already removed from the HTML AT BUILD TIME (strip-cloud-only.cjs,
        // class "legal-only") — no more subsequent JS hiding (fixes the flicker,
        //). Only the single project-website link is added here.
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
                a.textContent = t("nav.projectWebsite");
                footer.appendChild(sep);
                footer.appendChild(a);
            }
        }
    } else if (currentEdition === "onpremise") {
        // Hide billing & teams, permanently show "Enterprise Pro".
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
    // : pricing/billing features (tariff/coupon admin tabs, pricing page,
    // pricing footer link) exist only in the cloud edition. Otherwise hide them.
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

    //: a click (or Enter/Space) on the header logo goes to the home page.
    const logoHome = document.getElementById("logo-home");
    if (logoHome) {
        logoHome.addEventListener("click", () => navigateTo("/"));
        logoHome.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigateTo("/"); }
        });
    }

    //: the header "Teams" navigates to the dedicated Teams page.
    const teamsNav = document.getElementById("nav-btn-teams");
    if (teamsNav) {
        teamsNav.addEventListener("click", () => {
            if (teamsNav.classList.contains("hidden")) return;
            navigateTo("/teams");
        });
    }
    //  (#A): the header "My Vault" navigates to the unified Vault page (Playbooks/Devices/Presets).
    if (btnVault) {
        btnVault.addEventListener("click", () => {
            if (btnVault.classList.contains("hidden")) return;
            navigateTo("/vault");
        });
    }

    // Footer legal link interception for SPA routing
    // : also intercept "Agent Instructions" (/llm) as SPA navigation.
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

    // : wire up the burger menu / mobile drawer.
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
// : mobile navigation drawer (burger menu). Instead of duplicating the
// nav/auth/footer logic, proxy entries are created in the drawer that
// trigger the original elements (hidden on mobile via CSS, but still
// functional) via .click(). Visibility is derived from the
// logical state of the originals (classes/disabled/currentUser).
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
    //: derive the label WITHOUT the icon ligature. src.textContent would otherwise contain the text of the
    // .material-symbols-outlined spans (e.g. "terminal", "account_circle") and would render it as
    // plain text before the label. So remove the icon spans on a clone.
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

    // Navigation (only visible/active header buttons)
    ["nav-btn-configure", "nav-btn-vault", "nav-btn-teams", "nav-btn-history", "nav-btn-admin"]
        .forEach(id => _addDrawerProxy(navSec, id));

    // Auth actions depending on the login state
    if (currentUser) {
        _addDrawerProxy(authSec, "profile-btn");
        _addDrawerProxy(authSec, "logout-btn");
    } else {
        _addDrawerProxy(authSec, "login-btn");
        _addDrawerProxy(authSec, "register-btn");
    }

    // Footer links (order: API-Docs, Agent Instructions, Preise, AGB, Impressum, Datenschutz, Projekt)
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
//: legal texts are loaded dynamically from the backend (GET /api/legal/text/{doc}),
// no longer hardcoded. Map: SPA path -> document key.
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
        if (titleEl) titleEl.innerHTML = d.title || t("core.legalInfoTitle");
        if (bodyEl) bodyEl.innerHTML = d.html || "";
    } catch (e) {
        console.warn("Rechtstext konnte nicht geladen werden:", e);
        if (titleEl) titleEl.textContent = t("core.legalInfoTitle");
        if (bodyEl) bodyEl.textContent = t("core.legalLoadError");
    }
}

// : load and render the agent instructions (llm.txt).
// The file is served statically at /llm.txt (nginx), is written in Markdown and is
// rendered to HTML client-side. Deliberately NO external Markdown parser: the CSP allows
// only script-src 'self'; the small, custom renderer covers exactly the subset used in llm.txt
// (headings, paragraphs, lists, block quotes, code, tables, horizontal rules).
function _mdInline(s) {
    // First escape everything, then apply the inline markers on the escaped text.
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

        // Fenced code block — indentation-tolerant (blocks under bullet points are indented);
        // the indentation of the opening fence is removed from the content.
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

        // GFM table: current line has |, next is a separator line (---|---)
        if (/\|/.test(line) && i + 1 < lines.length &&
            /-/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
            closeList();
            const parseRow = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
            const headers = parseRow(line);
            i += 2; // skip header + separator
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

        // Horizontal rule
        if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out.push("<hr>"); i++; continue; }

        // Heading
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

        // Paragraph (collect until the next blank line / special line)
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
    if (bodyEl.dataset.loaded === "1") return;   // loading once is enough
    try {
        const r = await fetch("/llm.txt", { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const md = await r.text();
        bodyEl.innerHTML = renderMarkdown(md);
        bodyEl.dataset.loaded = "1";
    } catch (e) {
        console.warn("Agent-Anleitung konnte nicht geladen werden:", e);
        bodyEl.textContent = t("core.llmLoadError");
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
        //: show the API-Docs footer link again by default (hidden on /pricing).
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
        //  (#A): "My Vault" — your own Playbooks/Devices/Presets/Scenarios as tabs under one
        // page. Only for logged-in non-guests; the subscription is enforced per tab/endpoint,
        // not by hiding the whole vault.
        //: In the Community edition My Vault is reachable (restricted) — no longer lock it.
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
        // : when opening "My Vault" without an explicit tab, show scenarios by default.
        const vaultTab = path.split("/")[2] || "scenarios";
        switchVaultTab(vaultTab);
    } else if (path === "/admin") {
        // : while auth is still loading, do NOT decide — don't show admin markup
        // (no flicker) and don't redirect admins prematurely. init() routes /admin after the
        // auth boot again.
        if (!authReady) { hideAll(); return; }
        // Check permission FIRST — send non-admins to "/" before any admin markup.
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
        //: dedicated body class, so the job history/console (#right-column)
        // is hidden on legal pages (CSS rules hang off tab-* classes).
        document.body.classList.add("tab-legal");
        if (legalCard) {
            legalCard.classList.remove("hidden");
            legalCard.style.display = "flex";
            //: load content dynamically from the server-side text files.
            loadLegalContent(LEGAL_PATHS[path]);
        }
    } else if (path === "/llm") {
        // : agent instructions (llm.txt) as their own SPA card — in ALL editions.
        // Same body class as legal pages, so the job console (#right-column)
        // is hidden and the doc content gets the full width.
        hideAll();
        document.body.classList.add("tab-legal");
        if (llmCard) {
            llmCard.classList.remove("hidden");
            llmCard.style.display = "flex";
            loadLlmInstructions();
        }
    } else if (path === "/pricing") {
        // : pricing page only in the cloud edition.: guests MAY view the pricing page
        // (to inform themselves), but cannot purchase.  (feedback): admins MAY
        // now view the pricing page too (read-only) — they manage tariffs and want to
        // check the public view; previously they were redirected to "/" here (bounce after auth boot).
        if (currentEdition !== "cloud") {
            history.replaceState({}, "", "/");
            routePage();
            return;
        }
        hideAll();
        document.body.classList.add("tab-pricing");
        //: hide the API-Docs link on the pricing page.
        const docsLink = document.getElementById("footer-link-docs");
        if (docsLink) docsLink.style.display = "none";
        if (pricingCard) { pricingCard.classList.remove("hidden"); pricingCard.style.display = "flex"; }
        fetchPricing();
    } else if (path === "/teams") {
        // : while auth is still loading, do NOT decide — otherwise the early
        // routePage() call redirects the (still unknown) user to "/" and overwrites the URL,
        // which stops the post-auth re-routing for /teams from taking effect. init() routes /teams
        // again after the auth boot (analogous to /admin).
        if (!authReady) { hideAll(); return; }
        ///: dedicated Teams page. Admins may use it now; still
        // locked for guests/logged-out visitors and in the On-Premise edition.
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
        switchTeamsTab("users");   // : always start on the users tab
        fetchGuests();
        loadAuditLog();   // : load the team activity log
        //  (#D): your own presets now live in the vault presets tab (no longer on /teams).
    } else if (path === "/custom-playbooks") {
        //  (#A) backward-compat: redirect old direct links to the matching vault tab.
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

    //: toggle tile/flow-chart view <-> text log. Default = tiles.
    if (viewToggleBtn) {
        viewToggleBtn.addEventListener("click", () => {
            jobViewMode = jobViewMode === "tiles" ? "log" : "tiles";
            applyJobViewMode();
        });
    }
    applyJobViewMode();

    // : Firefox fallback (textarea + execCommand) + success toast, mirrored from copyGuestActivity().
    copyLogsBtn.addEventListener("click", async () => {
        if (!consoleOutput.textContent) return;
        const text = consoleOutput.textContent;
        try {
            await navigator.clipboard.writeText(text);
            showToast(t("core.logsCopied"));
        } catch (e) {
            // Fallback without the Clipboard API (e.g. Firefox / insecure context).
            const ta = document.createElement("textarea");
            ta.value = text; document.body.appendChild(ta); ta.select();
            try { document.execCommand("copy"); showToast(t("core.logsCopied")); }
            catch (x) { showToast(t("core.copyFailed")); }
            document.body.removeChild(ta);
        }
    });

    // : cancel button in the console header (aborts the currently selected run).
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
    //: search only filters visibility (no rebuild), so the selected
    // playbook selection is preserved while typing.
    const playbookSearch = document.getElementById("playbook-search");
    if (playbookSearch) playbookSearch.addEventListener("input", applyPlaybookSearch);

    //: category filter dropdown (open/close, outside click, reset). The
    // checkboxes themselves are wired up in populateCategoryFilter().
    const catFilterBtn = document.getElementById("catalog-filter-btn");
    const catFilterMenu = document.getElementById("catalog-filter-menu");
    if (catFilterBtn && catFilterMenu) {
        catFilterBtn.addEventListener("click", (e) => {
            e.preventDefault(); e.stopPropagation();
            const nowHidden = catFilterMenu.classList.toggle("hidden");
            catFilterBtn.setAttribute("aria-expanded", nowHidden ? "false" : "true");
        });
        document.addEventListener("click", (e) => {
            if (catFilterMenu.classList.contains("hidden")) return;
            if (catFilterMenu.contains(e.target) || catFilterBtn.contains(e.target)) return;
            catFilterMenu.classList.add("hidden");
            catFilterBtn.setAttribute("aria-expanded", "false");
        });
    }
    const catFilterClear = document.getElementById("catalog-filter-clear");
    if (catFilterClear) catFilterClear.addEventListener("click", () => {
        selectedCatalogCategories.clear();
        document.querySelectorAll(".catalog-filter-cb").forEach(cb => { cb.checked = false; });
        updateCategoryFilterBadge();
        applyPlaybookSearch();
    });

    // Modal actions
    //: cancel, backdrop click and ESC close with a warning on unsaved
    // input; any user input in the dialog marks it as "dirty".
    modalCancelBtn.addEventListener("click", closeCredentialsModalGuarded);
    modalSubmitBtn.addEventListener("click", handleModalSubmit);
    //  (#E): "Save as preset only" + checkbox reveals the name field.
    const modalSavePresetBtn = document.getElementById("modal-save-preset-btn");
    if (modalSavePresetBtn) modalSavePresetBtn.addEventListener("click", handleSavePresetFromDialog);
    // : "Save as preset only" is enabled only once a preset name has been entered.
    const modalPresetNameInp = document.getElementById("modal-preset-name");
    if (modalPresetNameInp && modalSavePresetBtn) {
        modalPresetNameInp.addEventListener("input", () => {
            modalSavePresetBtn.disabled = modalPresetNameInp.value.trim().length === 0;
        });
    }
    enableModalDismiss("credentials-dialog", closeCredentialsModalGuarded);
    // : buttons of the styled cancel confirmation dialog (discard / keep editing).
    const _discardHide = () => { const d = document.getElementById("discard-confirm-dialog"); if (d) d.classList.add("hidden"); };
    const discardCancel = document.getElementById("discard-confirm-cancel");
    if (discardCancel) discardCancel.addEventListener("click", _discardHide);
    const discardOk = document.getElementById("discard-confirm-ok");
    if (discardOk) discardOk.addEventListener("click", () => { _discardHide(); hideCredentialsModal(); });
    enableModalDismiss("discard-confirm-dialog", _discardHide);
    credentialsDialog.addEventListener("input", () => { modalDirty = true; });

    //: premium upsell modal (cancel / CTA to the pricing page / backdrop+ESC).
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
    //: null-safe, since the register dialog is removed from the HTML in the Community edition.
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
    // : filter for the scenario playbook selection
    const dgPbFilter = document.getElementById("device-group-playbook-filter");
    if (dgPbFilter) dgPbFilter.addEventListener("input", (e) => filterDeviceGroupPlaybooks(e.target.value));
    //  (#C): wire up managed single devices (vault devices tab) + share modal.
    const mdSave = document.getElementById("managed-device-save-btn");
    if (mdSave) mdSave.addEventListener("click", saveManagedDevice);
    const mdCancel = document.getElementById("managed-device-cancel-btn");
    if (mdCancel) mdCancel.addEventListener("click", closeManagedDeviceDialog);  // : close the dialog
    // : ESC / outside click checks for unsaved input (dataset.dirty).
    enableAdminDialogDismiss("managed-device-dialog", closeManagedDeviceDialog);
    // : FAB + cancel buttons of the create/edit dialogs.
    const vaultFab = document.getElementById("vault-fab");
    if (vaultFab) vaultFab.addEventListener("click", onVaultFab);
    // : download the example playbook (Hello World) as YAML.
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
    // : scenario creation wizard
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
    // : ESC / outside click checks for unsaved input (dataset.dirty).
    enableAdminDialogDismiss("scenario-wizard-dialog", closeScenarioWizard);
    // : one-time device dialog for a deviceless scenario run
    const srdCancel = document.getElementById("scenario-run-device-cancel");
    if (srdCancel) srdCancel.addEventListener("click", closeScenarioRunDeviceDialog);
    const srdGo = document.getElementById("scenario-run-device-go");
    if (srdGo) srdGo.addEventListener("click", submitScenarioRunDevice);
    // : SSH key upload in the one-time device dialog (click opens the file picker, remove clears it).
    const srdKeyDz = document.getElementById("scenario-run-key-dropzone");
    const srdKeyFile = document.getElementById("scenario-run-key-file");
    const srdKeyReset = document.getElementById("scenario-run-key-reset");
    if (srdKeyDz && srdKeyFile) {
        srdKeyDz.addEventListener("click", (e) => { if (e.target !== srdKeyReset) srdKeyFile.click(); });
        srdKeyFile.addEventListener("change", () => {
            const has = !!(srdKeyFile.files && srdKeyFile.files[0]);
            const lbl = document.getElementById("scenario-run-key-filename-lbl");
            if (lbl) lbl.textContent = has ? srdKeyFile.files[0].name : t("core.noFileSelected");
            if (srdKeyReset) srdKeyReset.classList.toggle("hidden", !has);
        });
    }
    if (srdKeyReset) srdKeyReset.addEventListener("click", _resetScenarioRunKeyUpload);
    // derive the base directory from the SSH user (root -> /root, otherwise /home/<user>),
    // as long as the user has not edited the field themselves (same logic as in the run dialog).
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
    // : as soon as the user touches the placeholder password, it counts as changed
    // (empty = delete, input = new secret).
    const mdCred = document.getElementById("managed-device-credential");
    if (mdCred) mdCred.addEventListener("input", () => { mdCred.dataset.placeholder = ""; });
    // : derive the base directory from the SSH user (root -> /root, otherwise /home/<user>),
    // as long as the field has not been edited manually (same logic as the run/one-time device dialog).
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
    // : SSH key upload dropzone (click opens the file picker; selection shows the file name).
    const mdKeyDz = document.getElementById("managed-device-key-dropzone");
    const mdKeyFile = document.getElementById("managed-device-key-file");
    if (mdKeyDz && mdKeyFile) {
        mdKeyDz.addEventListener("click", () => mdKeyFile.click());
        mdKeyFile.addEventListener("change", () => {
            const lbl = document.getElementById("managed-device-key-filename-lbl");
            if (lbl) lbl.textContent = (mdKeyFile.files && mdKeyFile.files[0]) ? mdKeyFile.files[0].name : t("core.noFileSelected");
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
    if (presetCancel) presetCancel.addEventListener("click", closePresetModal);  //  (#D): close the modal
    const presetPbFilter = document.getElementById("preset-playbook-filter");
    if (presetPbFilter) presetPbFilter.addEventListener("input", (e) => filterPresetPlaybooks(e.target.value));
    //  (#D): an outside click closes the preset modal (opened via "Edit";
    // new presets are created in the run dialog, so there is no "New preset" button anymore).
    enableModalDismiss("preset-edit-dialog", closePresetModal);

    // Profile password change
    document.getElementById("profile-password-form").addEventListener("submit", handlePasswordChange);
    document.getElementById("pw-change-new").addEventListener("input", updatePwChangeRequirements);
    document.getElementById("pw-change-confirm").addEventListener("input", checkPwChangeMatch);

    //  (#C): the "Manage devices" shortcut in the run dialog now points to the vault devices tab.
    //: the old #devices-dialog was removed as dead legacy code; /api/devices stays internal for the dropdown.
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
    document.getElementById("delete-confirm-form")?.addEventListener("submit", handleDeleteConfirmSubmit);  // cloud-only: stripped in Community
    
    // Profile settings changes
    document.getElementById("profile-email-notif").addEventListener("change", handleNotificationToggle);
    // : save the webhook URL.
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
    document.getElementById("admin-tab-users-btn")?.addEventListener("click", () => switchAdminTab("users"));  // community-strip: stripped in Community
    document.getElementById("admin-tab-config-btn").addEventListener("click", () => switchAdminTab("config"));
    document.getElementById("admin-tab-ip-btn").addEventListener("click", () => switchAdminTab("ip"));
    // : "Audit log" tab removed -> content now in the "Logs" tab (security).
    document.getElementById("admin-tab-security-btn").addEventListener("click", () => switchAdminTab("security"));
    // : central admin FAB (action per active tab).
    const adminFab = document.getElementById("admin-fab");
    if (adminFab) adminFab.addEventListener("click", onAdminFab);
    // : export dialog for the logs.
    const expCancel = document.getElementById("admin-export-cancel");
    if (expCancel) expCancel.addEventListener("click", closeAdminExportDialog);
    const expGo = document.getElementById("admin-export-go");
    if (expGo) expGo.addEventListener("click", runAdminExport);
    // : create-user dialog.
    const ucCancel = document.getElementById("admin-user-create-cancel");
    if (ucCancel) ucCancel.addEventListener("click", closeAdminUserCreateDialog);
    const ucForm = document.getElementById("admin-user-create-form");
    if (ucForm) ucForm.addEventListener("submit", handleAdminUserCreate);
    // : IP block dialog cancel.
    const ipCancel = document.getElementById("admin-ip-cancel");
    if (ipCancel) ipCancel.addEventListener("click", closeIpBlockDialog);
    // : SMTP-Test-E-Mail.
    const testEmailBtn = document.getElementById("admin-test-email-btn");
    if (testEmailBtn) testEmailBtn.addEventListener("click", sendAdminTestEmail);
    // : ESC/backdrop close for admin dialogs (forms with a dirty warning; export without).
    enableAdminDialogDismiss("admin-user-create-dialog", closeAdminUserCreateDialog);
    enableAdminDialogDismiss("admin-ip-dialog", closeIpBlockDialog);
    enableAdminDialogDismiss("admin-tariff-dialog", () => closeTariffDialog());
    enableAdminDialogDismiss("admin-coupon-dialog", () => closeCouponDialog());
    enableModalDismiss("admin-export-dialog", closeAdminExportDialog);
    // : tariff & coupon management (visible only in the cloud edition).
    // : in the Community edition these tabs are removed from the HTML -> bind null-safely.
    const tariffsTabBtn = document.getElementById("admin-tab-tariffs-btn");
    if (tariffsTabBtn) tariffsTabBtn.addEventListener("click", () => switchAdminTab("tariffs"));
    const couponsTabBtn = document.getElementById("admin-tab-coupons-btn");
    if (couponsTabBtn) couponsTabBtn.addEventListener("click", () => switchAdminTab("coupons"));
    // : billing tab (cloud only).
    const billingTabBtn = document.getElementById("admin-tab-billing-btn");
    if (billingTabBtn) billingTabBtn.addEventListener("click", () => switchAdminTab("billing"));
    // : time-range filter for the dashboard trend charts.
    document.querySelectorAll(".admin-range-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            _adminChartRange = btn.dataset.range || "7d";
            document.querySelectorAll(".admin-range-btn").forEach(b => b.classList.toggle("active", b === btn));
            loadDashboardTimeseries();
        });
    });
    //  (feedback): reload the dashboard charts manually (discard cache + fetch fresh).
    const chartRefreshBtn = document.getElementById("admin-chart-refresh-btn");
    if (chartRefreshBtn) {
        chartRefreshBtn.addEventListener("click", () => {
            Object.keys(_adminTimeseriesCache).forEach(k => delete _adminTimeseriesCache[k]);
            fetchAdminStats(true);
        });
    }
    //  (#A): "My Vault" tab-bar buttons (Scenarios is disabled -> no handler needed).
    ["playbooks", "devices", "presets", "scenarios"].forEach(t => {
        const b = document.getElementById(`vault-tab-${t}-btn`);
        if (b) b.addEventListener("click", () => switchVaultTab(t));
    });
    // : scenario form (create/edit/cancel)
    const scSave = document.getElementById("scenario-save-btn");
    if (scSave) scSave.addEventListener("click", saveScenario);
    const scCancel = document.getElementById("scenario-cancel-btn");
    if (scCancel) scCancel.addEventListener("click", closeScenarioDialog);  // : close the dialog
    // : scenario share dialog
    const scShareSave = document.getElementById("scenario-share-save");
    if (scShareSave) scShareSave.addEventListener("click", saveScenarioShares);
    const scShareCancel = document.getElementById("scenario-share-cancel");
    if (scShareCancel) scShareCancel.addEventListener("click", closeScenarioShareDialog);
    // : tariff/coupon dialogs are removed from the HTML in the Community edition -> null-safe.
    const tariffForm = document.getElementById("admin-tariff-form");
    if (tariffForm) tariffForm.addEventListener("submit", handleTariffSubmit);
    // : "Cancel" now closes the dialog (the form lives in the modal).
    const tariffReset = document.getElementById("admin-tariff-reset");
    if (tariffReset) tariffReset.addEventListener("click", closeTariffDialog);
    const couponForm = document.getElementById("admin-coupon-form");
    if (couponForm) couponForm.addEventListener("submit", handleCouponSubmit);
    const couponReset = document.getElementById("admin-coupon-reset");
    if (couponReset) couponReset.addEventListener("click", closeCouponDialog);
    // : coupon input field on the pricing page removed (discount codes in the Stripe checkout).
    // : GoBD-Finanzamt-Export
    const gobdBtn = document.getElementById("gobd-export-btn");
    if (gobdBtn) gobdBtn.addEventListener("click", handleGobdExport);

    // Admin user search + sort (community-strip : the entire users tab is stripped in Community -> null-safe)
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
        if (lbl) lbl.textContent = has ? fileInput.files[0].name : t("core.noFileSelected");
        if (cpbReset) cpbReset.classList.toggle("hidden", !has);
    };
    if (fileInput) {
        fileInput.addEventListener("change", _cpbUpdateLbl);
    }
    // : reset the playbook file selection (stopPropagation -> don't open the file dialog).
    if (cpbReset && fileInput) {
        cpbReset.addEventListener("click", (e) => { e.stopPropagation(); fileInput.value = ""; _cpbUpdateLbl(); });
    }
    const uploadForm = document.getElementById("custom-playbook-upload-form");
    if (uploadForm) {
        uploadForm.addEventListener("submit", handleCustomPlaybookUpload);
    }

    //: CSP hardening – use event delegation instead of inline onclick handlers,
    // so script-src can do without 'unsafe-inline'.
    const cpbDropzone = document.getElementById("custom-playbook-dropzone");
    if (cpbDropzone && fileInput) {
        cpbDropzone.addEventListener("click", () => fileInput.click());
    }

    //: logo upload box (dropzone) – click, file label and drag & drop, analogous to the YML box.
    const iconInput = document.getElementById("custom-pb-icon-file");
    const iconDropzone = document.getElementById("custom-pb-icon-dropzone");
    const iconReset = document.getElementById("custom-pb-icon-reset");
    const updateIconLbl = () => {
        const lbl = document.getElementById("custom-pb-icon-filename-lbl");
        const has = iconInput && iconInput.files.length;
        if (lbl) lbl.textContent = has ? iconInput.files[0].name : t("core.noFileSelected");
        if (iconReset) iconReset.classList.toggle("hidden", !has);
    };
    if (iconInput) iconInput.addEventListener("change", updateIconLbl);
    // : reset the logo selection.
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

    //: logo upload box (dropzone) in the edit dialog – analogous to the create form.
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

    // : Teams tabs, FAB + create dialog.
    const teamUsersBtn = document.getElementById("team-tab-users-btn");
    if (teamUsersBtn) teamUsersBtn.addEventListener("click", () => switchTeamsTab("users"));
    const teamActivityBtn = document.getElementById("team-tab-activity-btn");
    if (teamActivityBtn) teamActivityBtn.addEventListener("click", () => switchTeamsTab("activity"));
    const teamFab = document.getElementById("team-fab");
    if (teamFab) teamFab.addEventListener("click", openGuestCreateDialog);
    const guestCreateCancel = document.getElementById("guest-create-cancel");
    if (guestCreateCancel) guestCreateCancel.addEventListener("click", closeGuestCreateDialog);
    enableModalDismiss("guest-create-dialog", closeGuestCreateDialog);
    // : edit dialog.
    const guestEditCancel = document.getElementById("guest-edit-cancel");
    if (guestEditCancel) guestEditCancel.addEventListener("click", closeGuestEditDialog);
    const guestEditSave = document.getElementById("guest-edit-save");
    if (guestEditSave) guestEditSave.addEventListener("click", saveGuestEdit);
    enableModalDismiss("guest-edit-dialog", closeGuestEditDialog);
    // : scenario share dialog per team member.
    const guestScenCancel = document.getElementById("guest-scenarios-cancel");
    if (guestScenCancel) guestScenCancel.addEventListener("click", closeGuestScenariosDialog);
    const guestScenSave = document.getElementById("guest-scenarios-save");
    if (guestScenSave) guestScenSave.addEventListener("click", saveGuestScenarios);
    enableModalDismiss("guest-scenarios-dialog", closeGuestScenariosDialog);
    // : activities dialog per team member.
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

    //: share dialog
    const pbsCancel = document.getElementById("playbook-share-cancel");
    const pbsSave = document.getElementById("playbook-share-save");
    if (pbsCancel) pbsCancel.addEventListener("click", closeShareCustomPlaybook);
    if (pbsSave) pbsSave.addEventListener("click", saveShareCustomPlaybook);
    enableModalDismiss("playbook-share-dialog", closeShareCustomPlaybook);
    enableModalDismiss("managed-device-share-dialog", closeManagedDeviceShare);

    //: guest playbook revoke dialog
    const grCancel = document.getElementById("guest-revoke-cancel");
    const grSave = document.getElementById("guest-revoke-save");
    if (grCancel) grCancel.addEventListener("click", closeGuestRevokeDialog);
    if (grSave) grSave.addEventListener("click", saveGuestRevoke);
    enableModalDismiss("guest-revoke-dialog", closeGuestRevokeDialog);
    // : device share dialog per guest.
    const gdCancel = document.getElementById("guest-devices-cancel");
    if (gdCancel) gdCancel.addEventListener("click", closeGuestDevicesDialog);
    const gdSave = document.getElementById("guest-devices-save");
    if (gdSave) gdSave.addEventListener("click", saveGuestDevicesDialog);
    enableModalDismiss("guest-devices-dialog", closeGuestDevicesDialog);

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

    // Legal links are handled by standalone pages (no modal listeners needed anymore).
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
        //: navigator.clipboard is available ONLY in secure contexts (HTTPS/localhost); in
        // HTTP deployments (On-Prem/homelab via IP) it was undefined -> the handler threw synchronously
        // and the button appeared to do nothing. copyToClipboard() catches this with an execCommand fallback.
        copyTokenBtn.addEventListener("click", async () => {
            const text = document.getElementById("generated-token-text").textContent;
            const ok = await copyToClipboard(text);
            showToast(ok ? t("core.tokenCopied") : t("core.copyFailedManual"));
        });
    }
    
    const guestSubmitBtn = document.getElementById("guest-submit-btn");
    if (guestSubmitBtn) {
        guestSubmitBtn.addEventListener("click", handleGuestSubmit);
    }
    //: no manual "Refresh" button anymore - loadAuditLog() runs on
    // opening the /teams page (routePage).

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

//: robust copy to the clipboard. navigator.clipboard works only in
// secure contexts (HTTPS/localhost); in HTTP deployments it is missing. Then fall back to a
// temporary <textarea> + document.execCommand("copy"). Returns true on success.
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* falls through to execCommand below */ }
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
        //: ?lang -> the server returns bilingual playbook descriptions in the UI language.
        const response = await fetch(`/api/presets?lang=${encodeURIComponent(getLanguage())}`);
        if (response.ok) {
            allPresets = await response.json();
        } else {
            //: on error don't keep the (possibly foreign) old presets -> clear them,
            // so that after a logout the previous user's catalog never remains.
            allPresets = [];
        }
    } catch (e) {
        console.error("Fehler beim Laden der Presets:", e);
        allPresets = [];
    }
}

// Fetch all available playbooks from directory
// : presets created/shared by the user for catalog tiles (own + shared).
let userCustomPresets = [];
async function fetchUserCustomPresets() {
    // : NO more admin exclusion. Admins (and the community single user with role=admin)
    // may create their own presets (premium exception); /api/profile/presets returns them scoped to
    // the user. Previously only loadPresets (vault tab) loaded them without a guard, but fetchUserCustomPresets
    // did not -> the home-page tiles only appeared after visiting the presets tab. Now consistent.
    if (!currentUser) { userCustomPresets = []; return; }
    try {
        const r = await fetch("/api/profile/presets");
        userCustomPresets = r.ok ? await r.json() : [];
    } catch (e) { userCustomPresets = []; }
}

// : own + shared scenarios for the home-page "Scenarios" section.
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
        const response = await fetch(`/api/playbooks?lang=${encodeURIComponent(getLanguage())}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Fehler beim Laden");
        allPlaybooks = await response.json();
        await fetchUserCustomPresets();  //: load own/shared presets for tiles
        await fetchUserScenarios();       //: scenario tiles
        renderPlaybooks();
    } catch (err) {
        playbooksList.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-outlined">warning</span>
                ${t("core.playbooksLoadError")}
            </div>`;
    }
}

function renderSinglePlaybookItem(pb) {
    const item = document.createElement("label");
    item.className = "playbook-item";
    //: search index (name, category, description) for the visibility filtering.
    item.dataset.search = `${pb.name || ""} ${pb.category || ""} ${pb.description || ""}`.toLowerCase();
    //: exact category key (German index.yml value) for the category filter.
    // Presets/scenarios/custom tiles carry NO data-category -> they bypass the filter.
    item.dataset.category = (pb.category && pb.category.trim()) ? pb.category.trim() : "";

    let requiresHtml = "";
    if (pb.requires && pb.requires.length > 0) {
        const reqNames = pb.requires.map(reqFile => playbookNameMap[reqFile] || reqFile).join(", ");
        requiresHtml = `
            <div class="playbook-requires">
                <span class="material-symbols-outlined">link</span>
                <span>${t("core.requires")} <span class="req-names">${reqNames}</span></span>
            </div>
        `;
    }
    
    let iconHtml = "";
    let iconSrc = "";
    //: custom playbooks have an uploaded/linked logo (icon_value:
    // data URI or https URL) -> prefer showing it instead of the placeholder.
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
        img.src = iconSrc; // set as a property -> no HTML injection via the data URI
        iconHtml = img.outerHTML;
    } else {
        iconHtml = `<span class="material-symbols-outlined playbook-item-icon">${escapeHtml(pb.icon || 'settings')}</span>`;
    }
    
    //: premium marking only in the cloud edition (on-prem/community: everything free).
    // Badge on the name + accent-color background of the whole tile (class playbook-item--premium).
    let premiumHtml = "";
    const isPremium = pb.premium && currentEdition === "cloud";
    // : premium playbooks require an active premium runtime. Non-
    // eligible users (not logged in or without an active subscription) see the tile
    // grayed out and disabled; a click leads to the subscription/upsell flow.
    const entitled = !!(currentUser && currentUser.is_subscription_active);
    const locked = isPremium && !entitled;
    if (isPremium) {
        item.classList.add("playbook-item--premium");
        premiumHtml = `<span class="playbook-premium-badge" title="${t("core.premiumBadgeTitle")}">
                <span class="material-symbols-outlined">workspace_premium</span>Premium</span>`;
    }
    if (locked) {
        item.classList.add("playbook-item--locked");
    }

    // : vendor info only for system playbooks with configured vendor_urls.
    let vendorHtml = "";
    const hasVendor = !pb.custom && Array.isArray(pb.vendor_urls) && pb.vendor_urls.length > 0;
    if (hasVendor) {
        vendorHtml = `
            <div class="playbook-vendor">
                <a href="#" class="playbook-vendor-trigger">
                    <span class="material-symbols-outlined">info</span>${t("core.showVendor")}
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
                // Prevents the click from toggling the tile checkbox (label).
                e.preventDefault();
                e.stopPropagation();
                openVendorDialog(pb);
            });
        }
    }

    if (locked) {
        // Prevent selection and open the upsell dialog instead.
        item.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            promptPremiumUpsell();
        });
    }
    return item;
}

// : vendor info dialog. Shows the official vendor/author URLs of a
// system playbook as clickable links (open in a new tab, rel=noopener).
function openVendorDialog(pb) {
    const dialog = document.getElementById("playbook-vendor-dialog");
    if (!dialog) return;
    const titleEl = document.getElementById("playbook-vendor-title");
    if (titleEl) titleEl.textContent = t("core.vendorDialogTitle", { name: pb.name || "" });
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

// : upsell dialog for locked premium playbooks - styled modal in the
// page style instead of window.confirm. Role-dependent text; the CTA leads to the pricing page.




// : central entry point into the pricing/subscription flow -> dedicated pricing page.
// In non-cloud editions or for guests/admins, /pricing falls back in routePage()
// to the home page; there the existing subscription flow in the profile takes over.


// ===========================================================================
// : pricing page /pricing — tabs (tariff groups), portrait tiles
// (options), term dropdown (intervals), purchase flow.
// ===========================================================================















//: check the coupon code on the pricing page (UX feedback; the backend
// validates again at checkout).


function renderPlaybooks() {
    // : guest accounts with an active host subscription get a subtle
    // premium hint (premium playbooks are already filtered server-side).
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
        //: carry icon_value (custom playbook logo) along, so that the run modal
        // and the config accordion also show the uploaded logo.
        //: service_group for the port collision check.
        //: carry the catalog variables (index.yml) so the run dialog can render
        // config fields for playbooks without a hardcoded playbookDomainConfigs entry.
        playbookMetadataMap[pb.file] = { name: pb.name, icon: pb.icon, icon_value: pb.icon_value, service_group: pb.service_group, variables: pb.variables };
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
                ${t("core.noPlaybooksOrPresets")}
            </div>`;
        return;
    }
    
    //: always render ALL presets/playbooks. The search then only filters
    // visibility (applyPlaybookSearch at the end of the function), so that the current selection
    // (checkboxes in the DOM) is fully preserved while typing.
    const presetsToShow = allPresets || [];
    const playbooksToShow = allPlaybooks || [];

    // : scenarios section (own + shared) with a rocket icon. Click = 1-click run.
    // : scenarios now come BEFORE the available presets (own content first).
    const _scenarios = Array.isArray(userScenarios) ? userScenarios.filter(s => s.valid !== false) : [];
    if (_scenarios.length > 0) {
        const scHeader = document.createElement("div");
        scHeader.className = "category-main-title grid-row-header";
        scHeader.innerHTML = `
            <span class="material-symbols-outlined">rocket_launch</span>
            ${t("core.scenariosHeader")}
        `;
        playbooksList.appendChild(scHeader);
        _scenarios.forEach(s => {
            const tile = document.createElement("div");
            tile.className = "playbook-item scenario-tile";
            tile.style.cursor = "pointer";
            const badge = !s.is_owner ? `<span class="playbook-desc">${s.permission === "flexible" ? t("core.sharedFlexible") : t("core.sharedStrict")}</span>` : "";
            // : tile subtitle just "→ target device" (no preset name); deviceless -> "set at run time".
            tile.innerHTML = `<span class="material-symbols-outlined playbook-item-icon">rocket_launch</span>` +
                `<div class="playbook-info"><span class="playbook-name">${escapeHtml(s.name)}</span>` +
                `<span class="playbook-desc">→ ${escapeHtml(scenarioTargetLabel(s))}</span>${badge}</div>`;
            tile.addEventListener("click", () => runScenario(s));
            playbooksList.appendChild(tile);
        });
    }

    // : own/shared presets as launchable tiles. Also for guests,
    // so that shared presets can be executed. Click -> launchPreset (the server
    // enforces permission + premium).
    // 1. Render preset header & tiles — : own/shared presets belong in
    // "Available presets" (no separate "Own presets" category anymore).
    //: hide presets from which a scenario has already been created (the preset is
    // then represented by the scenario; delete/logic stays intact, only the display is dropped).
    // Only VALID scenarios (_scenarios, valid !== false) count — a scenario with a deleted
    // device does not appear in the scenarios list and must not also hide its preset.
    const _scenarioPresetIds = new Set(_scenarios.map(s => s.preset_id).filter(Boolean));
    const _customPresets = (Array.isArray(userCustomPresets) ? userCustomPresets : []).filter(p => !_scenarioPresetIds.has(p.id));
    if (presetsToShow.length > 0 || _customPresets.length > 0) {
        const presetHeader = document.createElement("div");
        presetHeader.className = "category-main-title grid-row-header";
        // : spacing to the scenarios section above (if present).
        if (_scenarios.length > 0) presetHeader.style.marginTop = "24px";
        // : same icon as the presets tab (tune).
        presetHeader.innerHTML = `
            <span class="material-symbols-outlined">tune</span>
            ${t("core.availablePresets")}
        `;
        playbooksList.appendChild(presetHeader);

        // Own/shared presets first (clickable tiles; click -> launchPreset).
        _customPresets.forEach(p => {
            const tile = document.createElement("div");
            tile.className = "playbook-item custom-preset-tile";
            tile.style.cursor = "pointer";
            const pbCount = (p.playbook_ids || []).length;
            const badge = !p.is_owner ? `<span class="playbook-desc">${p.permission === "flexible" ? t("core.sharedFlexible") : t("core.sharedStrict")}</span>` : "";
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
            //: search index (name, description, contained playbook names).
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
            
            const descriptionText = preset.description || t("core.presetModules", { names: presetPlaybookNames });
            
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
    //    Guests see the default catalog as well (supersedes).
    if (playbooksToShow.length > 0) {
        const pbHeader = document.createElement("div");
        pbHeader.className = "category-main-title grid-row-header";
        pbHeader.style.marginTop = "24px";
        pbHeader.innerHTML = `
            <span class="material-symbols-outlined">settings_applications</span>
            ${t("core.availablePlaybooks")}
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
        //: populate the filter dropdown with the categories actually present.
        populateCategoryFilter(catNames);

        catNames.forEach(catName => {
            const subTitle = document.createElement("div");
            subTitle.className = "subcategory-title grid-row-header";
            subTitle.style.marginTop = "12px";
            subTitle.textContent = catLabel(catName);
            playbooksList.appendChild(subTitle);
            
            //: within the category, sort alphabetically by display name.
            grouped[catName]
                .slice()
                .sort((a, b) => (a.name || "").localeCompare(b.name || "", getLocale(), { sensitivity: "base" }))
                .forEach(pb => {
                    playbooksList.appendChild(renderSinglePlaybookItem(pb));
                });
        });
    }
    
    // Apply grid/list view settings
    applyViewMode();

    // Initialize preset indeterminate states
    updatePresetHighlights();

    //: apply the active search term (if any) as pure visibility filtering.
    applyPlaybookSearch();
}

//: filters ONLY the visibility of preset/playbook tiles based on the search field and
// hides empty category/subcategory headings. Nothing is re-rendered,
// so the current selection (checkboxes) - even for currently hidden
// tiles - is fully preserved.
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
            const matchesText = !term || (el.dataset.search || "").includes(term);
            //: category filter. Tiles without data-category (presets/scenarios/custom) stay
            // visible; if no filter is active, everything applies too.
            const cat = el.dataset.category || "";
            const matchesCat = selectedCatalogCategories.size === 0 || cat === "" || selectedCatalogCategories.has(cat);
            const vis = matchesText && matchesCat;
            el.style.display = vis ? "" : "none";
            if (vis) { anyVisible = true; mainCount++; subCount++; }
        }
    });
    finalizeSub();
    finalizeMain();

    // "No matches" hint as its own element (does not destroy the tiles).
    let empty = document.getElementById("playbook-no-results");
    if (term && !anyVisible) {
        if (!empty) {
            empty = document.createElement("div");
            empty.id = "playbook-no-results";
            empty.className = "empty-state";
            playbooksList.appendChild(empty);
        }
        empty.innerHTML = `<span class="material-symbols-outlined">search_off</span> ${t("core.noSearchResults", { term: escapeHtml(term) })}`;
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
                showToast(t("core.dependencyAutoSelected", { name: reqName }));
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
        showToast(t("core.selectAtLeastOne"));
        return;
    }

    // : spam protection. If anonymous execution is disabled server-side,
    // we prompt not-logged-in visitors to sign in/register.
    if (!currentUser && !allowAnonymousRun) {
        showToast(t("core.loginToRun"));
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
        //: dashboard options. Defaults in the playbook preserve the previous behavior
        // (dashboard on, basic auth on, dashboard under the Traefik domain).
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
    //: MQTT/Mosquitto previously had no UI configuration. Defaults in the playbook
    // preserve the previous behavior (auth on, port 1883, user = SSH user).
    // The port is NOT a Traefik alternative -> scope "general" (always visible).
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
        //: the DB port is NOT a Traefik alternative (PostgreSQL does not run behind Traefik)
        // -> always visible/configurable, independent of the Traefik toggle.
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
        //: Subpfad-Modus – Gitea ist suburl-fähig via ROOT_URL (Tier A).
        { label: "Gitea Subpfad (bei Traefik-Subpfad-Modus)", variable: "gitea_subpath", placeholder: "/gitea", default: "/gitea", required: false },
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
    // Playbook roadmap (premium) – batch 2 (RustDesk has no configurable variables)
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

//: translate the catalog variables of a playbook (index.yml `variables`) into the
// config-field shape the run dialog expects (same shape as playbookDomainConfigs entries).
// Used as a FALLBACK for playbooks that have no hardcoded playbookDomainConfigs entry
// (game servers, and a few dev stacks like open-webui/dify). Playbooks that DO have a
// hardcoded entry keep it unchanged.
function catalogVariablesToConfigs(vars) {
    if (!Array.isArray(vars)) return [];
    // index.yml types -> HTML input type. `secret` must become `password` (otherwise the
    // value would render in plain text). Ports/strings/domains are plain text inputs.
    const TYPE_TO_INPUT = { secret: "password", port: "text", string: "text", domain: "text" };
    return vars.filter(v => v && v.name).map(v => {
        const isBool = v.type === "bool";
        // A domain field only makes sense behind Traefik -> scope "domain". Everything else
        // (game ports, names, passwords) is a real host-level setting -> "general" (always
        // visible, independent of Traefik). An explicit v.scope wins.
        let scope = v.scope;
        if (!scope) scope = (v.type === "domain" || String(v.name).endsWith("_domain")) ? "domain"
            : (String(v.name).endsWith("_subpath") ? "subpath" : "general");
        // Show the default as a gray placeholder so the user sees the current value, EXCEPT
        // for secrets (never surface a default password). An explicit v.placeholder wins.
        let placeholder = v.placeholder;
        if (placeholder === undefined && v.type !== "secret" && v.default !== undefined && v.default !== "") {
            placeholder = String(v.default);
        }
        const cfg = {
            variable: v.name,
            label: v.label || v.name,
            required: !!v.required,
            scope: scope,
        };
        if (isBool) {
            cfg.type = "bool";
            cfg.default = (v.default === true || v.default === "true");
        } else {
            cfg.type = TYPE_TO_INPUT[v.type] || "text";
            if (placeholder !== undefined) cfg.placeholder = placeholder;
        }
        return cfg;
    });
}

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
    //: the same ordering as the backend runner (prerequisites -> install-* -> create-stack-*).
    uniqueCheckedPlaybooks.sort((a, b) => playbookOrderRank(a) - playbookOrderRank(b));
    
    //: the "Selected playbooks" box was removed; uniqueCheckedPlaybooks is
    // still needed for the HTTPS/port warnings and the config accordions.

    //: warning when a selected playbook requires HTTPS.
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
            const verb = httpsNames.length === 1 ? t("run.requiresVerbSg") : t("run.requiresVerbPl");
            httpsWarnText.textContent = t("run.httpsWarning", { names: httpsNames.join(", "), verb });
            httpsWarn.classList.remove("hidden");
        } else {
            httpsWarn.classList.add("hidden");
        }
    }

    //: group configuration fields per playbook (for the accordion).
    const configGroups = [];
    let totalConfigs = 0;
    uniqueCheckedPlaybooks.forEach(pbPath => {
        const baseName = pbPath.split('/').pop();
        const meta = playbookMetadataMap[pbPath] || playbookMetadataMap[baseName] || { name: baseName };
        //: prefer the hand-tuned hardcoded config; otherwise fall back to the
        // catalog variables (index.yml) so game servers etc. also get input fields.
        const cfgs = playbookDomainConfigs[baseName] || catalogVariablesToConfigs(meta.variables);
        if (cfgs && cfgs.length) {
            //: service group (variants of the same service don't collide);
            // without an explicit group, each playbook is its own group.
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
    // : add variables of active own/shared presets (all their playbooks
    // selected), so the saved settings are visibly loaded into the fields.
    (userCustomPresets || []).forEach(p => {
        const ids = p.playbook_ids || [];
        if (!ids.length || !p.variables) return;
        const allSelected = ids.every(file => {
            const cb = playbooksList.querySelector(`input[name="playbooks"][value="${cssEscape(file)}"]`);
            return cb && cb.checked;
        });
        if (allSelected) Object.assign(activeVariables, p.variables);
    });
    // base_dir/timezone live outside the domains section -> pre-fill them visibly here
    // (the domain/port fields pull their value further down directly from activeVariables).
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
    //: routing-mode selector (domain vs. subpath) + base host for subpath mode.
    const routeModeContainer = document.getElementById("modal-route-mode-container");
    const routeModeSelect = document.getElementById("modal-route-mode");
    const baseDomainWrap = document.getElementById("modal-base-domain-wrap");
    const baseDomainInput = document.getElementById("modal-base-domain");

    domainsInputsContainer.innerHTML = "";
    
    if (totalConfigs > 0) {
        traefikContainer.classList.remove("hidden");
        //: the section is visible as soon as there are fields (no longer only in Traefik mode).
        domainsSection.classList.remove("hidden");

        //: fields per playbook in a collapsible accordion (closed by default).
        configGroups.forEach(group => {
            const details = document.createElement("details");
            details.className = "modal-config-accordion";
            const summary = document.createElement("summary");
            summary.className = "modal-config-accordion-summary";
            //: playbook logo to the left of the title; the count is set in
            // applyScopeVisibility based on the fields actually visible.
            summary.innerHTML =
                `<span class="modal-config-accordion-label">${playbookIconHtml({ icon: group.icon })}<span>${escapeHtml(group.name)}</span></span>` +
                `<span class="modal-config-accordion-count"></span>`;
            details.appendChild(summary);
            const body = document.createElement("div");
            body.className = "modal-config-accordion-body";

            group.configs.forEach(cfg => {
                //: scope per field – domains only with Traefik, HTTP ports only without
                // Traefik, all other settings always. An explicit cfg.scope takes precedence
                // (e.g. the DB port postgres_port is NOT a Traefik alternative -> 'general').
                let scope = cfg.scope
                    || (cfg.variable.endsWith("_domain") ? "domain"
                        : (cfg.variable.endsWith("_subpath") ? "subpath"
                            : (cfg.variable.endsWith("_port") ? "port" : "general")));
                const div = document.createElement("div");
                div.dataset.scope = scope;
                //: store the service group on the field (port collision check).
                div.dataset.serviceGroup = group.serviceGroup;
                if (cfg.type === "bool") {
                    //: boolean values as a toggle checkbox instead of free-text "true/false".
                    // Prefilled from the active preset, otherwise the playbook default (cfg.default).
                    const prefill = activeVariables[cfg.variable];
                    const checked = (prefill !== undefined) ? (prefill === true || prefill === "true") : !!cfg.default;
                    div.className = "config-field bool-field";
                    div.innerHTML =
                        `<label class="checkbox-label bool-field-label"><input type="checkbox" class="styled-checkbox" id="variable-${cfg.variable}" data-variable="${cfg.variable}" data-scope="${scope}"${checked ? " checked" : ""}><span>${escapeHtml(cfg.label)}</span></label>`;
                } else {
                    //: example value as a gray HTML placeholder (the label floats via .config-field
                    // permanently at the top, so it doesn't overlap the placeholder).
                    const defaultValue = activeVariables[cfg.variable] || cfg.default || "";
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

        //: show/hide fields depending on Traefik mode; accordions without
        // a visible field are hidden entirely.
        const applyScopeVisibility = () => {
            const traefik = useTraefikCheckbox.checked;
            //: subpath mode is only meaningful when Traefik is on.
            const subpathMode = traefik && routeModeSelect && routeModeSelect.value === "subpath";
            if (routeModeContainer) routeModeContainer.classList.toggle("hidden", !traefik);
            if (baseDomainWrap) baseDomainWrap.style.display = subpathMode ? "" : "none";
            let anyVisible = false;
            domainsInputsContainer.querySelectorAll(".modal-config-accordion").forEach(acc => {
                //: an app is subpath-capable iff it declares a subpath-scoped field.
                // In subpath mode non-capable apps are hidden entirely (Tier C hard-hide).
                const accCapable = !!acc.querySelector('.config-field[data-scope="subpath"]');
                let visibleCount = 0;
                acc.querySelectorAll(".config-field").forEach(field => {
                    const scope = field.dataset.scope;
                    let visible;
                    if (scope === "port") visible = !traefik;
                    else if (scope === "domain") visible = traefik && !subpathMode;
                    else if (scope === "subpath") visible = traefik && subpathMode;
                    else visible = !(traefik && subpathMode && !accCapable); // general
                    field.style.display = visible ? "" : "none";
                    if (visible) { anyVisible = true; visibleCount++; }
                    const inp = field.querySelector("input");
                    if (inp) inp.required = visible && inp.dataset.required === "true";
                });
                acc.style.display = visibleCount > 0 ? "" : "none";
                //: adjust the count to the fields actually visible.
                const countEl = acc.querySelector(".modal-config-accordion-count");
                if (countEl) countEl.textContent = `${visibleCount} ${visibleCount === 1 ? t("run.settingSg") : t("run.settingPl")}`;
            });
            //: the section now contains the Traefik checkbox and must stay reachable
            // as long as there are any config fields at all (totalConfigs > 0) - so no longer
            // hide it based on visible fields. The subheading is only shown
            // when fields are actually visible.
            domainsSection.classList.remove("hidden");
            const fieldsSubtitle = domainsSection.querySelector(".section-subtitle");
            if (fieldsSubtitle) fieldsSubtitle.style.display = anyVisible ? "" : "none";
            //: check port collisions after every visibility change.
            checkPortCollisions();
        };

        //: also check port collisions live on every input in the port fields.
        domainsInputsContainer.addEventListener("input", checkPortCollisions);

        useTraefikCheckbox.onchange = applyScopeVisibility;
        //: re-apply visibility when the routing mode changes; restore mode/base host from preset.
        if (routeModeSelect) {
            routeModeSelect.onchange = applyScopeVisibility;
            routeModeSelect.value = (activeVariables.route_mode === "subpath") ? "subpath" : "domain";
        }
        if (baseDomainInput) baseDomainInput.value = activeVariables.base_domain || "";
        // : take use_traefik from the active preset if saved; otherwise default
        // (true if the preset brings any variables at all).
        useTraefikCheckbox.checked = (activeVariables.use_traefik !== undefined)
            ? (activeVariables.use_traefik === true || activeVariables.use_traefik === "true")
            : hasPrefilled;
        applyScopeVisibility();
    } else {
        traefikContainer.classList.add("hidden");
        domainsSection.classList.add("hidden");
        if (routeModeContainer) routeModeContainer.classList.add("hidden");
        if (baseDomainWrap) baseDomainWrap.style.display = "none";
        useTraefikCheckbox.checked = false;
        useTraefikCheckbox.onchange = null;
    }
    
    //  (#E): show the "Save as preset" controls only for active non-guests (or admins).
    // The server gate in create_custom_preset is the real boundary; this is only for convenience.
    //  (Community): hide + disable entirely in the Community edition.
    const canSavePreset = currentEdition !== "community" && !!currentUser && currentUser.role !== "guest" && (currentUser.is_subscription_active || currentUser.role === "admin");
    const savePresetRow = document.getElementById("modal-save-preset-row");
    if (savePresetRow) savePresetRow.style.display = canSavePreset ? "" : "none";
    const savePresetBtn = document.getElementById("modal-save-preset-btn");
    // : "Save as preset only" starts disabled (enabled only once a name has been entered).
    if (savePresetBtn) { savePresetBtn.style.display = canSavePreset ? "" : "none"; savePresetBtn.disabled = true; }
    const savePresetCb = document.getElementById("modal-save-preset-cb");
    if (savePresetCb) savePresetCb.checked = false;
    const modalPresetName = document.getElementById("modal-preset-name");
    if (modalPresetName) modalPresetName.value = "";

    //: fresh dialog -> no unsaved changes.
    modalDirty = false;
    credentialsDialog.classList.remove("hidden");
    modalTargetHost.focus();
}

// : prefilling the preset settings now runs centrally in showCredentialsModal
// (activeVariables incl. userCustomPresets) — a separate applyPresetVariablesToModal function
// is no longer needed.

function hideCredentialsModal() {
    credentialsDialog.classList.add("hidden");
    modalDirty = false;
    modalTargetHost.disabled = false;
    modalUsernameInput.disabled = false;
    modalPasswordInput.disabled = false;
    const deviceSelect = document.getElementById("modal-device-select");
    if (deviceSelect) deviceSelect.value = "";
    // : release the active preset binding, so a subsequent normal run does not inherit it.
    window._activePresetId = null;
    //  (#E): reset the save-as-preset controls.
    const _spCb = document.getElementById("modal-save-preset-cb"); if (_spCb) _spCb.checked = false;
    const _spName = document.getElementById("modal-preset-name"); if (_spName) _spName.value = "";
    const _spBtn = document.getElementById("modal-save-preset-btn"); if (_spBtn) _spBtn.disabled = true;
    //: reset OS-family controls (auto-detect on by default, dropdown hidden). A device's
    // own stored family is still honored server-side even while auto-detect is on.
    const _osCb = document.getElementById("modal-os-autodetect");
    if (_osCb) { _osCb.checked = true; _osCb.onchange = _syncModalOsFamilyUI; }
    const _osSel = document.getElementById("modal-os-family");
    if (_osSel) _osSel.value = "debian";
    _syncModalOsFamilyUI();
}

//: show the run dialog's OS-family dropdown only when auto-detect is off.
function _syncModalOsFamilyUI() {
    const cb = document.getElementById("modal-os-autodetect");
    const wrap = document.getElementById("modal-os-family-wrap");
    if (wrap) wrap.style.display = (cb && cb.checked) ? "none" : "block";
}

// : reusable, styled confirmation dialog (#app-confirm-dialog) as a replacement
// for the native window.confirm() — especially for delete confirmations (devices, presets, playbooks, …).
// Returns a Promise<boolean> (true = confirmed). ESC/backdrop/cancel -> false.
// : `messageHtml` allows formatted content (bold names, accent colors). Callers
// MUST sanitize dynamic values in it themselves via escapeHtml(); `message` stays plain text.
function showConfirmDialog({ title = t("common.confirm"), message = "", messageHtml = null, confirmLabel = t("common.confirm"), cancelLabel = t("common.cancel") } = {}) {
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

//: user-initiated close (ESC/backdrop/cancel) with a warning on
// unsaved input. After a successful start, handleModalSubmit calls
// hideCredentialsModal() directly (without asking).
function closeCredentialsModalGuarded() {
    if (modalDirty) {
        // : styled confirmation in the site style instead of the native window.confirm.
        const dlg = document.getElementById("discard-confirm-dialog");
        if (dlg) { dlg.classList.remove("hidden"); return; }
    }
    hideCredentialsModal();
}

//: port collision check. Warns when the same host port is used by fields
// of DIFFERENT services (service_group). Variants of the same
// service (same service_group) deliberately do not collide. Only visible
// port fields (relevant in published-ports mode) count.
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
        const verb = conflicting.length === 1 ? t("run.portConflictVerbSg") : t("run.portConflictVerbPl");
        warnText.textContent = t("run.portCollision", { ports: conflicting.join(", "), verb });
        warn.classList.remove("hidden");
    } else {
        warn.classList.add("hidden");
    }
}

//  (#E): playbook/variable collection factored out of the run dialog, so the run path
// (handleModalSubmit) AND the preset save use byte-identical values.
function collectModalPlaybooks() {
    const checkedBoxes = playbooksList.querySelectorAll('input[name="playbooks"]:checked');
    const playbooks = Array.from(checkedBoxes).map(cb => cb.value);
    const uniquePlaybooks = [...new Set(playbooks)];
    //: the same ordering as the backend runner (prerequisites -> install-* -> create-stack-*).
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
    //: routing mode + base host (only relevant with Traefik / subpath mode).
    if (useTraefik) {
        const rm = document.getElementById("modal-route-mode");
        const mode = (rm && rm.value === "subpath") ? "subpath" : "domain";
        variables["route_mode"] = mode;
        if (mode === "subpath") {
            const bd = document.getElementById("modal-base-domain");
            if (bd && bd.value.trim()) variables["base_domain"] = bd.value.trim();
        }
    }
    document.querySelectorAll("#modal-domains-inputs .config-field").forEach(field => {
        if (field.style.display === "none") return;
        const inp = field.querySelector("input");
        if (!inp || !inp.dataset.variable) return;
        //: a bool checkbox always yields an explicit true/false string; text fields
        // as before, only when filled (empty = the playbook default applies).
        if (inp.type === "checkbox") {
            variables[inp.dataset.variable] = inp.checked ? "true" : "false";
        } else if (inp.value.trim()) {
            variables[inp.dataset.variable] = inp.value.trim();
        }
    });
    return variables;
}

//  (#E): save the current run configuration as a preset (premium; the server enforces the gate
// again, the UI gating is only for convenience). opts.silent suppresses the success toast.
async function saveModalPreset(opts) {
    opts = opts || {};
    const nameEl = document.getElementById("modal-preset-name");
    const name = ((nameEl && nameEl.value) || "").trim();
    const playbook_ids = collectModalPlaybooks();
    if (!name) { showToast(t("job.presetNameRequired")); if (nameEl) nameEl.focus(); return false; }
    if (!playbook_ids.length) { showToast(t("job.selectPlaybook")); return false; }
    // resolve base_dir like in the real run (same fallback logic).
    const username = modalUsernameInput.value.trim();
    let baseDir = modalBaseDirInput.value.trim();
    if (!baseDir && username && !document.getElementById("modal-device-select").value) {
        baseDir = username === "root" ? "/root" : `/home/${username}`;
    }
    // preset variables are strings (backend schema Dict[str,str]); use_traefik (bool) etc.
    // stringify them. The run path (/api/run) stays unchanged with the raw values.
    const _vars = collectModalVariables(baseDir);
    const variables = {};
    Object.keys(_vars).forEach(k => { variables[k] = String(_vars[k]); });
    try {
        // : a preset bundles ONLY playbooks + their settings — no device data
        // or device binding (devices are managed separately). device_group_id stays empty.
        const res = await fetch("/api/profile/presets", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, playbook_ids, variables, device_ids: [], shares: [] })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            if (!opts.silent) showToast(t("job.presetSaved"));
            if (typeof fetchUserCustomPresets === "function") await fetchUserCustomPresets();
            //: update the catalog tiles on the home page without a reload.
            if (typeof renderPlaybooks === "function" && Array.isArray(allPlaybooks) && allPlaybooks.length) renderPlaybooks();
            if (typeof loadPresets === "function" && document.querySelector("#vault-tab-presets #presets-list") && document.body.classList.contains("tab-vault")) loadPresets();
            return true;
        }
        showToast(errorDetailToMessage(data.detail, t("job.presetSaveFailed")));
        return false;
    } catch (e) { showToast(t("job.networkErrorSaving")); return false; }
}

// "Save as preset only" — saves without a run and closes the dialog on success.
async function handleSavePresetFromDialog() {
    const ok = await saveModalPreset();
    if (ok) hideCredentialsModal();
}

// Final Submit from Modal dialog
async function handleModalSubmit() {
    //: reset the previous error message in the dialog.
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
    // (device flatten): the dropdown directly yields a device_id (no more group: prefix).
    const deviceId = deviceSelect ? deviceSelect.value : "";

    // For a bound preset the server resolves the target devices (device_ids) -> don't
    // force manual host input (the single dropdown cannot represent multi-host).
    if (!deviceId && !window._activePresetId) {
        if (!targetHost) {
            showToast(t("job.targetRequired"));
            modalTargetHost.focus();
            return;
        }
        if (!username) {
            showToast(t("job.sshUserRequired"));
            modalUsernameInput.focus();
            return;
        }
        if (!password) {
            showToast(t("job.sshPasswordRequired"));
            modalPasswordInput.focus();
            return;
        }
    }
    
    //: do NOT close the dialog beforehand - only after a successful start (see below).
    // On a server error it stays open and shows the message inline, so the
    // input already entered is preserved.
    // Disable run button and start execution
    runButton.disabled = true;
    runButton.innerHTML = `<span class="spinner"></span> ${t("job.executingBtn")}`;
    
    // Prepare variables payload (#E: factored out -> byte-identical to the preset save).
    const variables = collectModalVariables(baseDir);
    
    const payload = {
        playbooks: uniquePlaybooks,
        session_id: sessionId,
        variables: variables
    };
    // : preset execution -> the server resolves playbooks/variables/group and
    // enforces permission (strict/flexible) + premium gate.
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
    //: send an optional sudo/become password (overrides one stored on the device).
    const becomeEl = document.getElementById("modal-become-password");
    if (becomeEl && becomeEl.value) {
        payload.become_password = becomeEl.value;
    }
    //: OS-family control. Auto-detect on -> backend gather_facts pre-step; off -> the
    // chosen family is applied to all hosts. A device's own stored family is honored by the
    // backend regardless (auto-detect only fills the gaps).
    const osAutoEl = document.getElementById("modal-os-autodetect");
    const osFamEl = document.getElementById("modal-os-family");
    const osAuto = !osAutoEl || osAutoEl.checked;
    payload.os_autodetect = osAuto;
    if (!osAuto && osFamEl && osFamEl.value) {
        payload.os_family = osFamEl.value;
    }

    try {
        const response = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {

            const data = await response.json();
            throw new Error(errorDetailToMessage(data.detail, t("job.serverErrorStarting")));
        }
        
        const result = await response.json();
        //  (#E): "Save as preset" ticked -> also save the run configuration as a preset.
        //  (Community): never save in the Community edition (the controls are hidden there).
        const _savePresetCb = document.getElementById("modal-save-preset-cb");
        if (currentEdition !== "community" && _savePresetCb && _savePresetCb.checked) { await saveModalPreset({ silent: true }); }
        hideCredentialsModal();   //: only close after a successful start
        showToast(t("job.queued"));
        
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
        //: if the poll loop was paused after a logout, restart it
        // here, so that an anonymous run can also be followed live. Idempotent.
        startHistoryPolling();
    } catch (err) {
        //: show the error ONLY in the still-open dialog (no additional toast;
        // input is preserved). Toast only as a fallback if the element is missing.
        if (modalErrEl) { modalErrEl.textContent = err.message; modalErrEl.classList.remove("hidden"); }
        else { showToast(err.message); }
    } finally {
        runButton.disabled = false;
        runButton.innerHTML = `<span class="material-symbols-outlined">play_arrow</span> ${t("job.executeBtn")}`;
    }
}

//: is the job still running? Decides whether an ended log stream counts as "finished" or
// was a premature abort that requires a reconnect.
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
//: robust against connection drops – the server sends heartbeats (NUL bytes) against the
// idle timeout of proxies/browser; the client filters them out and reconnects on a
// drop automatically from the last read byte offset (no duplicate, no gap).
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
    logUserScrolledUp = false; //: new stream -> anchor at the end again

    //: attach the scroll listener once – pauses auto-scroll as soon as the user
    // scrolls up, and resumes it as soon as they scroll back to the end.
    if (!logScrollListenerAttached) {
        consoleOutput.addEventListener("scroll", () => {
            const atBottom = consoleOutput.scrollTop + consoleOutput.clientHeight >= consoleOutput.scrollHeight - 24;
            logUserScrolledUp = !atBottom;
        });
        logScrollListenerAttached = true;
    }

    // bytesReceived counts ONLY real log-file bytes (heartbeat NULs are filtered out and
    // NOT counted) -> after a reconnect the server picks up again at exactly the right
    // place. attempt limits endless reconnects and is reset on real progress.
    let bytesReceived = 0;
    let attempt = 0;

    const appendChunk = (bytes, decoder, done) => {
        const chunk = decoder.decode(bytes, { stream: !done });
        if (!chunk) return;
        consoleOutput.textContent += chunk;
        //: auto-scroll only when enabled AND the user hasn't scrolled up themselves.
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
            // : send session_id along, so anonymous viewers see their OWN anonymous
            // run.: offset = log-file bytes already read (reconnect resume).
            const url = `/api/jobs/${encodeURIComponent(jobId)}/logs?session_id=${encodeURIComponent(sessionId)}&offset=${bytesReceived}`;
            const response = await fetch(url, { signal: myController.signal });

            if (!response.ok) {
                // 404/403 are final -> don't reconnect.
                if (response.status === 404 || response.status === 403) {
                    if (bytesReceived === 0) consoleOutput.textContent += `\n[${t("job.logUnavailable")}]`;
                    return;
                }
                throw new Error(t("job.logStreamError"));
            }

            const reader = response.body.getReader();
            copyLogsBtn.disabled = false;
            let done = false;
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value && value.length) {
                    //: filter out heartbeat NUL bytes (for display) and exclude them from the offset count,
                    // so the reconnect offset matches the log-file position exactly.
                    let hasNul = false;
                    for (let i = 0; i < value.length; i++) { if (value[i] === 0) { hasNul = true; break; } }
                    const bytes = hasNul ? value.filter(b => b !== 0) : value;
                    if (bytes.length) {
                        bytesReceived += bytes.length;
                        attempt = 0; // real progress -> reset the reconnect counter
                        appendChunk(bytes, decoder, done);
                    }
                }
            }
            cleanEof = true;
        } catch (err) {
            if (err.name === 'AbortError' || myController.signal.aborted) {
                return; // Clean cancellation when switching logs
            }
            // otherwise: network drop -> reconnect below
        }

        if (myController.signal.aborted || currentlyStreamingJobId !== jobId) return;

        // Clean stream end: the server ends the stream only when the job is finished. If
        // the job is still running per its status, a proxy probably closed the connection -> reconnect.
        if (cleanEof && !(await jobIsActive(jobId))) {
            return; // job finished, log complete
        }

        attempt++;
        if (attempt > 120) {
            consoleOutput.textContent += `\n[${t("job.logStreamAborted")}]`;
            return;
        }
        await new Promise(r => setTimeout(r, Math.min(1000 * attempt, 3000)));
    }
}

// Poll history list
async function startHistoryPolling() {
    //: idempotent - a second loop would fire /api/jobs twice.
    if (pollingActive) return;
    pollingActive = true;
    async function poll() {
        await refreshHistory();

        //: after logout (no logged-in user) and without own jobs/an active
        // log stream there is nothing to poll -> stop the loop instead of endlessly
        // firing /api/jobs?session_id=.... Re-arm happens on login (checkAuthStatus)
        // or when starting a new run (handleRun).
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

//: stop polling hard (logout). clearTimeout + reset the flag, so a
// later startHistoryPolling() starts up again.
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

//: the execution order mirrors _playbook_order_rank in the backend (install-* before
// create-stack-*), so the tile order matches the actual execution exactly.
function playbookOrderRank(pb) {
    const base = String(pb || "").split("/").pop();
    //: package-manager prerequisites (Docker, Flatpak) are themselves install-* playbooks,
    // but run BEFORE the other install-* (install-flatpak before the Flatpak apps) -> stage 0.
    if (base === "install-docker.yml" || base === "install-flatpak.yml") return 0;
    if (base.startsWith("install-")) return 1;
    if (base.startsWith("create-stack-")) return 3;
    return 2;
}

//: nice display name for a tile (path/prefix/extension removed, separators -> spaces).
function playbookDisplayName(pb) {
    let base = String(pb || "").split("/").pop().replace(/\.ya?ml$/i, "");
    base = base.replace(/^install-/, "").replace(/^create-stack-/, "");
    return base.replace(/[-_]+/g, " ").trim() || base;
}

//: derive per-playbook status from job status + progress.finished (consistent with the
// progress display, which uses the same finished count). finished = completed plays;
// the finished-th (0-based) playbook is currently running / is the failed one on error.
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

//: render the flow chart of the selected job's playbooks (tiles + connector arrows).
function renderFlowchart(job) {
    const view = document.getElementById("flowchart-view");
    if (!view) return;
    if (!job || !(job.playbooks || []).length) {
        view.innerHTML = `<div class="flowchart-empty">${job ? t("job.noPlaybookInfo") : t("job.selectJobForFlow")}</div>`;
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
        //: show the playbook's associated service icon before the name (logo or
        // Material icon from the playbook metadata; fallback in playbookIconHtml).
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

//: apply the active view (tiles vs. text log) + update the toggle button icon/title.
function applyJobViewMode() {
    const flow = document.getElementById("flowchart-view");
    const log = document.getElementById("console-output");
    const btn = document.getElementById("view-toggle-btn");
    const showTiles = jobViewMode === "tiles";
    if (flow) flow.classList.toggle("hidden", !showTiles);
    if (log) log.classList.toggle("hidden", showTiles);
    if (btn) {
        btn.title = showTiles ? t("job.switchToLogView") : t("job.switchToTileView");
        const ic = btn.querySelector(".material-symbols-outlined");
        if (ic) ic.textContent = showTiles ? "terminal" : "account_tree";
    }
}

function updateConsoleProgressBar() {
    const activeJob = allJobs.find(j => j.job_id === selectedJobId);
    renderFlowchart(activeJob);   //: update the tile view on every refresh (real-time status).
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
            textEl.textContent = t("job.progressText", { finished, total, percent, outstanding });
        }
    } else if (consoleJobProgress) {
        consoleJobProgress.classList.add("hidden");
    }

    // : show the cancel button only for a running/waiting selection (also on job switch).
    const cancelBtn = document.getElementById("cancel-job-btn");
    if (cancelBtn) {
        cancelBtn.style.display = (activeJob && (activeJob.status === "running" || activeJob.status === "pending")) ? "" : "none";
    }
}

// : abort a running or waiting run (with confirmation).
async function cancelJob(jobId) {
    if (!jobId) return;
    const ok = await showConfirmDialog({
        title: t("job.cancelExecTitle"),
        message: t("job.cancelExecMsg"),
        confirmLabel: t("common.cancel"),
        cancelLabel: t("job.keepRunning")
    });
    if (!ok) return;
    try {
        const r = await fetch(`/api/jobs/${jobId}/cancel?session_id=${encodeURIComponent(sessionId)}`, { method: "POST" });
        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            showToast(errorDetailToMessage(d.detail, t("job.cancelFailed")));
            return;
        }
        showToast(t("job.execCanceled"));
        await refreshHistory();
    } catch (e) {
        showToast(t("job.cancelFailed"));
    }
}

// : close the host tab; move focus to the previous (otherwise next) visible tab.
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
    //: only jump back to "configure" when NO valid main page is active.
    // Previously the guard only knew configure/history -> the history poll pulled users away from
    // /admin, /custom-playbooks and legal pages back to "/".
    //: /teams and /pricing were also not listed -> the poll threw users
    // off these pages back to the home page after a few seconds.
    const activeMainTabs = ["tab-configure", "tab-history", "tab-vault", "tab-admin", "tab-legal", "tab-teams", "tab-pricing"];
    if (!activeMainTabs.some(c => document.body.classList.contains(c))) {
        setTab("configure");
    }
    
    // Extract unique hosts
    const hosts = [...new Set(allJobs.map(j => j.target_host))];

    // : hide host tabs closed by the user (purely client-side, session-wide).
    // Forget vanished hosts; a NEW run for a closed host shows it again.
    for (const h of [...closedHosts]) {
        if (!hosts.includes(h)) closedHosts.delete(h);
    }
    allJobs.forEach(j => {
        if (closedHosts.has(j.target_host) && !knownJobIds.has(j.job_id)) closedHosts.delete(j.target_host);
    });
    allJobs.forEach(j => knownJobIds.add(j.job_id));
    const visibleHosts = hosts.filter(h => !closedHosts.has(h));

    if (visibleHosts.length === 0) {
        // All tabs closed -> empty workspace (refreshing or a new run brings them back).
        tabsBar.innerHTML = "";
        hostHistoryList.innerHTML = "";
        if (logController) { logController.abort(); logController = null; }
        currentlyStreamingJobId = null;
        selectedJobId = null;
        activeHost = null;
        consoleOutput.textContent = t("job.allTabsClosed");
        activeJobIdBadge.textContent = t("job.noActiveJob");
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
            <span class="tab-close material-symbols-outlined" title="${t("job.closeTab")}">close</span>
        `;

        tabBtn.addEventListener("click", () => {
            if (activeHost === host) return;
            activeHost = host;

            // Clear selected job of previous host so it grabs the newest for the next host
            selectedJobId = null;

            updateUI();
        });

        // : X closes the host tab (don't trigger the tab switch).
        const closeIcon = tabBtn.querySelector(".tab-close");
        if (closeIcon) {
            closeIcon.addEventListener("click", async (e) => {
                e.stopPropagation();
                // : confirm closing – the tab focus is lost (the run may keep running in the
                // background), and this cannot be undone.
                const ok = await showConfirmDialog({
                    title: t("job.closeTabTitle"),
                    message: t("job.closeTabMsg"),
                    confirmLabel: t("common.close"),
                    cancelLabel: t("common.cancel")
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
            durationStr = t("job.runningDuration");
        } else if (job.status === "pending") {
            durationStr = t("job.queuedDuration");
        }

        const dateObj = new Date(job.created_at);
        const dateStr = dateObj.toLocaleDateString(getLocale(), { day: "2-digit", month: "2-digit", year: "numeric" });
        const timeStr = dateObj.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });
        const jobTime = t("job.timeSuffix", { time: timeStr });
        
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
                    ${(job.status === "running" || job.status === "pending") ? `<button type="button" class="history-cancel-btn btn-icon" title="${t("job.cancelExecAction")}"><span class="material-symbols-outlined">stop_circle</span></button>` : ""}
                </div>
            </div>
            ${progressHtml}
        `;

        // : cancel per row (running/waiting jobs) – without merely selecting the job.
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
// Turns a FastAPI `detail` (string, OR a 422 list [{msg,loc}], OR an object) into a
// readable text - prevents the earlier "[object Object]" on validation errors.
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
    //: without a JS-readable companion cookie (as_auth) there is guaranteed to be no session ->
    // skip the /api/profile call (always 401 for anonymous users) and set the
    // guest state directly. Saves a superfluous, failing request on load.
    const hasSession = document.cookie.split(";").some(c => c.trim().startsWith("as_auth="));
    if (hasSession) {
        try {
            const response = await fetch("/api/profile");
            if (response.ok) {
                currentUser = await response.json();
                // : take over the server language (if set) + mark the user as
                // logged in, so later switches persist server-side.
                applyServerLanguage(currentUser.language);
                updateAuthUI();
                await fetchDevices();
            } else {
                currentUser = null;
                setLoggedIn(false);
                updateAuthUI();
            }
        } catch (err) {
            console.error("Auth check failed:", err);
            currentUser = null;
            setLoggedIn(false);
            updateAuthUI();
        }
    } else {
        currentUser = null;
        setLoggedIn(false);
        updateAuthUI();
    }
    // The playbook/preset catalog depends on login/role -> reload on auth change
    // : load independently — an error in fetchPresets must not skip fetchPlaybooks (and thus the
    // own preset tiles), otherwise they only appear after a reload.
    try { await fetchPresets(); } catch (e) { console.warn("Preset-Reload nach Auth-Wechsel fehlgeschlagen:", e); }
    try { await fetchPlaybooks(); } catch (e) { console.warn("Playbook-Reload nach Auth-Wechsel fehlgeschlagen:", e); }
    //: after login, restart the poll loop (possibly paused after a previous logout)
    // again, so the user's jobs are updated live. Idempotent.
    startHistoryPolling();
}

function updateAuthUI() {
    const loggedOutView = document.getElementById("logged-out-view");
    const loggedInView = document.getElementById("logged-in-view");
    const userDisplayName = document.getElementById("user-display-name");
    const btnHistory = document.getElementById("nav-btn-history");
    const deviceSelectContainer = document.getElementById("modal-device-select-container");

    //: the header language-selection icon is intended only for logged-out visitors;
    // logged-in users change the language exclusively via the profile settings.
    const langWrap = document.querySelector(".lang-switch-wrap");
    if (langWrap) langWrap.classList.toggle("hidden", !!currentUser);

    if (currentUser) {
        loggedOutView.classList.add("hidden");
        loggedInView.classList.remove("hidden");
        userDisplayName.textContent = currentUser.username;
        // Logs button active only when jobs/logs exist (updateUI is the authority).
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
        // : the username is immutable – only system admins may change
        // their own name. For everyone else the field is read-only.
        const unameImmutable = currentUser.role !== "admin";
        unameField.readOnly = unameImmutable;
        unameField.title = unameImmutable ? t("prof.usernameImmutableHint") : "";
        unameField.style.opacity = unameImmutable ? "0.6" : "";
        // : prefill the webhook URL.
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

        // Fetch user invoices (guests have no invoice history)
        // Fetch invoices only in the cloud edition (otherwise /api/billing/* = 404).
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

        //  (#A): "My Vault" nav button for logged-in non-guests (unifies own playbooks
        // + devices + presets). Login-only — NO subscription requirement anymore; the subscription is enforced per tab/endpoint
        // (e.g. custom upload, preset creation), not by hiding the vault.
        const vaultBtn = document.getElementById("nav-btn-vault");
        if (vaultBtn) {
            vaultBtn.classList.toggle("hidden", currentUser.role === "guest");
            vaultBtn.removeAttribute("disabled");
            vaultBtn.title = "";
        }
        // : the subtext "or save as preset" under the run button was
        // removed (element deleted), so there is no visibility control here anymore.

        ///: "Teams" nav button for registered users AND admins (not guest,
        // not logged out). In the On-Premise edition, teams features are disabled.
        const teamsBtn = document.getElementById("nav-btn-teams");
        if (teamsBtn) {
            const showTeams = currentUser.role !== "guest" && currentEdition !== "onpremise";
            teamsBtn.classList.toggle("hidden", !showTeams);
        }

        // /: the former separate "Devices" nav (nav-btn-devices) has merged into the "My Vault" tab
        // (devices = vault tab; see vaultBtn above). No dedicated nav button anymore.

        // Show/hide deletion warning (cloud-only : profile-delete-section stripped in Community -> null-safe)
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
                avvDownloadBtn.innerHTML = `<span class="material-symbols-outlined">download</span> ${t("prof.avvDownloadSigned")}`;
            } else {
                avvSignBtn.classList.remove("hidden");
                avvStatusBanner.classList.add("hidden");
                avvDownloadBtn.innerHTML = `<span class="material-symbols-outlined">download</span> ${t("prof.avvDownloadTemplate")}`;
            }
        }

        // Populate Teams/API panels (display is controlled by the tab system, not here)
        if (currentUser.role !== "guest") {
            fetchGuests();
            fetchTokens();
        }

        // --- Role-dependent profile visibility (Issue D) ---
        const isGuest = currentUser.role === "guest";
        const isAdmin = currentUser.role === "admin";
        const setDisplay = (id, show, showVal) => {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? (showVal || "") : "none";
        };
        // Business tabs only for regular users (not guest, not admin)
        const showBusinessTabs = !isGuest && !isAdmin;
        setDisplay("ptab-rechnungen", showBusinessTabs);
        setDisplay("ptab-teams", showBusinessTabs);
        // : "Device groups" profile tab removed -> dedicated page /devices (nav button).
        // : API token tab also for the system admin (passwordless tokens for bots/CI in
        // every edition; the backend allows admin tokens). Guests still don't see it.
        setDisplay("ptab-api", !isGuest);
        setDisplay("ptab-dsgvo", showBusinessTabs);
        // Home: a guest cannot change username/email; no subscription tier/date
        setDisplay("profile-identity-section", !isGuest);
        setDisplay("profile-tier-row", !isGuest && !isAdmin);
        setDisplay("profile-date-row", !isGuest);
        // Security: neither a guest nor an admin can delete themselves
        setDisplay("profile-delete-section", !isGuest && !isAdmin);
        // If a hidden tab was active, go back to the home page
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
                    badge.textContent = active ? t("prof.statusActive") : t("prof.statusInactive");
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
        //: hide the Teams nav for logged-out visitors.
        const teamsBtnOut = document.getElementById("nav-btn-teams");
        if (teamsBtnOut) teamsBtnOut.classList.add("hidden");

        // Reset manual input fields disabled state just in case
        modalTargetHost.disabled = false;
        modalUsernameInput.disabled = false;
        modalPasswordInput.disabled = false;

        // Fallback to configure tab if an auth-gated page is active after logout.
        //: tab-admin added (the admin page is locked). tab-legal deliberately NOT,
        // since legal pages are public - otherwise anonymous visitors would be thrown from /impressum
        // & co. to "/".
        if (["tab-history", "tab-vault", "tab-admin", "tab-teams"].some(c => document.body.classList.contains(c))) {
            setTab("configure");
        }
    }

    //: apply edition-specific UI rules after every auth/UI refresh.
    applyEditionRules();
    writeAuthCache(); //: cache the auth status to avoid nav-button flicker on reload
}

//: lightweight auth cache to show/hide the "Own playbooks" nav button immediately
// (synchronously) on reload, instead of only after the asynchronous /api/profile check.
const AUTH_CACHE_KEY = "ansimate_auth_cache";
function writeAuthCache() {
    try {
        if (currentUser) {
            localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
                loggedIn: true,
                role: currentUser.role,
                subActive: !!currentUser.is_subscription_active,
                edition: currentEdition,  //: carry the edition along (Community always hides the tab)
            }));
        } else {
            localStorage.removeItem(AUTH_CACHE_KEY);
        }
    } catch (e) { /* localStorage unavailable -> no cache, only (rare) flicker */ }
}
function applyCachedNavVisibility() {
    //: hide the header language switcher already in the cache path when "logged in" is cached
    // (no flicker on reload; updateAuthUI makes the authoritative decision).
    try {
        const c = JSON.parse(localStorage.getItem(AUTH_CACHE_KEY) || "null");
        const lw = document.querySelector(".lang-switch-wrap");
        if (lw) lw.classList.toggle("hidden", !!(c && c.loggedIn));
    } catch (e) { /* localStorage evtl. blockiert */ }
    const btn = document.getElementById("nav-btn-vault");
    if (!btn) return;
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem(AUTH_CACHE_KEY) || "null"); } catch (e) {}
    if (!cache) return; // no cache -> keep the default (hidden), the async check decides
    //  (#A): "My Vault" is login-only.
    //: visible in the Community edition too (restricted) -> no longer exclude the edition.
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
            showToast(enabled ? t("prof.twoFaEnabled") : t("prof.twoFaDisabled"));
            await checkAuthStatus();
        } else {
            showToast(errorDetailToMessage(data.detail, t("prof.twoFaChangeError")));
            document.getElementById("profile-2fa-toggle").checked = !enabled;
        }
    } catch (err) {
        showToast(t("prof.twoFaChangeNetworkError"));
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
            showToast(t("auth.twoFaPinSent"));
        } else if (response.ok && data.status === "logged_in") {
            document.getElementById("login-dialog").classList.add("hidden");
            document.getElementById("login-form").reset();
            showToast(t("auth.loginSuccess"));
            // : login from the maintenance page -> reload, so the gate takes
            // effect again (admin -> bypass/app, non-admin -> stays on the maintenance page).
            const mov = document.getElementById("maintenance-overlay");
            if (mov && !mov.classList.contains("hidden")) { window.location.reload(); return; }
            await checkAuthStatus();
        } else if (response.status === 403 && data.detail && data.detail.includes("bestaetigen")) {
            // Email not verified: offer to resend the confirmation email
            showToast(errorDetailToMessage(data.detail, t("auth.actionFailed")));
            if ((await showConfirmDialog({ title: t("auth.confirmEmailTitle"), message: t("auth.confirmEmailResendMsg"), confirmLabel: t("auth.resend") }))) {
                try {
                    await fetch("/api/auth/resend-verification", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ identifier })
                    });
                    showToast(t("auth.resendConfirmationSent"));
                } catch (e) {
                    showToast(t("auth.resendNetworkError"));
                }
            }
        } else {
            showToast(errorDetailToMessage(data.detail, t("auth.loginFailed")));
        }
    } catch (err) {
        showToast(t("auth.loginNetworkError"));
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
            showToast(t("auth.loginSuccess"));
            await checkAuthStatus();
        } else {
            showToast(errorDetailToMessage(data.detail, t("auth.invalidOtp")));
        }
    } catch (err) {
        showToast(t("auth.twoFaVerifyNetworkError"));
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
            btn.setAttribute("aria-label", show ? t("auth.hidePassword") : t("auth.showPassword"));
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

// : ESC/backdrop close for admin form dialogs WITH a dirty warning. Input
// marks the dialog as "dirty"; each open* dialog resets dataset.dirty.
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
                ok = await showConfirmDialog({ title: t("prof.discardChangesTitle"), message: t("prof.discardChangesMsg"), confirmLabel: t("prof.discard") });
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
            showToast(data.message || t("auth.resetLinkSent"));
        } else {
            showToast(errorDetailToMessage(data.detail, t("auth.requestFailed")));
            // refresh captcha after a failed attempt
            await loadCaptchaInto("forgot-captcha-question", "forgot-captcha-id", "forgot-captcha-answer", "forgot-captcha-container");
        }
    } catch (err) {
        showToast(t("auth.resetRequestNetworkError"));
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
        showToast(t("auth.passwordMismatch"));
        return;
    }
    if (!resetToken) {
        showToast(t("auth.noResetToken"));
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
            showToast(t("auth.resetSuccess"));
            document.getElementById("login-dialog").classList.remove("hidden");
        } else {
            showToast(errorDetailToMessage(data.detail, t("auth.resetFailed")));
        }
    } catch (err) {
        showToast(t("auth.resetNetworkError"));
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
        showToast(t("auth.passwordMismatch"));
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
            showToast(t("prof.passwordChanged"));
        } else {
            showToast(errorDetailToMessage(data.detail, t("prof.passwordChangeFailed")));
        }
    } catch (err) {
        showToast(t("prof.passwordChangeNetworkError"));
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
        showToast(t("auth.passwordMismatch"));
        return;
    }

    const captchaContainer = document.getElementById("register-captcha-container");
    const captchaRequired = captchaContainer && !captchaContainer.classList.contains("hidden");
    const captchaId = captchaRequired ? document.getElementById("register-captcha-id").value : null;
    const captchaAnswer = captchaRequired ? document.getElementById("register-captcha-answer").value.trim() : null;

    // : capture the browser fingerprint (best effort – null on failure).
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
            // : one-time hint if a trial has already been
            // used on this device (no new free trial period).
            if (data.fingerprint_seen) {
                showToast(t("auth.registerTrialUsed"), 9000);
            } else {
                showToast(data.message || t("auth.registerSuccess"));
            }
            // With email verification enabled, do NOT redirect straight to login.
            if (!data.verification_required) {
                document.getElementById("login-dialog").classList.remove("hidden");
            }
        } else {
            showToast(errorDetailToMessage(data.detail, t("auth.registerFailed")));
        }
    } catch (err) {
        showToast(t("auth.registerNetworkError"));
    }
}

// Handles the email confirmation link (/verify-email?token=...)
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
            showToast(data.message || t("auth.emailVerified"));
            document.getElementById("login-dialog").classList.remove("hidden");
        } else {
            showToast(errorDetailToMessage(data.detail, t("auth.verifyFailed")));
        }
    } catch (err) {
        showToast(t("auth.verifyNetworkError"));
    }
}

//: after logout, neither the job history may keep being polled nor the jobs of the
// logged-out user be shown. Stop polling + the active log stream and put the
// workspace back into landing mode.
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
            showToast(t("auth.logoutSuccess"));
            currentUser = null;
            userDevices = [];
            resetWorkspaceAfterLogout();
            updateAuthUI();
            //: catalog/presets depend on login & role -> reload after logout,
            // otherwise the previous user's personalized tiles stay visible.
            try { await fetchPresets(); await fetchPlaybooks(); }
            catch (e) { console.warn("Katalog-Reload nach Logout fehlgeschlagen:", e); }
        }
    } catch (err) {
        showToast(t("auth.logoutError"));
    }
}

async function handleLogoutAll() {
    if (!(await showConfirmDialog({ title: t("auth.logoutAllTitle"), message: t("auth.logoutAllMsg"), confirmLabel: t("auth.logout") }))) return;
    try {
        const response = await fetch("/api/auth/logout-all", { method: "POST" });
        if (response.ok) {
            document.getElementById("profile-dialog").classList.add("hidden");
            showToast(t("auth.logoutAllSuccess"));
            currentUser = null;
            userDevices = [];
            resetWorkspaceAfterLogout();
            updateAuthUI();
            //: reload catalog/presets after logout (render the guest catalog)
            try { await fetchPresets(); await fetchPlaybooks(); }
            catch (e) { console.warn("Katalog-Reload nach Logout fehlgeschlagen:", e); }
        }
    } catch (err) {
        showToast(t("auth.logoutError"));
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
            showToast(t("prof.notifUpdated"));
        }
    } catch (err) {
        showToast(t("prof.notifChangeError"));
        e.target.checked = !enabled;
    }
}

// : save the webhook URL for status notifications.
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
            showToast(data.message || t("prof.webhookSaved"));
        } else {
            showToast(errorDetailToMessage(data.detail, t("prof.webhookSaveError")));
        }
    } catch (err) {
        showToast(t("prof.webhookSaveNetworkError"));
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
            container.innerHTML = `<p style="color: var(--text-muted); font-size:13px;">${t("prof.sessionsLoadError")}</p>`;
            return;
        }
        renderSessions(await res.json());
    } catch (e) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size:13px;">${t("prof.networkError")}</p>`;
    }
}

function renderSessions(sessions) {
    const container = document.getElementById("sessions-list-container");
    if (!container) return;
    if (!sessions || sessions.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size:13px;">${t("prof.noSessions")}</p>`;
        return;
    }
    container.innerHTML = "";
    sessions.forEach(s => {
        const div = document.createElement("div");
        div.className = "session-item" + (s.current ? " current" : "");
        const created = s.created_at ? new Date(s.created_at).toLocaleString() : "-";
        const ua = (s.user_agent || t("prof.unknownDevice")).slice(0, 70);
        const left = document.createElement("div");
        left.innerHTML = `<div>${escapeHtml(ua)}${s.current ? ` <span style="color:var(--md-sys-color-primary);">${t("prof.thisSession")}</span>` : ''}</div>` +
            `<div style="color: var(--text-muted); font-size:12px;">IP: ${escapeHtml(s.ip_address || '-')} &middot; ${escapeHtml(created)}</div>`;
        div.appendChild(left);
        if (!s.current) {
            const btn = document.createElement("button");
            btn.className = "btn btn-secondary btn-small";
            btn.textContent = t("prof.endSession");
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
            showToast(t("prof.sessionEnded"));
            fetchSessions();
        } else {
            const d = await res.json();
            showToast(d.detail || t("prof.sessionEndFailed"));
        }
    } catch (e) {
        showToast(t("prof.sessionEndNetworkError"));
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

// : render the playbook multi-selection of the scenario template. The selection stays
// preserved while filtering (only rows are shown/hidden, never re-rendered).
function renderDeviceGroupPlaybooks(selPlaybookIds) {
    const pc = document.getElementById("device-group-playbooks");
    if (!pc) return;
    const sel = new Set(selPlaybookIds || []);
    const list = (allPlaybooks || []).slice()
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", getLocale(), { sensitivity: "base" }));
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
        span.textContent = pb.category ? `${pb.name} — ${catLabel(pb.category)}` : pb.name;
        row.appendChild(span);
        pc.appendChild(row);
    });
}

// : filter for the scenario playbook list (only hides rows).
function filterDeviceGroupPlaybooks(term) {
    const q = (term || "").trim().toLowerCase();
    document.querySelectorAll("#device-group-playbooks .dg-pb-row").forEach(row => {
        row.style.display = (!q || (row.dataset.search || "").includes(q)) ? "flex" : "none";
    });
}

// : start a scenario - preselect the group's playbooks in the catalog, set the group as
// the target and open the run modal. Speeds up manual setup.
function launchGroupScenario(g) {
    const ids = (g && g.default_playbook_ids) || [];
    if (!ids.length) {
        showToast("Diese Gruppe hat keine Szenario-Playbooks hinterlegt.");
        return;
    }
    // Close the profile dialog and switch to the home page (that's where the catalog is).
    const profileDialog = document.getElementById("profile-dialog");
    if (profileDialog && typeof profileDialog.close === "function" && profileDialog.open) profileDialog.close();
    navigateTo("/");
    // Set the selection in the catalog (first deselect everything, then activate the scenario).
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
        showToast(t("misc.scenarioPlaybooksUnavailable"));
        return;
    }
    if (missing.length) {
        showToast(`${missing.length} Playbook(s) der Vorlage nicht verfügbar: ${missing.join(", ")}`);
    }
    // Preselect the group as the target and open the modal.
    showCredentialsModal();
    const deviceSelect = document.getElementById("modal-device-select");
    if (deviceSelect) {
        deviceSelect.value = `group:${g.id}`;
        deviceSelect.dispatchEvent(new Event("change"));
    }
}

// CSS.escape fallback for older environments (secure the attribute selector with path IDs).
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
        // : start the scenario directly, provided playbooks are set.
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

//: fill/clear the default-value fields of the group form
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
    cred.value = "";   // Plaintext is never returned
    base.value = (g && g.default_base_directory) || "";
    tz.value = (g && g.default_timezone) || "";
    //: represent default variables as "name=value" lines.
    const dv = document.getElementById("device-group-default-variables");
    if (dv) {
        const vars = (g && g.default_variables) || {};
        dv.value = Object.keys(vars).map(k => `${k}=${vars[k]}`).join("\n");
    }
    const hasCred = !!(g && g.has_default_credential);
    if (hint) hint.style.display = hasCred ? "block" : "none";
    // Offer the delete checkbox only when a credential is stored
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
    if (!name) { showToast(t("misc.enterGroupName")); return; }
    const device_ids = Array.from(document.querySelectorAll("#device-group-devices .dg-device:checked")).map(c => c.value);
    const guest_access = Array.from(document.querySelectorAll("#device-group-guests .dg-guest:checked")).map(c => c.value);
    // : send the preselected scenario playbooks along.
    const default_playbook_ids = Array.from(document.querySelectorAll("#device-group-playbooks .dg-playbook:checked")).map(c => c.value);
    const payload = { name, device_ids, guest_access, default_playbook_ids };
    //: send default values along (empty = not set)
    const dgUser = document.getElementById("device-group-default-user");
    if (dgUser) {
        payload.default_ssh_user = dgUser.value.trim();
        payload.default_credential_type = document.getElementById("device-group-default-credtype").value;
        payload.default_base_directory = document.getElementById("device-group-default-basedir").value.trim();
        payload.default_timezone = document.getElementById("device-group-default-tz").value.trim();
        //: parse default variables from "name=value" lines.
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
        // Credential semantics: new secret -> set; "Remove" ticked or new entry -> "" (delete/empty);
        // when editing without input -> omit the field (the backend keeps the existing value + type unchanged).
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
    // : show the specific name in bold in the confirmation prompt.
    const msgHtml = name ? `Möchten Sie die Geräte-Gruppe <b>${escapeHtml(name)}</b> wirklich löschen?` : "Geräte-Gruppe wirklich löschen?";
    if (!(await showConfirmDialog({ title: "Geräte-Gruppe löschen?", messageHtml: msgHtml, confirmLabel: "Löschen" }))) return;
    try {
        const res = await fetch(`/api/profile/device-groups/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) { showToast(t("misc.deviceGroupDeleted")); await loadDeviceGroupsTab(); }
        else showToast(errorDetailToMessage(data.detail, "Löschen fehlgeschlagen."));
    } catch (e) { showToast(t("misc.deleteNetworkError")); }
}

// =====  (#C): managed single devices (vault devices tab) =====
// A "device" = one device in a 1-member DeviceGroup (backend devices-unified). The list shows
// only managed groups; connection data lives on the device, run defaults/sharing on the group.
let editingManagedDevice = null;

async function loadManagedDevicesTab() {
    resetManagedDeviceForm();
    const listEl = document.getElementById("managed-devices-list");
    try {
        // (device flatten): device list directly from /api/profile/devices-unified (flat).
        const res = await fetch("/api/profile/devices-unified");
        const devices = res.ok ? await res.json() : [];
        renderManagedDevicesList(devices);
    } catch (e) {
        if (listEl) listEl.innerHTML = `<p style="color:var(--md-sys-color-error); font-size:13px;">${t("device.loadError")}</p>`;
    }
}

function renderManagedDevicesList(devices) {
    const c = document.getElementById("managed-devices-list");
    if (!c) return;
    if (!devices || devices.length === 0) {
        c.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">${t("device.emptyList")}</p>`;
        return;
    }
    c.innerHTML = "";
    devices.forEach(g => {
        const md = g.managed_device || {};
        const div = document.createElement("div");
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; background:rgba(255,255,255,0.02); font-size:13px;";
        // : left group = buttons (share/edit) before name + meta; on the right only
        // delete — mirrored from the preset list.
        const leftGroup = document.createElement("div");
        leftGroup.style.cssText = "display:flex; align-items:center; gap:8px; min-width:0;";
        //: no "Share" in the Community edition (no additional users/teams).
        if (currentEdition !== "community") {
            const share = vaultActionButton(t("device.share"), "share", "primary");
            share.addEventListener("click", () => openManagedDeviceShare(g));
            leftGroup.appendChild(share);
        }
        const edit = vaultActionButton(t("common.edit"), "edit", "secondary");
        edit.addEventListener("click", () => editManagedDevice(g));
        leftGroup.appendChild(edit);
        const info = document.createElement("div");
        info.style.minWidth = "0";
        const conn = (md.username ? md.username + "@" : "") + (md.host || "");
        //: share label only outside the Community edition (there are no shares there).
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
        const del = vaultActionButton(t("common.delete"), "delete", "danger");
        del.addEventListener("click", () => deleteManagedDevice(g.id, g.name));
        right.appendChild(del);
        div.appendChild(right);
        c.appendChild(div);
    });
}

// : read the file (SSH key) as text.
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
    if (keyLbl) keyLbl.textContent = t("device.noFileSelected");
}

function resetManagedDeviceForm() {
    editingManagedDevice = null;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    ["managed-device-id", "managed-device-name", "managed-device-host", "managed-device-user",
     "managed-device-credential", "managed-device-become", "managed-device-basedir"].forEach(id => set(id, ""));
    // : prefill the timezone with the browser timezone on new entry.
    let browserTz = "";
    try { browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    set("managed-device-tz", browserTz);
    _resetManagedKeyUpload();
    const title = document.getElementById("managed-device-form-title");
    if (title) title.textContent = t("device.newTitle");
    // : new entry -> device icon (no pencil).
    const icon = document.getElementById("managed-device-form-icon");
    if (icon) icon.textContent = "devices";
    // : cancel is always visible in the dialog (closes the dialog).
    const hint = document.getElementById("managed-device-cred-hint");
    if (hint) hint.style.display = "none";
    // : reset the placeholder state (new entry = empty field, no placeholder).
    const credEl = document.getElementById("managed-device-credential");
    if (credEl) credEl.dataset.placeholder = "";
    //: reset the sudo password field + placeholder/hint (new entry = empty).
    const becomeEl = document.getElementById("managed-device-become");
    if (becomeEl) becomeEl.dataset.placeholder = "";
    const becomeHint = document.getElementById("managed-device-become-hint");
    if (becomeHint) becomeHint.style.display = "none";
    // : reset the base-directory autofill lock (new entry = follow mode active).
    const baseEl = document.getElementById("managed-device-basedir");
    if (baseEl) baseEl.dataset.edited = "false";
    // : reset the dialog's dirty flag (fresh state -> no discard prompt).
    const dlg = document.getElementById("managed-device-dialog");
    if (dlg) dlg.dataset.dirty = "";
    //: reset OS-family controls (new entry = auto-detect on, dropdown hidden).
    const osCb = document.getElementById("managed-device-os-autodetect");
    if (osCb) { osCb.checked = true; osCb.onchange = _syncManagedOsFamilyUI; }
    const osSel = document.getElementById("managed-device-os-family");
    if (osSel) osSel.value = "debian";
    _syncManagedOsFamilyUI();
}

//: show the OS-family dropdown only when auto-detect is off.
function _syncManagedOsFamilyUI() {
    const cb = document.getElementById("managed-device-os-autodetect");
    const wrap = document.getElementById("managed-device-os-family-wrap");
    if (wrap) wrap.style.display = (cb && cb.checked) ? "none" : "block";
}

// : placeholder in the password field of an edited device (shows "Credentials stored").
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
    // : mark an existing base directory as "edited", so a
    // later user change does not overwrite it (an empty field stays in follow mode).
    const baseEl = document.getElementById("managed-device-basedir");
    if (baseEl) baseEl.dataset.edited = g.base_directory ? "true" : "false";
    set("managed-device-tz", g.timezone || "");
    _resetManagedKeyUpload();
    const title = document.getElementById("managed-device-form-title");
    if (title) title.textContent = t("device.editTitle");
    // : edit -> pencil icon in the header.
    const icon = document.getElementById("managed-device-form-icon");
    if (icon) icon.textContent = "edit";
    // : placeholder password instead of a delete checkbox. Unchanged -> keep,
    // overwrite -> change, clear -> delete (detected via dataset.placeholder).
    const hasCred = !!md.has_credential;
    const credEl = document.getElementById("managed-device-credential");
    if (credEl) {
        credEl.value = hasCred ? MANAGED_CRED_PLACEHOLDER : "";
        credEl.dataset.placeholder = hasCred ? "1" : "";
    }
    const hint = document.getElementById("managed-device-cred-hint");
    if (hint) hint.style.display = hasCred ? "block" : "none";
    //: sudo password likewise via placeholder (stored -> dots, unchanged = keep).
    const hasBecome = !!md.has_become_credential;
    const becomeEl = document.getElementById("managed-device-become");
    if (becomeEl) {
        becomeEl.value = hasBecome ? MANAGED_CRED_PLACEHOLDER : "";
        becomeEl.dataset.placeholder = hasBecome ? "1" : "";
    }
    const becomeHint = document.getElementById("managed-device-become-hint");
    if (becomeHint) becomeHint.style.display = hasBecome ? "block" : "none";
    //: OS family. A stored family -> auto-detect off + dropdown preselected;
    // no stored family -> auto-detect on.
    const osCb = document.getElementById("managed-device-os-autodetect");
    const osSel = document.getElementById("managed-device-os-family");
    const fam = (g.os_family || "").trim();
    if (osCb) { osCb.checked = !fam; osCb.onchange = _syncManagedOsFamilyUI; }
    if (osSel) osSel.value = fam || "debian";
    _syncManagedOsFamilyUI();
    // : open editing in the dialog.
    openManagedDeviceDialog();
}

async function saveManagedDevice() {
    const name = document.getElementById("managed-device-name").value.trim();
    const host = document.getElementById("managed-device-host").value.trim();
    if (!name) { showToast(t("device.nameRequired")); return; }
    if (!host) { showToast(t("device.hostRequired")); return; }
    //: auto-detect on -> store no family (empty = auto); off -> the chosen family.
    const osAuto = document.getElementById("managed-device-os-autodetect");
    const osSel = document.getElementById("managed-device-os-family");
    const osFamily = (osAuto && osAuto.checked) ? "" : ((osSel && osSel.value) || "");
    const payload = {
        name, host,
        default_ssh_user: document.getElementById("managed-device-user").value.trim(),
        default_base_directory: document.getElementById("managed-device-basedir").value.trim(),
        default_timezone: document.getElementById("managed-device-tz").value.trim(),
        os_family: osFamily,
    };
    // : derive the auth method from the fields — an uploaded SSH key => key,
    // otherwise password. Contract: new secret -> set; "Remove"/new entry -> "" (delete);
    // editing without input -> omit the fields (the backend keeps the existing value + type).
    //: no more free-form default variables -> default_variables is not sent.
    const keyInput = document.getElementById("managed-device-key-file");
    const keyFile = keyInput && keyInput.files && keyInput.files[0];
    const credEl = document.getElementById("managed-device-credential");
    const credVal = credEl.value;
    // : placeholder password. Untouched (dataset.placeholder==="1") -> keep the secret
    // (send no credential fields -> the backend leaves None unchanged); overwritten -> set;
    // cleared -> delete (""). An uploaded SSH key takes precedence.
    const credUntouched = credEl.dataset.placeholder === "1";
    if (keyFile) {
        let keyText;
        try { keyText = await readFileAsText(keyFile); }
        catch (e) { showToast(t("device.keyReadError")); return; }
        if (!keyText || !keyText.trim()) { showToast(t("device.keyFileEmpty")); return; }
        payload.default_credential = keyText;
        payload.default_credential_type = "key";
    } else if (credUntouched) {
        // Placeholder not touched -> leave the existing secret unchanged.
    } else if (credVal) {
        payload.default_credential = credVal;
        payload.default_credential_type = "password";
    } else {
        payload.default_credential = "";
        payload.default_credential_type = null;
    }
    //: sudo/become password with the same placeholder contract: untouched -> don't send
    // (the backend keeps the existing value), overwritten -> set, cleared -> "" (delete).
    const becomeEl = document.getElementById("managed-device-become");
    if (becomeEl) {
        const becomeVal = becomeEl.value;
        if (becomeEl.dataset.placeholder === "1") {
            // Placeholder unchanged -> keep the existing sudo password (omit the field).
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
            showToast(editingManagedDevice ? t("device.updated") : t("device.created"));
            closeManagedDeviceDialog();  // 
            await loadManagedDevicesTab();
            if (typeof fetchDevices === "function") fetchDevices();  // Keep the run dropdown in sync
        } else {
            showToast(errorDetailToMessage(data.detail, t("device.saveFailed")));
        }
    } catch (e) { showToast(t("device.saveNetworkError")); }
}

async function deleteManagedDevice(id, name) {
    // : device name in bold in the confirmation prompt.
    const msgHtml = name ? t("device.deleteConfirmHtml", {name: escapeHtml(name)}) : t("device.deleteConfirmGeneric");
    if (!(await showConfirmDialog({ title: t("device.deleteTitle"), messageHtml: msgHtml, confirmLabel: t("common.delete") }))) return;
    try {
        const res = await fetch(`/api/profile/devices-unified/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            showToast(t("device.deleted"));
            await loadManagedDevicesTab();
            if (typeof fetchDevices === "function") fetchDevices();
        } else {
            showToast(errorDetailToMessage(data.detail, t("device.deleteFailed")));
        }
    } catch (e) { showToast(t("device.deleteNetworkError")); }
}

let sharingManagedDevice = null;
async function openManagedDeviceShare(g) {
    sharingManagedDevice = g.id;
    document.getElementById("managed-device-share-name").textContent = g.name || "";
    const container = document.getElementById("managed-device-share-guests");
    container.innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("device.loadingGuests")}</p>`;
    document.getElementById("managed-device-share-dialog").classList.remove("hidden");
    try {
        const guests = await fetchGuestList();
        if (!guests || guests.length === 0) {
            container.innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("device.noGuests")}</p>`;
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
        container.innerHTML = `<p style="color:var(--md-sys-color-error); margin:0;">${t("device.guestsLoadError")}</p>`;
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
            showToast(t("device.shareSaved"));
            closeManagedDeviceShare();
            await loadManagedDevicesTab();
        } else {
            showToast(errorDetailToMessage(data.detail, t("device.saveFailed")));
        }
    } catch (e) { showToast(t("device.saveNetworkError")); }
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
        // (device flatten): target device selection from the flat device list.
        window._presetDevices = devicesRes.ok ? await devicesRes.json() : [];
        renderPresetDevices([]);
        renderPresetPlaybooks([]);
        renderPresetShares([]);
        renderPresetsList(presets);
        //: keep the catalog tiles in sync (e.g. after save/delete).
        userCustomPresets = presets;
        if (typeof renderPlaybooks === "function" && allPlaybooks && allPlaybooks.length) renderPlaybooks();
    } catch (e) {
        listEl.innerHTML = `<p style="color:var(--md-sys-color-error);">${t("preset.loadError")}</p>`;
    }
}

function renderPresetPlaybooks(selIds) {
    const pc = document.getElementById("preset-playbooks");
    if (!pc) return;
    const sel = new Set(selIds || []);
    const list = (allPlaybooks || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", getLocale(), { sensitivity: "base" }));
    if (!list.length) { pc.innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("preset.noPlaybooksAvail")}</p>`; return; }
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
        span.textContent = pb.category ? `${pb.name} — ${catLabel(pb.category)}` : pb.name;
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
    // (device flatten): multi-selection of target devices (checkboxes) instead of a single group.
    const c = document.getElementById("preset-devices");
    if (!c) return;
    const sel = new Set(selIds || []);
    const devices = window._presetDevices || [];
    if (!devices.length) {
        c.innerHTML = `<p style="color: var(--text-muted); margin:0; font-size:12px;">${t("preset.noDevices")}</p>`;
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

// Share list: one checkbox per guest + strict/flexible choice.
function renderPresetShares(shares) {
    const sc = document.getElementById("preset-shares");
    if (!sc) return;
    const guests = window._presetGuests || [];
    const byGuest = {};
    (shares || []).forEach(s => { byGuest[s.guest_id] = s.permission || "strict"; });
    if (!guests.length) { sc.innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("preset.noTeamMembers")}</p>`; return; }
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
        perm.innerHTML = `<option value="strict">${t("preset.permStrict")}</option><option value="flexible">${t("preset.permFlexible")}</option>`;
        perm.value = byGuest[g.id] || "strict";
        row.appendChild(cb); row.appendChild(name); row.appendChild(perm);
        sc.appendChild(row);
    });
}

function renderPresetsList(presets) {
    const c = document.getElementById("presets-list");
    if (!c) return;
    if (!presets || !presets.length) {
        c.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">${t("preset.noPresets")}</p>`;
        return;
    }
    c.innerHTML = "";
    presets.forEach(p => {
        const div = document.createElement("div");
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; background:rgba(255,255,255,0.02); font-size:13px;";
        // : left group = buttons (share/edit) before name + meta; on the right only delete.
        const leftGroup = document.createElement("div");
        leftGroup.style.cssText = "display:flex; align-items:center; gap:8px; min-width:0;";
        if (p.is_owner) {
            const share = vaultActionButton(t("preset.share"), "share", "primary");
            share.addEventListener("click", () => openPresetModal(p));
            const edit = vaultActionButton(t("common.edit"), "edit", "secondary");
            edit.addEventListener("click", () => openPresetModal(p));
            leftGroup.appendChild(share); leftGroup.appendChild(edit);
        }
        const info = document.createElement("div");
        info.style.minWidth = "0";
        const pbCount = (p.playbook_ids || []).length;
        const shareCount = (p.shares || []).length;
        const meta = [`${pbCount} Playbook${pbCount === 1 ? "" : "s"}`];
        if (p.is_owner && shareCount) meta.push(shareCount === 1 ? t("preset.shareOne", { count: shareCount }) : t("preset.shareMany", { count: shareCount }));
        if (!p.is_owner) meta.push(p.permission === "flexible" ? t("preset.sharedFlexible") : t("preset.sharedStrict"));
        info.innerHTML = `<div style="font-weight:bold; color:var(--md-sys-color-primary);">${escapeHtml(p.name)}</div>` +
            `<div style="color:var(--text-secondary); font-size:12px;">${escapeHtml(meta.join(" · "))}</div>`;
        leftGroup.appendChild(info);
        div.appendChild(leftGroup);
        const right = document.createElement("div");
        right.style.whiteSpace = "nowrap";
        if (p.is_owner) {
            const del = vaultActionButton(t("common.delete"), "delete", "danger");
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
    document.getElementById("preset-form-title").textContent = t("preset.editTitle");
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
    const title = document.getElementById("preset-form-title"); if (title) title.textContent = t("preset.newTitle");
    const pf = document.getElementById("preset-playbook-filter"); if (pf) pf.value = "";
    renderPresetPlaybooks([]);
    renderPresetDevices([]);
    renderPresetShares([]);
}

//  (#D): the preset editor runs as a modal. Open in create (p=null) or edit mode;
// fields/IDs are unchanged, so editPreset/savePreset/renderPreset* work as before.
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
    if (!name) { showToast(t("preset.nameRequired")); return; }
    const playbook_ids = Array.from(document.querySelectorAll("#preset-playbooks .preset-playbook:checked")).map(c => c.value);
    if (!playbook_ids.length) { showToast(t("preset.selectPlaybook")); return; }
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
        if (res.ok) { showToast(editingPreset ? t("preset.updated") : t("preset.created")); closePresetModal(); await loadPresets(); }
        else showToast(errorDetailToMessage(data.detail, t("preset.saveFailed")));
    } catch (e) { showToast(t("preset.saveError")); }
}

async function deletePresetById(id, name) {
    // : preset name in bold in the confirmation prompt.
    const msgHtml = name ? t("preset.deleteConfirmNamed", { name: escapeHtml(name) }) : t("preset.deleteConfirmGeneric");
    if (!(await showConfirmDialog({ title: t("preset.deleteTitle"), messageHtml: msgHtml, confirmLabel: t("common.delete") }))) return;
    try {
        const res = await fetch(`/api/profile/presets/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) { showToast(t("preset.deleted")); await loadPresets(); }
        else showToast(errorDetailToMessage(data.detail, t("preset.deleteFailed")));
    } catch (e) { showToast(t("preset.deleteError")); }
}

// Run a preset: preselect the playbooks in the catalog, set the device group as target, open the run
// modal. custom_preset_id is sent along -> the server resolves playbooks/variables/group
// and enforces permission (strict/flexible) + premium gate.
function launchPreset(p) {
    const ids = p.playbook_ids || [];
    if (!ids.length) { showToast(t("preset.noPlaybooksInPreset")); return; }
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
    if (!matched) { showToast(t("preset.playbooksNotInCatalog")); return; }
    if (missing.length) showToast(t("preset.playbooksUnavailable", { count: missing.length, list: missing.join(", ") }));
    // : an own preset behaves like a system preset — only preselect playbooks, NO
    // dialog. The saved settings are applied when the run dialog is opened
    // (showCredentialsModal includes userCustomPresets in activeVariables).
    if (p.is_owner) {
        window._activePresetId = null;
        return;
    }
    // Shared (foreign) preset: open the dialog + server binding (strict/flexible enforcement).
    window._activePresetId = p.id;
    if (p.permission === "strict") showToast(t("preset.strictSharedInfo"));
    showCredentialsModal();
    // (device flatten): with exactly ONE bound device, preselect it in the dropdown.
    // With several (or none), the server resolves the target devices from preset.device_ids
    // (custom_preset_id is sent along) — the single dropdown cannot represent multi-host.
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
            showToast(t("misc.profileUpdated"));
            await checkAuthStatus();
        } else {
            showToast(errorDetailToMessage(data.detail, t("misc.profileUpdateFailed")));
        }
    } catch (err) {
        showToast(t("misc.profileUpdateNetErr"));
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
            showToast(t("misc.exportDownloaded"));
        }
    } catch (err) {
        showToast(t("misc.exportError"));
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
            showToast(t("misc.deleteScheduled"));
            currentUser = null;
            userDevices = [];
            updateAuthUI();
        } else {
            showToast(errorDetailToMessage(data.detail, "Passwort ungültig."));
        }
    } catch (err) {
        showToast(t("misc.deleteInitError"));
    }
}

async function handleCancelDeletion() {
    try {
        const response = await fetch("/api/profile/delete-cancel", { method: "POST" });
        const data = await response.json();
        if (response.ok) {
            showToast(t("misc.deleteRequestCancelled"));
            await checkAuthStatus();
        } else {
            showToast(errorDetailToMessage(data.detail, "Stornierung fehlgeschlagen."));
        }
    } catch (err) {
        showToast(t("misc.deleteCancelError"));
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
    // (device flatten): one host per device -> the dropdown lists devices directly (device_id).
    // Multi-host runs via scenarios (multi-selection), not via this single dropdown.
    select.innerHTML = '<option value="">-- Manuelle Eingabe --</option>';
    (userDevices || []).forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.id;
        opt.textContent = `${d.name} (${d.host})`;
        select.appendChild(opt);
    });
}

// Stripe Subscriptions & Invoices Handlers






// Admin Control Panel Handlers
function openAdminDashboard() {
    // The admin panel is now an inline page (routing in routePage); only set the tab.
    switchAdminTab("dashboard");
}

function formatBytes(bytes) {
    if (!bytes) return "0 KB";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}





// : chart instances + active time-range filter for the dashboard.
const _adminCharts = {};
let _adminChartRange = "7d";
//  (feedback): dashboard data is loaded ONCE and cached. The snapshots
// are created server-side only hourly (capture_stats_snapshot) — a re-fetch on
// every tab switch or routePage re-run would be pure waste and contributed to the
// rate-limit/IP blocks. Refresh only explicitly via the "Refresh" button now.
let _adminStatsCache = null;
const _adminTimeseriesCache = {};  // cached per time range (24h/7d/30d)

function _destroyChart(key) {
    if (_adminCharts[key]) { _adminCharts[key].destroy(); delete _adminCharts[key]; }
}

//  (feedback): read chart text/grid from the ACTIVE theme variables, so the
// charts are readable in BOTH light and dark themes. Previously legend/axes were fixed at #ccc/
// (meant for dark) — nearly invisible in the light theme. Read on every (re-)render.
function _chartThemeColors() {
    const cs = getComputedStyle(document.body);
    const v = (name, fb) => (cs.getPropertyValue(name).trim() || fb);
    return {
        text: v("--md-sys-color-on-surface-variant", "#999"),
        grid: v("--md-sys-color-outline-variant", "rgba(128,128,128,0.2)"),
    };
}

// Render pie charts (current state) from the live stats.
function renderDashboardPies(s) {
    const tc = _chartThemeColors();
    const usersPie = document.getElementById("chart-users-pie");
    if (usersPie) {
        _destroyChart("usersPie");
        _adminCharts.usersPie = new Chart(usersPie, {
            type: "doughnut",
            data: {
                labels: [t("adminDash.pieActivePaid"), t("adminDash.pieActiveTrial"), t("adminDash.pieInactive")],
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
                labels: [t("adminDash.ipAuto"), t("adminDash.ipManual")],
                datasets: [{ data: [ip.auto || 0, ip.manual || 0], backgroundColor: ["#3498db", "#9b59b6"], borderWidth: 0 }],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: tc.text, boxWidth: 12, font: { size: 11 } } } } },
        });
    }
}

// Trend charts (lines) from the snapshots in the selected time range.
//  (feedback): cached per time range — load once when a range is first shown,
// then render from the cache. `force` (Refresh button) bypasses the cache.
async function loadDashboardTimeseries(force = false) {
    if (!force && _adminTimeseriesCache[_adminChartRange]) {
        renderDashboardTimeseries(_adminTimeseriesCache[_adminChartRange]);
        return;
    }
    let rows = [];
    try {
        const r = await fetch(`/api/admin/stats/timeseries?range=${encodeURIComponent(_adminChartRange)}`);
        if (r.ok) rows = await r.json();
    } catch (e) { /* leave empty */ }
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
        ds(t("adminDash.total"), "total", "#1abc9c"), ds("Paid", "paid", "#2ecc71"), ds("Trial", "trial", "#f1c40f"), ds(t("adminDash.pieInactive"), "inactive", "#e74c3c"),
    ]);
    mkLine("chart-ip-line", "ipLine", [ ds(t("adminDash.ipBlocks"), "ip_total", "#3498db") ]);
    mkLine("chart-storage-line", "storageLine", [
        { label: t("adminDash.storageMb"), data: rows.map(x => Math.round((x.storage || 0) / 1024 / 1024 * 10) / 10), borderColor: "#9b59b6", backgroundColor: "#9b59b633", tension: 0.3, pointRadius: rows.length > 30 ? 0 : 2, borderWidth: 2 },
    ]);
}

async function fetchAdminStats(force = false) {
    const cfg = document.getElementById("admin-config-status");
    //  (feedback): load once, then render from the cache — no re-fetch
    // on every dashboard visit or routePage re-run. `force` = Refresh button.
    if (!force && _adminStatsCache) {
        renderAdminStats(_adminStatsCache, false);
        return;
    }
    try {
        const res = await fetch("/api/admin/stats");
        if (!res.ok) { if (cfg) cfg.innerHTML = `<p style="color:var(--md-sys-color-error);">${t("adminDash.loadError")}</p>`; return; }
        const s = await res.json();
        _adminStatsCache = s;
        renderAdminStats(s, force);
    } catch (e) {
        if (cfg) cfg.innerHTML = `<p style="color:var(--md-sys-color-error);">${t("adminDash.networkError")}</p>`;
    }
}

function renderAdminStats(s, force = false) {
    const cfg = document.getElementById("admin-config-status");
    // : static text tiles replaced by charts (pies + trend).
    renderDashboardPies(s);
    loadDashboardTimeseries(force);

        const chip = (label, ok, okText, badText) => {
            const color = ok ? "#2ecc71" : "#e74c3c";
            const txt = ok ? (okText || t("adminDash.active")) : (badText || t("adminDash.inactive"));
            return `<div style="display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:8px 12px;">
                <span style="width:9px; height:9px; border-radius:50%; background:${color}; display:inline-block;"></span>
                <span style="font-size:13px;">${label}: <strong style="color:${color};">${txt}</strong></span></div>`;
        };
        const cf = s.config || {};
        // : colored chip with an arbitrary traffic-light color (green/yellow/red).
        const chipColored = (label, color, txt) => `<div style="display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:8px 12px;">
                <span style="width:9px; height:9px; border-radius:50%; background:${color}; display:inline-block;"></span>
                <span style="font-size:13px;">${label}: <strong style="color:${color};">${escapeHtml(txt)}</strong></span></div>`;
        // : the 3 Stripe tiles (mode/connection/signature check) consolidated into ONE traffic
        // light. Green = live + webhook + connection ok; yellow = ok but test/webhook missing;
        // red = mock/no keys or connection error.
        const sconn = cf.stripe_connection || {};
        let stColor, stTxt;
        if (cf.stripe_mock) {
            stColor = "#e74c3c"; stTxt = t("adminDash.stripeInactiveMock");
        } else if (sconn.status === "error") {
            stColor = "#e74c3c"; stTxt = t("adminDash.error") + (sconn.detail ? `: ${String(sconn.detail).slice(0, 80)}` : "");
        } else if (sconn.status === "ok") {
            if (cf.stripe_livemode && cf.stripe_signature_check) {
                stColor = "#2ecc71"; stTxt = t("adminDash.stripeActiveLive") + (sconn.account ? ` (${sconn.account})` : "");
            } else {
                stColor = "#f1c40f"; stTxt = cf.stripe_livemode ? t("adminDash.stripeLiveNoWebhook") : t("adminDash.stripeActiveTest");
            }
        } else {
            stColor = "#e74c3c"; stTxt = t("adminDash.stripeInactiveUnknown");
        }
        //  (Community): edition-dependent status tiles.
        //  - Stripe: cloud only (billing exists only there).
        //  - Captcha: cloud only.
        //  - Email verification: Cloud + On-Premise (hidden in Community).
        let _chips = chip("SMTP", cf.smtp, t("adminDash.configured"), t("adminDash.notConfigured"));
        if (currentEdition === "cloud") _chips += chipColored("Stripe", stColor, stTxt);
        if (currentEdition === "cloud") _chips += chip("Captcha", cf.captcha, t("adminDash.on"), t("adminDash.off"));
        if (currentEdition !== "community") _chips += chip(t("adminDash.emailVerification"), cf.email_verification, t("adminDash.on"), t("adminDash.off"));
        _chips += chip("API-Docs", cf.api_docs, t("adminDash.on"), t("adminDash.off"));
        cfg.innerHTML = _chips;
            // : maintenance-mode tile removed (covered by banner + tab indicators).
        //: prominent banner at the top, visible when the Stripe mock/demo mode is active.
        // Stripe/billing mock banner only in the cloud edition; Community/On-Premise have no
        // billing (additionally the .cloud-only class hides it edition-wide).
        const mockBanner = document.getElementById("admin-mock-banner");
        if (mockBanner) mockBanner.classList.toggle("hidden", !(cf.stripe_mock && currentEdition === "cloud"));
}

function switchAdminTab(tabName) {
    //  (Community): no users tab -> redirect the selection to the home page.
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

    // : configure the admin FAB per tab (action via onAdminFab).
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
        // : the "Logs" tab loads both sections (unusual activity + audit log).
        fetchSecurityAlerts();
        fetchAuditLog();
        fetchAdminIPBlocks();  // : the IP block history now lives in this tab.
        prefillGobdDates();  // : the GoBD export now lives in this tab.
    } else if (tabName === "tariffs") {
        fetchTariffs();
    } else if (tabName === "coupons") {
        fetchCoupons();
    } else if (tabName === "billing") {
        fetchBillingInvoices();  // : Stripe-Buchungen (Cloud)
    }
}

// : active admin tab + FAB control (label/icon/visibility per tab).
let currentAdminTab = "dashboard";

// Per tab: icon, label and action of the admin FAB. Tabs without an entry -> FAB hidden (.fab-off).
// labelKey: i18n key for the (already translated) community-visible FABs; label = German fallback.
// The cloud-only tabs (tariffs/coupons) stay without a key for now (to follow via an OnPrem/Cloud issue).
const ADMIN_FAB_CONFIG = {
    users: { icon: "person_add", label: "Benutzer erstellen" },
    security: { icon: "download", label: "Protokolle exportieren", labelKey: "adm.export.title" },
    tariffs: { icon: "add", label: "Tarif erstellen" },
    coupons: { icon: "add", label: "Gutschein erstellen" },
    ip: { icon: "block", label: "IP-Sperre hinzufügen", labelKey: "adm.fabIpBlock" },  // 
    config: { icon: "save", label: "Einstellungen speichern", labelKey: "adm.fabSaveConfig" },  // : saves directly
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
    if (label) label.textContent = cfg.labelKey ? t(cfg.labelKey) : cfg.label;
}

function onAdminFab() {
    if (currentAdminTab === "users") openAdminUserCreateDialog();
    else if (currentAdminTab === "security") openAdminExportDialog();
    else if (currentAdminTab === "tariffs") { if (typeof openTariffCreateDialog === "function") openTariffCreateDialog(); }
    else if (currentAdminTab === "coupons") { if (typeof openCouponCreateDialog === "function") openCouponCreateDialog(); }
    else if (currentAdminTab === "ip") openIpBlockDialog();  // 
    else if (currentAdminTab === "config") handleAdminConfigSubmit({ preventDefault() {} });  // : save directly
}

// : IP block dialog.
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

//  (#A): tab switching within "My Vault". Clone of switchAdminTab (same tab-btn
// inline-style convention), BUT with history.replaceState instead of a recursive routePage call —
// otherwise a bounce risk with the 5s history poll (cf.). Per-tab loaders load the content.
// ===========================================================================
// : scenarios — a preset (recipe) + a fixed target device, 1-click deployment.
// Executed via the existing /api/run path (custom_preset_id + device_group_id).
// ===========================================================================
let editingScenario = null;
let userScenarioPresets = [];
// (device flatten): target device selection from the flat device list (instead of groups).
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
        //: keep the home-page "Scenarios" section in sync (after create/edit/delete).
        userScenarios = scenarios;
        if (typeof renderPlaybooks === "function" && allPlaybooks && allPlaybooks.length) renderPlaybooks();
        //: only the preset is required; target devices are optional (deviceless scenario).
        const missing = !userScenarioPresets.length;
        const hint = document.getElementById("scenario-empty-hint");
        //: in the Community edition the hint points to the hidden presets tab and
        // is misleading — there scenarios are created entirely via the wizard (device optional). Off.
        if (hint) hint.classList.toggle("hidden", !missing || currentEdition === "community");
        const saveBtn = document.getElementById("scenario-save-btn");
        if (saveBtn) saveBtn.disabled = missing;
    } catch (e) {
        if (listEl) listEl.innerHTML = `<p style="color:var(--md-sys-color-error);">${t("scenario.loadNetErr")}</p>`;
    }
}

function populateScenarioSelects() {
    //: only the preset select remains (device selection runs via wizard step 3).
    const pSel = document.getElementById("scenario-preset-select");
    if (pSel) {
        const cur = pSel.value;
        pSel.innerHTML = userScenarioPresets.length
            ? userScenarioPresets.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")
            : `<option value="">${t("scenario.noPreset")}</option>`;
        if (cur) pSel.value = cur;
    }
}

// : share controls in the scenario form (mirrored from renderPresetShares).
// : share list of the scenario share dialog (#scenario-share-list).
function renderScenarioShareList(shares) {
    const sc = document.getElementById("scenario-share-list");
    if (!sc) return;
    const guests = window._scenarioGuests || [];
    const byGuest = {};
    (shares || []).forEach(s => { byGuest[s.guest_id] = s.permission || "strict"; });
    if (!guests.length) { sc.innerHTML = `<p style="color: var(--text-muted); font-size: 12px;">${t("vault.noTeamMembers")}</p>`; return; }
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
        perm.innerHTML = `<option value="strict">${t("vault.permStrict")}</option><option value="flexible">${t("vault.permFlexible")}</option>`;
        perm.value = byGuest[g.id] || "strict";
        row.appendChild(cb); row.appendChild(name); row.appendChild(perm);
        sc.appendChild(row);
    });
}

// : action button with icon for the My Vault lists (share/edit/delete).
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

// : unified target-device label for the list AND the home-page tiles.
// Device assigned -> device name; deviceless -> "set at run time".
function scenarioTargetLabel(s) {
    return s.device_optional ? t("scenario.deviceOnRun") : (s.device_name || "?");
}

function renderScenariosList(scenarios) {
    const c = document.getElementById("scenarios-list");
    if (!c) return;
    if (!scenarios || !scenarios.length) {
        c.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">${t("scenario.emptyList")}</p>`;
        return;
    }
    c.innerHTML = "";
    scenarios.forEach(s => {
        const div = document.createElement("div");
        // : no margin-bottom -> spacing only via the container gap (8px), exactly like
        // the playbooks/devices list (otherwise double spacing: gap + margin).
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; background:rgba(255,255,255,0.02); font-size:13px;";
        // /: share (own dialog) + edit on the left, delete on the right,
        // with icons. Running goes via the home page.
        const leftGroup = document.createElement("div");
        leftGroup.style.cssText = "display:flex; align-items:center; gap:8px; min-width:0;";
        //: no "Share" in the Community edition (no additional users/teams).
        if (currentEdition !== "community") {
            const share = vaultActionButton(t("scenario.share"), "share", "primary");
            share.addEventListener("click", () => openScenarioShareDialog(s));
            leftGroup.appendChild(share);
        }
        const edit = vaultActionButton(t("common.edit"), "edit", "secondary");
        edit.addEventListener("click", () => editScenario(s));
        leftGroup.appendChild(edit);
        const info = document.createElement("div");
        info.style.minWidth = "0";
        // : deviceless -> "Device at run time" instead of "?".
        // : subtitle just "→ target device" (no longer repeat the preset name).
        const meta = s.valid
            ? `→ ${escapeHtml(scenarioTargetLabel(s))}`
            : t("scenario.metaBroken");
        // : compact metadata (number of playbooks/devices/shared users) as in other lists.
        const counts = [];
        if (typeof s.playbook_count === "number") counts.push(`${s.playbook_count} Playbook${s.playbook_count === 1 ? "" : "s"}`);
        if (!s.device_optional && typeof s.device_count === "number") counts.push(s.device_count === 1 ? t("scenario.deviceCountOne", { count: s.device_count }) : t("scenario.deviceCountMany", { count: s.device_count }));
        if (currentEdition !== "community" && typeof s.shared_count === "number") counts.push(s.shared_count === 1 ? t("scenario.sharedCountOne", { count: s.shared_count }) : t("scenario.sharedCountMany", { count: s.shared_count }));
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
        const del = vaultActionButton(t("common.delete"), "delete", "danger");
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
    if (title) title.textContent = t("scenario.newScenario");
    const saveBtn = document.getElementById("scenario-save-btn");
    if (saveBtn) saveBtn.textContent = t("common.save");
    // : cancel is always visible in the dialog (closes the dialog).
}

// : editing opens the same wizard as creating, with prefilled values
// (name, playbooks, variables, device, shares). The old #scenario-dialog is no longer used.
function editScenario(s) {
    if (s.valid === false && !s.preset_name) {
        // Preset deleted -> playbooks/variables cannot be prefilled; still editable
        // (the wizard creates a new preset on save).
        showToast(t("scenario.presetMissingReselect"));
    }
    openScenarioWizard(s);
}

async function saveScenario() {
    const name = (document.getElementById("scenario-name").value || "").trim();
    const presetId = document.getElementById("scenario-preset-select").value;
    const deviceGroupId = document.getElementById("scenario-device-select").value;
    if (!name) { showToast(t("scenario.nameRequired")); return; }
    // : target device optional (empty = deviceless scenario); only the preset is required.
    if (!presetId) { showToast(t("scenario.presetRequired")); return; }
    // : shares go via the dedicated share dialog -> do NOT send them here
    // (the backend leaves shares unchanged when None). On creation the scenario starts without shares.
    const payload = { name, preset_id: presetId, device_group_id: deviceGroupId || null };
    const url = editingScenario ? `/api/profile/scenarios/${editingScenario}` : "/api/profile/scenarios";
    try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(errorDetailToMessage(d.detail, t("vault.saveFailed"))); }
        showToast(editingScenario ? t("scenario.updated") : t("scenario.created"));
        closeScenarioDialog();  // 
        await loadScenarios();
    } catch (e) {
        showToast(e.message);
    }
}

async function deleteScenarioById(id, name) {
    // : scenario name in bold in the confirmation prompt.
    const msgHtml = name ? t("scenario.deleteConfirmNamed", { name: escapeHtml(name) }) : t("scenario.deleteConfirm");
    if (!(await showConfirmDialog({ title: t("scenario.deleteTitle"), messageHtml: msgHtml, confirmLabel: t("common.delete") }))) return;
    try {
        const res = await fetch(`/api/profile/scenarios/${id}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(errorDetailToMessage(d.detail, t("vault.deleteFailed"))); }
        showToast(t("scenario.deleted"));
        if (editingScenario === id) resetScenarioForm();
        await loadScenarios();
    } catch (e) {
        showToast(e.message);
    }
}

// /: 1-click execution via scenario_id — the server resolves the preset (playbooks +
// variables) and the fixed target device and enforces share/permission (also for guests).
// : confirmation dialog before the start;: deviceless scenario -> one-time device dialog.
async function runScenario(s) {
    if (s.valid === false) { showToast(t("scenario.invalidEdit")); return; }
    // : highlight the scenario name and target device in the accent color (values sanitized via escapeHtml).
    const accent = (txt) => `<b style="color: var(--md-sys-color-primary);">${escapeHtml(txt)}</b>`;
    const messageHtml = s.device_optional
        ? t("scenario.runConfirmDeviceless", { name: accent(s.name) })
        : t("scenario.runConfirmDevice", { name: accent(s.name), device: accent(s.device_name || t("scenario.storedDevice")) });
    const ok = await showConfirmDialog({ title: t("scenario.runTitle"), messageHtml, confirmLabel: t("landing.run") });
    if (!ok) return;
    if (s.device_optional) { openScenarioRunDeviceDialog(s); return; }
    await executeScenarioRun(s, {});
}

// : deviceless scenario -> ask for host/SSH once (not persisted) and send it along.
let scenarioRunPending = null;
function openScenarioRunDeviceDialog(s) {
    scenarioRunPending = s;
    const t = document.getElementById("scenario-run-device-title");
    if (t) t.textContent = window.t("scenario.runDeviceTitle", { name: s.name });
    ["scenario-run-host", "scenario-run-user", "scenario-run-password", "scenario-run-basedir"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    // Reset the autofill lock: base_dir is derived from the username again.
    const _srBaseDir = document.getElementById("scenario-run-basedir");
    if (_srBaseDir) _srBaseDir.dataset.edited = "false";
    _resetScenarioRunKeyUpload();  // 
    const dlg = document.getElementById("scenario-run-device-dialog"); if (dlg) dlg.classList.remove("hidden");
}
// : reset the one-time device dialog's key upload (clear the selection + hide the remove button).
function _resetScenarioRunKeyUpload() {
    const keyFile = document.getElementById("scenario-run-key-file");
    if (keyFile) keyFile.value = "";
    const lbl = document.getElementById("scenario-run-key-filename-lbl");
    if (lbl) lbl.textContent = t("core.noFileSelected");
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
    //: optional sudo/become password for this run.
    const becomeEl = document.getElementById("scenario-run-become");
    const becomePassword = becomeEl ? (becomeEl.value || "") : "";
    if (!host) { showToast(t("scenario.hostRequired")); return; }
    if (!user) { showToast(t("scenario.userRequired")); return; }
    // : optional SSH key (takes precedence over password); only for this run, not saved.
    let ssh_key = "";
    const keyInput = document.getElementById("scenario-run-key-file");
    const keyFile = keyInput && keyInput.files && keyInput.files[0];
    if (keyFile) {
        try { ssh_key = await readFileAsText(keyFile); }
        catch (e) { showToast(t("scenario.keyReadFailed")); return; }
        if (!ssh_key || !ssh_key.trim()) { showToast(t("scenario.keyFileEmpty")); return; }
    }
    if (!password && !ssh_key) { showToast(t("scenario.passwordOrKeyRequired")); return; }
    // The base directory is optional; if empty we omit it, so the server can fall back to
    // the SSH user's home directory.
    const baseDir = (document.getElementById("scenario-run-basedir").value || "").trim();
    const s = scenarioRunPending;
    closeScenarioRunDeviceDialog();
    await executeScenarioRun(s, { target_host: host, username: user, password, ssh_key, become_password: becomePassword, base_dir: baseDir });
}

async function executeScenarioRun(s, extra) {
    try {
        // base_dir belongs in the run variables (not as a top-level field); the server merges it
        // over the preset variables under flexible permission. Omit an empty base_dir, so
        // the server-side home-directory fallback applies.
        const { base_dir, ...rest } = extra || {};
        const variables = base_dir ? { base_dir } : undefined;
        const res = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // playbooks is a required field in RunRequest (Pydantic validation before the handler);
            // the server replaces it server-side with the playbooks of the scenario preset.
            body: JSON.stringify({ playbooks: [], scenario_id: s.id, session_id: sessionId, ...rest, ...(variables ? { variables } : {}) })
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(errorDetailToMessage(d.detail, t("vault.startFailed"))); }
        const result = await res.json();
        showToast(t("scenario.started", { name: s.name }));
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

// : dedicated share dialog for a scenario (decoupled from editing).
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
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(errorDetailToMessage(d.detail, t("vault.shareFailed"))); }
        showToast(t("vault.shareSaved"));
        closeScenarioShareDialog();
        await loadScenarios();
    } catch (e) {
        showToast(e.message);
    }
}

function switchVaultTab(tabName) {
    // : presets tab disabled/hidden for now -> no longer reachable
    // (not even via /vault/presets); calls land on the default tab "Scenarios".
    //: in the Community edition the Playbooks tab is additionally dropped (custom upload
    // backend-locked) -> only scenarios + devices are reachable.
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

    // Mirror the URL to /vault/<tab> WITHOUT calling routePage again (no recursion/bounce bug).
    const wanted = `/vault/${tabName}`;
    if (window.location.pathname !== wanted) history.replaceState({}, "", wanted);

    // Load per-tab content.
    if (tabName === "playbooks") {
        fetchCustomPlaybooks();
    } else if (tabName === "devices") {
        loadManagedDevicesTab();
    } else if (tabName === "presets") {
        //  (#D): load the own-presets list (now in the vault); the editor runs as modal #preset-edit-dialog.
        loadPresets();
    } else if (tabName === "scenarios") {
        // : load scenarios + populate the form's preset/device selection.
        loadScenarios();
    }
    // : FAB label per tab + remember the active tab (for the FAB action).
    currentVaultTab = tabName;
    const fabLabel = document.getElementById("vault-fab-label");
    if (fabLabel) {
        const labels = { playbooks: t("vault.fabUploadPlaybook"), devices: t("vault.fabAddDevice"), presets: t("vault.fabCreatePreset"), scenarios: t("scenario.create") };
        fabLabel.textContent = labels[tabName] || t("vault.fabAdd");
    }
}

// : active My Vault tab (controls the FAB action).
let currentVaultTab = "playbooks";

function onVaultFab() {
    if (currentVaultTab === "playbooks") openCustomPbCreateDialog();
    else if (currentVaultTab === "devices") openManagedDeviceCreate();
    else if (currentVaultTab === "presets") openPresetWizard();  // : create via the wizard
    else if (currentVaultTab === "scenarios") openScenarioWizard();  // : create via the scenario wizard
}

// --- Playbook-Hochladen-Dialog ---
function openCustomPbCreateDialog() {
    const form = document.getElementById("custom-playbook-upload-form");
    if (form) form.reset();
    const fl = document.getElementById("custom-playbook-filename-lbl"); if (fl) fl.textContent = t("core.noFileSelected");
    const il = document.getElementById("custom-pb-icon-filename-lbl"); if (il) il.textContent = t("core.noFileSelected");
    ["custom-playbook-reset", "custom-pb-icon-reset"].forEach(id => { const b = document.getElementById(id); if (b) b.classList.add("hidden"); });
    const d = document.getElementById("custom-pb-create-dialog"); if (d) d.classList.remove("hidden");
}
function closeCustomPbCreateDialog() {
    const d = document.getElementById("custom-pb-create-dialog"); if (d) d.classList.add("hidden");
}

// --- Device dialog ---
function openManagedDeviceDialog() { const d = document.getElementById("managed-device-dialog"); if (d) d.classList.remove("hidden"); }
function closeManagedDeviceDialog() { const d = document.getElementById("managed-device-dialog"); if (d) d.classList.add("hidden"); resetManagedDeviceForm(); }
function openManagedDeviceCreate() { resetManagedDeviceForm(); openManagedDeviceDialog(); }

// --- Scenario dialog ---
function openScenarioDialog() { const d = document.getElementById("scenario-dialog"); if (d) d.classList.remove("hidden"); }
function closeScenarioDialog() { const d = document.getElementById("scenario-dialog"); if (d) d.classList.add("hidden"); resetScenarioForm(); }
function openScenarioCreate() { resetScenarioForm(); populateScenarioSelects(); openScenarioDialog(); }

// ===========================================================================
// : preset creation wizard — step 1 playbooks, 2 settings, 3 sharing.
// Create-only; editing/sharing existing presets still goes via #preset-edit-dialog.
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
    const titles = { 1: window.t("vault.presetWizStep1"), 2: window.t("vault.presetWizStep2"), 3: window.t("vault.presetWizStep3") };
    const t = document.getElementById("preset-wizard-title"); if (t) t.textContent = titles[step];
    const back = document.getElementById("preset-wizard-back"); if (back) back.style.display = step > 1 ? "" : "none";
    const next = document.getElementById("preset-wizard-next"); if (next) next.style.display = step < 3 ? "" : "none";
    const finish = document.getElementById("preset-wizard-finish"); if (finish) finish.style.display = step === 3 ? "" : "none";
}

// : context objects, so the preset and scenario wizards share the same renderers.
// Default = preset wizard -> all existing call sites stay unchanged.
function presetWizardCtx() {
    return { pb: "preset-wizard-playbooks", cfg: "preset-wizard-config", shares: "preset-wizard-shares",
             prefix: "wizard-", pbClass: "wizard-pb", selected: presetWizardSelected,
             guests: window._presetGuests || [] };
}
function scenarioWizardCtx() {
    // : scenario shares use the same guest list as loadScenarios (window._scenarioGuests);
    // the presets tab (which filled window._presetGuests) has been hidden since.
    return { pb: "scenario-wizard-playbooks", cfg: "scenario-wizard-config", shares: "scenario-wizard-shares",
             prefix: "scwiz-", pbClass: "scwiz-pb", selected: scenarioWizardSelected,
             guests: window._scenarioGuests || [] };
}

function renderWizardPlaybooks(filter, ctx = presetWizardCtx()) {
    const c = document.getElementById(ctx.pb);
    if (!c) return;
    const ftxt = (filter || "").toLowerCase();
    const list = (allPlaybooks || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", getLocale(), { sensitivity: "base" }));
    if (!list.length) { c.innerHTML = `<p style="color:var(--text-muted); font-size:13px;">${t("vault.noPlaybooksAvailable")}</p>`; return; }
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
        info.innerHTML = `<div style="font-weight:bold;">${escapeHtml(pb.name || pb.file)}</div>` + (pb.category ? `<div style="color:var(--text-secondary); font-size:12px;">${escapeHtml(catLabel(pb.category))}</div>` : "");
        row.appendChild(cb); row.appendChild(icon); row.appendChild(info);
        c.appendChild(row);
    });
}

// Step 2: collapsible config sections like in the run dialog (mirrored accordion logic).
function renderWizardConfig(ctx = presetWizardCtx()) {
    const container = document.getElementById(ctx.cfg);
    if (!container) return;
    container.innerHTML = "";
    let tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    const general = document.createElement("div");
    general.style.cssText = "margin-bottom:14px;";
    general.innerHTML =
        `<div class="text-field" style="margin-bottom:10px; width:100%;"><input type="text" id="${ctx.prefix}base-dir" placeholder=" " style="width:100%;"><label for="${ctx.prefix}base-dir">${t("vault.baseDir")}</label></div>` +
        `<div class="text-field" style="margin-bottom:10px; width:100%;"><input type="text" id="${ctx.prefix}timezone" placeholder=" " value="${escapeHtml(tz)}" style="width:100%;"><label for="${ctx.prefix}timezone">${t("vault.timezone")}</label></div>` +
        `<label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; margin-bottom:6px;"><input type="checkbox" id="${ctx.prefix}use-traefik" class="styled-checkbox" checked> ${t("vault.useTraefik")}</label>` +
        //: routing mode (domain vs. subpath) + base host for subpath mode.
        `<div id="${ctx.prefix}route-mode-wrap" style="display:none; align-items:center; gap:8px; font-size:13px; margin-bottom:8px;"><label for="${ctx.prefix}route-mode" style="white-space:nowrap;">${t("vault.routeMode")}</label><select id="${ctx.prefix}route-mode" style="flex:1;"><option value="domain">${t("vault.routeModeDomain")}</option><option value="subpath">${t("vault.routeModeSubpath")}</option></select></div>` +
        `<div id="${ctx.prefix}base-domain-wrap" class="text-field" style="display:none; margin-bottom:10px; width:100%;"><input type="text" id="${ctx.prefix}base-domain" placeholder=" " style="width:100%;"><label for="${ctx.prefix}base-domain">${t("vault.baseDomain")}</label></div>`;
    container.appendChild(general);
    Array.from(ctx.selected).forEach(pbPath => {
        const baseName = pbPath.split("/").pop();
        const meta = (typeof playbookMetadataMap !== "undefined" && (playbookMetadataMap[pbPath] || playbookMetadataMap[baseName])) || { name: baseName };
        //: same fallback as the run dialog — playbooks without a hardcoded config
        // (game servers etc.) get their fields from the catalog variables (index.yml).
        const hardcoded = (typeof playbookDomainConfigs !== "undefined") ? playbookDomainConfigs[baseName] : null;
        const cfgs = (hardcoded && hardcoded.length) ? hardcoded : catalogVariablesToConfigs(meta.variables);
        if (!cfgs || !cfgs.length) return;
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
            const scope = cfg.scope || (cfg.variable.endsWith("_domain") ? "domain" : (cfg.variable.endsWith("_subpath") ? "subpath" : (cfg.variable.endsWith("_port") ? "port" : "general")));
            const div = document.createElement("div");
            div.dataset.scope = scope; div.dataset.serviceGroup = serviceGroup;
            if (cfg.type === "bool") {
                //: boolean values as a toggle checkbox (prefilled via applyWizardVariables / cfg.default).
                div.className = "config-field bool-field";
                div.innerHTML = `<label class="checkbox-label bool-field-label"><input type="checkbox" class="styled-checkbox" id="${ctx.prefix}variable-${cfg.variable}" data-variable="${cfg.variable}" data-scope="${scope}"${cfg.default ? " checked" : ""}><span>${escapeHtml(cfg.label)}</span></label>`;
            } else {
                //: example value as a gray HTML placeholder (the label floats permanently at the top via .config-field).
                const type = cfg.type || "text";
                const ph = cfg.placeholder ? escapeHtml(cfg.placeholder) : " ";
                div.className = "text-field config-field";
                const defVal = cfg.default != null ? escapeHtml(String(cfg.default)) : "";
                div.innerHTML = `<input type="${type}" id="${ctx.prefix}variable-${cfg.variable}" data-variable="${cfg.variable}" data-scope="${scope}" placeholder="${ph}" value="${defVal}"><label for="${ctx.prefix}variable-${cfg.variable}">${escapeHtml(cfg.label)}</label>`;
            }
            body.appendChild(div);
        });
        details.appendChild(body);
        container.appendChild(details);
    });
    const traefik = document.getElementById(`${ctx.prefix}use-traefik`);
    const routeModeSel = document.getElementById(`${ctx.prefix}route-mode`);
    const routeModeWrap = document.getElementById(`${ctx.prefix}route-mode-wrap`);
    const baseDomainWrap = document.getElementById(`${ctx.prefix}base-domain-wrap`);
    const applyVis = () => {
        const isTraefik = traefik.checked;
        //: subpath mode only under Traefik; toggle the mode selector + base host field.
        const subpathMode = isTraefik && routeModeSel && routeModeSel.value === "subpath";
        if (routeModeWrap) routeModeWrap.style.display = isTraefik ? "flex" : "none";
        if (baseDomainWrap) baseDomainWrap.style.display = subpathMode ? "" : "none";
        container.querySelectorAll(".modal-config-accordion").forEach(acc => {
            //: subpath-capable = has a subpath-scoped field; else hard-hidden in subpath mode.
            const accCapable = !!acc.querySelector('.config-field[data-scope="subpath"]');
            let visible = 0;
            acc.querySelectorAll(".config-field").forEach(field => {
                const scope = field.dataset.scope;
                let vis;
                if (scope === "port") vis = !isTraefik;
                else if (scope === "domain") vis = isTraefik && !subpathMode;
                else if (scope === "subpath") vis = isTraefik && subpathMode;
                else vis = !(isTraefik && subpathMode && !accCapable); // general
                field.style.display = vis ? "" : "none";
                if (vis) visible++;
            });
            acc.style.display = visible > 0 ? "" : "none";
            const cnt = acc.querySelector(".modal-config-accordion-count");
            if (cnt) cnt.textContent = visible === 1 ? t("vault.settingCountOne", { count: visible }) : t("vault.settingCountMany", { count: visible });
        });
    };
    if (traefik) { traefik.onchange = applyVis; }
    if (routeModeSel) routeModeSel.onchange = applyVis;
    if (traefik) applyVis();
    if (!container.querySelector(".modal-config-accordion")) {
        const note = document.createElement("p");
        note.style.cssText = "color:var(--text-muted); font-size:12px;";
        note.textContent = t("vault.noExtraSettings");
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
    const isTraefik = !!(traefik && traefik.checked);
    vars["use_traefik"] = isTraefik ? "true" : "false";
    //: routing mode + base host (only with Traefik / subpath mode).
    if (isTraefik) {
        const rm = document.getElementById(`${ctx.prefix}route-mode`);
        const mode = (rm && rm.value === "subpath") ? "subpath" : "domain";
        vars["route_mode"] = mode;
        if (mode === "subpath") {
            const bd = document.getElementById(`${ctx.prefix}base-domain`);
            if (bd && bd.value.trim()) vars["base_domain"] = bd.value.trim();
        }
    }
    document.querySelectorAll(`#${ctx.cfg} .modal-config-accordion .config-field`).forEach(field => {
        if (field.style.display === "none") return;
        const inp = field.querySelector("input");
        if (!inp || !inp.dataset.variable) return;
        //: bool checkbox -> explicit true/false string; text field only when filled.
        if (inp.type === "checkbox") vars[inp.dataset.variable] = inp.checked ? "true" : "false";
        else if (inp.value.trim()) vars[inp.dataset.variable] = inp.value.trim();
    });
    return vars;
}

// : `selected` (list of existing shares {guest_id, permission}) pre-populates existing
// shares when editing (checkbox on, permission set). When creating = null.
function renderWizardShares(ctx = presetWizardCtx(), selected = null) {
    const sc = document.getElementById(ctx.shares);
    if (!sc) return;
    const guests = (ctx.guests && ctx.guests.length ? ctx.guests : (window._presetGuests || []));
    if (!guests.length) { sc.innerHTML = `<p style="color:var(--text-muted); font-size:12px;">${t("vault.noTeamMembers")}</p>`; return; }
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
        perm.innerHTML = `<option value="strict">${t("vault.permStrict")}</option><option value="flexible">${t("vault.permFlexible")}</option>`;
        perm.value = byGuest[g.id] || "strict";
        row.appendChild(cb); row.appendChild(name); row.appendChild(perm);
        sc.appendChild(row);
    });
}

// : apply a preset's saved variables into the (already rendered) wizard step-2 fields.
// Must run AFTER renderWizardConfig.
function applyWizardVariables(ctx, vars) {
    if (!vars) return;
    const bd = document.getElementById(`${ctx.prefix}base-dir`);
    if (bd && vars.base_dir != null) bd.value = vars.base_dir;
    const tz = document.getElementById(`${ctx.prefix}timezone`);
    if (tz && vars.timezone != null) tz.value = vars.timezone;
    const traefik = document.getElementById(`${ctx.prefix}use-traefik`);
    //: restore routing mode + base host before re-applying visibility.
    const routeModeSel = document.getElementById(`${ctx.prefix}route-mode`);
    if (routeModeSel && vars.route_mode != null) routeModeSel.value = (String(vars.route_mode) === "subpath") ? "subpath" : "domain";
    const baseDomainInp = document.getElementById(`${ctx.prefix}base-domain`);
    if (baseDomainInp && vars.base_domain != null) baseDomainInp.value = vars.base_domain;
    if (traefik && vars.use_traefik != null) {
        traefik.checked = String(vars.use_traefik) === "true";
        if (typeof traefik.onchange === "function") traefik.onchange();  // Re-apply visibility (domain/port/subpath)
    }
    document.querySelectorAll(`#${ctx.cfg} .modal-config-accordion .config-field input[data-variable]`).forEach(inp => {
        const key = inp.dataset.variable;
        if (vars[key] == null) return;
        //: apply the saved bool string to the checkbox state.
        if (inp.type === "checkbox") inp.checked = String(vars[key]) === "true";
        else inp.value = vars[key];
    });
}

function presetWizardNext() {
    if (presetWizardStep === 1) {
        const name = (document.getElementById("preset-wizard-name").value || "").trim();
        if (!name) { showToast(t("vault.presetNameRequired")); return; }
        if (!presetWizardSelected.size) { showToast(t("vault.selectPlaybook")); return; }
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
    if (!name || !playbook_ids.length) { showToast(t("vault.nameAndPlaybookRequired")); return; }
    const variables = collectWizardVariables();
    const shares = Array.from(document.querySelectorAll("#preset-wizard-shares .wizard-share-cb:checked")).map(cb => {
        const permEl = document.querySelector(`#preset-wizard-shares .wizard-share-perm[data-guest="${cssEscape(cb.value)}"]`);
        return { guest_id: cb.value, permission: (permEl && permEl.value) || "strict" };
    });
    const payload = { name, playbook_ids, variables, device_ids: [], shares };
    try {
        const res = await fetch("/api/profile/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(errorDetailToMessage(d.detail, t("vault.createFailed")));
        showToast(t("vault.presetCreated"));
        closePresetWizard();
        await loadPresets();
    } catch (e) {
        showToast(e.message);
    }
}

// ===========================================================================
// : scenario creation wizard — playbooks → settings → devices → sharing.
// Creates a preset in the background (steps 1+2) and links it as a scenario with the
// device chosen in step 3 (or "no fixed device" for) + shares from step 4.
// ===========================================================================
let scenarioWizardStep = 1;
let scenarioWizardSelected = new Set();
let scenarioWizardDevices = [];   //: list of selected device IDs ([] = deviceless scenario)
// : edit mode of the scenario wizard.
let scenarioWizardEditing = null;       // scenario ID (null = new entry)
let scenarioWizardEditPresetId = null;  // preset to update (null = create a new preset)
let scenarioWizardEditVars = null;      // variables to prefill step 2
let scenarioWizardEditShares = null;    // existing shares for step 4
let scenarioWizardVarsApplied = false;  // apply the step-2 prefill only once

// : new entry.: with a scenario object = edit (values prefilled).
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
        // : edit — prefill name, playbooks, variables, device and shares from the scenario
        // (or its preset). The preset provides playbooks + variables.
        scenarioWizardEditing = s.id;
        const preset = (userScenarioPresets || []).find(p => p.id === s.preset_id) || null;
        scenarioWizardEditPresetId = preset ? preset.id : null;  // if the preset is missing -> create a new one on save
        scenarioWizardSelected = new Set(preset ? (preset.playbook_ids || []) : []);
        scenarioWizardEditVars = preset ? (preset.variables || {}) : {};
        //: only preselect existing devices; discard unknown IDs (deleted).
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
    // : reset the dirty flag, so the freshly opened dialog doesn't immediately count as "changed".
    if (dlg) { dlg.dataset.dirty = ""; dlg.classList.remove("hidden"); }
}
function closeScenarioWizard() {
    const dlg = document.getElementById("scenario-wizard-dialog"); if (dlg) dlg.classList.add("hidden");
}
function scenarioWizardGoTo(step) {
    scenarioWizardStep = step;
    [1, 2, 3, 4].forEach(n => { const el = document.getElementById("scenario-wizard-step-" + n); if (el) el.classList.toggle("hidden", n !== step); });
    // : title/icon/buttons reflect new entry vs. edit.
    const editing = !!scenarioWizardEditing;
    const prefix = editing ? window.t("scenario.editScenario") : window.t("scenario.newScenario");
    const titles = { 1: window.t("scenario.wizStep1", { prefix }), 2: window.t("scenario.wizStep2", { prefix }), 3: window.t("scenario.wizStep3", { prefix }), 4: window.t("scenario.wizStep4", { prefix }) };
    const t = document.getElementById("scenario-wizard-title"); if (t) t.textContent = titles[step];
    const icon = document.getElementById("scenario-wizard-icon"); if (icon) icon.textContent = editing ? "edit" : "rocket_launch";  //
    //: in the Community edition the sharing step (step 4) is dropped — no additional users.
    const lastStep = currentEdition === "community" ? 3 : 4;
    const back = document.getElementById("scenario-wizard-back"); if (back) back.style.display = step > 1 ? "" : "none";
    const next = document.getElementById("scenario-wizard-next"); if (next) next.style.display = step < lastStep ? "" : "none";
    const finish = document.getElementById("scenario-wizard-finish");
    if (finish) { finish.style.display = step === lastStep ? "" : "none"; finish.textContent = editing ? window.t("scenario.saveChanges") : window.t("scenario.create"); }
}

// Step 3: (device flatten): multi-selection of target devices (checkboxes). No selection
// = deviceless scenario (the device is entered once at run time).
function renderScenarioWizardDevices() {
    const c = document.getElementById("scenario-wizard-devices");
    if (!c) return;
    c.innerHTML = "";
    const note = document.createElement("p");
    note.style.cssText = "color:var(--text-secondary); font-size:12px; margin:0 0 8px 0;";
    note.textContent = t("scenario.wizDeviceNote");
    c.appendChild(note);
    const selected = new Set(scenarioWizardDevices || []);
    const devices = userScenarioDevices || [];
    if (!devices.length) {
        const empty = document.createElement("p");
        empty.style.cssText = "color:var(--text-muted); font-size:12px; margin:0;";
        empty.textContent = t("scenario.wizNoDevices");
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
        if (!name) { showToast(t("scenario.nameRequiredWiz")); return; }
        if (!scenarioWizardSelected.size) { showToast(t("vault.selectPlaybook")); return; }
        renderWizardConfig(scenarioWizardCtx());
        // : prefill saved variables once (only in edit mode).
        if (scenarioWizardEditing && !scenarioWizardVarsApplied) {
            applyWizardVariables(scenarioWizardCtx(), scenarioWizardEditVars);
            scenarioWizardVarsApplied = true;
        }
        scenarioWizardGoTo(2);
    } else if (scenarioWizardStep === 2) {
        renderScenarioWizardDevices();
        scenarioWizardGoTo(3);
    } else if (scenarioWizardStep === 3) {
        //: in the Community edition step 3 is the last step (no sharing);
        // the "Next" button is hidden there, this guard is the safeguard.
        if (currentEdition === "community") return;
        // : in edit mode, pre-populate existing shares.
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
    if (!name || !playbook_ids.length) { showToast(t("vault.nameAndPlaybookRequired")); return; }
    const variables = collectWizardVariables(scenarioWizardCtx());
    //: the Community edition has no sharing step -> never send shares.
    const shares = currentEdition === "community" ? [] : Array.from(document.querySelectorAll("#scenario-wizard-shares .wizard-share-cb:checked")).map(cb => {
        const permEl = document.querySelector(`#scenario-wizard-shares .wizard-share-perm[data-guest="${cssEscape(cb.value)}"]`);
        return { guest_id: cb.value, permission: (permEl && permEl.value) || "strict" };
    });
    try {
        //  option A: create a reusable preset (recipe) from steps 1+2, or
        // when editing update the scenario's existing preset.
        let presetId;
        if (scenarioWizardEditing && scenarioWizardEditPresetId) {
            // Leave existing preset shares unchanged (the scenario's sharing goes via step 4).
            const existingPreset = (userScenarioPresets || []).find(p => p.id === scenarioWizardEditPresetId);
            const presetShares = (existingPreset && existingPreset.shares) || [];
            const presetRes = await fetch(`/api/profile/presets/${scenarioWizardEditPresetId}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, playbook_ids, variables, device_ids: [], shares: presetShares })
            });
            const presetData = await presetRes.json().catch(() => ({}));
            if (!presetRes.ok) throw new Error(errorDetailToMessage(presetData.detail, t("vault.saveFailed")));
            presetId = presetData.id;
        } else {
            // New entry – or editing a scenario whose preset has meanwhile been deleted.
            const presetRes = await fetch("/api/profile/presets", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, playbook_ids, variables, device_ids: [], shares: [] })
            });
            const presetData = await presetRes.json().catch(() => ({}));
            if (!presetRes.ok) throw new Error(errorDetailToMessage(presetData.detail, t("vault.createFailed")));
            presetId = presetData.id;
        }
        // ... then the scenario that links the preset with the chosen device (or deviceless).
        const scenarioUrl = scenarioWizardEditing ? `/api/profile/scenarios/${scenarioWizardEditing}` : "/api/profile/scenarios";
        const scenarioRes = await fetch(scenarioUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, preset_id: presetId, device_ids: scenarioWizardDevices, shares })
        });
        const scenarioData = await scenarioRes.json().catch(() => ({}));
        if (!scenarioRes.ok) throw new Error(errorDetailToMessage(scenarioData.detail, scenarioWizardEditing ? t("scenario.saveFailed") : t("scenario.createFailed")));
        showToast(scenarioWizardEditing ? t("scenario.updated") : t("scenario.created"));
        closeScenarioWizard();
        await loadScenarios();
    } catch (e) {
        showToast(e.message);
    }
}

// : log export (TXT/CSV) of the rendered tables — purely client-side.
function _collectTableRows(tbodyId, colCount) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return [];
    const rows = [];
    tbody.querySelectorAll("tr").forEach(tr => {
        const cells = tr.querySelectorAll("td");
        if (cells.length < colCount) return; // Skip placeholder/colspan rows (Loading…/No entries)
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
    if (!rows.length) { showToast(t("misc.noExportEntries")); return; }
    // Date stamp without the Date.now ban issue (the browser context allows new Date()).
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

// : central export dialog (select log types + format) instead of inline buttons.
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
    if (!wantSecurity && !wantAudit) { showToast(t("adminExport.selectAtLeastOne")); return; }
    const fmtEl = document.querySelector('input[name="admin-export-format"]:checked');
    const format = fmtEl ? fmtEl.value : "csv";
    if (wantSecurity) exportAdminLog("security", format);
    if (wantAudit) exportAdminLog("audit", format);
    closeAdminExportDialog();
}

async function fetchAuditLog() {
    const tbody = document.getElementById("admin-audit-tbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:var(--text-muted);">${t("adminExport.loading")}</td></tr>`;
    try {
        const res = await fetch("/api/admin/audit-log");
        if (!res.ok) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:var(--md-sys-color-error);">${t("adminExport.loadError")}</td></tr>`; return; }
        const entries = await res.json();
        if (!entries || entries.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:var(--text-muted);">${t("adminExport.noEntries")}</td></tr>`;
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
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:var(--md-sys-color-error);">${t("adminExport.networkError")}</td></tr>`;
    }
}

// : load and display security notices in the admin panel.
async function fetchSecurityAlerts() {
    // Fingerprint/security notices = trial abuse detection (cloud-only):
    // stripped in Community, hidden in On-Premise -> load only in the cloud.
    if (currentEdition !== "cloud") {
        const sec = document.getElementById("admin-security-alerts-section");
        if (sec) sec.style.display = "none";
        return;
    }
    const tbody = document.getElementById("admin-security-tbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:15px; color:var(--text-muted);">${t("adminExport.loading")}</td></tr>`;
    try {
        const res = await fetch("/api/admin/security-alerts");
        if (!res.ok) { tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:15px; color:var(--md-sys-color-error);">${t("adminExport.loadError")}</td></tr>`; return; }
        const alerts = await res.json();
        if (!alerts || alerts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:15px; color:var(--text-muted);">${t("adminExport.noAlerts")}</td></tr>`;
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
                ? `<span style="color: var(--text-muted);">${t("adminExport.resolved")}${a.acknowledged_by ? " (" + escapeHtml(a.acknowledged_by) + ")" : ""}</span>`
                : `<span style="color: var(--md-sys-color-error); font-weight: bold;">${t("adminExport.open")}</span>`;
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
                btn.textContent = t("adminExport.markResolved");
                btn.addEventListener("click", () => acknowledgeSecurityAlert(a.id));
                actTd.appendChild(btn);
            }
            tr.appendChild(actTd);
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:15px; color:var(--md-sys-color-error);">${t("adminExport.networkError")}</td></tr>`;
    }
}

async function acknowledgeSecurityAlert(alertId) {
    try {
        const res = await fetch(`/api/admin/security-alerts/${alertId}/acknowledge`, { method: "POST" });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || t("adminExport.markedResolved"));
            fetchSecurityAlerts();
        } else {
            showToast(errorDetailToMessage(data.detail, t("adminExport.actionFailed")));
        }
    } catch (err) {
        showToast(t("adminExport.networkError"));
    }
}

// ===========================================================================
// : tariff & coupon management in the admin panel
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

    // Only registered users; guests are viewable via the owner's management
    let list = allAdminUsers.filter(u => u.role !== "guest").filter(u =>
        !q || (u.username || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q));

    list.sort((a, b) => {
        if (sort === "created_at") return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        if (sort === "active") return (a.is_active === b.is_active) ? 0 : (a.is_active ? 1 : -1);
        return String(a[sort] || "").localeCompare(String(b[sort] || ""));
    });

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 15px; color: var(--text-muted);">${t("adminUsers.noUsersFound")}</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    list.forEach(user => {
        const isSelf = currentUser && user.username === currentUser.username;
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
        const activeBadge = user.is_active
            ? `<span style="color:#2ecc71;">${t("adminUsers.yes")}</span>`
            : `<span style="color:#e74c3c;">${t("adminUsers.no")}</span>`;
        // : "Manage" (icon manage_accounts) to the left of the name.
        const nameTd = document.createElement("td");
        nameTd.style.cssText = "padding:8px; white-space:nowrap;";
        if (!isSelf) {
            const manage = document.createElement("button");
            manage.type = "button"; manage.className = "btn btn-secondary btn-small"; manage.style.marginRight = "8px";
            manage.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; margin-right:4px;">manage_accounts</span>${t("adminUsers.manage")}`;
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
        tr.appendChild(cell(escapeHtml(user.subscription_status || t("adminUsers.inactive"))));
        tr.appendChild(cell(activeBadge));
        // : "Delete" on the far right (warning dialog with the name in bold).
        const tdAct = document.createElement("td");
        tdAct.style.cssText = "padding:8px; text-align:right; white-space:nowrap;";
        if (isSelf) {
            tdAct.textContent = "—";
        } else {
            const del = document.createElement("button");
            del.type = "button"; del.className = "btn btn-danger btn-small";
            del.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; margin-right:4px;">delete</span>${t("common.delete")}`;
            del.addEventListener("click", () => deleteAdminUserById(user.id, user.username));
            tdAct.appendChild(del);
        }
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
    });
}

// : create-user dialog (admin) + creation via POST /api/admin/users.
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
    if (!username || !email || !password) { showToast(t("adminUsers.fillAllFields")); return; }
    try {
        const res = await fetch("/api/admin/users", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, email, password, role })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(errorDetailToMessage(data.detail, t("adminUsers.createFailed")));
        showToast(t("adminUsers.userCreated"));
        closeAdminUserCreateDialog();
        fetchAdminUsers();
    } catch (err) {
        showToast(err.message);
    }
}

async function fetchAdminUsers() {
    const tbody = document.getElementById("admin-users-tbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 15px; color: var(--text-muted);">${t("adminUsers.loadingUsers")}</td></tr>`;
    try {
        const response = await fetch("/api/admin/users");
        if (response.ok) {
            allAdminUsers = await response.json();
            renderAdminUsers();
        } else {
            const data = await response.json();
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 15px; color: var(--md-sys-color-error);">${t("adminUsers.errorPrefix")} ${escapeHtml(errorDetailToMessage(data.detail, t("adminUsers.loadError")))}</td></tr>`;
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 15px; color: var(--md-sys-color-error);">${t("adminUsers.networkErrorLoadUsers")}</td></tr>`;
    }
}

let currentAdminEditUser = null;
let currentAdminEditUserData = null;   // : most recently loaded user record
let adminLimitDefaults = null;          // : global default limits for placeholders

async function openAdminEditUser(userId) {
    // : load the global default limits once (for limit placeholders)
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
    document.getElementById("admin-edit-user-info").innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("adminUsers.loading")}</p>`;
    document.getElementById("admin-user-invoices").innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("adminUsers.loadingInvoices")}</p>`;
    dialog.classList.remove("hidden");

    try {
        const res = await fetch(`/api/admin/users/${userId}`);
        if (!res.ok) {
            document.getElementById("admin-edit-user-info").innerHTML = `<p style="color:var(--md-sys-color-error); margin:0;">${t("adminUsers.couldNotLoadUser")}</p>`;
            return;
        }
        const u = await res.json();
        currentAdminEditUserData = u;
        document.getElementById("admin-edit-username-lbl").textContent = u.username;
        const toggleBtn = document.getElementById("admin-toggle-active-btn");
        toggleBtn.textContent = u.is_active ? t("adminUsers.deactivate") : t("adminUsers.activate");
        toggleBtn.dataset.active = u.is_active ? "1" : "0";

        // : prefill the role dropdown
        const roleSel = document.getElementById("admin-edit-role");
        if (roleSel) roleSel.value = u.role;

        // : prefill the username (editable in the admin panel).
        const unameInput = document.getElementById("admin-edit-username");
        if (unameInput) unameInput.value = u.username || "";

        // : individual limits — the placeholder shows the global default
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
        //: the Community edition has no per-user limits -> hide the section.
        const limitsSection = document.getElementById("admin-edit-limits-section");
        if (limitsSection) limitsSection.style.display = (currentEdition === "community") ? "none" : "";

        const fmt = (d) => d ? new Date(d).toLocaleString() : "-";
        const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : "-";

        // : header badges — verification, account status, premium
        const badge = (txt, color, icon) =>
            `<span style="display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:600; padding:3px 9px; border-radius:99px; background:${color}22; color:${color}; border:1px solid ${color}55;">` +
            (icon ? `<span class="material-symbols-outlined" style="font-size:14px;">${icon}</span>` : "") + `${txt}</span>`;
        const verifyBadge = u.email_verified
            ? badge(t("adminUsers.verified"), "#2ecc71", "verified")
            : badge(t("adminUsers.pending"), "#e74c3c", "schedule");
        const statusBadge = u.is_active
            ? badge(t("adminUsers.statusActive"), "#2ecc71", "check_circle")
            : badge(t("adminUsers.statusDeactivated"), "#e74c3c", "block");
        const premiumBadge = u.is_subscription_active ? badge("Premium", "#f1c40f", "workspace_premium") : "";
        document.getElementById("admin-edit-user-header").innerHTML =
            `<div style="font-size:17px; font-weight:700; margin-bottom:8px;">${escapeHtml(u.username)}</div>` +
            `<div style="display:flex; flex-wrap:wrap; gap:8px;">${verifyBadge}${statusBadge}${premiumBadge}</div>`;

        // : account info — role (not tariff), 2FA as an icon next to the email
        const twofaIcon = u.two_factor_enabled
            ? `<span class="material-symbols-outlined" title="${t("adminUsers.twofaActive")}" style="font-size:15px; color:#2ecc71; vertical-align:middle;">lock</span>`
            : `<span class="material-symbols-outlined" title="${t("adminUsers.twofaInactive")}" style="font-size:15px; color:var(--text-muted); vertical-align:middle;">no_encryption</span>`;
        const roleLabels = { user: t("adminUsers.roleUser"), admin: t("adminUsers.roleAdmin"), guest: t("adminUsers.roleGuest") };
        document.getElementById("admin-edit-user-info").innerHTML =
            `<div><strong>${t("adminUsers.labelEmail")}:</strong> ${escapeHtml(u.email)} ${twofaIcon}</div>` +
            `<div><strong>${t("adminUsers.labelRole")}:</strong> ${escapeHtml(roleLabels[u.role] || u.role)}</div>` +
            `<div><strong>${t("adminUsers.labelRegistered")}:</strong> ${fmt(u.created_at)}</div>` +
            `<div><strong>${t("adminUsers.labelDevices")}:</strong> ${u.device_count} &middot; <strong>${t("adminUsers.labelGuests")}:</strong> ${u.guest_count} &middot; <strong>${t("adminUsers.labelApiTokens")}:</strong> ${u.token_count}</div>` +
            (u.avv_accepted_at ? `<div><strong>${t("adminUsers.labelAvv")}:</strong> ${escapeHtml(u.avv_company || '')} ${t("adminUsers.avvOn")} ${fmt(u.avv_accepted_at)}</div>` : "");

        // : current tariff — subscription status, term end, Stripe customer ID
        const endDate = u.subscription_ends_at || u.trial_ends_at;
        document.getElementById("admin-edit-user-tariff").innerHTML =
            `<div><strong>${t("adminUsers.labelSubStatus")}:</strong> ${escapeHtml(u.subscription_status || '-')}${u.is_subscription_active ? ' (' + t("adminUsers.active") + ')' : ''}</div>` +
            `<div><strong>${t("adminUsers.labelEndDate")}:</strong> ${fmtDate(endDate)}${u.cancels_at_period_end ? t("adminUsers.endsAtPeriodEnd") : ''}</div>` +
            `<div><strong>${t("adminUsers.labelStripeCustomerId")}:</strong> ${u.stripe_customer_id ? escapeHtml(u.stripe_customer_id) : '-'}</div>`;

        // Linked guest accounts
        const gc = document.getElementById("admin-edit-user-guests");
        if (gc) {
            const guests = u.guests || [];
            if (guests.length === 0) {
                gc.innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("adminUsers.noGuestAccounts")}</p>`;
            } else {
                gc.innerHTML = guests.map(g =>
                    `<div style="display:flex; justify-content:space-between; padding:3px 0;">
                        <span>${escapeHtml(g.username)} <span style="color:var(--text-muted);">(${escapeHtml(g.email)})</span></span>
                        <span style="color:${g.is_active ? '#2ecc71' : '#e74c3c'};">${g.is_active ? t("adminUsers.active") : t("adminUsers.inactive")}</span>
                    </div>`).join("");
            }
        }
    } catch (e) {
        document.getElementById("admin-edit-user-info").innerHTML = `<p style="color:var(--md-sys-color-error); margin:0;">${t("adminUsers.networkError")}</p>`;
    }

    // Load invoices (: only the last 30 days)
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
        document.getElementById("admin-user-invoices").innerHTML = `<p style="color:var(--md-sys-color-error); margin:0;">${t("adminUsers.invoicesLoadFailed")}</p>`;
    }
}

// : saves role + individual limits in one step.
async function adminSaveChanges() {
    if (!currentAdminEditUser) return;
    const parseOrNull = (id) => {
        const v = document.getElementById(id).value.trim();
        return v === "" ? null : parseInt(v, 10);
    };
    let ok = true;

    // 1) role (only if changed; the server forbids self-change)
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
            if (!res.ok) { ok = false; showToast(errorDetailToMessage(data.detail, t("adminUsers.roleChangeError"))); }
        } catch (e) { ok = false; showToast(t("adminUsers.roleChangeNetworkError")); }
    }

    // : username (only if changed).
    const unameInput = document.getElementById("admin-edit-username");
    const newUsername = unameInput ? unameInput.value.trim() : null;
    if (newUsername && newUsername !== cur.username) {
        try {
            const res = await fetch(`/api/admin/users/${currentAdminEditUser}/username`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: newUsername })
            });
            const data = await res.json();
            if (!res.ok) { ok = false; showToast(errorDetailToMessage(data.detail, t("adminUsers.usernameChangeError"))); }
        } catch (e) { ok = false; showToast(t("adminUsers.usernameChangeNetworkError")); }
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
        if (!res.ok) { ok = false; showToast(errorDetailToMessage(data.detail, t("adminUsers.limitsSaveError"))); }
    } catch (e) { ok = false; showToast(t("adminUsers.limitsSaveNetworkError")); }

    if (ok) { showToast(t("adminUsers.changesSaved")); fetchAdminUsers(); }
    openAdminEditUser(currentAdminEditUser);
}

async function adminGrantTime() {
    if (!currentAdminEditUser) return;
    const days = parseInt(document.getElementById("admin-grant-days").value, 10);
    if (!days || days < 1) { showToast(t("adminUsers.enterDays")); return; }
    try {
        const res = await fetch(`/api/admin/users/${currentAdminEditUser}/grant-time`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ days })
        });
        const data = await res.json();
        if (res.ok) { showToast(data.message); openAdminEditUser(currentAdminEditUser); fetchAdminUsers(); }
        else showToast(errorDetailToMessage(data.detail, t("adminUsers.error")));
    } catch (e) { showToast(t("adminUsers.networkError")); }
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
        else showToast(errorDetailToMessage(data.detail, t("adminUsers.error")));
    } catch (e) { showToast(t("adminUsers.networkError")); }
}

// : delete a user directly from the list (warning dialog with the name in bold).
async function deleteAdminUserById(id, name) {
    const ok = await showConfirmDialog({ title: t("adminUsers.deleteUserTitle"), messageHtml: t("adminUsers.deleteUserConfirm", { name: escapeHtml(name) }), confirmLabel: t("adminUsers.deletePermanently") });
    if (!ok) return;
    try {
        const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (res.ok) { showToast(t("adminUsers.userDeleted")); fetchAdminUsers(); }
        else showToast(errorDetailToMessage(data.detail, t("adminUsers.deleteError")));
    } catch (e) { showToast(t("adminUsers.deleteNetworkError")); }
}

async function adminDeleteUser() {
    if (!currentAdminEditUser) return;
    const name = (currentAdminEditUserData && currentAdminEditUserData.username) || t("adminUsers.thisUser");
    if (!(await showConfirmDialog({ title: t("adminUsers.deleteUserTitle"), messageHtml: t("adminUsers.deleteUserConfirm", { name: escapeHtml(name) }), confirmLabel: t("adminUsers.deletePermanently") }))) return;
    try {
        const res = await fetch(`/api/admin/users/${currentAdminEditUser}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) {
            showToast(t("adminUsers.userDeleted"));
            document.getElementById("admin-edit-user-dialog").classList.add("hidden");
            fetchAdminUsers();
        } else showToast(errorDetailToMessage(data.detail, t("adminUsers.deleteError")));
    } catch (e) { showToast(t("adminUsers.deleteNetworkError")); }
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
            // Fingerprint alert thresholds (cloud-only; stripped in Community -> null-safe).
            const fpAlertCount = document.getElementById("admin-cfg-fp-alert-count");
            if (fpAlertCount) fpAlertCount.value = settings.fingerprint_alert_threshold_count || "";
            const fpAlertHours = document.getElementById("admin-cfg-fp-alert-hours");
            if (fpAlertHours) fpAlertHours.value = settings.fingerprint_alert_threshold_hours || "";
            // : default timeout (default 3600 if not yet set).
            document.getElementById("admin-cfg-job-timeout").value = settings.default_job_timeout || "3600";
            //: connection/sudo prompt timeout (default 30 if not yet set).
            document.getElementById("admin-cfg-connection-timeout").value = settings.default_connection_timeout || "30";
            // : Passwortregeln.
            document.getElementById("admin-cfg-pw-min-length").value = settings.password_min_length || "8";
            document.getElementById("admin-cfg-pw-special").checked = String(settings.password_require_special || "false").toLowerCase() === "true";
            document.getElementById("admin-cfg-pw-case").checked = String(settings.password_require_case || "false").toLowerCase() === "true";
            document.getElementById("admin-cfg-pw-digit").checked = String(settings.password_require_digit || "false").toLowerCase() === "true";
            // : maintenance mode + note.
            const maintCb = document.getElementById("admin-cfg-maintenance-mode");
            if (maintCb) maintCb.checked = String(settings.maintenance_mode || "false").toLowerCase() === "true";
            const maintNote = document.getElementById("admin-cfg-maintenance-note");
            if (maintNote) maintNote.value = settings.maintenance_note || "";
            // : registration toggle (default on if never set).
            const regCb = document.getElementById("admin-cfg-registration-enabled");
            if (regCb) regCb.checked = String(settings.registration_enabled || "true").toLowerCase() === "true";
            //: enterprise tariff (cloud-only; fields stripped in the Community edition -> null-safe).
            const entEnabledCb = document.getElementById("admin-cfg-enterprise-enabled");
            if (entEnabledCb) entEnabledCb.checked = String(settings.enterprise_tier_enabled || "true").toLowerCase() !== "false";
            const entTitle = document.getElementById("admin-cfg-enterprise-title");
            if (entTitle) entTitle.value = settings.enterprise_tier_title || "";
            const entDesc = document.getElementById("admin-cfg-enterprise-desc");
            if (entDesc) entDesc.value = settings.enterprise_tier_description || "";
            const entContact = document.getElementById("admin-cfg-enterprise-contact");
            if (entContact) entContact.value = settings.enterprise_contact_email || "";
        } else {
            showToast(t("adminCfg.loadError"));
        }
    } catch (err) {
        showToast(t("adminCfg.loadNetworkError"));
    }
    //: in the Community edition neither quota/limit nor fingerprint-alert
    // settings apply — hide the corresponding fields (wrapper .text-field). handleAdminConfigSubmit
    // then doesn't send them (the backend treats them as optional), no 422.
    if (currentEdition === "community") {
        ["admin-cfg-max-guests", "admin-cfg-max-tokens", "admin-cfg-storage-quota", "admin-cfg-max-playbooks"].forEach(id => {
            const el = document.getElementById(id);
            const wrap = el && el.closest(".text-field");
            if (wrap) wrap.style.display = "none";
        });
    }
    // : the GoBD date fields are now prefilled when the Logs tab is opened.
    prefillGobdDates();
}

// : send a test email for SMTP verification.
async function sendAdminTestEmail() {
    const addr = (document.getElementById("admin-test-email-addr").value || "").trim();
    if (!addr) { showToast(t("adminCfg.enterRecipientEmail")); return; }
    const btn = document.getElementById("admin-test-email-btn");
    if (btn) btn.disabled = true;
    try {
        const res = await fetch("/api/admin/config/test-email", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: addr })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) showToast(data.message || t("adminCfg.testEmailSent"));
        else showToast(errorDetailToMessage(data.detail, t("adminCfg.testEmailFailed")));
    } catch (e) {
        showToast(t("adminCfg.testEmailNetworkError"));
    } finally {
        if (btn) btn.disabled = false;
    }
}

// /: prefill the GoBD export date fields with the current fiscal year.
function prefillGobdDates() {
    const gStart = document.getElementById("gobd-start-date");
    const gEnd = document.getElementById("gobd-end-date");
    if (gStart && gEnd && !gStart.value && !gEnd.value) {
        const year = new Date().getFullYear();
        gStart.value = `${year}-01-01`;
        gEnd.value = `${year}-12-31`;
    }
}

// : download the GoBD export as a ZIP (GET download with a session cookie).
function handleGobdExport() {
    const start = document.getElementById("gobd-start-date").value;
    const end = document.getElementById("gobd-end-date").value;
    if (!start || !end) { showToast(t("adminCfg.gobdSelectDates")); return; }
    if (start > end) { showToast(t("adminCfg.gobdEndAfterStart")); return; }
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
    // Fingerprint alert thresholds (cloud-only; stripped in Community -> null-safe, sent conditionally below).
    const fpAlertCountEl = document.getElementById("admin-cfg-fp-alert-count");
    const fpAlertHoursEl = document.getElementById("admin-cfg-fp-alert-hours");
    // : default timeout for runs.
    const default_job_timeout = document.getElementById("admin-cfg-job-timeout").value;
    //: Verbindungs-/Sudo-Prompt-Timeout.
    const default_connection_timeout = document.getElementById("admin-cfg-connection-timeout").value;
    // : Passwortregeln.
    const password_min_length = document.getElementById("admin-cfg-pw-min-length").value;
    const password_require_special = document.getElementById("admin-cfg-pw-special").checked ? "true" : "false";
    const password_require_case = document.getElementById("admin-cfg-pw-case").checked ? "true" : "false";
    const password_require_digit = document.getElementById("admin-cfg-pw-digit").checked ? "true" : "false";
    // /: maintenance mode + note + registration toggle. In Community
    // build-stripped (community-strip) -> null-safe and sent only conditionally below, otherwise
    // Community would needlessly set these (there inert) values to "false" on every save.
    const maintCb = document.getElementById("admin-cfg-maintenance-mode");
    const maintNoteEl = document.getElementById("admin-cfg-maintenance-note");
    const regCb = document.getElementById("admin-cfg-registration-enabled");
    //: enterprise tariff fields (cloud-only; stripped in the Community edition -> null-safe).
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
    //: in the Community edition these fields are hidden (quota/limits,
    // fingerprint alerts) — don't send them (the backend leaves them unchanged), otherwise 422.
    if (currentEdition === "community") {
        ["max_active_api_tokens", "max_guest_accounts", "storage_quota_mb", "max_custom_playbooks"].forEach(k => delete payload[k]);
    }
    //: only send enterprise fields when present (cloud).
    if (entEnabledCb) payload.enterprise_tier_enabled = entEnabledCb.checked ? "true" : "false";
    if (entTitleEl) payload.enterprise_tier_title = entTitleEl.value;
    if (entDescEl) payload.enterprise_tier_description = entDescEl.value;
    if (entContactEl) payload.enterprise_contact_email = entContactEl.value;
    // Only send the fingerprint alert thresholds when present (cloud).
    if (fpAlertCountEl) payload.fingerprint_alert_threshold_count = fpAlertCountEl.value;
    if (fpAlertHoursEl) payload.fingerprint_alert_threshold_hours = fpAlertHoursEl.value;
    // Only send maintenance mode/note + registration toggle when present (cloud/onprem;
    // build-stripped in Community -> the values stay unchanged, no needless "false").
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
            showToast(t("adminCfg.saved"));
            updateMaintenanceBanner();  // : update the banner immediately after a maintenance-mode change.
        } else {
            showToast(errorDetailToMessage(data.detail, t("adminCfg.saveError")));
        }
    } catch (err) {
        showToast(t("adminCfg.saveNetworkError"));
    }
}

async function fetchAdminIPBlocks() {
    const activeTbody = document.getElementById("admin-active-bans-tbody");
    const historyTbody = document.getElementById("admin-history-bans-tbody");
    if (!activeTbody || !historyTbody) return;

    activeTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--text-muted);">${t("adminCfg.loadingActiveBans")}</td></tr>`;
    historyTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--text-muted);">${t("adminCfg.loadingHistory")}</td></tr>`;

    try {
        const response = await fetch("/api/admin/ip-blocks");
        if (response.ok) {
            const data = await response.json();

            if (data.blocks.length === 0) {
                activeTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--text-muted);">${t("adminCfg.noActiveBans")}</td></tr>`;
            } else {
                // DOM construction instead of string interpolation: no onclick from the (spoofable) IP value
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
                    btn.textContent = t("adminCfg.release");
                    btn.addEventListener("click", () => releaseIPBan(b.ip));
                    actTd.appendChild(btn);
                    tr.appendChild(actTd);
                    activeTbody.appendChild(tr);
                });
            }

            if (data.history.length === 0) {
                historyTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--text-muted);">${t("adminCfg.noHistory")}</td></tr>`;
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
            activeTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--md-sys-color-error);">${t("msg.loadFailed")}</td></tr>`;
            historyTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--md-sys-color-error);">${t("msg.loadFailed")}</td></tr>`;
        }
    } catch (err) {
        activeTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--md-sys-color-error);">${t("msg.networkError")}</td></tr>`;
        historyTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--md-sys-color-error);">${t("msg.networkError")}</td></tr>`;
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
            showToast(t("adminCfg.ipBanned", { ip }));
            document.getElementById("admin-ip-ban-form").reset();
            closeIpBlockDialog();  // 
            fetchAdminIPBlocks();
        } else {
            showToast(errorDetailToMessage(data.detail, t("adminCfg.ipBanError")));
        }
    } catch (err) {
        showToast(t("adminCfg.ipBanNetworkError"));
    }
}

async function releaseIPBan(ip) {
    if (!(await showConfirmDialog({ title: t("adminCfg.ipReleaseTitle"), message: t("adminCfg.ipReleaseConfirm", { ip }), confirmLabel: t("adminCfg.releaseBan") }))) return;

    try {
        const response = await fetch(`/api/admin/ip-blocks/${ip}`, {
            method: "DELETE"
        });
        const data = await response.json();
        if (response.ok) {
            showToast(t("adminCfg.ipReleased", { ip }));
            fetchAdminIPBlocks();
        } else {
            showToast(errorDetailToMessage(data.detail, t("adminCfg.ipReleaseError")));
        }
    } catch (err) {
        showToast(t("adminCfg.ipReleaseNetworkError"));
    }
}


// Custom Playbooks Handlers
let customPlaybooksData = {};

// : generate the Hello World example playbook as a YAML download, so users see the
// required format (hosts: all at the top level + simple tasks) directly.
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
    listEl.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">${t("customPb.loading")}</p>`;

    try {
        // : no HTTP cache -> show the current own playbooks immediately after login/upload
        // (a response cached before login without custom entries is not reused).
        const response = await fetch(`/api/playbooks?lang=${encodeURIComponent(getLanguage())}`, { cache: "no-store" });
        if (!response.ok) {
            listEl.innerHTML = `<p style="color: var(--md-sys-color-error); font-size: 13px;">${t("customPb.loadError")}</p>`;
            return;
        }
        const playbooks = await response.json();
        const custom = playbooks.filter(pb => pb.custom === true);
        customPlaybooksData = {};
        custom.forEach(pb => { customPlaybooksData[pb.filename] = pb; });

        if (custom.length === 0) {
            listEl.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">${t("customPb.none")}</p>`;
            return;
        }

        listEl.innerHTML = "";
        custom.forEach(pb => {
            const row = document.createElement("div");
            // : spacing exactly like the devices list -> no margin-bottom (spacing only via container gap),
            // otherwise double spacing (gap + margin) and a more restless layout than "Devices".
            row.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; background:rgba(255,255,255,0.02); font-size:13px;";
            // : left group = share + edit + logo/name/meta (layout like).
            const leftGroup = document.createElement("div");
            leftGroup.style.cssText = "display:flex; align-items:center; gap:8px; min-width:0;";
            const shareBtn = vaultActionButton(t("customPb.share"), "share", "primary");
            shareBtn.addEventListener("click", () => openShareCustomPlaybook(pb.filename));
            const editBtn = vaultActionButton(t("common.edit"), "edit", "secondary");
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
            const delBtn = vaultActionButton(t("common.delete"), "delete", "danger");
            delBtn.addEventListener("click", () => deleteCustomPlaybook(pb.filename, pb.name));
            right.appendChild(delBtn);
            row.appendChild(right);
            listEl.appendChild(row);
        });
    } catch (err) {
        listEl.innerHTML = `<p style="color: var(--md-sys-color-error); font-size: 13px;">${t("customPb.loadNetworkError")}</p>`;
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
    updateEditIconLbl();   //: reset the dropzone's file label

    //: shares are moved out into the dedicated share dialog.
    document.getElementById("custom-pb-edit-dialog").classList.remove("hidden");
}

//: update the file label of the logo dropzone in the edit dialog.
function updateEditIconLbl() {
    const editIconInput = document.getElementById("custom-pb-edit-icon-file");
    const lbl = document.getElementById("custom-pb-edit-icon-filename-lbl");
    if (lbl) lbl.textContent = (editIconInput && editIconInput.files.length) ? editIconInput.files[0].name : t("customPb.noFileSelected");
}

function closeEditCustomPlaybook() {
    document.getElementById("custom-pb-edit-dialog").classList.add("hidden");
    editingCustomPlaybook = null;
}

//: dedicated share dialog (decoupled from editing)
let sharingCustomPlaybook = null;

async function openShareCustomPlaybook(filename) {
    const pb = customPlaybooksData[filename];
    if (!pb) return;
    sharingCustomPlaybook = filename;
    document.getElementById("playbook-share-filename").textContent = filename;
    const container = document.getElementById("playbook-share-guests");
    container.innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("team.loadingMembers")}</p>`;
    document.getElementById("playbook-share-dialog").classList.remove("hidden");
    try {
        const guests = await fetchGuestList();
        if (!guests || guests.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("team.noMembersHint")}</p>`;
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
        container.innerHTML = `<p style="color:var(--md-sys-color-error); margin:0;">${t("team.loadMembersError")}</p>`;
    }
}

function closeShareCustomPlaybook() {
    document.getElementById("playbook-share-dialog").classList.add("hidden");
    sharingCustomPlaybook = null;
}

async function saveShareCustomPlaybook() {
    if (!sharingCustomPlaybook) return;
    const checked = Array.from(document.querySelectorAll("#playbook-share-guests .pb-share-guest:checked")).map(c => c.value);
    // Only update shares - name/description/icon stay untouched (decoupled).
    const fd = new FormData();
    fd.append("filename", sharingCustomPlaybook);
    fd.append("guest_access", JSON.stringify(checked));
    try {
        const res = await fetch("/api/playbooks/custom-meta", { method: "POST", body: fd });
        const data = await res.json();
        if (res.ok) {
            showToast(t("customPb.shareSaved"));
            closeShareCustomPlaybook();
            await fetchCustomPlaybooks();
            await fetchPlaybooks();
        } else {
            showToast(errorDetailToMessage(data.detail, t("msg.saveFailed")));
        }
    } catch (e) {
        showToast(t("msg.networkErrorSaving"));
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
    //: guest_access is NO longer sent here (dedicated share dialog).

    try {
        const res = await fetch("/api/playbooks/custom-meta", { method: "POST", body: fd });
        const data = await res.json();
        if (res.ok) {
            showToast(t("customPb.metaSaved"));
            closeEditCustomPlaybook();
            await fetchCustomPlaybooks();
            await fetchPlaybooks();
        } else {
            showToast(errorDetailToMessage(data.detail, t("msg.saveFailed")));
        }
    } catch (e) {
        showToast(t("msg.networkErrorSaving"));
    }
}

async function handleCustomPlaybookUpload(e) {
    e.preventDefault();
    const fileInput = document.getElementById("custom-playbook-file-input");
    if (!fileInput || fileInput.files.length === 0) {
        showToast(t("customPb.selectFileFirst"));
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
            showToast(t("customPb.uploaded"));
            document.getElementById("custom-playbook-upload-form").reset();
            document.getElementById("custom-playbook-filename-lbl").textContent = t("customPb.noFileSelected");
            //: reset the logo upload box label too.
            const iconLbl = document.getElementById("custom-pb-icon-filename-lbl");
            if (iconLbl) iconLbl.textContent = t("customPb.noFileSelected");
            // : hide the dropzones' reset buttons again after a successful upload.
            ["custom-playbook-reset", "custom-pb-icon-reset"].forEach(id => { const b = document.getElementById(id); if (b) b.classList.add("hidden"); });
            closeCustomPbCreateDialog();  // : close the upload dialog after success

            await fetchCustomPlaybooks();
            await fetchPlaybooks();
        } else {
            showToast(errorDetailToMessage(data.detail, t("customPb.uploadError")));
        }
    } catch (err) {
        showToast(t("customPb.uploadNetworkError"));
    }
}

async function deleteCustomPlaybook(filename, name) {
    // : playbook display name (fallback file name) in bold in the confirmation prompt.
    const label = name || filename;
    if (!(await showConfirmDialog({ title: t("customPb.deleteTitle"), messageHtml: t("customPb.deleteConfirm", { label: escapeHtml(label) }), confirmLabel: t("common.delete") }))) return;

    try {
        const response = await fetch(`/api/playbooks/custom/${filename}`, {
            method: "DELETE"
        });
        const data = await response.json();
        if (response.ok) {
            showToast(t("customPb.deleted"));
            await fetchCustomPlaybooks();
            await fetchPlaybooks();
        } else {
            showToast(errorDetailToMessage(data.detail, t("msg.deleteError")));
        }
    } catch (err) {
        showToast(t("customPb.deleteNetworkError"));
    }
}

// Legal & Privacy Helper Functions (: no window bindings needed – see event delegation)
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
        showToast(t("avv.fillAllAndConsent"));
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
            showToast(t("avv.signed"));
            closeAVVSignatureModal();
            // Refresh auth status to reload signed AVV status
            await checkAuthStatus();
            
            // Proactively trigger the download of the personalized PDF
            window.location.href = "/api/legal/avv-download";
        } else {
            showToast(errorDetailToMessage(data.detail, t("avv.signError")));
        }
    } catch (err) {
        showToast(t("avv.signNetworkError"));
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
    showToast(t("cookie.saved"));
}

function saveCustomCookieConsent() {
    const analytics = document.getElementById("cookie-pref-analytics").checked;
    saveCookieConsent(true, analytics);
}

let telemetryInitialized = false;
function initializeTelemetry() {
    console.log("[Telemetry] Initialisiere anonymisierte Nutzungsstatistiken (opt-in gewährt)...");

    //: no more dynamically injected <script> (it was blocked by the hardened CSP
    // script-src 'self',). The mock tracking notice is logged directly from the
    // already loaded JS – CSP-compliant and idempotent.
    if (!telemetryInitialized) {
        telemetryInitialized = true;
        console.log("[Telemetry] Mock-Tracking-Dienst läuft im Hintergrund.");
    }
}

// Collaboration and API Tokens Controllers
let guestsData = {};   //: id -> guest (inkl. revoked_playbooks)

// : human-readable labels for the audit action codes.
const AUDIT_ACTION_LABELS = {
    "playbook.run": "audit.act.playbookRun",
    "device_group.create": "audit.act.deviceGroupCreate",
    "device_group.update": "audit.act.deviceGroupUpdate",
    "device_group.delete": "audit.act.deviceGroupDelete",
    "guest.create": "audit.act.guestCreate",
    "guest.delete": "audit.act.guestDelete",
    "guest.update": "audit.act.guestUpdate",
    "guest.permissions_update": "audit.act.permissionsUpdate",
    "playbook.share_update": "audit.act.playbookShareUpdate",
    "scenario.create": "audit.act.scenarioCreate",
    "scenario.update": "audit.act.scenarioUpdate",
    "scenario.delete": "audit.act.scenarioDelete",
};

// : compact, safe detail rendering (only keys/counts, no secrets).
function formatAuditDetails(action, details) {
    if (!details || typeof details !== "object") return "";
    const parts = [];
    if (Array.isArray(details.playbooks) && details.playbooks.length) {
        parts.push(`Playbooks: ${details.playbooks.join(", ")}`);
    }
    if (details.target) parts.push(`${t("msg.target")}: ${details.target}`);
    if (details.variables && typeof details.variables === "object") {
        const keys = Object.keys(details.variables).filter(k => k !== "use_traefik");
        if (keys.length) parts.push(`${t("audit.det.variables")}: ${keys.join(", ")}`);
    }
    if (typeof details.devices === "number") parts.push(t("audit.det.devices", { n: details.devices }));
    if (typeof details.guests === "number") parts.push(t("audit.det.shares", { n: details.guests }));
    if (typeof details.playbooks === "number") parts.push(`${details.playbooks} Playbooks`);
    if (typeof details.revoked === "number") parts.push(t("audit.det.revoked", { n: details.revoked }));
    if (typeof details.shared_premium === "number") parts.push(t("audit.det.premiumShared", { n: details.shared_premium }));
    if (details.email) parts.push(escapeHtml(details.email));
    return parts.map(p => escapeHtml(String(p))).join(" · ");
}

async function loadAuditLog() {
    const tbody = document.getElementById("audit-log-tbody");
    const statusEl = document.getElementById("audit-log-status");
    if (!tbody) return;
    if (statusEl) statusEl.textContent = t("msg.loading");
    try {
        const res = await fetch("/api/profile/audit-log");
        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:10px; color:var(--md-sys-color-error);">${t("audit.loadError")}</td></tr>`;
            if (statusEl) statusEl.textContent = "";
            return;
        }
        const entries = await res.json();
        if (!entries.length) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:10px; color: var(--text-muted);">${t("audit.noActivityYet")}</td></tr>`;
            if (statusEl) statusEl.textContent = "";
            return;
        }
        tbody.innerHTML = entries.map(e => {
            const ts = e.timestamp ? new Date(e.timestamp).toLocaleString(getLocale()) : "";
            const actor = escapeHtml(e.actor || "—");
            const action = escapeHtml(AUDIT_ACTION_LABELS[e.action] ? t(AUDIT_ACTION_LABELS[e.action]) : (e.action || ""));
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
        if (statusEl) statusEl.textContent = t("audit.entriesCount", { n: entries.length });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:10px; color:var(--md-sys-color-error);">${t("msg.networkError")}</td></tr>`;
        if (statusEl) statusEl.textContent = "";
    }
}

// Community deliberately locks /api/profile/guests (404, no multi-user/team-member scope).
// Don't even issue the request there (otherwise 404 noise in the browser console),
// but return an empty list. In Cloud/On-Premise fetch normally.
async function fetchGuestList() {
    if (currentEdition === "community") return [];
    try {
        const res = await fetch("/api/profile/guests");
        return res.ok ? await res.json() : [];
    } catch (e) { return []; }
}

async function fetchGuests() {
    // Community: no team members -> don't request the endpoint (404 by design).
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
                    listEl.innerHTML = `<p style="color: var(--text-muted); font-size: 13px; margin:0;">${t("team.noMembers")}</p>`;
                } else {
                    listEl.innerHTML = guests.map(g => {
                        // : share counts per type (playbooks/devices/scenarios) as a quick overview.
                        const sh = g.shares || {};
                        const fmt = (o) => o ? `${o.shared}/${o.total}` : "0/0";
                        const counts = `Playbooks ${fmt(sh.playbooks)} · ${t("team.devices")} ${fmt(sh.devices)} · ${t("team.scenarios")} ${fmt(sh.scenarios)}`;
                        // : share & management buttons + name/email next to the shares.
                        return `
                        <div class="team-member-row" style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:6px; background:rgba(255,255,255,0.02);">
                            <div style="display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap;">
                                <!-- M52: feste Reihenfolge Szenarios, Playbooks, Geräte, Aktivitäten, Bearbeiten (mit Text). -->
                                <button type="button" class="btn btn-secondary btn-small" data-action="guest-scenarios" data-id="${escapeHtml(g.id)}" title="${t("team.shareScenarios")}">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">rocket_launch</span> ${t("team.scenarios")}
                                </button>
                                <button type="button" class="btn btn-secondary btn-small" data-action="guest-revoke" data-id="${escapeHtml(g.id)}" title="${t("team.sharePlaybooks")}">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">terminal</span> Playbooks
                                </button>
                                <button type="button" class="btn btn-secondary btn-small" data-action="guest-devices" data-id="${escapeHtml(g.id)}" title="${t("team.shareDevices")}">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">devices</span> ${t("team.devices")}
                                </button>
                                <button type="button" class="btn btn-secondary btn-small" data-action="guest-activity" data-id="${escapeHtml(g.id)}" title="${t("team.viewActivity")}">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">history</span> ${t("team.activity")}
                                </button>
                                <button type="button" class="btn btn-secondary btn-small" data-action="guest-edit" data-id="${escapeHtml(g.id)}" title="${t("team.editMember")}">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">edit</span> ${t("common.edit")}
                                </button>
                                <div class="team-member-meta">
                                    <span style="font-weight:bold; color:var(--md-sys-color-primary);">${escapeHtml(g.username)} <span style="font-weight:normal; color:var(--text-secondary);">(${escapeHtml(g.email)})</span></span>
                                    <span class="team-member-shares" style="color:var(--text-muted);">${escapeHtml(counts)}</span>
                                </div>
                            </div>
                            <div style="white-space:nowrap;">
                                <button type="button" class="btn btn-small btn-danger" data-action="guest-delete" data-id="${escapeHtml(g.id)}">
                                    <span class="material-symbols-outlined" style="font-size: 14px;">delete</span> ${t("common.delete")}
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

// : device sharing per team member — shows the owner's devices (groups) with
// a checkbox (ticked = shared with this guest) and sets guest_access server-side.
let sharingDevicesGuestId = null;
async function openGuestDevicesDialog(guestId) {
    const guest = guestsData[guestId];
    if (!guest) return;
    sharingDevicesGuestId = guestId;
    document.getElementById("guest-devices-username").textContent = guest.username;
    const container = document.getElementById("guest-devices-list");
    container.innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("team.loadingDevices")}</p>`;
    document.getElementById("guest-devices-dialog").classList.remove("hidden");
    try {
        // (device flatten): sharing per device (flat device list).
        const res = await fetch("/api/profile/devices-unified");
        const devices = res.ok ? await res.json() : [];
        if (!devices.length) {
            container.innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("team.noDevicesHint")}</p>`;
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
        container.innerHTML = `<p style="color:var(--md-sys-color-error); margin:0;">${t("team.loadDevicesError")}</p>`;
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
            showToast(t("team.deviceShareSaved"));
            closeGuestDevicesDialog();
            await fetchGuests();  // update the counter
        } else {
            showToast(errorDetailToMessage(data.detail, t("msg.saveFailed")));
        }
    } catch (e) { showToast(t("msg.networkErrorSaving")); }
}

//: dialog - the owner selectively revokes playbooks from a guest
let revokingGuestId = null;

// : small playbook logo/icon for lists like the share dialog.
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
    container.innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("team.loadingPlaybooks")}</p>`;
    document.getElementById("guest-revoke-dialog").classList.remove("hidden");
    try {
        const res = await fetch(`/api/playbooks?lang=${encodeURIComponent(getLanguage())}`);
        const all = res.ok ? await res.json() : [];
        // Custom playbooks are managed via their own share dialog;
        // this dialog controls the default catalog (free + premium).
        const playbooks = all.filter(pb => !pb.custom);
        if (!playbooks.length) {
            container.innerHTML = `<p style="color: var(--text-muted); margin:0;">${t("team.noPlaybooks")}</p>`;
            return;
        }
        const revoked = new Set(guest.revoked_playbooks || []);
        const shared = new Set(guest.shared_premium_playbooks || []);
        container.innerHTML = "";

        //: group by categories (analogous to the home page), "Sonstige" last.
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
            h.textContent = catLabel(cat);
            h.style.cssText = "font-weight:600; color:var(--md-sys-color-primary); margin:12px 0 6px;";
            container.appendChild(h);
            grouped[cat].forEach(pb => {
                const isPremium = !!pb.premium;
                //: uniform semantics -> ticked = access granted.
                // Standard: access as long as NOT revoked; premium: only with an explicit share.
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
        container.innerHTML = `<p style="color:var(--md-sys-color-error); margin:0;">${t("team.loadPlaybooksError")}</p>`;
    }
}

function closeGuestRevokeDialog() {
    document.getElementById("guest-revoke-dialog").classList.add("hidden");
    revokingGuestId = null;
}

async function saveGuestRevoke() {
    if (!revokingGuestId) return;
    // : ticked = access. Standard playbooks without a tick are revoked
    // (revoked); premium playbooks with a tick are shared.
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
            showToast(t("team.playbookSharesUpdated"));
            closeGuestRevokeDialog();
            fetchGuests();
        } else {
            showToast(errorDetailToMessage(data.detail, t("msg.saveFailed")));
        }
    } catch (e) {
        showToast(t("msg.networkErrorSaving"));
    }
}

async function deleteGuest(id) {
    if (!(await showConfirmDialog({ title: t("team.deleteTitle"), message: t("team.deleteConfirm"), confirmLabel: t("common.delete") }))) return;
    try {
        const res = await fetch(`/api/profile/guests/${id}`, { method: "DELETE" });
        if (res.ok) {
            showToast(t("team.memberDeleted"));
            fetchGuests();
        } else {
            const err = await res.json();
            showToast(err.detail || t("team.memberDeleteError"));
        }
    } catch (err) {
        console.error("Failed to delete guest:", err);
        showToast(t("msg.networkError"));
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
                    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 10px; color: var(--text-muted);">${t("tokens.none")}</td></tr>`;
                } else {
                    tbody.innerHTML = tokens.map(tok => {
                        const scopesBadges = tok.scopes.map(s => {
                            //: run_playbook -> "run", everything else (read_logs/manage_*) -> "read" style.
                            const scopeClass = s === "run_playbook" ? "run" : "read";
                            return `<span class="scope-badge ${scopeClass}">${escapeHtml(s)}</span>`;
                        }).join('');
                        //: show the expiry date (if set), otherwise "unlimited".
                        const expiryLabel = tok.expires_at
                            ? escapeHtml(new Date(tok.expires_at).toLocaleDateString(getLocale()))
                            : `<span style="color: var(--text-muted);">${t("tokens.unlimited")}</span>`;
                        return `
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <td style="padding: 8px 5px;">${escapeHtml(tok.name)}</td>
                                <td style="padding: 8px 5px;">${scopesBadges}</td>
                                <td style="padding: 8px 5px; font-size: 12px; color: var(--text-secondary);">${expiryLabel}</td>
                                <td style="padding: 8px 5px; text-align: right;">
                                    <button type="button" class="btn-small-danger" data-action="token-delete" data-id="${escapeHtml(tok.id)}">
                                        <span class="material-symbols-outlined" style="font-size: 14px;">link_off</span> ${t("tokens.revoke")}
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
    if (!(await showConfirmDialog({ title: t("tokens.revokeTitle"), message: t("tokens.revokeConfirm"), confirmLabel: t("tokens.revoke") }))) return;
    try {
        const res = await fetch(`/api/profile/tokens/${id}`, { method: "DELETE" });
        if (res.ok) {
            showToast(t("tokens.revoked"));
            fetchTokens();
        } else {
            const err = await res.json();
            showToast(err.detail || t("tokens.revokeError"));
        }
    } catch (err) {
        console.error("Failed to delete token:", err);
        showToast(t("msg.networkError"));
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
        showToast(t("team.fillAllFields"));
        return;
    }
    
    try {
        const res = await fetch("/api/profile/guests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, email, password })
        });
        
        if (res.ok) {
            showToast(t("team.memberCreated"));
            usernameInput.value = "";
            emailInput.value = "";
            passwordInput.value = "";
            closeGuestCreateDialog();   // 
            fetchGuests();
        } else {
            const err = await res.json();
            showToast(err.detail || t("team.memberCreateError"));
        }
    } catch (err) {
        console.error("Guest creation failed:", err);
        showToast(t("msg.networkError"));
    }
}

// ===========================================================================
// : Teams UX — tabs, create/edit/scenario/activities dialogs
// ===========================================================================

// : tab switching users/activities (pattern like switchVaultTab).
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
    // FAB only on the users tab (CSS: body.tab-teams.team-activity-tab #team-fab { display:none }).
    document.body.classList.toggle("team-activity-tab", tabName === "activity");
    if (tabName === "activity") loadAuditLog();
}

// : open/close the create dialog.
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

// : edit a team member.
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
    if (!username || !email) { showToast(t("team.usernameEmailRequired")); return; }
    const body = { username, email };
    if (password) body.password = password;
    try {
        const res = await fetch(`/api/profile/guests/${id}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            showToast(t("team.memberUpdated"));
            closeGuestEditDialog();
            fetchGuests();
        } else {
            showToast(errorDetailToMessage(data.detail, t("msg.saveError")));
        }
    } catch (e) {
        showToast(t("msg.networkErrorSaving"));
    }
}

// : scenario sharing per team member. Lists the owner's scenarios with
// a checkbox (ticked = shared with this guest) and writes the shares per scenario.
let sharingScenariosGuestId = null;
let _guestScenariosCache = [];
async function openGuestScenariosDialog(guestId) {
    const g = guestsData[guestId];
    if (!g) return;
    sharingScenariosGuestId = guestId;
    const nameEl = document.getElementById("guest-scenarios-name");
    if (nameEl) nameEl.textContent = `${g.username} (${g.email})`;
    const list = document.getElementById("guest-scenarios-list");
    if (list) list.innerHTML = `<p style="color: var(--text-muted); font-size: 12px;">${t("msg.loading")}</p>`;
    const dlg = document.getElementById("guest-scenarios-dialog");
    if (dlg) dlg.classList.remove("hidden");
    try {
        const res = await fetch("/api/profile/scenarios");
        _guestScenariosCache = res.ok ? await res.json() : [];
    } catch (e) { _guestScenariosCache = []; }
    if (!list) return;
    if (!_guestScenariosCache.length) {
        list.innerHTML = `<p style="color: var(--text-muted); font-size: 12px;">${t("team.noScenariosHint")}</p>`;
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
    if (ok) showToast(changed ? t("team.scenarioSharesSaved") : t("team.noChanges"));
    else showToast(t("team.someSharesFailed"));
    closeGuestScenariosDialog();
    fetchGuests();
}

// : activity log of a team member (dialog with copy & TXT export).
let _guestActivityEntries = [];
let _guestActivityName = "";
async function openGuestActivityDialog(guestId) {
    const g = guestsData[guestId];
    if (!g) return;
    _guestActivityName = `${g.username} (${g.email})`;
    const titleEl = document.getElementById("guest-activity-title");
    if (titleEl) titleEl.textContent = t("team.activityTitle", { name: _guestActivityName });
    const tbody = document.getElementById("guest-activity-tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:10px; color: var(--text-muted);">${t("msg.loading")}</td></tr>`;
    const dlg = document.getElementById("guest-activity-dialog");
    if (dlg) dlg.classList.remove("hidden");
    try {
        const res = await fetch(`/api/profile/audit-log?actor_id=${encodeURIComponent(guestId)}`);
        _guestActivityEntries = res.ok ? await res.json() : [];
    } catch (e) { _guestActivityEntries = []; }
    if (!tbody) return;
    if (!_guestActivityEntries.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:10px; color: var(--text-muted);">${t("team.noActivity")}</td></tr>`;
        return;
    }
    tbody.innerHTML = _guestActivityEntries.map(e => {
        const ts = e.timestamp ? new Date(e.timestamp).toLocaleString(getLocale()) : "";
        const action = escapeHtml(AUDIT_ACTION_LABELS[e.action] ? t(AUDIT_ACTION_LABELS[e.action]) : (e.action || ""));
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
    const header = `${t("team.activityLogHeader", { name: _guestActivityName })}\n${"=".repeat(40)}\n`;
    const lines = _guestActivityEntries.map(e => {
        const ts = e.timestamp ? new Date(e.timestamp).toLocaleString(getLocale()) : "";
        const action = AUDIT_ACTION_LABELS[e.action] ? t(AUDIT_ACTION_LABELS[e.action]) : (e.action || "");
        const target = e.target || "-";
        let det = "";
        try { det = e.details ? JSON.stringify(e.details) : ""; } catch (x) { det = ""; }
        return `[${ts}] ${action} | ${t("msg.target")}: ${target}${det ? " | " + det : ""}`;
    });
    return header + lines.join("\n") + "\n";
}
async function copyGuestActivity() {
    const text = _guestActivityAsText();
    try {
        await navigator.clipboard.writeText(text);
        showToast(t("team.logsCopied"));
    } catch (e) {
        // Fallback without the Clipboard API (e.g. insecure context).
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); showToast(t("team.logsCopiedShort")); }
        catch (x) { showToast(t("team.copyFailed")); }
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
        showToast(t("tokens.enterName"));
        return;
    }
    
    const scopes = [];
    if (document.getElementById("token-scope-run").checked) scopes.push("run_playbook");
    if (document.getElementById("token-scope-read").checked) scopes.push("read_logs");
    //: granular scopes for agent management of devices/scenarios.
    if (document.getElementById("token-scope-devices").checked) scopes.push("manage_devices");
    if (document.getElementById("token-scope-scenarios").checked) scopes.push("manage_scenarios");

    if (scopes.length === 0) {
        showToast(t("tokens.selectScope"));
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
            showToast(t("tokens.generated"));
            nameInput.value = "";
            
            // Show generated token display
            document.getElementById("generated-token-text").textContent = data.token;
            document.getElementById("token-display-dialog").classList.remove("hidden");
            
            fetchTokens();
        } else {
            const err = await res.json();
            showToast(err.detail || t("tokens.generateError"));
        }
    } catch (err) {
        console.error("Token generation failed:", err);
        showToast(t("msg.networkError"));
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

///: share hint with the generic term "user". Using "user" as a
// single generic label drops the earlier guest/guests pluralization.
function guestShareLabel(count) {
    const n = Number(count) || 0;
    return t("customPb.sharedWith", { n });
}

//: no more window bindings needed – the former inline onclick handlers
// (deleteGuest/deleteToken/openGuestRevokeDialog) now run via event delegation.


// ---------------------------------------------------------------------------
// : Browser-Fingerprinting
// Lightweight vanilla-JS solution without an external dependency. Combines stable,
// device-specific signals (user agent, language, timezone, screen, canvas, WebGL …)
// into a SHA-256 hash. Serves solely to make trial abuse harder –
// not 100% unique, but stable enough to detect repeated free trials
// on the same device. Each sub-step is encapsulated, so a
// blocked API (e.g. canvas protection in the browser) does not prevent the capture.
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
    // Prefer SubtleCrypto (available only in secure contexts/HTTPS).
    if (window.crypto && window.crypto.subtle && window.isSecureContext) {
        try {
            const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
        } catch (e) { /* fallback below */ }
    }
    // Fallback: simple, stable 53-bit hash (cyrb53) as hex – sufficient as an identifier.
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
        // Capture failed -> no fingerprint (the backend treats this as "unknown").
        return null;
    }
}





// : core state/helpers for the billing module (live bindings).
export { _numOrNull, checkAuthStatus, currentEdition, currentUser, errorDetailToMessage, escapeHtml, fmtPrice, navigateTo, openProfileDialog, showConfirmDialog, showToast };
