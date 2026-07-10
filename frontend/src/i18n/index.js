// : i18n-Einstiegspunkt. Registriert ALLE Woerterbuch-Fragmente (dict/*.js) an der
// Engine und re-exportiert deren oeffentliche API. app.js importiert nur diese Datei.
//
// Woerterbuecher werden per import.meta.glob eager eingesammelt — jede neue dict/<bereich>.js
// wird automatisch beruecksichtigt, OHNE dass hier (oder sonstwo) eine gemeinsame Datei
// editiert werden muss. Das entkoppelt die parallele Content-Uebersetzung (–) sauber.
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
