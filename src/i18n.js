import zhHantTW from "./locales/zh-Hant-TW.js";
import enUS from "./locales/en-US.js";

export const SUPPORTED_LOCALES = ["zh-Hant-TW", "en-US"];

const DEFAULT_LOCALE = "en-US";

const LOCALE_LABELS = {
  "zh-Hant-TW": "繁體中文",
  "en-US": "English",
};

const MESSAGES = {
  "zh-Hant-TW": zhHantTW,
  "en-US": enUS,
};

function normalizeLocale(value) {
  return String(value || "").trim();
}

export function detectLocale(value) {
  const locale = normalizeLocale(value).toLowerCase();
  if (locale.startsWith("zh")) return "zh-Hant-TW";
  if (locale.startsWith("en")) return "en-US";
  return DEFAULT_LOCALE;
}

export function getStoredLocale(value) {
  const locale = normalizeLocale(value);
  return SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

export function getLocaleLabel(locale) {
  return LOCALE_LABELS[locale] || LOCALE_LABELS[DEFAULT_LOCALE];
}

export function t(locale, key, params = {}) {
  const safeLocale = getStoredLocale(locale);
  const template = MESSAGES[safeLocale]?.[key] || MESSAGES[DEFAULT_LOCALE]?.[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (_, token) => {
    const value = params[token];
    return value === undefined || value === null ? "" : String(value);
  });
}
