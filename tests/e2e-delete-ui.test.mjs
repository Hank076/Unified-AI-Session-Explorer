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
      return { path: args.sessionPath, errorCode: null, errors: [], events: [] };
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
