// : lean i18n mechanism without a framework. Imported by app.js (and, cloud-only, from
// billing.js); app.js is a large IIFE bundled by Vite. Because the dynamic billing import is
// emitted as its own chunk, the engine keeps its state as a singleton on the window object
// (__ANSIMATE_I18N__) — so the main bundle and the billing chunk are guaranteed to share ONE
// language + ONE dictionary, no matter how Vite splits the modules.
//
// Public API (also mirrored as window globals, for debugging/Playwright):
//   t(key, params) · getLanguage() · setLanguage(lang, opts) · applyStaticTranslations(root)
//   initI18n() · applyServerLanguage(lang) · setLoggedIn(bool) · setRenderHook(fn)
//   registerTranslations({de, en})

export const SUPPORTED = ["de", "en"];
export const FALLBACK = "en";
const LS_KEY = "ansimate-lang"; // only pre-login/offline cache; the profile is the source of truth

const G = (typeof window !== "undefined" ? window : globalThis);
const STATE = G.__ANSIMATE_I18N__ || (G.__ANSIMATE_I18N__ = {
    lang: FALLBACK,
    dict: { de: {}, en: {} },
    loggedIn: false,
    onChange: null,      // re-render hook that app.js sets (setRenderHook)
    switcherWired: false,
});

// --- Dictionary registration (the dict/*.js files call this via index.js) -------------------
export function registerTranslations(map) {
    if (!map) return;
    for (const lang of SUPPORTED) {
        if (map[lang]) Object.assign(STATE.dict[lang], map[lang]);
    }
}

// --- Lookup + Interpolation -----------------------------------------------------------------
export function t(key, params) {
    if (key == null) return "";
    let str = STATE.dict[STATE.lang] && STATE.dict[STATE.lang][key];
    if (str == null && STATE.lang !== FALLBACK) {
        str = STATE.dict[FALLBACK] && STATE.dict[FALLBACK][key];
    }
    if (str == null) {
        // Dev hint about a missing key; in normal operation there should be 0 misses.
        if (G.location && /localhost|127\.0\.0\.1/.test(G.location.hostname)) {
            console.warn("[i18n] missing key:", key, "(" + STATE.lang + ")");
        }
        return key;
    }
    if (params) {
        str = str.replace(/\{(\w+)\}/g, (m, name) =>
            (params[name] != null ? String(params[name]) : m));
    }
    return str;
}

export function getLanguage() { return STATE.lang; }

// : BCP-47 locale for the active language — for date/time/number formatting and
// localeCompare sorting, so they follow the chosen UI language (instead of a fixed "de-DE").
const LOCALE_MAP = { de: "de-DE", en: "en-GB" };
export function getLocale() { return LOCALE_MAP[STATE.lang] || "en-GB"; }

// --- Detection: profile -> localStorage cache -> navigator -> en ----------------------------
function normalizeTag(tag) { return String(tag || "").toLowerCase().split("-")[0]; }

export function detect(profileLang) {
    if (profileLang && SUPPORTED.includes(profileLang)) return profileLang;
    try {
        const cached = localStorage.getItem(LS_KEY);
        if (cached && SUPPORTED.includes(cached)) return cached;
    } catch (e) { /* localStorage may be blocked */ }
    try {
        const navs = (navigator.languages && navigator.languages.length)
            ? navigator.languages : [navigator.language];
        for (const n of navs) {
            const primary = normalizeTag(n);
            if (SUPPORTED.includes(primary)) return primary;
        }
    } catch (e) { /* navigator may be unavailable */ }
    return FALLBACK;
}

// --- Translate static HTML ------------------------------------------------------------------
const ATTR_MAP = [
    ["data-i18n-placeholder", "placeholder"],
    ["data-i18n-title", "title"],
    ["data-i18n-aria-label", "aria-label"],
    ["data-i18n-alt", "alt"],
];

export function applyStaticTranslations(root) {
    root = root || document;
    // textContent
    root.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        if (key) el.textContent = t(key);
    });
    // Attribute
    for (const [dataAttr, targetAttr] of ATTR_MAP) {
        root.querySelectorAll("[" + dataAttr + "]").forEach((el) => {
            const key = el.getAttribute(dataAttr);
            if (key) el.setAttribute(targetAttr, t(key));
        });
    }
}

// --- Language switch ------------------------------------------------------------------------
// opts: { persist=true, persistValue, cache=true }
//  - persist:    save server-side for a logged-in user (POST /api/profile/language)
//  - persistValue: what gets stored (for "Automatic" => null, while detect() applies locally)
//  - cache:      update the localStorage cache
export function setLanguage(lang, opts) {
    opts = opts || {};
    if (!SUPPORTED.includes(lang)) lang = detect(lang);
    STATE.lang = lang;
    try { document.documentElement.lang = lang; } catch (e) { /* noop */ }
    if (opts.cache !== false) {
        try { localStorage.setItem(LS_KEY, lang); } catch (e) { /* noop */ }
    }
    if (opts.persist !== false && STATE.loggedIn) {
        const value = (opts.persistValue !== undefined ? opts.persistValue : lang);
        try {
            fetch("/api/profile/language", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ language: value }),
            }).catch(() => { /* best-effort; the cookie session carries the auth */ });
        } catch (e) { /* noop */ }
    }
    applyStaticTranslations(document);
    updateSwitcherUI();
    if (typeof STATE.onChange === "function") {
        try { STATE.onChange(lang); } catch (e) { console.error("[i18n] render hook failed:", e); }
    }
}

