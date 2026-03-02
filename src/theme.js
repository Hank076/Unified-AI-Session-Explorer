export function getStoredThemeMode(storageValue) {
  if (storageValue === "light" || storageValue === "dark" || storageValue === "auto") {
    return storageValue;
  }
  return "auto";
}

export function resolveTheme({ mode, systemPrefersDark }) {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return systemPrefersDark ? "dark" : "light";
}

export function nextThemeMode(mode) {
  if (mode === "auto") return "light";
  if (mode === "light") return "dark";
  return "auto";
}

export function buildThemeDatasetValue(resolvedTheme) {
  return resolvedTheme === "light" ? "light" : "dark";
}
