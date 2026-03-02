const { invoke } = window.__TAURI__.core;

const TECH_PREVIEW_COUNT = 20;

const state = {
  projects: [],
  entries: [],
  selectedProjectPath: "",
  selectedEntryPath: "",
  selectedEntryType: "",
  timelineItems: [],
  parseErrors: [],
  parseErrorCode: "",
  showChatOnly: false,
  techViewState: {},
};

const refs = {
  projectsList: null,
  entriesList: null,
  viewerTitle: null,
  viewerMeta: null,
  viewerContent: null,
  status: null,
  chatOnlyToggle: null,
};

function setStatus(message, type = "info") {
  refs.status.textContent = message || "";
  refs.status.dataset.type = type;
}

function formatError(code) {
  if (code === "NOT_FOUND") return "找不到目標路徑或檔案。";
  if (code === "READ_FAILED") return "讀取失敗，請確認權限與路徑。";
  if (code === "PARSE_PARTIAL") return "部分 JSONL 行解析失敗，已顯示可用內容。";
  return `發生未知錯誤：${code}`;
}

function clearViewer() {
  state.timelineItems = [];
  state.parseErrors = [];
  state.parseErrorCode = "";
  state.techViewState = {};
  refs.viewerTitle.textContent = "Viewer";
  refs.viewerMeta.textContent = "";
  refs.viewerContent.innerHTML = '<p class="placeholder">請先選擇專案與項目。</p>';
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

function renderProjects() {
  refs.projectsList.innerHTML = "";
  for (const project of state.projects) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.className = "list-btn";
    if (state.selectedProjectPath === project.path) button.dataset.active = "true";
    button.textContent = decodeProjectLabel(project.name);
    button.title = project.path;
    button.addEventListener("click", () => selectProject(project.path));
    li.appendChild(button);
    refs.projectsList.appendChild(li);
  }
}

function buildEntryLabel(entry) {
  if (entry.entryType === "memory") return "📘 MEMORY.md";
  if (entry.entryType === "subagent_session") {
    return `↳ ${entry.label} (subagent: ${entry.parentSession})`;
  }
  return entry.label;
}

function renderEntries() {
  refs.entriesList.innerHTML = "";
  for (const entry of state.entries) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.className = "list-btn";
    button.textContent = buildEntryLabel(entry);
    button.title = entry.path;
    if (state.selectedEntryPath === entry.path) button.dataset.active = "true";
    button.addEventListener("click", () => selectEntry(entry));
    li.appendChild(button);
    refs.entriesList.appendChild(li);
  }
}

function renderMemory(payload) {
  refs.viewerTitle.textContent = "MEMORY.md";
  refs.viewerMeta.textContent = payload.path;
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

  if (toolName === "AskUserQuestion") {
    const questions = parseAskUserQuestions(input);
    const lines = [];
    for (const q of questions) {
      const question = typeof q?.question === "string" ? q.question.trim() : "";
      if (question) lines.push(`Q: ${question}`);
      if (Array.isArray(q?.options) && q.options.length > 0) {
        const labels = q.options
          .map((opt) => (typeof opt?.label === "string" ? opt.label.trim() : ""))
          .filter(Boolean);
        if (labels.length > 0) lines.push(`選項: ${labels.join(" / ")}`);
      }
    }
    return {
      toolName,
      title: "向使用者提問",
      lines: lines.length > 0 ? lines : ["questions 結構存在，但無可讀內容"],
    };
  }

  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const lines = [];
    if (description) lines.push(`描述: ${description}`);
    if (command) lines.push(`命令: ${command}`);
    return {
      toolName,
      title: "Bash 指令執行",
      lines: lines.length > 0 ? lines : ["input 結構存在，但無可讀內容"],
    };
  }

  if (toolName === "Read") {
    const filePath = typeof input.file_path === "string" ? input.file_path.trim() : "";
    const offset = Number.isFinite(input.offset) ? input.offset : null;
    const limit = Number.isFinite(input.limit) ? input.limit : null;
    const lines = [];
    if (filePath) lines.push(`檔案: ${filePath}`);
    if (offset !== null || limit !== null) {
      lines.push(`範圍: offset=${offset ?? 0}, limit=${limit ?? "auto"}`);
    }
    return {
      toolName,
      title: "檔案讀取",
      lines: lines.length > 0 ? lines : ["input 結構存在，但無可讀內容"],
    };
  }

  return {
    toolName,
    title: `工具調用: ${toolName}`,
    lines: ["已記錄工具調用（可展開 Raw JSON 查看完整 input）"],
  };
}

