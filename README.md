# Claude Projects Browser

一個使用 `Tauri 2 + Vanilla HTML/CSS/JS` 的桌面工具，用來瀏覽 `~/.claude/projects`。

## 功能

- 左欄：列出 `~/.claude/projects` 第一層專案資料夾
- 中欄：`MEMORY.md`（存在時置頂）+ 主 session `.jsonl` + 同名資料夾下 `subagents/*.jsonl`
- 右欄：
  - `MEMORY.md` 唯讀內容
  - `.jsonl` 解析後時間軸（含部分壞行容錯）

## 開發需求

- Node.js 22+
- Rust stable toolchain
- Tauri prerequisites: https://tauri.app/start/prerequisites/

## 啟動

```bash
npm install
npm run tauri dev
```

## 測試

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
