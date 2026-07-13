// : i18n entry point. Registers ALL dictionary fragments (dict/*.js) with the
// engine and re-exports its public API. app.js imports only this file.
//
// Dictionaries are collected eagerly via import.meta.glob — every new dict/<area>.js
// is picked up automatically, WITHOUT any need to edit a shared file here (or anywhere
// else). That cleanly decouples the parallel content translation (–).
import { registerTranslations } from "./engine.js";

const modules = import.meta.glob("./dict/*.js", { eager: true });
for (const path in modules) {
    const mod = modules[path];
    const map = mod && (mod.default || mod);
    if (map && (map.de || map.en)) registerTranslations(map);
}

export {
    t,
    getLanguage,
    getLocale,
    setLanguage,
    applyStaticTranslations,
    initI18n,
    applyServerLanguage,
    setLoggedIn,
    setRenderHook,
    registerTranslations,
    detect,
    SUPPORTED,
    FALLBACK,
} from "./engine.js";