function extractTextSummary(raw) {
  const message = raw?.message;
  const content = message?.content ?? message;
  const textChunks = [];
  const tags = [];
  let toolUseCount = 0;
  let thinkingCount = 0;
  const toolNames = new Set();
  const thinkingDetails = [];
  const toolUseDetails = [];

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
      if (typeof item.content === "string" && item.content.trim()) {
        textChunks.push(item.content.trim());
      }
      if (Array.isArray(item.content)) {
        for (const sub of item.content) {
          if (typeof sub === "string" && sub.trim()) {
            textChunks.push(sub.trim());
          } else if (
            sub &&
            typeof sub === "object" &&
            typeof sub.text === "string" &&
            sub.text.trim()
          ) {
            textChunks.push(sub.text.trim());
          }
        }
      }
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

  const summary = truncateText(textChunks.join("\n").trim(), 380);
  if (summary) {
    const commandDisplay = extractCommandDisplay(summary);
    return { summary: commandDisplay || summary, tags, thinkingDetails, toolUseDetails };
  }

  if (contentItems.some((item) => item.type === "tool_result")) {
    return { summary: "工具結果（可展開 Raw JSON）", tags, thinkingDetails, toolUseDetails };
  }

  if (toolUseCount > 0) {
    const names = Array.from(toolNames).slice(0, 3).join(", ");
    const suffix = names ? `：${names}${toolNames.size > 3 ? "..." : ""}` : "";
    return { summary: `工具呼叫 ${toolUseCount} 次${suffix}`, tags, thinkingDetails, toolUseDetails };
  }

  if (thinkingCount > 0) {
    return { summary: `Claude 內部思考事件 ${thinkingCount} 筆`, tags, thinkingDetails, toolUseDetails };
  }

  return { summary: "事件內容為結構化資料（可展開 Raw JSON）", tags, thinkingDetails, toolUseDetails };
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
        summary: `Hook 進度：${hookName}`,
      };
    }
    if (dataType === "bash_progress") {
      const lines = raw.data?.totalLines;
      if (typeof lines === "number") {
        return {
          subtype: dataType,
          summary: `命令執行進度：目前 ${lines} 行輸出`,
        };
      }
      return {
        subtype: dataType,
        summary: "命令執行進度更新",
      };
    }
    return {
      subtype: dataType,
      summary: `進度更新：${dataType}`,
    };
  }

  if (rawType === "system") {
    const subtype = raw.subtype || "system";
    if (subtype === "local_command") {
      const durationMs = raw.durationMs;
      const suffix = typeof durationMs === "number" ? `（${durationMs}ms）` : "";
      return { subtype, summary: `本機命令紀錄${suffix}` };
    }
    if (subtype === "turn_duration") {
      const durationMs = raw.durationMs;
      const suffix = typeof durationMs === "number" ? `（${durationMs}ms）` : "";
      return { subtype, summary: `回合耗時${suffix}` };
    }
    return { subtype, summary: `系統事件：${subtype}` };
  }

  if (rawType === "file-history-snapshot") {
    return { subtype: rawType, summary: "檔案快照已更新" };
  }

  if (rawType === "queue-operation") {
    const operation = raw.operation || "unknown";
    return { subtype: rawType, summary: `佇列操作：${operation}` };
  }

  return {
    subtype: rawType,
    summary: `技術事件：${rawType}`,
  };
}

