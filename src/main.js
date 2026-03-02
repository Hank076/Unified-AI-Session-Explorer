const { invoke } = window.__TAURI__.core;

const state = {
  projects: [],
  entries: [],
  selectedProjectPath: "",
  selectedEntryPath: "",
  selectedEntryType: "",
};

const refs = {
  projectsList: null,
  entriesList: null,
  viewerTitle: null,
  viewerMeta: null,
  viewerContent: null,
  status: null,
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
  refs.viewerTitle.textContent = "Viewer";
  refs.viewerMeta.textContent = "";
  refs.viewerContent.innerHTML = '<p class="placeholder">請先選擇專案與項目。</p>';
}

function escapeHtml(input) {
  return input
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

function renderTimeline(payload) {
  refs.viewerTitle.textContent = "Session Timeline";
  refs.viewerMeta.textContent = payload.path;
  const blocks = [];

  if (payload.errorCode === "PARSE_PARTIAL") {
    blocks.push(
      `<div class="warning">解析警告：${formatError(
        payload.errorCode,
      )}（錯誤行數：${payload.errors.map((v) => v.line).join(", ")}）</div>`,
    );
  }

  if (!payload.events.length) {
    blocks.push('<p class="placeholder">此 session 沒有可顯示的事件。</p>');
  } else {
    for (const event of payload.events) {
      blocks.push(`
        <article class="event">
          <header>
            <span>${escapeHtml(event.timestamp || "-")}</span>
            <span>${escapeHtml(event.role || "unknown")}</span>
            <span>${escapeHtml(event.eventType || "event")}</span>
            <span>line ${event.line}</span>
          </header>
          <p>${escapeHtml(event.summary)}</p>
          <details>
            <summary>Raw JSON</summary>
            <pre>${escapeHtml(JSON.stringify(event.raw, null, 2))}</pre>
          </details>
        </article>
      `);
    }
  }

  refs.viewerContent.innerHTML = blocks.join("");
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
      setStatus("MEMORY.md 載入完成。");
      return;
    }

    const payload = await invoke("read_session_timeline", {
      sessionPath: entry.path,
    });
    renderTimeline(payload);
    if (payload.errorCode) {
      setStatus(formatError(payload.errorCode), "warn");
    } else {
      setStatus("Session 載入完成。");
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

  clearViewer();
  await loadProjects();
});
