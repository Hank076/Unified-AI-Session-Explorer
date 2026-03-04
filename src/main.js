import {
  buildThemeDatasetValue,
  getStoredThemeMode,
  resolveTheme,
} from "./theme.js";
import {
  SUPPORTED_LOCALES,
  detectLocale,
  getLocaleLabel,
  getStoredLocale,
  t,
} from "./i18n.js";

const { invoke } = window.__TAURI__.core;

const TECH_PREVIEW_COUNT = 20;
const CHAT_PREVIEW_LENGTH = 380;
const THEME_STORAGE_KEY = "claude_history_theme_mode";
const LOCALE_STORAGE_KEY = "claude_history_locale";

const state = {
  projects: [],
  projectSearchQuery: "",
  entries: [],
  selectedProjectPath: "",
  selectedEntryPath: "",
  selectedEntryType: "",
  timelineItems: [],
  parseErrors: [],
  parseErrorCode: "",
  hideSystemEvents: false,
  techViewState: {},
  entryExpandState: {},
  themeMode: "auto",
  resolvedTheme: "dark",
  locale: "en-US",
};

const refs = {
  panelGrid: null,
  projectsPanel: null,
  entriesPanel: null,
  resizerLeft: null,
  resizerMiddle: null,
  projectsList: null,
  projectsSearchInput: null,
  entriesList: null,
  viewerTitle: null,
  viewerMeta: null,
  viewerContent: null,
  status: null,
  hideSystemEventsToggle: null,
  hideSystemEventsWrap: null,
  pathTooltip: null,
  themeButtons: [],
  localeSelect: null,
};

function tt(key, params) {
  return t(state.locale, key, params);
}

function applyStaticTranslations() {
  document.documentElement.lang = state.locale;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    const key = node.getAttribute("data-i18n");
    if (!key) continue;
    node.textContent = tt(key);
  }
  for (const node of document.querySelectorAll("[data-i18n-aria-label]")) {
    const key = node.getAttribute("data-i18n-aria-label");
    if (!key) continue;
    node.setAttribute("aria-label", tt(key));
  }
}

function setStatus(message, type = "info") {
  refs.status.textContent = message || "";
  refs.status.dataset.type = type;
}

function formatError(code) {
  if (code === "NOT_FOUND") return tt("error.NOT_FOUND");
  if (code === "READ_FAILED") return tt("error.READ_FAILED");
  if (code === "PARSE_PARTIAL") return tt("error.PARSE_PARTIAL");
  return tt("error.unknown", { code });
}

function clearViewer() {
  state.timelineItems = [];
  state.parseErrors = [];
  state.parseErrorCode = "";
  state.techViewState = {};
  refs.viewerTitle.textContent = tt("panel.viewer");
  refs.viewerMeta.textContent = "";
  setHideSystemEventsVisible(true);
  refs.viewerContent.innerHTML = `<p class="placeholder">${escapeHtml(tt("placeholder.select"))}</p>`;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function decodeProjectLabel(encodedName) {
  const isWindows = navigator.platform.toLowerCase().includes("win");
  const separator = isWindows ? "\\" : "/";

  const driveMatch = encodedName.match(/^([A-Za-z])--(.+)$/);
  if (driveMatch) {
    const drive = `${driveMatch[1]}:${separator}`;
    const rest = driveMatch[2]
      .split("-")
      .filter(Boolean)
      .join(separator);
    return `${drive}${rest}`;
  }

  return encodedName
    .split("-")
    .filter(Boolean)
    .join(separator);
}

function normalizeDisplayPath(path) {
  const isWindows = navigator.platform.toLowerCase().includes("win");
  let value = String(path || "");
  if (isWindows) {
    value = value.replace(/^\\\\\?\\/, "");
    value = value.replace(/^\/\/\?\//, "");
    return value.replaceAll("/", "\\");
  }
  return value.replaceAll("\\", "/");
}

function detectHomePrefix(path) {
  const value = normalizeDisplayPath(path);
  const windowsMatch = value.match(/^[A-Za-z]:\\Users\\[^\\]+/);
  if (windowsMatch) return windowsMatch[0];
  const unixMatch = value.match(/^\/(?:home|Users)\/[^/]+/);
  if (unixMatch) return unixMatch[0];
  return "";
}

function abbreviateHomePath(path) {
  const value = normalizeDisplayPath(path);
  const homePrefix = detectHomePrefix(value);
  if (!homePrefix) return value;
  if (!value.startsWith(homePrefix)) return value;
  const suffix = value.slice(homePrefix.length);
  return suffix ? `~${suffix}` : "~";
}

function getProjectDisplayName(project) {
  const rawName = String(project?.name || "").trim();
  if (rawName) return rawName;

  const normalizedPath = normalizeDisplayPath(project?.path || "");
  const parts = normalizedPath.split(/[\\/]/).filter(Boolean);
  if (parts.length > 0) return parts[parts.length - 1];

  const decoded = decodeProjectLabel(String(project?.name || ""));
  const decodedParts = normalizeDisplayPath(decoded).split(/[\\/]/).filter(Boolean);
  if (decodedParts.length > 0) return decodedParts[decodedParts.length - 1];
  return decoded || tt("panel.projects");
}

function doesProjectMatchSearch(project, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return true;

  const name = getProjectDisplayName(project).toLowerCase();
  const preferredPath = normalizeDisplayPath(
    project?.cwdPath || decodeProjectLabel(String(project?.name || "")),
  ).toLowerCase();
  const abbreviatedPath = abbreviateHomePath(preferredPath).toLowerCase();
  return (
    name.includes(normalizedQuery) ||
    preferredPath.includes(normalizedQuery) ||
    abbreviatedPath.includes(normalizedQuery)
  );
}

function updateProjectSearchTexts() {
  if (!refs.projectsSearchInput) return;
  refs.projectsSearchInput.placeholder = tt("project.searchPlaceholder");
  refs.projectsSearchInput.setAttribute("aria-label", tt("project.searchAria"));
}

function getSystemPrefersDark() {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? true;
  } catch {
    return true;
  }
}

function readThemeMode() {
  try {
    return getStoredThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

function saveThemeMode(mode) {
  try {
    if (mode === "auto") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    // Ignore storage errors and keep runtime-only setting.
  }
}

function updateThemeButtons() {
  for (const button of refs.themeButtons) {
    const active = button.dataset.themeMode === state.themeMode;
    button.dataset.active = active ? "true" : "false";
    button.setAttribute("aria-checked", active ? "true" : "false");
  }
}

function resolveAndApplyTheme() {
  const resolvedTheme = resolveTheme({
    mode: state.themeMode,
    systemPrefersDark: getSystemPrefersDark(),
  });
  const datasetValue = buildThemeDatasetValue(resolvedTheme);
  document.documentElement.dataset.theme = datasetValue;
  state.resolvedTheme = datasetValue;
  updateThemeButtons();
}

function setThemeMode(mode, { persist = true } = {}) {
  state.themeMode = getStoredThemeMode(mode);
  if (persist) saveThemeMode(state.themeMode);
  resolveAndApplyTheme();
}

function initThemeMode() {
  state.themeMode = readThemeMode();
  resolveAndApplyTheme();

  let mediaQuery = null;
  try {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    mediaQuery = null;
  }
  if (!mediaQuery) return;

  const onSystemThemeChange = () => {
    if (state.themeMode === "auto") {
      resolveAndApplyTheme();
    }
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", onSystemThemeChange);
  } else if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(onSystemThemeChange);
  }
}

function readLocale() {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved) return getStoredLocale(saved);
  } catch {
    // Ignore storage errors and use runtime locale.
  }
  return detectLocale(navigator.language);
}

