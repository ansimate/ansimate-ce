// : schlanke i18n-Mechanik ohne Framework. Wird von app.js (und, cloud-only, von
// billing.js) importiert; app.js ist eine grosse, per Vite gebuendelte IIFE. Da der dynamische
// Billing-Import als eigener Chunk emittiert wird, haelt die Engine ihren State als Singleton am
// window-Objekt (__ANSIMATE_I18N__) — so teilen sich Haupt-Bundle und Billing-Chunk garantiert
// EINE Sprache + EIN Woerterbuch, egal wie Vite die Module aufteilt.
//
// Oeffentliche API (auch als window-Globals gespiegelt, fuers Debugging/Playwright):
//   t(key, params) · getLanguage() · setLanguage(lang, opts) · applyStaticTranslations(root)
//   initI18n() · applyServerLanguage(lang) · setLoggedIn(bool) · setRenderHook(fn)
//   registerTranslations({de, en})

export const SUPPORTED = ["de", "en"];
export const FALLBACK = "en";
const LS_KEY = "ansimate-lang"; // nur Vor-Login-/Offline-Cache; Quelle der Wahrheit ist das Profil

const G = (typeof window !== "undefined" ? window : globalThis);
const STATE = G.__ANSIMATE_I18N__ || (G.__ANSIMATE_I18N__ = {
    lang: FALLBACK,
    dict: { de: {}, en: {} },
    loggedIn: false,
    onChange: null,      // Re-Render-Hook, den app.js setzt (setRenderHook)
    switcherWired: false,
});

// --- Woerterbuch-Registrierung (die dict/*.js-Dateien rufen dies via index.js auf) ----------
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
        // Dev-Hinweis auf fehlenden Key; im Normalbetrieb sollen 0 Misses auftreten.
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

// : BCP-47-Locale zur aktiven Sprache — fuer Datums-/Zeit-/Zahl-Formatierung und
// localeCompare-Sortierung, damit diese der gewaehlten UI-Sprache folgen (statt fest "de-DE").
const LOCALE_MAP = { de: "de-DE", en: "en-GB" };
export function getLocale() { return LOCALE_MAP[STATE.lang] || "en-GB"; }

// --- Detection: Profil -> localStorage-Cache -> navigator -> en ------------------------------
function normalizeTag(tag) { return String(tag || "").toLowerCase().split("-")[0]; }

export function detect(profileLang) {
    if (profileLang && SUPPORTED.includes(profileLang)) return profileLang;
    try {
        const cached = localStorage.getItem(LS_KEY);
        if (cached && SUPPORTED.includes(cached)) return cached;
    } catch (e) { /* localStorage evtl. blockiert */ }
    try {
        const navs = (navigator.languages && navigator.languages.length)
            ? navigator.languages : [navigator.language];
        for (const n of navs) {
            const primary = normalizeTag(n);
            if (SUPPORTED.includes(primary)) return primary;
        }
    } catch (e) { /* navigator evtl. nicht verfuegbar */ }
    return FALLBACK;
}

// --- Statisches HTML uebersetzen ------------------------------------------------------------
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

// --- Sprachwechsel --------------------------------------------------------------------------
// opts: { persist=true, persistValue, cache=true }
//  - persist:    bei eingeloggtem Nutzer serverseitig speichern (POST /api/profile/language)
//  - persistValue: was gespeichert wird (fuer "Automatisch" => null, waehrend lokal detect() gilt)
//  - cache:      localStorage-Cache aktualisieren
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
            }).catch(() => { /* best-effort; Cookie-Session traegt die Auth */ });
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

// Beim Auth-Boot die Serversprache uebernehmen (falls gesetzt); markiert den Nutzer als
// eingeloggt, damit spaetere Wechsel serverseitig persistieren.
export function applyServerLanguage(profileLang) {
    STATE.loggedIn = true;
    if (profileLang && SUPPORTED.includes(profileLang)) {
        if (profileLang !== STATE.lang) setLanguage(profileLang, { persist: false });
    }
    // profileLang == null => "Automatisch": bereits detektierte Sprache beibehalten.
    updateProfileSelect(profileLang || "");
}

// --- Boot -----------------------------------------------------------------------------------
export function initI18n() {
    // So frueh wie initTheme(): Sprache aus Cache/Browser bestimmen und anwenden (noch ohne
    // Serverwissen -> kein Persistieren). Nach dem Auth-Boot ruft app.js applyServerLanguage().
    setLanguage(detect(null), { persist: false });
    wireSwitcher();
}

// --- Header-Switcher + Profil-Select ---------------------------------------
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
        // Nur den aktiven Wert spiegeln, wenn das Select nicht auf "Automatisch" steht.
        if (sel.value !== "") sel.value = STATE.lang;
    } else {
        sel.value = value; // "" (Automatisch) | "de" | "en"
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
                setLanguage(lang); // persistiert serverseitig, falls eingeloggt
                // manuelle Wahl im Header -> Profil-Select folgt (kein "Automatisch" mehr)
                updateProfileSelect(lang);
                closeMenu();
            });
        });
    }

    // Profil-Select
    const sel = document.getElementById("profile-language-select");
    if (sel) {
        sel.addEventListener("change", () => {
            const val = sel.value; // "" = Automatisch
            if (val === "") {
                // Automatisch: serverseitig null speichern, lokal detektieren (ohne Profil/Cache
                // wuerde erneut der Browser greifen -> hier explizit Browser bevorzugen).
                setLanguage(detectBrowserOnly(), { persistValue: null });
            } else {
                setLanguage(val);
            }
            updateProfileSelect(val);
        });
    }

    updateSwitcherUI();
}

// "Automatisch" soll ausdruecklich die Browsersprache waehlen (nicht den localStorage-Cache
// der vorherigen manuellen Wahl), sonst fuehlt sich "Automatisch" nicht zuruecksetzend an.
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

// window-Globals spiegeln (Debug/Playwright/legacy-Zugriff).
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
