import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_LOCALES,
  detectLocale,
  getLocaleLabel,
  getStoredLocale,
  t,
} from "../src/i18n.js";

test("supported locales list includes zh-Hant-TW and en-US", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["zh-Hant-TW", "en-US"]);
});

test("detectLocale prefers zh-Hant-TW and en-US for common inputs", () => {
  assert.equal(detectLocale("zh-TW"), "zh-Hant-TW");
  assert.equal(detectLocale("zh-Hant-TW"), "zh-Hant-TW");
  assert.equal(detectLocale("en"), "en-US");
  assert.equal(detectLocale("en-US"), "en-US");
});

test("getStoredLocale falls back to default for invalid locale", () => {
  assert.equal(getStoredLocale("fr-FR"), "en-US");
});

test("getLocaleLabel returns readable labels", () => {
  assert.equal(getLocaleLabel("zh-Hant-TW"), "繁體中文");
  assert.equal(getLocaleLabel("en-US"), "English");
});

test("t resolves translated strings and fallback behavior", () => {
  assert.equal(t("zh-Hant-TW", "panel.session"), "對話");
  assert.equal(t("en-US", "panel.session"), "Sessions");
  assert.equal(t("en-US", "status.projectsLoaded", { count: 3 }), "Loaded 3 projects.");
  assert.equal(t("fr-FR", "panel.session"), "Sessions");
});
