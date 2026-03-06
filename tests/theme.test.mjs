import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildThemeDatasetValue,
  getStoredThemeMode,
  nextThemeMode,
  resolveTheme,
} from "../src/theme.js";

function extractRootVariable(css, variableName) {
  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  assert.ok(rootMatch, "root block should exist");
  const variableMatch = rootMatch[1].match(
    new RegExp(`${variableName}\\s*:\\s*([^;]+);`),
  );
  assert.ok(variableMatch, `${variableName} should exist in root block`);
  return variableMatch[1].trim();
}

function extractLightVariable(css, variableName) {
  const lightMatch = css.match(/html\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);
  assert.ok(lightMatch, "light theme block should exist");
  const variableMatch = lightMatch[1].match(
    new RegExp(`${variableName}\\s*:\\s*([^;]+);`),
  );
  assert.ok(variableMatch, `${variableName} should exist in light theme block`);
  return variableMatch[1].trim();
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "").trim();
  const raw =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : normalized;
  const value = Number.parseInt(raw, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function channelToLinear(channel) {
  const value = channel / 255;
  if (value <= 0.03928) return value / 12.92;
  return ((value + 0.055) / 1.055) ** 2.4;
}

function getLuminance(colorHex) {
  const { r, g, b } = hexToRgb(colorHex);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

function getContrastRatio(foregroundHex, backgroundHex) {
  const foreground = getLuminance(foregroundHex);
  const background = getLuminance(backgroundHex);
  const lighter = Math.max(foreground, background);
  const darker = Math.min(foreground, background);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── theme logic ────────────────────────────────────────────────────────────

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

// ── CSS structure ──────────────────────────────────────────────────────────

test("light theme does not override layout-affecting variables", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const match = css.match(/html\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, "light theme block should exist");
  const lightBlock = match[1];

  const layoutVariables = [
    "--font-title:",
    "--font-ui:",
    "--panel-border-width:",
    "--control-border-width:",
    "--header-height:",
  ];

  for (const variable of layoutVariables) {
    assert.equal(
      lightBlock.includes(variable),
      false,
      `light theme should not override ${variable}`,
    );
  }
});

test("dark theme uses graphite blue-gray palette", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.equal(extractRootVariable(css, "--panel-border"), "#334155");
  assert.equal(extractRootVariable(css, "--panel-title"), "#93c5fd");
  assert.equal(extractRootVariable(css, "--accent"), "#60a5fa");
  assert.equal(extractRootVariable(css, "--viewer-bg"), "#020817");
});

test("spacing declarations follow the 4px/8px scale", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const lines = css.split(/\r?\n/);
  const declarationPattern = /^\s*([a-z-]+)\s*:\s*([^;]*\d+px[^;]*);/;
  const spacingPropertyPattern =
    /^(gap|padding|padding-left|padding-right|padding-top|padding-bottom|margin|margin-left|margin-right|margin-top|margin-bottom|border-radius|min-height|--viewer-row-height)$/;

  const disallowed = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(declarationPattern);
    if (!match) continue;
    const [, property, value] = match;
    if (!spacingPropertyPattern.test(property)) continue;

    const pxValues = [...value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((item) =>
      Math.abs(Number(item[1])),
    );
    const invalidValue = pxValues.find(
      (valuePx) => ![0, 1, 2, 4, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 999].includes(valuePx),
    );
    if (invalidValue !== undefined) {
      disallowed.push(`line ${index + 1}: ${property}: ${value}`);
    }
  }

  assert.deepEqual(disallowed, []);
});

test("styles include clreq-oriented zh-Hant rules", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /html:lang\(zh-Hant-TW\)/);
  assert.match(css, /line-break:\s*strict;/);
  assert.match(css, /word-break:\s*keep-all;/);
  assert.match(css, /hanging-punctuation:\s*allow-end;/);
});

// ── contrast: dark mode ────────────────────────────────────────────────────

test("dark theme viewer search placeholder meets WCAG AA contrast", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const foreground = extractRootVariable(css, "--viewer-search-icon");
  const background = extractRootVariable(css, "--viewer-search-bg");
  const ratio = getContrastRatio(foreground, background);

  assert.ok(
    ratio >= 4.5,
    `viewer search contrast should be >= 4.5, actual: ${ratio.toFixed(2)}`,
  );
});

test("dark theme --text-secondary meets contrast ratio on panel-bg", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const foreground = extractRootVariable(css, "--text-secondary");
  const background = extractRootVariable(css, "--viewer-meta-bg");
  const ratio = getContrastRatio(foreground, background);

  assert.ok(
    ratio >= 7,
    `text-secondary contrast should be >= 7:1 on panel-bg, actual: ${ratio.toFixed(2)}`,
  );
});

// ── a11y tokens ────────────────────────────────────────────────────────────

test("dark theme defines --accent-text with accessible lighter blue", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.equal(extractRootVariable(css, "--accent-text"), "#a8d0fc");
});

test("dark theme defines --accent-soft for overlay surfaces", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const value = extractRootVariable(css, "--accent-soft");
  assert.match(value, /^#[0-9a-f]{6}$/, "--accent-soft should be a hex color");
});

test("light theme defines --accent-soft for overlay surfaces", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const value = extractLightVariable(css, "--accent-soft");
  assert.match(value, /^#[0-9a-f]{6}$/, "--accent-soft light should be a hex color");
});

test("active filter toggle uses --accent-text instead of --accent", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const match = css.match(/\.hide-system-events-toggle\[aria-pressed="true"\]\s*\{([^}]*)\}/);
  assert.ok(match, "active toggle rule should exist");
  const rule = match[1];
  assert.match(rule, /color:\s*var\(--accent-text\)/, "pressed state should use --accent-text");
  assert.doesNotMatch(rule, /color:\s*var\(--accent\)[^-]/, "pressed state should not use bare --accent");
});

// ── font sizes ─────────────────────────────────────────────────────────────

test("no sub-minimum font sizes remain (10px or 11px)", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const lines = css.split(/\r?\n/);
  const violations = lines
    .map((line, i) => ({ line, num: i + 1 }))
    .filter(({ line }) => /font(-size)?:\s*(10|11)px/.test(line));

  assert.deepEqual(
    violations.map((v) => `line ${v.num}: ${v.line.trim()}`),
    [],
    "all font sizes should be >= 12px",
  );
});

test(".panel h2 font-size meets 14px minimum for non-caption headings", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const match = css.match(/\.panel h2\s*\{([^}]*)\}/);
  assert.ok(match, ".panel h2 rule should exist");
  const sizeMatch = match[1].match(/font-size:\s*(\d+)px/);
  assert.ok(sizeMatch, ".panel h2 should have an explicit font-size");
  const size = Number(sizeMatch[1]);
  assert.ok(size >= 14, `.panel h2 font-size should be >= 14px, got ${size}px`);
});