function saveLocale(locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage errors and keep runtime-only setting.
  }
}

function setLocale(locale, { persist = true } = {}) {
  state.locale = getStoredLocale(locale);
  if (persist) saveLocale(state.locale);
  if (refs.localeSelect) refs.localeSelect.value = state.locale;
  applyStaticTranslations();
  updateProjectSearchTexts();
  renderProjects();
  renderEntries();
  if (!state.selectedEntryPath) clearViewer();
}

function initLocaleSelector() {
  if (!refs.localeSelect) return;
  refs.localeSelect.innerHTML = "";
  for (const locale of SUPPORTED_LOCALES) {
    const option = document.createElement("option");
    option.value = locale;
    option.textContent = getLocaleLabel(locale);
    refs.localeSelect.append(option);
  }
  setLocale(readLocale(), { persist: false });
  refs.localeSelect.addEventListener("change", (event) => {
    setLocale(event.target.value, { persist: true });
  });
}

function isMarkdownPath(path) {
  return /\.md$/i.test(String(path || "").trim());
}

function bindPathHover(element, text, options = {}) {
  if (!element || !refs.pathTooltip) return;
  const displayPath = String(text || "");
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 0;
  let timerId = null;

  const showNow = (event) => {
    refs.pathTooltip.hidden = false;
    refs.pathTooltip.textContent = displayPath;
    move(event);
  };
  const show = (event) => {
    if (timerId) window.clearTimeout(timerId);
    if (delayMs <= 0) {
      showNow(event);
      return;
    }
    timerId = window.setTimeout(() => {
      showNow(event);
      timerId = null;
    }, delayMs);
  };
  const hide = () => {
    if (timerId) {
      window.clearTimeout(timerId);
      timerId = null;
    }
    refs.pathTooltip.hidden = true;
  };
  const move = (event) => {
    if (!event || refs.pathTooltip.hidden) return;
    const offset = 14;
    refs.pathTooltip.style.left = `${event.clientX + offset}px`;
    refs.pathTooltip.style.top = `${event.clientY + offset}px`;
  };

  element.addEventListener("mouseenter", show);
  element.addEventListener("mousemove", move);
  element.addEventListener("mouseleave", hide);
  element.addEventListener("blur", hide);
}

function setHideSystemEventsVisible(visible) {
  if (!refs.hideSystemEventsWrap) return;
  refs.hideSystemEventsWrap.style.display = visible ? "inline-flex" : "none";
  refs.hideSystemEventsWrap.setAttribute("aria-hidden", visible ? "false" : "true");
}

function renderProjects() {
  refs.projectsList.innerHTML = "";
  const visibleProjects = state.projects.filter((project) =>
    doesProjectMatchSearch(project, state.projectSearchQuery),
  );
  for (const project of visibleProjects) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.className = "list-btn project-btn";
    if (state.selectedProjectPath === project.path) button.dataset.active = "true";
    const displayName = getProjectDisplayName(project);
    const sourcePath = project.cwdPath || project.path;
    const fullPath = normalizeDisplayPath(sourcePath);
    const displayPath = abbreviateHomePath(sourcePath);

    const nameNode = createElement("div", "project-name", displayName);
    const pathNode = createElement("div", "project-path", displayPath);
    button.append(nameNode, pathNode);
    bindPathHover(button, fullPath, { delayMs: 1600 });
    button.addEventListener("click", () => selectProject(project.path));
    li.appendChild(button);
    refs.projectsList.appendChild(li);
  }

  if (visibleProjects.length === 0) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = tt("project.empty");
    refs.projectsList.appendChild(empty);
  }
}

function formatEntryTime(modifiedMs) {
  if (!Number.isFinite(modifiedMs)) return tt("common.timeUnknown");
  const date = new Date(modifiedMs);
  if (Number.isNaN(date.getTime())) return tt("common.timeUnknown");
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
}

function formatBytes(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "-";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = sizeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function renderEntries() {
  refs.entriesList.innerHTML = "";
  const memoryEntries = state.entries
    .filter((entry) => entry.entryType === "memory_file")
    .sort((a, b) => {
      const aIsMain = isTopMemoryFile(a.path, a.label);
      const bIsMain = isTopMemoryFile(b.path, b.label);
      if (aIsMain !== bIsMain) return aIsMain ? -1 : 1;
      return String(a.label || "").localeCompare(String(b.label || ""), "zh-TW");
    });
  const sessionEntries = state.entries.filter((entry) => entry.entryType === "session");
  const subagentsByParent = new Map();

  for (const entry of state.entries) {
    if (entry.entryType !== "subagent_session" || !entry.parentSession) continue;
    if (!subagentsByParent.has(entry.parentSession)) {
      subagentsByParent.set(entry.parentSession, []);
    }
    subagentsByParent.get(entry.parentSession).push(entry);
  }

  if (memoryEntries.length > 0) {
    refs.entriesList.appendChild(
      createEntriesSectionTitle(tt("panel.memoryFiles"), memoryEntries.length, "memory"),
    );
  }

  for (const entry of memoryEntries) {
    const li = document.createElement("li");
    li.appendChild(createEntryButton(entry, { primaryText: entry.label }));
    refs.entriesList.appendChild(li);
  }

  if (memoryEntries.length > 0 && sessionEntries.length > 0) {
    const divider = document.createElement("li");
    divider.className = "entries-divider";
    divider.setAttribute("aria-hidden", "true");
    refs.entriesList.appendChild(divider);
  }

  if (sessionEntries.length > 0) {
    refs.entriesList.appendChild(
      createEntriesSectionTitle(`${tt("panel.session")} FILES`, sessionEntries.length, "sessions"),
    );
  }

  for (const entry of sessionEntries) {
    const sessionStem = String(entry.label || "").replace(/\.jsonl$/i, "");
    const children = subagentsByParent.get(sessionStem) || [];
    const hasChildren = children.length > 0;
    const expanded = hasChildren ? Boolean(state.entryExpandState[sessionStem]) : false;

    const li = document.createElement("li");
    const row = createElement("div", "entry-row");
    if (hasChildren) row.dataset.hasChildren = "true";

    row.appendChild(createEntryButton(entry, { hasChildren }));
    if (hasChildren) {
      const toggle = createElement("button", "entry-toggle", expanded ? "▾" : "▸");
      toggle.type = "button";
      toggle.title = expanded ? tt("action.collapseSubagent") : tt("action.expandSubagent");
      toggle.setAttribute("aria-label", toggle.title);
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.entryExpandState[sessionStem] = !expanded;
        renderEntries();
      });
      row.appendChild(toggle);
    }
    li.appendChild(row);
    refs.entriesList.appendChild(li);

    if (!expanded) continue;
    for (const child of children) {
      const childLi = document.createElement("li");
      childLi.className = "entry-child-item";
      childLi.appendChild(
        createEntryButton(child, {
          primaryText: tt("entry.childPrefix", { time: formatEntryTime(child.modifiedMs) }),
          isSubagent: true,
        }),
      );
      refs.entriesList.appendChild(childLi);
    }
  }
}

