import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = process.cwd();
const INDEX_HTML = path.join(ROOT, "src", "index.html");

function createMockInvoke() {
  const calls = [];
  const projects = [
    {
      name: "demo-project",
      path: "D:/mock/demo-project",
      cwdPath: "D:/mock/demo-project",
      modifiedMs: Date.now(),
    },
  ];
  const entries = [
    {
      entryType: "session",
      label: "alpha.jsonl",
      path: "D:/mock/demo-project/alpha.jsonl",
      parentSession: null,
      modifiedMs: Date.now(),
      sizeBytes: 120,
    },
    {
      entryType: "subagent_session",
      label: "alpha-child.jsonl",
      path: "D:/mock/demo-project/alpha/subagents/alpha-child.jsonl",
      parentSession: "alpha",
      modifiedMs: Date.now(),
      sizeBytes: 96,
    },
    {
      entryType: "memory_file",
      label: "MEMORY.md",
      path: "D:/mock/demo-project/memory/MEMORY.md",
      parentSession: null,
      modifiedMs: Date.now(),
      sizeBytes: 44,
    },
  ];

  const invoke = async (cmd, args = {}) => {
    calls.push({ cmd, args });
    if (cmd === "list_projects") return projects;
    if (cmd === "list_project_entries") return entries;
    if (cmd === "get_project_delete_impact") {
      return {
        sessionCount: 1,
        subagentSessionCount: 1,
        memoryFileCount: 1,
        totalFileCount: 3,
        totalSizeBytes: 260,
      };
    }
    if (cmd === "read_session_timeline") {
      return {
        path: args.sessionPath,
        errorCode: null,
        errors: [],
        events: [
          {
            line: 1,
            timestamp: "2026-03-04T10:00:00Z",
            role: "user",
            eventType: "message",
            summary: "hello",
            raw: {
              type: "user",
              timestamp: "2026-03-04T10:00:00Z",
              message: {
                role: "user",
                content: [{ type: "text", text: "hello" }],
              },
            },
          },
          {
            line: 2,
            timestamp: "2026-03-04T10:02:05Z",
            role: "assistant",
            eventType: "message",
            summary: "world",
            raw: {
              type: "assistant",
              timestamp: "2026-03-04T10:02:05Z",
              message: {
                role: "assistant",
                model: "claude-sonnet-4-6",
                content: [
                  { type: "text", text: "world" },
                  { type: "thinking", thinking: "plan silently" },
                  { type: "tool_use", id: "toolu_123", name: "Bash", input: { command: "echo hi" } },
                ],
                usage: {
                  input_tokens: 1,
                  output_tokens: 403,
                },
              },
            },
          },
          {
            line: 21,
            timestamp: "2026-03-04T10:02:10Z",
            role: "assistant",
            eventType: "message",
            summary: "meta note",
            raw: {
              type: "assistant",
              isMeta: true,
              timestamp: "2026-03-04T10:02:10Z",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "meta note" }],
              },
            },
          },
          {
            line: 22,
            timestamp: "2026-03-04T10:02:11Z",
            role: "user",
            eventType: "message",
            summary: "command call",
            raw: {
              type: "user",
              uuid: "cmd-1",
              timestamp: "2026-03-04T10:02:11Z",
              message: {
                role: "user",
                content:
                  "<command-name>/mcp</command-name>\n            <command-message>mcp</command-message>\n            <command-args>disable pencil</command-args>",
              },
            },
          },
          {
            line: 23,
            timestamp: "2026-03-04T10:02:12Z",
            role: "user",
            eventType: "message",
            summary: "local command output",
            raw: {
              type: "user",
              parentUuid: "cmd-1",
              timestamp: "2026-03-04T10:02:12Z",
              message: {
                role: "user",
                content: "<local-command-stdout>MCP server \"pencil\" disabled</local-command-stdout>",
              },
            },
          },
          {
            line: 3,
            timestamp: "2026-03-04T10:02:20Z",
            role: "user",
            eventType: "tool_result",
            summary: "tool result",
            raw: {
              type: "user",
              timestamp: "2026-03-04T10:02:20Z",
              message: {
                role: "user",
                content: [{ type: "tool_result", content: "done" }],
              },
              toolUseResult: {
                commandName: "Bash",
                success: true,
                stdout: "done",
                stderr: "",
                interrupted: false,
                isImage: false,
                noOutputExpected: false,
              },
            },
          },
          {
            line: 4,
            timestamp: "2026-03-04T10:03:00Z",
            role: null,
            eventType: "system",
            summary: "turn duration",
            raw: {
              type: "system",
              subtype: "turn_duration",
              durationMs: 60000,
              timestamp: "2026-03-04T10:03:00Z",
            },
          },
          {
            line: 5,
            timestamp: "2026-03-04T10:04:00Z",
            role: null,
            eventType: "system",
            summary: "turn duration",
            raw: {
              type: "system",
              subtype: "turn_duration",
              durationMs: 120000,
              timestamp: "2026-03-04T10:04:00Z",
            },
          },
        ],
        metadata: {
          modelName: "claude-sonnet-4-5",
          totalInputTokens: 1234,
          totalOutputTokens: 567,
          startTime: "2026-03-04T10:00:00Z",
          endTime: "2026-03-04T10:02:05Z",
        },
      };
    }
    if (cmd === "read_memory") {
      return { path: args.memoryPath, content: "mock-memory" };
    }
    if (cmd === "delete_session") return null;
    if (cmd === "delete_project") return null;
    throw new Error(`Unhandled command: ${cmd}`);
  };

  return { invoke, calls };
}

