# Unified AI Session Explorer：Claude 專案歷史瀏覽器

這是一個基於 **Tauri 2** 與 **Rust** 開發的高性能、隱私優先桌面應用程式，專為視覺化與探索本機 Claude 專案歷史而設計。

## 🚀 概覽

Claude 會將專案會話、記憶檔案與子代理日誌以 `.jsonl` 格式儲存在本地。**Unified AI Session Explorer** 提供了一個簡潔且專業的界面，讓你能瀏覽這些紀錄，並具備結構化時間軸、工具調用關聯以及會話元數據統計功能。

## 🔒 隱私至上

你的資料屬於你自己。**Unified AI Session Explorer** 秉持「純本地運作」的設計理念：
- **無雲端同步**：我們不會將你的日誌上傳到任何伺服器。
- **離線處理**：所有解析工作均由 Rust 後端在本機完成。
- **直接存取**：應用程式直接從你的本地檔案系統讀取，不會在隱藏資料庫中建立副本。
- **透明度**：作為開源工具，你可以確切驗證你的資料是如何被處理的。

## ✨ 核心功能

- **專案瀏覽器**：輕鬆瀏覽專案路徑：
  - **macOS/Linux**: `~/.claude/projects`
  - **Windows**: `%USERPROFILE%\.claude\projects`
- **會話時間軸**：將複雜的 `.jsonl` 日誌視覺化為直觀的對話界面。
- **工具調用關聯 (Tool Binding)**：自動將 `tool_use` 調用與對應的 `tool_result` 結果合併為一個統一的卡片。
- **會話元數據**：即時查看模型名稱、Token 消耗量（輸入/輸出）以及會話持續時間。
- **技術事件群組化**：合併背景系統事件（進度、Shell 指令等），確保對話焦點不被干擾。
- **多語系支援**：透過 `src/i18n.js` 管理（支援英文與繁體中文）。
- **主題支援**：透過 `src/theme.js` 與 CSS 變數處理深色/淺色模式切換。

## 🛠️ 技術棧

- **後端**：Rust (Tauri 2) - 負責高性能檔案 I/O 與 JSONL 解析。
- **前端**：原生 HTML5, CSS3 與 ES6+ JavaScript - 輕量且**無框架**負擔。
- **資料來源**：直接存取本地 Claude 專案目錄。

## 🚦 入門指南

### 準備工作

- [Node.js](https://nodejs.org/) (v22+)
- [Rust](https://www.rust-lang.org/) (Stable toolchain)
- Tauri 必要元件 (參考 [Tauri 官方文件](https://tauri.app/start/prerequisites/))

### 安裝與執行

1. 複製儲存庫：
   ```bash
   git clone https://github.com/Hank076/Unified-AI-Session-Explorer.git
   cd Unified-AI-Session-Explorer
   ```

2. 安裝依賴：
   ```bash
   npm install
   ```

3. 啟動開發模式：
   ```bash
   # 使用 Tauri 容器執行
   npm run tauri dev

   # 僅執行網頁端 (需 http-server)
   npm run dev:web
   ```

4. 執行測試：
   ```bash
   # 前端與多國語系測試
   npm test

   # 後端測試
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

## 📂 專案結構

- `src-tauri/`：Rust 後端邏輯、檔案系統指令與解析規則。
- `src/`：前端 UI 資源。
  - `i18n.js`：多國語系字典與邏輯。
  - `theme.js`：主題切換與狀態保存。
  - `main.js`：主要應用程式邏輯與狀態管理。
  - `styles.css`：使用 CSS 變數的全域樣式。
- `tests/`：前端與多國語系測試套件。

## 📄 授權協議

本專案採用 MIT 授權協議。詳情請參閱 `LICENSE`。