function createEntriesSectionTitle(title, count, iconName = "") {
  const item = document.createElement("li");
  item.className = "entries-section-title";
  if (iconName) item.classList.add(`entries-section-title--${iconName}`);
  item.setAttribute("aria-hidden", "true");

  const headingWrap = createElement("span", "entries-section-heading-wrap");
  const icon = createSectionIcon(iconName);
  if (icon) headingWrap.appendChild(icon);
  headingWrap.append(createElement("span", "entries-section-heading", title));
  const badge = createElement("span", "entries-section-badge", String(count));
  item.append(headingWrap, badge);
  return item;
}

function createSectionIcon(name) {
  const iconName = String(name || "").toLowerCase();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("entries-section-icon");
  if (iconName) svg.classList.add(`entries-section-icon--${iconName}`);

  const addPath = (d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  };

  if (iconName === "memory") {
    addPath("M8.5 8.5a3.5 3.5 0 0 1 7 0");
    addPath("M8 8H6.8A2.8 2.8 0 0 0 4 10.8v2.6A2.6 2.6 0 0 0 6.6 16H8");
    addPath("M16 8h1.4a2.6 2.6 0 0 1 2.6 2.6v2.8a2.6 2.6 0 0 1-2.6 2.6H16");
    addPath("M12 6.3v2.1");
    addPath("M8 11h2");
    addPath("M14 11h2");
    addPath("M12 15.2v2.5");
    addPath("M10.5 18h3");
    return svg;
  }

  if (iconName === "sessions") {
    addPath("M12.8 3.1a1.4 1.4 0 0 0-1.6 0L3 8l8.2 4.9a1.4 1.4 0 0 0 1.6 0L21 8z");
    addPath("m3.2 11.2 8 4.8a1.4 1.4 0 0 0 1.6 0l8-4.8");
    addPath("m3.2 14.8 8 4.8a1.4 1.4 0 0 0 1.6 0l8-4.8");
    return svg;
  }

  return null;
}

function createEntryButton(
  entry,
  {
    primaryText = formatEntryTime(entry.modifiedMs),
    typeLabel = "",
    isSubagent = false,
    hasChildren = false,
  } = {},
) {
  const button = document.createElement("button");
  button.className = "list-btn entry-btn";
  button.dataset.entryType = entry.entryType;
  button.dataset.subagent = isSubagent ? "true" : "false";
  if (hasChildren) button.dataset.hasChildren = "true";

  const secondaryParts = [formatBytes(entry.sizeBytes)];
  if (typeLabel) secondaryParts.push(typeLabel);

  const primary = createElement("div", "entry-primary", primaryText);
  const secondary = createElement("div", "entry-secondary", secondaryParts.join(" · "));
  button.append(primary, secondary);

  bindPathHover(button, entry.label, { delayMs: 1600 });
  if (state.selectedEntryPath === entry.path) button.dataset.active = "true";
  button.addEventListener("click", () => selectEntry(entry));
  return button;
}

function isTopMemoryFile(path, label) {
  const fileName = String(label || "").toLowerCase();
  if (fileName !== "memory.md") return false;
  return /[\\/]memory[\\/]memory\.md$/i.test(String(path || ""));
}

function renderMemory(payload) {
  const fileName = String(payload.path || "").split(/[\\/]/).pop() || "memory";
  refs.viewerTitle.textContent = fileName;
  refs.viewerMeta.textContent = normalizeDisplayPath(payload.path);
  refs.viewerContent.innerHTML = `<pre class="memory-block">${escapeHtml(payload.content)}</pre>`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "-";
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return String(timestamp);
  return value.toLocaleString("zh-TW", { hour12: false });
}

function truncateText(text, limit = 380) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
}

function extractCommandDisplay(text) {
  const source = String(text || "");
  const commandName = source.match(/<command-name>([\s\S]*?)<\/command-name>/i)?.[1]?.trim();
  const commandArgs = source.match(/<command-args>([\s\S]*?)<\/command-args>/i)?.[1]?.trim();
  const parts = [commandName, commandArgs].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(" ");
}

function extractTextFromUnknown(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text.trim();
  if (typeof value.content === "string") return value.content.trim();
  return "";
}

function normalizeContentItems(content) {
  if (Array.isArray(content)) return content;
  if (content && typeof content === "object") return [content];
  return [];
}