async function setupApp() {
  const html = await fs.readFile(INDEX_HTML, "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/" });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLDialogElement = window.HTMLDialogElement;
  globalThis.Event = window.Event;
  globalThis.MouseEvent = window.MouseEvent;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: window.navigator,
  });

  window.matchMedia =
    window.matchMedia ||
    (() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  globalThis.requestAnimationFrame = window.requestAnimationFrame;

  if (window.HTMLDialogElement) {
    if (!window.HTMLDialogElement.prototype.showModal) {
      window.HTMLDialogElement.prototype.showModal = function showModal() {
        this.open = true;
      };
    }
    if (!window.HTMLDialogElement.prototype.close) {
      window.HTMLDialogElement.prototype.close = function close() {
        this.open = false;
      };
    }
  }

  const mock = createMockInvoke();
  window.__TAURI__ = { core: { invoke: mock.invoke } };

  await import(`../src/main.js?e2e=${Date.now()}-${Math.random()}`);
  window.dispatchEvent(new window.Event("DOMContentLoaded"));
  await new Promise((resolve) => setTimeout(resolve, 30));

  return { window, mock, cleanup: () => dom.window.close() };
}

test("project delete dialog shows impact and confirms by exact name", async () => {
  const app = await setupApp();
  const { window, mock } = app;

  const projectDeleteBtn = window.document.querySelector('[aria-label^="Delete project"]');
  assert.ok(projectDeleteBtn);
  projectDeleteBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const dialog = window.document.querySelector("#project-delete-dialog");
  const impact = window.document.querySelector("#project-delete-impact");
  const input = window.document.querySelector("#project-delete-input");
  const confirm = window.document.querySelector("#project-delete-confirm");

  assert.equal(dialog.open, true);
  assert.match(impact.textContent, /Will delete/i);
  assert.equal(confirm.disabled, true);

  input.value = "wrong-name";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(confirm.disabled, true);

  input.value = "demo-project";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(confirm.disabled, false);

  const impactCalls = mock.calls.filter((call) => call.cmd === "get_project_delete_impact");
  assert.equal(impactCalls.length, 1);
  app.cleanup();
});

