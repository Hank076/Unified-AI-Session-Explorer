export const SUPPORTED_LOCALES = ["zh-Hant-TW", "en-US"];

const DEFAULT_LOCALE = "en-US";

const LOCALE_LABELS = {
  "zh-Hant-TW": "繁體中文",
  "en-US": "English",
};

const MESSAGES = {
  "zh-Hant-TW": {
    "app.name": "Claude Projects Browser",
    "app.subtitle": "瀏覽 ~/.claude/projects、會話與 MEMORY.md",
    "panel.projects": "專案",
    "panel.session": "會話",
    "panel.viewer": "檢視器",
    "viewer.timeline": "會話時間軸",
    "theme.mode": "色彩模式",
    "theme.auto": "跟隨系統",
    "theme.light": "淺色",
    "theme.dark": "深色",
    "language.label": "語系",
    "toggle.hideSystemEvents": "隱藏系統事件",
    "placeholder.select": "請先選擇專案與會話。",
    "placeholder.emptySession": "此會話目前沒有可顯示內容。",
    "status.loadingProjects": "正在載入專案...",
    "status.projectsLoaded": "已載入 {count} 個專案。",
    "status.loadingEntries": "正在載入會話...",
    "status.entriesLoaded": "已載入 {count} 筆項目。",
    "status.loadingContent": "正在載入內容...",
    "status.memoryLoaded": "已載入 MEMORY 檔案。",
    "status.sessionLoaded": "已載入會話。",
    "error.NOT_FOUND": "找不到指定路徑或檔案。",
    "error.READ_FAILED": "讀取失敗，請確認路徑與權限。",
    "error.PARSE_PARTIAL": "部分 JSONL 行解析失敗，僅顯示可用內容。",
    "error.unknown": "未知錯誤：{code}",
    "common.timeUnknown": "未知時間",
    "aria.projectsExplorer": "專案瀏覽器",
    "aria.resizeLeft": "調整專案與會話欄寬",
    "aria.resizeMiddle": "調整會話與檢視器欄寬",
  },
  "en-US": {
    "app.name": "Claude Projects Browser",
    "app.subtitle": "Browse ~/.claude/projects, sessions, and MEMORY.md",
    "panel.projects": "Projects",
    "panel.session": "Sessions",
    "panel.viewer": "Viewer",
    "viewer.timeline": "Session Timeline",
    "theme.mode": "Color mode",
    "theme.auto": "Follow system",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "language.label": "Language",
    "toggle.hideSystemEvents": "Hide system events",
    "placeholder.select": "Select a project and session to begin.",
    "placeholder.emptySession": "No visible content in this session.",
    "status.loadingProjects": "Loading projects...",
    "status.projectsLoaded": "Loaded {count} projects.",
    "status.loadingEntries": "Loading sessions...",
    "status.entriesLoaded": "Loaded {count} items.",
    "status.loadingContent": "Loading content...",
    "status.memoryLoaded": "MEMORY file loaded.",
    "status.sessionLoaded": "Session loaded.",
    "error.NOT_FOUND": "Target path or file not found.",
    "error.READ_FAILED": "Read failed. Verify path and permissions.",
    "error.PARSE_PARTIAL": "Some JSONL lines failed to parse. Showing available content.",
    "error.unknown": "Unknown error: {code}",
    "common.timeUnknown": "Unknown time",
    "aria.projectsExplorer": "Projects Explorer",
    "aria.resizeLeft": "Resize Projects and Sessions columns",
    "aria.resizeMiddle": "Resize Sessions and Viewer columns",
  },
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