function parseAskUserQuestions(input) {
  const rawQuestions = input?.questions;
  if (Array.isArray(rawQuestions)) return rawQuestions;
  if (typeof rawQuestions === "string") {
    try {
      const parsed = JSON.parse(rawQuestions);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

function buildToolUseDetail(item) {
  if (!item || item.type !== "tool_use") return null;
  const toolName = String(item.name || "unknown");
  const input = item.input && typeof item.input === "object" ? item.input : {};
  const fallbackInput = [tt("tool.fallback.input")];

  if (toolName === "AskUserQuestion") {
    const questions = parseAskUserQuestions(input);
    const lines = [];
    for (const q of questions) {
      const question = typeof q?.question === "string" ? q.question.trim() : "";
      if (question) lines.push(tt("tool.label.question", { text: question }));
      if (Array.isArray(q?.options) && q.options.length > 0) {
        const labels = q.options
          .map((opt) => (typeof opt?.label === "string" ? opt.label.trim() : ""))
          .filter(Boolean);
        if (labels.length > 0) {
          lines.push(tt("tool.label.options", { options: labels.join(" / ") }));
        }
      }
    }
    return {
      toolName,
      title: tt("tool.askUserQuestion.title"),
      lines: lines.length > 0 ? lines : [tt("tool.fallback.questions")],
    };
  }

  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const lines = [];
    if (description) lines.push(tt("tool.label.description", { text: description }));
    if (command) lines.push(tt("tool.label.command", { text: command }));
    return {
      toolName,
      title: tt("tool.bash.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "Read") {
    const filePath = typeof input.file_path === "string" ? input.file_path.trim() : "";
    const offset = Number.isFinite(input.offset) ? input.offset : null;
    const limit = Number.isFinite(input.limit) ? input.limit : null;
    const lines = [];
    if (filePath) lines.push(tt("tool.label.file", { text: filePath }));
    if (offset !== null || limit !== null) {
      lines.push(
        tt("tool.label.range", {
          offset: offset ?? 0,
          limit: limit ?? "auto",
        }),
      );
    }
    return {
      toolName,
      title: tt("tool.read.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "TaskCreate") {
    const activeForm = typeof input.activeForm === "string" ? input.activeForm.trim() : "";
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    const description =
      typeof input.description === "string" ? input.description.trim() : "";
    const lines = [];
    if (activeForm) lines.push(tt("tool.label.phase", { text: activeForm }));
    if (subject) lines.push(tt("tool.label.subject", { text: subject }));
    if (description) lines.push(tt("tool.label.description", { text: description }));
    return {
      toolName,
      title: tt("tool.taskCreate.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "Glob") {
    const pattern = typeof input.pattern === "string" ? input.pattern.trim() : "";
    const path = typeof input.path === "string" ? input.path.trim() : "";
    const lines = [];
    if (pattern) lines.push(tt("tool.label.pattern", { text: pattern }));
    if (path) lines.push(tt("tool.label.path", { text: path }));
    return {
      toolName,
      title: tt("tool.glob.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "Grep") {
    const pattern = typeof input.pattern === "string" ? input.pattern.trim() : "";
    const path = typeof input.path === "string" ? input.path.trim() : "";
    const glob = typeof input.glob === "string" ? input.glob.trim() : "";
    const lines = [];
    if (pattern) lines.push(tt("tool.label.pattern", { text: pattern }));
    if (path) lines.push(tt("tool.label.path", { text: path }));
    if (glob) lines.push(tt("tool.label.glob", { text: glob }));
    return {
      toolName,
      title: tt("tool.grep.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "TaskUpdate") {
    const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
    const status = typeof input.status === "string" ? input.status.trim() : "";
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    const description =
      typeof input.description === "string" ? input.description.trim() : "";
    const activeForm = typeof input.activeForm === "string" ? input.activeForm.trim() : "";
    const lines = [];
    if (taskId) lines.push(tt("tool.label.taskId", { text: taskId }));
    if (status) lines.push(tt("tool.label.status", { text: status }));
    if (activeForm) lines.push(tt("tool.label.phase", { text: activeForm }));
    if (subject) lines.push(tt("tool.label.subject", { text: subject }));
    if (description) lines.push(tt("tool.label.description", { text: description }));
    return {
      toolName,
      title: tt("tool.taskUpdate.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "TaskList") {
    const filter = typeof input.filter === "string" ? input.filter.trim() : "";
    const status = typeof input.status === "string" ? input.status.trim() : "";
    const lines = [];
    if (filter) lines.push(tt("tool.label.filter", { text: filter }));
    if (status) lines.push(tt("tool.label.status", { text: status }));
    return {
      toolName,
      title: tt("tool.taskList.title"),
      lines: lines.length > 0 ? lines : [tt("tool.fallback.taskList")],
    };
  }

  if (toolName === "TaskGet") {
    const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
    const id = typeof input.id === "string" ? input.id.trim() : "";
    const lines = [];
    if (taskId || id) lines.push(tt("tool.label.taskId", { text: taskId || id }));
    return {
      toolName,
      title: tt("tool.taskGet.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "Edit") {
    const filePath = typeof input.file_path === "string" ? input.file_path.trim() : "";
    const oldString = typeof input.old_string === "string" ? input.old_string.trim() : "";
    const newString = typeof input.new_string === "string" ? input.new_string.trim() : "";
    const lines = [];
    if (filePath) lines.push(tt("tool.label.file", { text: filePath }));
    if (oldString) lines.push(tt("tool.label.oldContent", { text: truncateText(oldString, 120) }));
    if (newString) lines.push(tt("tool.label.newContent", { text: truncateText(newString, 120) }));
    return {
      toolName,
      title: tt("tool.edit.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "Write") {
    const filePath = typeof input.file_path === "string" ? input.file_path.trim() : "";
    const content = typeof input.content === "string" ? input.content : "";
    const lines = [];
    if (filePath) lines.push(tt("tool.label.file", { text: filePath }));
    if (content) lines.push(tt("tool.label.contentLength", { count: content.length }));
    return {
      toolName,
      title: tt("tool.write.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "TaskOutput") {
    const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
    const shellId = typeof input.shellId === "string" ? input.shellId.trim() : "";
    const lines = [];
    if (taskId) lines.push(tt("tool.label.taskId", { text: taskId }));
    if (shellId) lines.push(tt("tool.label.shellId", { text: shellId }));
    return {
      toolName,
      title: tt("tool.taskOutput.title"),
      lines: lines.length > 0 ? lines : [tt("tool.fallback.taskOutput")],
    };
  }

  if (toolName === "Skill") {
    const skillName = typeof input.skillName === "string" ? input.skillName.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const skill = typeof input.skill === "string" ? input.skill.trim() : "";
    const lines = [];
    if (skillName || name || skill) {
      lines.push(tt("tool.label.skill", { text: skillName || name || skill }));
    }
    return {
      toolName,
      title: tt("tool.skill.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "Agent") {
    const task = typeof input.task === "string" ? input.task.trim() : "";
    const lines = [];
    if (task) lines.push(tt("tool.label.task", { text: truncateText(task, 180) }));
    return {
      toolName,
      title: tt("tool.agent.title"),
      lines: lines.length > 0 ? lines : [tt("tool.fallback.agent")],
    };
  }

  if (toolName === "WebSearch") {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    const domains = Array.isArray(input.domains) ? input.domains.join(", ") : "";
    const lines = [];
    if (query) lines.push(tt("tool.label.query", { text: query }));
    if (domains) lines.push(tt("tool.label.domains", { text: domains }));
    return {
      toolName,
      title: tt("tool.webSearch.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "WebFetch") {
    const url = typeof input.url === "string" ? input.url.trim() : "";
    const lines = [];
    if (url) lines.push(tt("tool.label.url", { text: url }));
    return {
      toolName,
      title: tt("tool.webFetch.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "MCPSearch") {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    const lines = [];
    if (query) lines.push(tt("tool.label.query", { text: query }));
    return {
      toolName,
      title: tt("tool.mcpSearch.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "KillShell") {
    const shellId = typeof input.shell_id === "string" ? input.shell_id.trim() : "";
    const lines = [];
    if (shellId) lines.push(tt("tool.label.shellId", { text: shellId }));
    return {
      toolName,
      title: tt("tool.killShell.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "ExitPlanMode") {
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const lines = [];
    if (reason) lines.push(tt("tool.label.reason", { text: reason }));
    return {
      toolName,
      title: tt("tool.exitPlanMode.title"),
      lines: lines.length > 0 ? lines : [tt("tool.fallback.exitPlanMode")],
    };
  }

  if (toolName === "NotebookEdit") {
    const notebookPath =
      typeof input.notebook_path === "string" ? input.notebook_path.trim() : "";
    const lines = [];
    if (notebookPath) lines.push(tt("tool.label.notebook", { text: notebookPath }));
    return {
      toolName,
      title: tt("tool.notebookEdit.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  if (toolName === "LSP") {
    const method = typeof input.method === "string" ? input.method.trim() : "";
    const path = typeof input.path === "string" ? input.path.trim() : "";
    const lines = [];
    if (method) lines.push(tt("tool.label.method", { text: method }));
    if (path) lines.push(tt("tool.label.path", { text: path }));
    return {
      toolName,
      title: tt("tool.lsp.title"),
      lines: lines.length > 0 ? lines : fallbackInput,
    };
  }

  return {
    toolName,
    title: tt("tool.default.title", { name: toolName }),
    lines: [tt("tool.fallback.default")],
  };
}

function extractToolResultDetail(item, index = 1) {
  const lines = [];
  if (!item || item.type !== "tool_result") return null;

  const content = item.content;
  if (typeof content === "string" && content.trim()) {
    lines.push(content.trim());
  } else if (Array.isArray(content)) {
    for (const sub of content) {
      if (typeof sub === "string" && sub.trim()) {
        lines.push(sub.trim());
      } else if (
        sub &&
        typeof sub === "object" &&
        typeof sub.text === "string" &&
        sub.text.trim()
      ) {
        lines.push(sub.text.trim());
      }
    }
  }

  if (lines.length === 0 && typeof content === "object" && content !== null) {
    lines.push(tt("tool.result.structured"));
  }

  return {
    title: tt("tool.result.title", { index }),
    lines: lines.length > 0 ? lines : [tt("tool.result.empty")],
  };
}


function extractChatOnlySummary(raw) {
  if (raw?.type === "tool_result") return "";

  const message = raw?.message;
  const content = message?.content ?? message;
  const chunks = [];

  if (typeof content === "string" && content.trim()) {
    chunks.push(content.trim());
  }

  const items = normalizeContentItems(content);
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
      chunks.push(item.text.trim());
    }
  }

  return chunks.join("\n").trim();
}

function extractToolTagNames(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag) => typeof tag === "string" && tag.startsWith("tool:"))
    .map((tag) => tag.slice(5))
    .filter(Boolean);
}

function extractTextSummary(raw, resultsMap = null) {
  const message = raw?.message;
  const content = message?.content ?? message;
  const textChunks = [];
  const tags = [];
  let toolUseCount = 0;
  let thinkingCount = 0;
  const toolNames = new Set();
  const thinkingDetails = [];
  const toolUseDetails = [];
  const toolResultDetails = [];

  if (typeof content === "string" && content.trim()) {
    textChunks.push(content.trim());
  }

  const contentItems = normalizeContentItems(content);
  for (const item of contentItems) {
    if (!item || typeof item !== "object") continue;

    if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
      textChunks.push(item.text.trim());
    }

    if (item.type === "thinking" && typeof item.thinking === "string" && item.thinking.trim()) {
      thinkingDetails.push(item.thinking.trim());
    }

    if (item.type === "tool_result") {
      tags.push("tool_result");
      const detail = extractToolResultDetail(item, toolResultDetails.length + 1);
      if (detail) toolResultDetails.push(detail);
    }

    if (item.type === "thinking") {
      thinkingCount += 1;
      tags.push("thinking");
    }
    if (item.type === "tool_use") {
      toolUseCount += 1;
      const toolName = item.name || "unknown";
      toolNames.add(String(toolName));
      tags.push(`tool:${toolName}`);
      const detail = buildToolUseDetail(item);
      if (detail) toolUseDetails.push(detail);

      // 嘗試關聯結果 (Tool Binding)
      if (resultsMap && item.id) {
        const resultItem = resultsMap.get(item.id);
        if (resultItem) {
          const resDetail = extractToolResultDetail(resultItem, toolResultDetails.length + 1);
          if (resDetail) toolResultDetails.push(resDetail);
          if (!tags.includes("tool_result")) tags.push("tool_result");
        }
      }
    }
  }

  if (
    textChunks.length === 0 &&
    message &&
    typeof message === "object" &&
    !Array.isArray(message)
  ) {
    const fallback = extractTextFromUnknown(message);
    if (fallback) textChunks.push(fallback);
  }

  if (textChunks.length === 0 && raw?.type === "tool_result") {
    tags.push("tool_result");
    const detail = extractToolResultDetail({ type: "tool_result", content: raw?.content }, 1);
    if (detail) toolResultDetails.push(detail);
  }

  const summary = textChunks.join("\n").trim();
  if (summary) {
    const commandDisplay = extractCommandDisplay(summary);
    return { summary: commandDisplay || summary, tags, thinkingDetails, toolUseDetails, toolResultDetails };
  }

  if (contentItems.some((item) => item.type === "tool_result")) {
    return {
      summary: tt("summary.toolResult"),
      tags,
      thinkingDetails,
      toolUseDetails,
      toolResultDetails,
    };
  }

  if (toolUseCount > 0) {
    const names = Array.from(toolNames).slice(0, 3).join(", ");
    const suffix = names
      ? tt("summary.toolUseNames", { names, more: toolNames.size > 3 ? "..." : "" })
      : "";
    return {
      summary: tt("summary.toolUseCount", { count: toolUseCount, suffix }),
      tags,
      thinkingDetails,
      toolUseDetails,
      toolResultDetails,
    };
  }

  if (thinkingCount > 0) {
    return {
      summary: tt("summary.thinking", { count: thinkingCount }),
      tags,
      thinkingDetails,
      toolUseDetails,
      toolResultDetails,
    };
  }

  return {
    summary: tt("summary.structuredEvent"),
    tags,
    thinkingDetails,
    toolUseDetails,
    toolResultDetails,
  };
}

function buildTechSummary(event) {
  const raw = event.raw || {};
  const rawType = raw.type || event.eventType || "unknown";

  if (rawType === "progress") {
    const dataType = raw.data?.type || "progress";
    if (dataType === "hook_progress") {
      const hookName = raw.data?.hookName || "unknown";
      return {
        subtype: dataType,
        summary: tt("tech.hookProgress", { name: hookName }),
      };
    }
    if (dataType === "bash_progress") {
      const lines = raw.data?.totalLines;
      if (typeof lines === "number") {
        return {
          subtype: dataType,
          summary: tt("tech.bashProgress", { count: lines }),
        };
      }
      return {
        subtype: dataType,
        summary: tt("tech.bashProgressUpdate"),
      };
    }
    return {
      subtype: dataType,
      summary: tt("tech.progressUpdate", { type: dataType }),
    };
  }

  if (rawType === "system") {
    const subtype = raw.subtype || "system";
    if (subtype === "local_command") {
      const durationMs = raw.durationMs;
      const suffix = typeof durationMs === "number" ? tt("tech.duration", { ms: durationMs }) : "";
      return { subtype, summary: tt("tech.localCommand", { suffix }) };
    }
    if (subtype === "turn_duration") {
      const durationMs = raw.durationMs;
      const suffix = typeof durationMs === "number" ? tt("tech.duration", { ms: durationMs }) : "";
      return { subtype, summary: tt("tech.turnDuration", { suffix }) };
    }
    return { subtype, summary: tt("tech.systemEvent", { subtype }) };
  }

  if (rawType === "file-history-snapshot") {
    return { subtype: rawType, summary: tt("tech.fileSnapshot") };
  }

  if (rawType === "queue-operation") {
    const operation = raw.operation || "unknown";
    return { subtype: rawType, summary: tt("tech.queueOperation", { operation }) };
  }

  return {
    subtype: rawType,
    summary: tt("tech.generic", { type: rawType }),
  };
}

function normalizeEvents(events) {
  const normalized = [];
  const toolResultsMap = new Map();
  const consumedResultIds = new Set();

  // 第一階段：預掃描所有 tool_result
  for (const event of events) {
    const raw = event.raw || {};
    const contentItems = normalizeContentItems(raw.message?.content || raw.content);
    for (const item of contentItems) {
      if (item?.type === "tool_result" && item.tool_use_id) {
        toolResultsMap.set(item.tool_use_id, item);
      }
    }
    // 處理外層就是 tool_result 的情況
    if (raw.type === "tool_result" && raw.tool_use_id) {
      toolResultsMap.set(raw.tool_use_id, raw);
    }
  }

  // 第二階段：正規化事件
  for (const event of events) {
    const raw = event.raw || {};
    const rawType = raw.type || event.eventType || "unknown";
    const role = raw.message?.role;
    const contentItems = normalizeContentItems(raw.message?.content || raw.content);
    
    // 檢查此事件是否僅包含已「消費」的工具結果
    const onlyConsumedResults = contentItems.length > 0 && contentItems.every(item => 
      item?.type === "tool_result" && item.tool_use_id && toolResultsMap.has(item.tool_use_id)
    );
    const isTopLevelConsumed = rawType === "tool_result" && raw.tool_use_id && toolResultsMap.has(raw.tool_use_id);

    // 如果開啟「隱藏系統事件」且這是純工具結果，則略過渲染（因為它已合併到 tool_use 卡片）
    if (state.hideSystemEvents && (onlyConsumedResults || isTopLevelConsumed)) {
      continue;
    }

    const hasToolResultContent = contentItems.some((item) => item?.type === "tool_result");
    const roleType =
      rawType === "tool_result" || hasToolResultContent
        ? "assistant"
        : role === "user" || role === "assistant"
          ? role
          : rawType;

    if (roleType === "user" || roleType === "assistant") {
      const text = extractTextSummary(raw, toolResultsMap);
      normalized.push({
        kind: roleType === "user" ? "chat_user" : "chat_assistant",
        line: event.line,
        timestamp: event.timestamp,
        title: roleType === "user" ? tt("chat.user") : tt("chat.assistant"),
        summary: text.summary,
        conversationSummary: extractChatOnlySummary(raw),
        conversationToolSummary: (() => {
          const names = extractToolTagNames(text.tags);
          if (names.length === 0) return "";
          return tt("summary.toolTags", { names: names.join(", ") });
        })(),
        tags:
          rawType === "tool_result" && !text.tags.includes("tool_result")
            ? [...text.tags, "tool_result"]
            : text.tags,
        thinkingDetails: text.thinkingDetails,
        toolUseDetails: text.toolUseDetails,
        toolResultDetails: text.toolResultDetails,
        raw: raw,
      });
      continue;
    }

    const tech = buildTechSummary(event);
    normalized.push({
      kind: "tech",
      line: event.line,
      timestamp: event.timestamp,
      title: rawType,
      summary: tech.summary,
      techSubtype: tech.subtype,
      raw: raw,
    });
  }

  return normalized;
}

function buildTimelineItems(events) {
  const normalized = normalizeEvents(events);
  const items = [];
  let currentTechGroup = null;
  let nextGroupId = 1;

  for (const item of normalized) {
    if (item.kind === "tech") {
      if (!currentTechGroup) {
        const groupId = `tech-group-${nextGroupId++}`;
        currentTechGroup = {
          kind: "tech_group",
          id: groupId,
          events: [],
        };
        items.push(currentTechGroup);
        if (!state.techViewState[groupId]) {
          state.techViewState[groupId] = {
            expanded: false,
            visibleCount: TECH_PREVIEW_COUNT,
          };
        }
      }
      currentTechGroup.events.push(item);
      continue;
    }

    currentTechGroup = null;
    items.push(item);
  }

  return items;
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (typeof text === "string") el.textContent = text;
  return el;
}

function initColumnResizers() {
  const MIN_LEFT = 180;
  const MIN_MIDDLE = 220;
  const MIN_RIGHT = 320;
  const SPLITTER_TOTAL = 16;

  const grid = refs.panelGrid;
  if (!grid || !refs.projectsPanel || !refs.entriesPanel) return;

  const setSizes = (left, middle) => {
    grid.style.setProperty("--col-left", `${Math.round(left)}px`);
    grid.style.setProperty("--col-middle", `${Math.round(middle)}px`);
  };

  const startDrag = (type, downEvent) => {
    downEvent.preventDefault();
    const startX = downEvent.clientX;
    const startLeft = refs.projectsPanel.getBoundingClientRect().width;
    const startMiddle = refs.entriesPanel.getBoundingClientRect().width;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const containerWidth = grid.getBoundingClientRect().width;

      if (type === "left") {
        const maxLeft = Math.max(MIN_LEFT, containerWidth - startMiddle - MIN_RIGHT - SPLITTER_TOTAL);
        const nextLeft = Math.min(Math.max(startLeft + dx, MIN_LEFT), maxLeft);
        setSizes(nextLeft, startMiddle);
        return;
      }

      const maxMiddle = Math.max(
        MIN_MIDDLE,
        containerWidth - startLeft - MIN_RIGHT - SPLITTER_TOTAL,
      );
      const nextMiddle = Math.min(Math.max(startMiddle + dx, MIN_MIDDLE), maxMiddle);
      setSizes(startLeft, nextMiddle);
    };

    const onUp = () => {
      document.body.classList.remove("resizing-columns");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    document.body.classList.add("resizing-columns");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  refs.resizerLeft?.addEventListener("pointerdown", (event) => startDrag("left", event));
  refs.resizerMiddle?.addEventListener("pointerdown", (event) => startDrag("middle", event));
}

function renderRawDetails(raw) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Raw JSON";
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(raw, null, 2);
  details.append(summary, pre);
  return details;
}

function renderChatItem(item) {
  const article = createElement("article", `event chat ${item.kind}`);
  const header = createElement("header", "event-header");
  const visibleTags = state.hideSystemEvents
    ? item.tags.filter((tag) => tag !== "thinking" && tag !== "tool_result")
    : item.tags;
  const titleGroup = createElement("div", "title-group");
  titleGroup.append(createElement("span", "badge", item.title));
  if (item.kind === "chat_assistant" && visibleTags.length > 0) {
    const inlineTagRow = createElement("div", "inline-tag-row");
    for (const tag of visibleTags.slice(0, 4)) {
      inlineTagRow.append(createElement("span", "tag inline-tag", tag));
    }
    titleGroup.append(inlineTagRow);
  }
  header.append(
    titleGroup,
    createElement("span", "time", formatTimestamp(item.timestamp)),
    createElement("span", "line", `line ${item.line}`),
  );

  const fullText = String(
    state.hideSystemEvents
      ? item.conversationSummary || item.conversationToolSummary || ""
      : item.summary || "",
  );
  const isLong = fullText.length > CHAT_PREVIEW_LENGTH;
  let expanded = false;
  const body = createElement(
    "p",
    "chat-text",
    isLong ? truncateText(fullText, CHAT_PREVIEW_LENGTH) : fullText,
  );
  article.append(header, body);

  if (isLong) {
    const toggle = createElement("button", "expand-btn", tt("action.expandContent"));
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      body.textContent = expanded ? fullText : truncateText(fullText, CHAT_PREVIEW_LENGTH);
      toggle.textContent = expanded ? tt("action.collapseContent") : tt("action.expandContent");
    });
    article.append(toggle);
  }

  if (item.kind !== "chat_assistant" && visibleTags.length > 0) {
    const tagRow = createElement("div", "tag-row");
    for (const tag of visibleTags.slice(0, 4)) {
      tagRow.append(createElement("span", "tag", tag));
    }
    article.append(tagRow);
  }

  if (
    !state.hideSystemEvents &&
    item.kind === "chat_assistant" &&
    Array.isArray(item.thinkingDetails) &&
    item.thinkingDetails.length > 0
  ) {
    const thinkingBox = createElement("details", "assistant-fold");
    thinkingBox.append(
      createElement("summary", "assistant-fold-summary", tt("section.thinking", { count: item.thinkingDetails.length })),
    );
    const content = createElement("section", "assistant-thinking");
    for (const text of item.thinkingDetails.slice(0, 2)) {
      content.append(createElement("p", "assistant-thinking-text", truncateText(text, 800)));
    }
    thinkingBox.append(content);
    article.append(thinkingBox);
  }

  if (
    item.kind === "chat_assistant" &&
    Array.isArray(item.toolUseDetails) &&
    item.toolUseDetails.length > 0
  ) {
    const toolBox = createElement("section", "assistant-tools");
    toolBox.append(createElement("h4", "assistant-subtitle", tt("section.toolUse")));
    for (const detail of item.toolUseDetails.slice(0, 4)) {
      const card = createElement("div", "assistant-tool-card");
      card.append(createElement("div", "assistant-tool-title", detail.title));
      for (const line of detail.lines.slice(0, 5)) {
        card.append(createElement("div", "assistant-tool-line", line));
      }
      toolBox.append(card);
    }
    article.append(toolBox);
  }

  if (
    !state.hideSystemEvents &&
    item.kind === "chat_assistant" &&
    Array.isArray(item.toolResultDetails) &&
    item.toolResultDetails.length > 0
  ) {
    const resultBox = createElement("details", "assistant-fold");
    resultBox.append(
      createElement(
        "summary",
        "assistant-fold-summary",
        tt("section.toolResult", { count: item.toolResultDetails.length }),
      ),
    );
    const content = createElement("section", "assistant-tools");
    for (const detail of item.toolResultDetails.slice(0, 4)) {
      const card = createElement("div", "assistant-tool-card");
      card.append(createElement("div", "assistant-tool-title", detail.title));
      for (const line of detail.lines.slice(0, 6)) {
        card.append(createElement("div", "assistant-tool-line", line));
      }
      content.append(card);
    }
    resultBox.append(content);
    article.append(resultBox);
  }

  article.append(renderRawDetails(item.raw));
  return article;
}

function renderTechGroup(group) {
  const wrapper = createElement("section", "event chat chat_assistant tech-group tech-group-chat");
  const viewState = state.techViewState[group.id] || {
    expanded: false,
    visibleCount: TECH_PREVIEW_COUNT,
  };

  const subtypeCount = {};
  for (const item of group.events) {
    const key = item.techSubtype || "unknown";
    subtypeCount[key] = (subtypeCount[key] || 0) + 1;
  }
  const subtypeSummary = Object.entries(subtypeCount)
    .slice(0, 3)
    .map(([key, count]) => `${key} ${count}`)
    .join(" / ");

  const header = createElement("header", "event-header");
  const titleGroup = createElement("div", "title-group");
  titleGroup.append(createElement("span", "badge", "Claude"));
  titleGroup.append(createElement("span", "tag inline-tag", "technical"));
  header.append(
    titleGroup,
    createElement("span", "time", "-"),
    createElement("span", "line", `events ${group.events.length}`),
  );
  wrapper.append(header);

  const headBtn = createElement(
    "button",
    "tech-group-toggle",
    tt("tech.groupTitle", { count: group.events.length, detail: subtypeSummary ? tt("tech.groupDetail", { detail: subtypeSummary }) : "" }),
  );
  headBtn.type = "button";
  headBtn.dataset.expanded = viewState.expanded ? "true" : "false";
  headBtn.addEventListener("click", () => {
    state.techViewState[group.id] = {
      ...viewState,
      expanded: !viewState.expanded,
    };
    renderTimelineView();
  });
  wrapper.append(headBtn);

  if (!viewState.expanded) {
    return wrapper;
  }

  const list = createElement("ul", "tech-event-list");
  const visible = Math.min(viewState.visibleCount, group.events.length);
  for (const event of group.events.slice(0, visible)) {
    const row = createElement("li", "tech-event-row");
    const meta = createElement(
      "div",
      "tech-meta",
      `${formatTimestamp(event.timestamp)} | ${event.title} | line ${event.line}`,
    );
    const summary = createElement("div", "tech-summary", event.summary);
    row.append(meta, summary, renderRawDetails(event.raw));
    list.append(row);
  }
  wrapper.append(list);

  if (visible < group.events.length) {
    const more = createElement(
      "button",
      "load-more-btn",
      tt("action.loadMore", { count: group.events.length - visible }),
    );
    more.type = "button";
    more.addEventListener("click", () => {
      state.techViewState[group.id] = {
        ...viewState,
        visibleCount: Math.min(group.events.length, viewState.visibleCount + TECH_PREVIEW_COUNT),
      };
      renderTimelineView();
    });
    wrapper.append(more);
  }

  return wrapper;
}

function renderTimelineView() {
  refs.viewerContent.innerHTML = "";

  if (state.parseErrorCode === "PARSE_PARTIAL") {
    const warning = createElement(
      "div",
      "warning",
      tt("error.parseLines", { message: formatError(state.parseErrorCode), lines: state.parseErrors.map((item) => item.line).join(", ") }),


    );
    refs.viewerContent.append(warning);
  }

  let renderedCount = 0;

  for (const item of state.timelineItems) {
    if (item.kind.startsWith("chat")) {
      if (state.hideSystemEvents && item.kind === "chat_assistant") {
        if (!String(item.conversationSummary || item.conversationToolSummary || "").trim()) {
          continue;
        }
      }
      refs.viewerContent.append(renderChatItem(item));
      renderedCount += 1;
      continue;
    }

    if (!state.hideSystemEvents && item.kind === "tech_group") {
      refs.viewerContent.append(renderTechGroup(item));
      renderedCount += 1;
    }
  }

  if (renderedCount === 0) {
    refs.viewerContent.innerHTML = `<p class="placeholder">${escapeHtml(tt("placeholder.emptySession"))}</p>`;
  } else {
    requestAnimationFrame(() => {
      refs.viewerContent.scrollTop = refs.viewerContent.scrollHeight;
    });
  }
}

function renderTimeline(payload) {
  const metaParts = [normalizeDisplayPath(payload.path)];
  if (payload.metadata) {
    const md = payload.metadata;
    if (md.modelName) metaParts.push(`Model: ${md.modelName}`);
    if (md.totalInputTokens || md.totalOutputTokens) {
      metaParts.push(`Tokens: ${md.totalInputTokens} in / ${md.totalOutputTokens} out`);
    }
  }

  refs.viewerTitle.textContent = tt("viewer.timeline");
  refs.viewerMeta.textContent = metaParts.join(" | ");

  state.parseErrorCode = payload.errorCode || "";
  state.parseErrors = Array.isArray(payload.errors) ? payload.errors : [];
  state.techViewState = {};
  state.timelineItems = buildTimelineItems(Array.isArray(payload.events) ? payload.events : []);

  renderTimelineView();
}

async function loadProjects() {
  setStatus(tt("status.loadingProjects"));
  try {
    state.projects = await invoke("list_projects");
    renderProjects();
    setStatus(tt("status.projectsLoaded", { count: state.projects.length }));
  } catch (errorCode) {
    setStatus(formatError(String(errorCode)), "error");
  }
}

async function selectProject(projectPath) {
  state.selectedProjectPath = projectPath;
  state.selectedEntryPath = "";
  state.selectedEntryType = "";
  clearViewer();
  renderProjects();
  setStatus(tt("status.loadingEntries"));

  try {
    state.entries = await invoke("list_project_entries", {
      projectPath,
    });
    state.entryExpandState = {};
    for (const entry of state.entries) {
      if (entry.entryType === "subagent_session" && entry.parentSession) {
        state.entryExpandState[entry.parentSession] = false;
      }
    }
    renderEntries();
    setStatus(tt("status.entriesLoaded", { count: state.entries.length }));
  } catch (errorCode) {
    state.entries = [];
    renderEntries();
    setStatus(formatError(String(errorCode)), "error");
  }
}

async function selectEntry(entry) {
  state.selectedEntryPath = entry.path;
  state.selectedEntryType = entry.entryType;
  renderEntries();
  setStatus(tt("status.loadingContent"));
  const hideSystemEventsControl = entry.entryType === "memory_file";
  setHideSystemEventsVisible(!hideSystemEventsControl);

  try {
    if (entry.entryType === "memory_file") {
      const payload = await invoke("read_memory", { memoryPath: entry.path });
      renderMemory(payload);
      setStatus(tt("status.memoryLoaded"), "info");
      return;
    }

    const payload = await invoke("read_session_timeline", {
      sessionPath: entry.path,
    });
    setHideSystemEventsVisible(true);
    renderTimeline(payload);
    if (payload.errorCode) {
      setStatus(formatError(payload.errorCode), "warn");
    } else {
      setStatus(tt("status.sessionLoaded"), "info");
    }
  } catch (errorCode) {
    if (entry.entryType !== "memory_file") {
      setHideSystemEventsVisible(true);
    }
    setStatus(formatError(String(errorCode)), "error");
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  refs.panelGrid = document.querySelector("#panel-grid");
  refs.projectsPanel = document.querySelector("#projects-panel");
  refs.entriesPanel = document.querySelector("#entries-panel");
  refs.resizerLeft = document.querySelector("#resizer-left");
  refs.resizerMiddle = document.querySelector("#resizer-middle");
  refs.projectsList = document.querySelector("#projects-list");
  refs.projectsSearchInput = document.querySelector("#projects-search-input");
  refs.entriesList = document.querySelector("#entries-list");
  refs.viewerTitle = document.querySelector("#viewer-title");
  refs.viewerMeta = document.querySelector("#viewer-meta");
  refs.viewerContent = document.querySelector("#viewer-content");
  refs.status = document.querySelector("#status");
  refs.hideSystemEventsToggle = document.querySelector("#hide-system-events-toggle");
  refs.hideSystemEventsWrap = document.querySelector(".hide-system-events-toggle");
  refs.pathTooltip = document.querySelector("#path-tooltip");
  refs.themeButtons = Array.from(document.querySelectorAll(".theme-btn"));
  refs.localeSelect = document.querySelector("#locale-select");

  for (const button of refs.themeButtons) {
    button.addEventListener("click", () => {
      setThemeMode(button.dataset.themeMode, { persist: true });
    });
  }

  if (refs.projectsSearchInput) {
    refs.projectsSearchInput.addEventListener("input", (event) => {
      state.projectSearchQuery = String(event.target.value || "");
      renderProjects();
    });
  }

  refs.hideSystemEventsToggle.checked = true;
  state.hideSystemEvents = true;
  refs.hideSystemEventsToggle.addEventListener("change", (event) => {
    state.hideSystemEvents = event.target.checked;
    renderTimelineView();
  });
  initLocaleSelector();
  initThemeMode();
  initColumnResizers();

  clearViewer();
  await loadProjects();
});