test("session delete requires confirmation modal and supports undo", async () => {
  const app = await setupApp();
  const { window, mock } = app;

  const projectButton = window.document.querySelector(".project-btn");
  assert.ok(projectButton);
  projectButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const deleteBtn = window.document.querySelector('[aria-label^="Delete conversation"]');
  assert.ok(deleteBtn);
  deleteBtn.click();

  const sessionDialog = window.document.querySelector("#session-delete-dialog");
  assert.equal(sessionDialog.open, true);
  assert.equal(mock.calls.some((call) => call.cmd === "delete_session"), false);

  const confirm = window.document.querySelector("#session-delete-confirm");
  confirm.click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sessionDialog.open, false);
  assert.equal(mock.calls.some((call) => call.cmd === "delete_session"), false);

  const toast = window.document.querySelector("#undo-toast");
  assert.equal(toast.hidden, false);
  const undo = window.document.querySelector("#undo-toast-undo");
  undo.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(mock.calls.some((call) => call.cmd === "delete_session"), false);
  assert.equal(mock.calls.some((call) => call.cmd === "list_project_entries"), true);

  app.cleanup();
});

test("chat title shows model before line number", async () => {
  const app = await setupApp();
  const { window } = app;

  const projectButton = window.document.querySelector(".project-btn");
  assert.ok(projectButton);
  projectButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const sessionButton = window.document.querySelector('.entry-btn[data-entry-type="session"]');
  assert.ok(sessionButton);
  sessionButton.click();
  await new Promise((resolve) => setTimeout(resolve, 30));

  const assistantHeader = window.document.querySelector(".assist-row .msg-header");
  assert.ok(assistantHeader);
  const headerText = assistantHeader.textContent || "";
  const modelIndex = headerText.indexOf("model:claude-sonnet-4-6");
  const lineIndex = headerText.indexOf("line 2");
  assert.ok(modelIndex >= 0);
  assert.ok(lineIndex >= 0);
  assert.ok(modelIndex < lineIndex);

  app.cleanup();
});

test("chat header does not show tool:* badges", async () => {
  const app = await setupApp();
  const { window } = app;

  const projectButton = window.document.querySelector(".project-btn");
  assert.ok(projectButton);
  projectButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const sessionButton = window.document.querySelector('.entry-btn[data-entry-type="session"]');
  assert.ok(sessionButton);
  sessionButton.click();
  await new Promise((resolve) => setTimeout(resolve, 30));

  const badgeTexts = [...window.document.querySelectorAll(".msg-header .tag-badge")]
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean);
  assert.equal(badgeTexts.some((text) => /^tool:/i.test(text)), false);

  app.cleanup();
});

test("command xml text is rendered as compact command line", async () => {
  const app = await setupApp();
  const { window } = app;

  const projectButton = window.document.querySelector(".project-btn");
  assert.ok(projectButton);
  projectButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const sessionButton = window.document.querySelector('.entry-btn[data-entry-type="session"]');
  assert.ok(sessionButton);
  sessionButton.click();
  await new Promise((resolve) => setTimeout(resolve, 30));

  const toolToggle = window.document.querySelector("#hide-tool-events-toggle");
  assert.ok(toolToggle);
  toolToggle.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const assistantTexts = [...window.document.querySelectorAll(".assist-text, .user-msg-text")]
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean);
  assert.equal(
    assistantTexts.some((text) => /command:\s*\/mcp\s+disable\s+pencil/i.test(text)),
    true,
  );
  const toolTitles = [...window.document.querySelectorAll(".assistant-tool-title")]
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean);
  assert.equal(toolTitles.some((text) => /command:\s*\/mcp\s+disable\s+pencil/i.test(text)), false);
  const toolLines = [...window.document.querySelectorAll(".assistant-tool-line")]
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean);
  assert.equal(toolLines.some((text) => /(回傳結果|Result):\s*MCP server \"pencil\" disabled/i.test(text)), true);

  app.cleanup();
});