export function setRenderHook(fn) { STATE.onChange = fn; }
export function setLoggedIn(v) { STATE.loggedIn = !!v; }

// On auth boot, adopt the server language (if set); marks the user as
// logged in so that later switches persist server-side.
export function applyServerLanguage(profileLang) {
    STATE.loggedIn = true;
    if (profileLang && SUPPORTED.includes(profileLang)) {
        if (profileLang !== STATE.lang) setLanguage(profileLang, { persist: false });
    }
    // profileLang == null => "Automatic": keep the already-detected language.
    updateProfileSelect(profileLang || "");
}

// --- Boot -----------------------------------------------------------------------------------
export function initI18n() {
    // As early as initTheme(): determine and apply the language from cache/browser (still without
    // server knowledge -> no persisting). After the auth boot, app.js calls applyServerLanguage().
    setLanguage(detect(null), { persist: false });
    wireSwitcher();
}

// --- Header switcher + profile select --------------------------------------
function currentBadge() { return STATE.lang.toUpperCase(); }

function updateSwitcherUI() {
    const btn = document.getElementById("lang-switch-btn");
    if (btn) {
        const badge = btn.querySelector(".lang-switch-badge");
        if (badge) badge.textContent = currentBadge();
        btn.setAttribute("aria-label", t("lang.switch"));
        btn.setAttribute("title", t("lang.switch"));
    }
    const menu = document.getElementById("lang-switch-menu");
    if (menu) {
        menu.querySelectorAll("[data-lang]").forEach((item) => {
            const active = item.getAttribute("data-lang") === STATE.lang;
            item.setAttribute("aria-checked", active ? "true" : "false");
            item.classList.toggle("active", active);
        });
    }
    updateProfileSelect(undefined);
}

function updateProfileSelect(value) {
    const sel = document.getElementById("profile-language-select");
    if (!sel) return;
    if (value === undefined) {
        // Only mirror the active value when the select is not set to "Automatic".
        if (sel.value !== "") sel.value = STATE.lang;
    } else {
        sel.value = value; // "" (Automatic) | "de" | "en"
    }
}

function closeMenu() {
    const menu = document.getElementById("lang-switch-menu");
    const btn = document.getElementById("lang-switch-btn");
    if (menu) menu.classList.add("hidden");
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClickForMenu, true);
}

function onDocClickForMenu(ev) {
    const menu = document.getElementById("lang-switch-menu");
    const btn = document.getElementById("lang-switch-btn");
    if (!menu || menu.classList.contains("hidden")) return;
    if (menu.contains(ev.target) || (btn && btn.contains(ev.target))) return;
    closeMenu();
}

function wireSwitcher() {
    if (STATE.switcherWired) return;
    STATE.switcherWired = true;

    const btn = document.getElementById("lang-switch-btn");
    const menu = document.getElementById("lang-switch-menu");
    if (btn && menu) {
        btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const willOpen = menu.classList.contains("hidden");
            if (willOpen) {
                menu.classList.remove("hidden");
                btn.setAttribute("aria-expanded", "true");
                document.addEventListener("click", onDocClickForMenu, true);
            } else {
                closeMenu();
            }
        });
        menu.querySelectorAll("[data-lang]").forEach((item) => {
            item.addEventListener("click", (ev) => {
                ev.preventDefault();
                const lang = item.getAttribute("data-lang");
                setLanguage(lang); // persists server-side if logged in
                // manual choice in the header -> the profile select follows (no longer "Automatic")
                updateProfileSelect(lang);
                closeMenu();
            });
        });
    }

    // Profile select
    const sel = document.getElementById("profile-language-select");
    if (sel) {
        sel.addEventListener("change", () => {
            const val = sel.value; // "" = Automatic
            if (val === "") {
                // Automatic: store null server-side, detect locally (without profile/cache
                // the browser would apply again -> explicitly prefer the browser here).
                setLanguage(detectBrowserOnly(), { persistValue: null });
            } else {
                setLanguage(val);
            }
            updateProfileSelect(val);
        });
    }

    updateSwitcherUI();
}

// "Automatic" should explicitly pick the browser language (not the localStorage cache
// from the previous manual choice), otherwise "Automatic" would not feel like a reset.
function detectBrowserOnly() {
    try {
        const navs = (navigator.languages && navigator.languages.length)
            ? navigator.languages : [navigator.language];
        for (const n of navs) {
            const primary = normalizeTag(n);
            if (SUPPORTED.includes(primary)) return primary;
        }
    } catch (e) { /* noop */ }
    return FALLBACK;
}

// Mirror window globals (debug/Playwright/legacy access).
G.t = t;
G.getLanguage = getLanguage;
G.getLocale = getLocale;
G.setLanguage = setLanguage;
G.applyStaticTranslations = applyStaticTranslations;
G.initI18n = initI18n;
G.i18n = {
    t, getLanguage, getLocale, setLanguage, applyStaticTranslations, initI18n,
    applyServerLanguage, setLoggedIn, setRenderHook, registerTranslations, detect, SUPPORTED,
};
