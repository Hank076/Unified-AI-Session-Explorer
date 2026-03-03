# Chronicle AI：Claude 專案歷史瀏覽器

這是一個基於 **Tauri 2** 與 **Rust** 開發的高性能、隱私優先桌面應用程式，專為視覺化與探索本機 Claude 專案歷史而設計。

## 🚀 概覽

Claude 會將專案會話、記憶檔案與子代理日誌以 `.jsonl` 格式儲存在本地。**Chronicle AI** 提供了一個簡潔且專業的界面，讓你能瀏覽這些紀錄，並具備結構化時間軸、工具調用關聯以及會話元數據統計功能。

## ✨ 核心功能

- **專案瀏覽器**：輕鬆瀏覽位於 `~/.claude/projects` 中的所有專案。
- **會話時間軸**：將複雜的 `.jsonl` 日誌視覺化為直觀的對話界面。
- **工具調用關聯 (Tool Binding)**：自動將 `tool_use` 調用與對應的 `tool_result` 結果合併為一個統一的卡片。
- **會話元數據**：即時查看模型名稱、Token 消耗量（輸入/輸出）以及會話持續時間。
- **技術事件群組化**：合併背景系統事件（進度、Shell 指令等），確保對話焦點不被干擾。
- **本地與隱私**：所有解析與資料存取均在你的電腦上完成，不向外部伺服器發送任何資料。
- **多語系支援**：完整支援英文與繁體中文 (zh-Hant-TW)。
- **主題支援**：現代感的深色模式與高對比度的淺色模式。

## 🛠️ 技術棧

- **後端**：Rust (Tauri 2) - 負責高性能檔案 I/O 與 JSONL 解析。
- **前端**：原生 HTML5, CSS3 與 ES6+ JavaScript - 輕量且無框架負擔。
- **資料來源**：直接存取本地 `.claude/projects` 目錄。

## 🚦 入門指南

### 準備工作

- [Node.js](https://nodejs.org/) (v22+)
- [Rust](https://www.rust-lang.org/) (Stable toolchain)
- Tauri 必要元件 (參考 [Tauri 官方文件](https://tauri.app/start/prerequisites/))

### 安裝與執行

1. 複製儲存庫：
   ```bash
   git clone https://github.com/your-username/chronicle-ai.git
   cd chronicle-ai
   ```

2. 安裝依賴：
   ```bash
   npm install
   ```

3. 啟動開發模式：
   ```bash
   npm run tauri dev
   ```

## 📂 專案結構

- `src-tauri/`：Rust 後端邏輯、檔案系統指令與解析規則。
- `src/`：前端 UI 資源（HTML, CSS, 原生 JS）。
- `docs/`：設計文件與技術規格書。
- `tests/`：前端與多國語系測試套件。

## 🗺️ 開發路線圖

- [ ] 全域關鍵字搜尋（跨會話）。
- [ ] 支援 Gemini 與 Codex 的本地歷史紀錄。
- [ ] 將會話匯出為 Markdown 或 PDF。
- [ ] 針對極大型（>100MB）日誌檔案的效能優化。

## 📄 授權協議

本專案採用 MIT 授權協議。詳情請參閱 `LICENSE`。
