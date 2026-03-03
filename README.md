# TraceLens: Claude Projects Browser

A high-performance, privacy-focused desktop application built with **Tauri 2** and **Rust** to visualize and explore your local Claude project history.

## 🚀 Overview

Claude saves its project sessions, memory files, and subagent logs locally in `.jsonl` format. **TraceLens** provides a clean, professional interface to browse these records, complete with a structured timeline, tool-use binding, and session metadata statistics.

## 🔒 Privacy First

Your data is your own. **TraceLens** is designed with a "Local-Only" philosophy:
- **No Cloud Sync**: We do not upload your logs to any server.
- **Offline Processing**: All parsing is done locally by the Rust backend.
- **Direct Access**: The app reads directly from your local filesystem without creating copies in hidden databases.
- **Transparency**: As an open-source tool, you can verify exactly how your data is handled.

## ✨ Key Features

- **Project Explorer**: Effortlessly browse all projects located in `~/.claude/projects`.
- **Session Timeline**: Visualize complex `.jsonl` logs as an intuitive chat interface.
- **Tool-Use Binding**: Automatically correlates `tool_use` calls with their corresponding `tool_result` into a single, unified card.
- **Session Metadata**: Instant visibility into Model names, Token usage (Input/Output), and session duration.
- **Technical Event Grouping**: Consolidates background system events (progress, shell commands, etc.) to keep the conversation focused.
- **Local & Private**: All parsing and data access stay on your machine. No data is sent to external servers.
- **Multi-language Support**: Full support for English and Traditional Chinese (zh-Hant-TW).
- **Theme Support**: Modern Dark mode and high-contrast Light mode.

## 🛠️ Tech Stack

- **Backend**: Rust (Tauri 2) - High-performance file I/O and JSONL parsing.
- **Frontend**: Vanilla HTML5, CSS3, and ES6+ JavaScript - Lightweight and framework-free.
- **Data Source**: Direct access to local `.claude/projects` directory.

## 🚦 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22+)
- [Rust](https://www.rust-lang.org/) (Stable toolchain)
- Tauri Prerequisites (See [Tauri Docs](https://tauri.app/start/prerequisites/))

### Installation & Run

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/tracelens.git
   cd tracelens
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start development mode:
   ```bash
   npm run tauri dev
   ```

## 📂 Project Structure

- `src-tauri/`: Rust backend logic, file system commands, and parsing rules.
- `src/`: Frontend UI assets (HTML, CSS, Vanilla JS).
- `docs/`: Design documents and technical specifications.
- `tests/`: Frontend and i18n test suites.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