function normalizeEvents(events) {
  const normalized = [];

  for (const event of events) {
    const rawType = event.raw?.type || event.eventType || "unknown";
    const role = event.raw?.message?.role;
    const roleType = role === "user" || role === "assistant" ? role : rawType;

    if (roleType === "user" || roleType === "assistant") {
      const text = extractTextSummary(event.raw);
      normalized.push({
        kind: roleType === "user" ? "chat_user" : "chat_assistant",
        line: event.line,
        timestamp: event.timestamp,
        title: roleType === "user" ? "使用者" : "Claude",
        summary: text.summary,
        tags: text.tags,
        thinkingDetails: text.thinkingDetails,
        toolUseDetails: text.toolUseDetails,
        raw: event.raw,
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
      raw: event.raw,
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
  const titleGroup = createElement("div", "title-group");
  titleGroup.append(createElement("span", "badge", item.title));
  if (item.kind === "chat_assistant" && item.tags.length > 0) {
    const inlineTagRow = createElement("div", "inline-tag-row");
    for (const tag of item.tags.slice(0, 4)) {
      inlineTagRow.append(createElement("span", "tag inline-tag", tag));
    }
    titleGroup.append(inlineTagRow);
  }
  header.append(
    titleGroup,
    createElement("span", "time", formatTimestamp(item.timestamp)),
    createElement("span", "line", `line ${item.line}`),
  );

  const body = createElement("p", "chat-text", item.summary);
  article.append(header, body);

  if (item.kind !== "chat_assistant" && item.tags.length > 0) {
    const tagRow = createElement("div", "tag-row");
    for (const tag of item.tags.slice(0, 4)) {
      tagRow.append(createElement("span", "tag", tag));
    }
    article.append(tagRow);
  }

  if (item.kind === "chat_assistant" && Array.isArray(item.thinkingDetails) && item.thinkingDetails.length > 0) {
    const thinkingBox = createElement("section", "assistant-thinking");
    thinkingBox.append(createElement("h4", "assistant-subtitle", "內部思考"));
    for (const text of item.thinkingDetails.slice(0, 2)) {
      thinkingBox.append(createElement("p", "assistant-thinking-text", truncateText(text, 500)));
    }
    article.append(thinkingBox);
  }

  if (item.kind === "chat_assistant" && Array.isArray(item.toolUseDetails) && item.toolUseDetails.length > 0) {
    const toolBox = createElement("section", "assistant-tools");
    toolBox.append(createElement("h4", "assistant-subtitle", "工具調用"));
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

  article.append(renderRawDetails(item.raw));
  return article;
}

function renderTechGroup(group) {
  const wrapper = createElement("section", "tech-group");
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

  const headBtn = createElement(
    "button",
    "tech-group-toggle",
    `技術事件 ${group.events.length} 筆${subtypeSummary ? `（${subtypeSummary}）` : ""}`,
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
      `載入更多 (${group.events.length - visible} 筆)`,
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
      `${formatError(state.parseErrorCode)}（行號：${state.parseErrors
        .map((item) => item.line)
        .join(", ")}）`,
    );
    refs.viewerContent.append(warning);
  }

  let renderedCount = 0;

  for (const item of state.timelineItems) {
    if (item.kind.startsWith("chat")) {
      refs.viewerContent.append(renderChatItem(item));
      renderedCount += 1;
      continue;
    }

    if (!state.showChatOnly && item.kind === "tech_group") {
      refs.viewerContent.append(renderTechGroup(item));
      renderedCount += 1;
    }
  }

  if (renderedCount === 0) {
    refs.viewerContent.innerHTML =
      '<p class="placeholder">此 session 沒有可顯示的內容。</p>';
  }
}

function renderTimeline(payload) {
  refs.viewerTitle.textContent = "Session Timeline";
  refs.viewerMeta.textContent = payload.path;

  state.parseErrorCode = payload.errorCode || "";
  state.parseErrors = Array.isArray(payload.errors) ? payload.errors : [];
  state.techViewState = {};
  state.timelineItems = buildTimelineItems(Array.isArray(payload.events) ? payload.events : []);

  renderTimelineView();
}

async function loadProjects() {
  setStatus("載入專案中...");
  try {
    state.projects = await invoke("list_projects");
    renderProjects();
    setStatus(`已載入 ${state.projects.length} 個專案。`);
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
  setStatus("載入項目中...");

  try {
    state.entries = await invoke("list_project_entries", {
      projectPath,
    });
    renderEntries();
    setStatus(`已載入 ${state.entries.length} 個項目。`);
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
  setStatus("載入內容中...");

  try {
    if (entry.entryType === "memory") {
      const payload = await invoke("read_memory", { memoryPath: entry.path });
      renderMemory(payload);
      setStatus("MEMORY.md 載入完成。", "info");
      return;
    }

    const payload = await invoke("read_session_timeline", {
      sessionPath: entry.path,
    });
    renderTimeline(payload);
    if (payload.errorCode) {
      setStatus(formatError(payload.errorCode), "warn");
    } else {
      setStatus("Session 載入完成。", "info");
    }
  } catch (errorCode) {
    setStatus(formatError(String(errorCode)), "error");
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  refs.projectsList = document.querySelector("#projects-list");
  refs.entriesList = document.querySelector("#entries-list");
  refs.viewerTitle = document.querySelector("#viewer-title");
  refs.viewerMeta = document.querySelector("#viewer-meta");
  refs.viewerContent = document.querySelector("#viewer-content");
  refs.status = document.querySelector("#status");
  refs.chatOnlyToggle = document.querySelector("#chat-only-toggle");

  refs.chatOnlyToggle.addEventListener("change", (event) => {
    state.showChatOnly = event.target.checked;
    renderTimelineView();
  });

  clearViewer();
  await loadProjects();
});
