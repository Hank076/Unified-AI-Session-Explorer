import test from "node:test";
import assert from "node:assert/strict";
import {
  buildThemeDatasetValue,
  getStoredThemeMode,
  nextThemeMode,
  resolveTheme,
} from "../src/theme.js";

test("resolveTheme uses explicit light override", () => {
  assert.equal(resolveTheme({ mode: "light", systemPrefersDark: true }), "light");
});

test("resolveTheme uses explicit dark override", () => {
  assert.equal(resolveTheme({ mode: "dark", systemPrefersDark: false }), "dark");
});

test("resolveTheme follows system when auto", () => {
  assert.equal(resolveTheme({ mode: "auto", systemPrefersDark: true }), "dark");
  assert.equal(resolveTheme({ mode: "auto", systemPrefersDark: false }), "light");
});

test("getStoredThemeMode accepts auto value", () => {
  assert.equal(getStoredThemeMode("auto"), "auto");
});

test("getStoredThemeMode falls back to auto on invalid value", () => {
  assert.equal(getStoredThemeMode("x"), "auto");
});

test("nextThemeMode cycles auto -> light -> dark -> auto", () => {
  assert.equal(nextThemeMode("auto"), "light");
  assert.equal(nextThemeMode("light"), "dark");
  assert.equal(nextThemeMode("dark"), "auto");
});

test("buildThemeDatasetValue maps only light and dark", () => {
  assert.equal(buildThemeDatasetValue("light"), "light");
  assert.equal(buildThemeDatasetValue("dark"), "dark");
  assert.equal(buildThemeDatasetValue("unknown"), "dark");
});