test("toolUseResult commandName is parsed and rendered in tool result panel", async () => {
  const app = await setupApp();
  const { window } = app;

  const projectButton = window.document.querySelector(".project-btn");
  assert.ok(projectButton);
  projectButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const sessionButton = window.document.querySelector('.entry-btn[data-entry-type="session"]');
  assert.ok(sessionButton);
  sessionButton.click();
  await new Promise((resolve) => setTimeout(resolve, 30));

  const toolToggle = window.document.querySelector("#hide-tool-events-toggle");
  assert.ok(toolToggle);
  toolToggle.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const toolResultLines = [...window.document.querySelectorAll(".assistant-tool-line")]
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean);
  assert.equal(toolResultLines.some((text) => /stdout:\s*done/i.test(text)), true);

  app.cleanup();
});

test("event toggles independently control tool/thinking while system events are hidden", async () => {
  const app = await setupApp();
  const { window } = app;

  const projectButton = window.document.querySelector(".project-btn");
  assert.ok(projectButton);
  projectButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const sessionButton = window.document.querySelector('.entry-btn[data-entry-type="session"]');
  assert.ok(sessionButton);
  sessionButton.click();
  await new Promise((resolve) => setTimeout(resolve, 30));

  const systemToggle = window.document.querySelector("#hide-system-events-toggle");
  const toolToggle = window.document.querySelector("#hide-tool-events-toggle");
  const thinkingToggle = window.document.querySelector("#hide-thinking-events-toggle");
  assert.ok(systemToggle);
  assert.ok(toolToggle);
  assert.ok(thinkingToggle);
  assert.equal(systemToggle.getAttribute("aria-pressed"), "true");
  assert.equal(toolToggle.getAttribute("aria-pressed"), "true");
  assert.equal(thinkingToggle.getAttribute("aria-pressed"), "true");

  let toolResultLines = [...window.document.querySelectorAll(".assistant-tool-line")]
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean);
  assert.equal(toolResultLines.some((text) => /stdout:\s*done/i.test(text)), false);
  assert.equal(window.document.querySelectorAll(".assistant-thinking-text").length, 0);
  let assistantTexts = [...window.document.querySelectorAll(".assist-text")]
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean);
  assert.equal(assistantTexts.includes("meta note"), false);

  toolToggle.click();
  thinkingToggle.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  toolResultLines = [...window.document.querySelectorAll(".assistant-tool-line")]
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean);
  assert.equal(toolResultLines.some((text) => /stdout:\s*done/i.test(text)), true);
  assert.equal(window.document.querySelectorAll(".assistant-thinking-text").length > 0, true);
  assistantTexts = [...window.document.querySelectorAll(".assist-text")]
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean);
  assert.equal(assistantTexts.includes("meta note"), true);

  toolToggle.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  toolResultLines = [...window.document.querySelectorAll(".assistant-tool-line")]
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean);
  assert.equal(toolResultLines.some((text) => /stdout:\s*done/i.test(text)), false);
  assert.equal(
    toolResultLines.some((text) => /(回傳結果|Result):\s*MCP server \"pencil\" disabled/i.test(text)),
    true,
  );

  thinkingToggle.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(window.document.querySelectorAll(".assistant-thinking-text").length, 0);

  app.cleanup();
});

test("viewer meta shows total minutes from system turn_duration events", async () => {
  const app = await setupApp();
  const { window } = app;

  const projectButton = window.document.querySelector(".project-btn");
  assert.ok(projectButton);
  projectButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const sessionButton = window.document.querySelector('.entry-btn[data-entry-type="session"]');
  assert.ok(sessionButton);
  sessionButton.click();
  await new Promise((resolve) => setTimeout(resolve, 30));

  const metaText = (window.document.querySelector("#viewer-meta-time")?.textContent || "").trim();
  assert.equal(/3\s*(?:分鐘|min)/i.test(metaText), true);

  app.cleanup();
});
