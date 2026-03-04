use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

const ERR_NOT_FOUND: &str = "NOT_FOUND";
const ERR_READ_FAILED: &str = "READ_FAILED";
const ERR_PARSE_PARTIAL: &str = "PARSE_PARTIAL";
const NEGATIVE_CWD_CACHE_TTL_MS: u64 = 60_000;
const CWD_CACHE_FALLBACK_TTL_MS: u64 = 300_000;

static PROJECT_CWD_CACHE: OnceLock<Mutex<HashMap<String, ProjectCwdCacheEntry>>> = OnceLock::new();

#[derive(Debug, Clone)]
struct ProjectCwdCacheEntry {
    cwd_path: Option<String>,
    source_session: Option<PathBuf>,
    source_session_mtime_ms: Option<u64>,
    cached_at_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    name: String,
    path: String,
    cwd_path: Option<String>,
    modified_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    entry_type: String,
    label: String,
    path: String,
    parent_session: Option<String>,
    modified_ms: Option<u64>,
    size_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPayload {
    path: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseError {
    line: usize,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    line: usize,
    timestamp: Option<String>,
    role: Option<String>,
    event_type: Option<String>,
    summary: String,
    raw: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
    pub model_name: Option<String>,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTimelinePayload {
    pub path: String,
    pub error_code: Option<String>,
    pub errors: Vec<ParseError>,
    pub events: Vec<TimelineEvent>,
    pub metadata: SessionMetadata,
}

#[tauri::command]
pub fn list_projects(base_path: Option<String>) -> Result<Vec<Project>, String> {
    let root = resolve_root_path(base_path.as_deref())?;
    let mut projects = Vec::new();

    for item in fs::read_dir(root).map_err(map_read_error)? {
        let item = item.map_err(map_read_error)?;
        let file_type = item.file_type().map_err(map_read_error)?;
        if !file_type.is_dir() {
            continue;
        }

        let path = item.path();
        let cwd_path = infer_project_cwd_path_cached(&path);
        let name = cwd_path
            .as_deref()
            .and_then(project_name_from_cwd)
            .unwrap_or_else(|| item.file_name().to_string_lossy().to_string());
        let (modified_ms, _) = get_file_metadata(&path);
        projects.push(Project {
            name,
            path: path.to_string_lossy().to_string(),
            cwd_path,
            modified_ms,
        });
    }

    projects.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(projects)
}

#[tauri::command]
pub fn list_project_entries(
    project_path: String,
    base_path: Option<String>,
) -> Result<Vec<Entry>, String> {
    let root = resolve_root_path(base_path.as_deref())?;
    let project = validate_under_root(&root, Path::new(&project_path))?;
    if !project.is_dir() {
        return Err(ERR_NOT_FOUND.to_string());
    }

    let mut entries = Vec::new();
    let memory_dir = project.join("memory");
    if memory_dir.is_dir() {
        let mut memory_files = Vec::new();
        collect_files_recursive(&memory_dir, &mut memory_files)?;
        memory_files.sort_by_key(|path| {
            path.to_string_lossy()
                .to_string()
                .to_lowercase()
        });

        for memory_file in memory_files {
            let label = memory_file
                .file_name()
                .map(|v| v.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let (modified_ms, size_bytes) = get_file_metadata(&memory_file);
            entries.push(Entry {
                entry_type: "memory_file".to_string(),
                label,
                path: memory_file.to_string_lossy().to_string(),
                parent_session: None,
                modified_ms,
                size_bytes,
            });
        }
    }

    let mut sessions: Vec<PathBuf> = fs::read_dir(&project)
        .map_err(map_read_error)?
        .filter_map(|item| item.ok().map(|v| v.path()))
        .filter(|path| path.is_file() && has_jsonl_extension(path))
        .collect();
    sessions.sort_by(|a, b| {
        let (a_mod, _) = get_file_metadata(a);
        let (b_mod, _) = get_file_metadata(b);
        b_mod.cmp(&a_mod)
    });

    for session in sessions {
        let stem = session
            .file_stem()
            .map(|v| v.to_string_lossy().to_string())
            .unwrap_or_default();
        let session_label = session
            .file_name()
            .map(|v| v.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown.jsonl".to_string());

        let (modified_ms, size_bytes) = get_file_metadata(&session);
        entries.push(Entry {
            entry_type: "session".to_string(),
            label: session_label,
            path: session.to_string_lossy().to_string(),
            parent_session: None,
            modified_ms,
            size_bytes,
        });

        let subagents_dir = project.join(&stem).join("subagents");
        if !subagents_dir.is_dir() {
            continue;
        }

        let mut subagent_files: Vec<PathBuf> = fs::read_dir(subagents_dir)
            .map_err(map_read_error)?
            .filter_map(|item| item.ok().map(|v| v.path()))
            .filter(|path| path.is_file() && has_jsonl_extension(path))
            .collect();
        subagent_files.sort_by_key(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_lowercase())
                .unwrap_or_default()
        });

        for subagent_file in subagent_files {
            let label = subagent_file
                .file_name()
                .map(|v| v.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown.jsonl".to_string());
            let (modified_ms, size_bytes) = get_file_metadata(&subagent_file);
            entries.push(Entry {
                entry_type: "subagent_session".to_string(),
                label,
                path: subagent_file.to_string_lossy().to_string(),
                parent_session: Some(stem.clone()),
                modified_ms,
                size_bytes,
            });
        }
    }

    Ok(entries)
}

#[tauri::command]
pub fn read_memory(memory_path: String, base_path: Option<String>) -> Result<MemoryPayload, String> {
    let root = resolve_root_path(base_path.as_deref())?;
    let memory_file = validate_under_root(&root, Path::new(&memory_path))?;
    if !memory_file.is_file() {
        return Err(ERR_NOT_FOUND.to_string());
    }
    let content = fs::read_to_string(&memory_file).map_err(map_read_error)?;
    Ok(MemoryPayload {
        path: memory_file.to_string_lossy().to_string(),
        content,
    })
}

#[tauri::command]
pub fn read_session_timeline(
    session_path: String,
    base_path: Option<String>,
) -> Result<SessionTimelinePayload, String> {
    let root = resolve_root_path(base_path.as_deref())?;
    let session_file = validate_under_root(&root, Path::new(&session_path))?;
    if !session_file.is_file() {
        return Err(ERR_NOT_FOUND.to_string());
    }
    if !has_jsonl_extension(&session_file) {
        return Err(ERR_READ_FAILED.to_string());
    }

    let content = fs::read_to_string(&session_file).map_err(map_read_error)?;
    let mut events = Vec::new();
    let mut errors = Vec::new();

    let mut model_name = None;
    let mut total_input_tokens = 0;
    let mut total_output_tokens = 0;

    for (index, line) in content.lines().enumerate() {
        let line_number = index + 1;
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<Value>(line) {
            Ok(value) => {
                // 統計元數據
                if model_name.is_none() {
                    model_name = extract_string(&value, &["model", "model_name", "request.model"]);
                }
                
                if let Some(usage) = value.get("usage").or_else(|| value.get("message").and_then(|m| m.get("usage"))) {
                    total_input_tokens += usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    total_output_tokens += usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                }

                events.push(build_timeline_event(line_number, value));
            }
            Err(_) => errors.push(ParseError {
                line: line_number,
                message: "invalid json".to_string(),
            }),
        }
    }

    sort_events_by_time(&mut events);

    let start_time = events.first().and_then(|e| e.timestamp.clone());
    let end_time = events.last().and_then(|e| e.timestamp.clone());

    Ok(SessionTimelinePayload {
        path: session_file.to_string_lossy().to_string(),
        error_code: if errors.is_empty() {
            None
        } else {
            Some(ERR_PARSE_PARTIAL.to_string())
        },
        errors,
        events,
        metadata: SessionMetadata {
            model_name,
            total_input_tokens,
            total_output_tokens,
            start_time,
            end_time,
        },
    })
}

fn build_timeline_event(line: usize, raw: Value) -> TimelineEvent {
    let timestamp = extract_string(&raw, &["timestamp", "created_at", "time", "ts"]);
    let role = extract_string(&raw, &["role", "speaker", "author", "actor"]);
    let event_type = extract_string(&raw, &["type", "event_type", "event"]);
    let summary = build_summary(&raw);

    TimelineEvent {
        line,
        timestamp,
        role,
        event_type,
        summary,
        raw,
    }
}

fn sort_events_by_time(events: &mut [TimelineEvent]) {
    let has_any_timestamp = events.iter().any(|event| event.timestamp.is_some());
    if !has_any_timestamp {
        return;
    }

    events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp).then(a.line.cmp(&b.line)));
}

fn build_summary(value: &Value) -> String {
    if let Some(text) = extract_string(value, &["content", "message", "text", "summary"]) {
        return truncate(&text, 240);
    }
    truncate(&value.to_string(), 240)
}

fn truncate(input: &str, max_len: usize) -> String {
    if input.chars().count() <= max_len {
        return input.to_string();
    }
    let shortened: String = input.chars().take(max_len).collect();
    format!("{shortened}...")
}

fn extract_string(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        let found = value.get(key).and_then(|v| v.as_str());
        if let Some(s) = found {
            if !s.trim().is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn infer_project_cwd_path_cached(project_dir: &Path) -> Option<String> {
    let key = project_dir.to_string_lossy().to_string();
    let now_ms = now_unix_ms();

    if let Some(cached) = get_cached_project_cwd(&key) {
        if let Some(source) = cached.source_session.as_ref() {
            let current_mtime = get_file_metadata(source).0;
            if current_mtime == cached.source_session_mtime_ms {
                return cached.cwd_path;
            }
        } else if cached.cwd_path.is_none() {
            if now_ms.saturating_sub(cached.cached_at_ms) < NEGATIVE_CWD_CACHE_TTL_MS {
                return None;
            }
        } else if now_ms.saturating_sub(cached.cached_at_ms) < CWD_CACHE_FALLBACK_TTL_MS {
            return cached.cwd_path;
        }
    }

    let fresh = infer_project_cwd_with_source(project_dir, now_ms);
    set_cached_project_cwd(&key, fresh.clone());
    fresh.cwd_path
}

fn infer_project_cwd_with_source(project_dir: &Path, cached_at_ms: u64) -> ProjectCwdCacheEntry {
    let mut session_files: Vec<PathBuf> = match fs::read_dir(project_dir) {
        Ok(read_dir) => read_dir
            .filter_map(|item| item.ok().map(|v| v.path()))
            .filter(|path| path.is_file() && has_jsonl_extension(path))
            .collect(),
        Err(_) => {
            return ProjectCwdCacheEntry {
                cwd_path: None,
                source_session: None,
                source_session_mtime_ms: None,
                cached_at_ms,
            };
        }
    };

    if session_files.is_empty() {
        return ProjectCwdCacheEntry {
            cwd_path: None,
            source_session: None,
            source_session_mtime_ms: None,
            cached_at_ms,
        };
    }

    session_files.sort_by(|a, b| {
        let (a_mod, a_size) = get_file_metadata(a);
        let (b_mod, b_size) = get_file_metadata(b);
        a_size.cmp(&b_size).then(a_mod.cmp(&b_mod)).then(a.cmp(b))
    });

    for session_file in &session_files {
        let session_mtime = get_file_metadata(session_file).0;
        if let Some(cwd) = extract_cwd_from_session_file(&session_file, 300) {
            return ProjectCwdCacheEntry {
                cwd_path: Some(cwd),
                source_session: Some(session_file.clone()),
                source_session_mtime_ms: session_mtime,
                cached_at_ms,
            };
        }
    }

    ProjectCwdCacheEntry {
        cwd_path: None,
        source_session: None,
        source_session_mtime_ms: None,
        cached_at_ms,
    }
}

fn get_cached_project_cwd(key: &str) -> Option<ProjectCwdCacheEntry> {
    let cache = PROJECT_CWD_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let guard = cache.lock().ok()?;
    guard.get(key).cloned()
}

fn set_cached_project_cwd(key: &str, entry: ProjectCwdCacheEntry) {
    let cache = PROJECT_CWD_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut guard) = cache.lock() {
        guard.insert(key.to_string(), entry);
    }
}

fn extract_cwd_from_session_file(path: &Path, max_lines: usize) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    for line_result in reader.lines().take(max_lines) {
        let line = line_result.ok()?;
        if line.trim().is_empty() {
            continue;
        }
        let value = match serde_json::from_str::<Value>(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(cwd) = find_string_by_key_recursive(&value, &["cwd", "current_working_directory"]) {
            return Some(cwd);
        }
    }
    None
}

fn find_string_by_key_recursive(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(text) = map.get(*key).and_then(|v| v.as_str()) {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
            for child in map.values() {
                if let Some(found) = find_string_by_key_recursive(child, keys) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => {
            for item in items {
                if let Some(found) = find_string_by_key_recursive(item, keys) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn project_name_from_cwd(cwd: &str) -> Option<String> {
    let mut last = None;
    for component in Path::new(cwd).components() {
        if let Component::Normal(value) = component {
            let text = value.to_string_lossy().trim().to_string();
            if !text.is_empty() {
                last = Some(text);
            }
        }
    }
    last
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn has_jsonl_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("jsonl"))
        .unwrap_or(false)
}

fn collect_files_recursive(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for item in fs::read_dir(dir).map_err(map_read_error)? {
        let item = item.map_err(map_read_error)?;
        let path = item.path();
        if path.is_dir() {
            collect_files_recursive(&path, out)?;
        } else if path.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

fn resolve_root_path(base_path: Option<&str>) -> Result<PathBuf, String> {
    let root = if let Some(path) = base_path {
        PathBuf::from(path)
    } else {
        default_projects_path()?
    };

    if !root.exists() {
        return Err(ERR_NOT_FOUND.to_string());
    }
    root.canonicalize().map_err(map_read_error)
}

fn validate_under_root(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let canonical_target = target.canonicalize().map_err(map_read_error)?;
    if !canonical_target.starts_with(root) {
        return Err(ERR_READ_FAILED.to_string());
    }
    Ok(canonical_target)
}

fn default_projects_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| ERR_READ_FAILED.to_string())?;
    Ok(home.join(".claude").join("projects"))
}

fn map_read_error(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => ERR_NOT_FOUND.to_string(),
        _ => ERR_READ_FAILED.to_string(),
    }
}

fn get_file_metadata(path: &Path) -> (Option<u64>, Option<u64>) {
    let Ok(meta) = fs::metadata(path) else {
        return (None, None);
    };

    let size = Some(meta.len());
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| u64::try_from(duration.as_millis()).ok());

    (modified_ms, size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("claude-projects-browser-{name}-{ts}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, content).expect("write file");
    }

    fn clear_project_cwd_cache() {
        let cache = PROJECT_CWD_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        cache.lock().expect("lock cache").clear();
    }

    #[test]
    fn list_entries_memory_first_and_include_subagents() {
        clear_project_cwd_cache();
        let root = unique_temp_dir("entries");
        let project = root.join("demo");
        fs::create_dir_all(&project).expect("create project");
        write_file(&project.join("memory").join("MEMORY.md"), "# memory");
        write_file(
            &project.join("alpha.jsonl"),
            "{\"timestamp\":\"2026-03-01T00:00:00Z\",\"content\":\"hello\"}",
        );
        write_file(&project.join("alpha").join("subagents").join("s1.jsonl"), "{\"content\":\"sub\"}");

        let entries = list_project_entries(
            project.to_string_lossy().to_string(),
            Some(root.to_string_lossy().to_string()),
        )
        .expect("list entries");

        assert!(!entries.is_empty());
        assert_eq!(entries[0].entry_type, "memory_file");
        assert!(entries.iter().any(|v| v.entry_type == "session"));
        assert!(entries.iter().any(|v| v.entry_type == "subagent_session"));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn parse_session_keeps_valid_events_and_reports_partial_error() {
        clear_project_cwd_cache();
        let root = unique_temp_dir("timeline");
        let session = root.join("mixed.jsonl");
        write_file(
            &session,
            "{\"timestamp\":\"2026-03-01T00:00:00Z\",\"content\":\"ok1\"}\n{broken}\n{\"timestamp\":\"2026-03-02T00:00:00Z\",\"content\":\"ok2\"}\n",
        );

        let payload = read_session_timeline(
            session.to_string_lossy().to_string(),
            Some(root.to_string_lossy().to_string()),
        )
        .expect("parse session");

        assert_eq!(payload.error_code.as_deref(), Some(ERR_PARSE_PARTIAL));
        assert_eq!(payload.errors.len(), 1);
        assert_eq!(payload.events.len(), 2);

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn list_projects_prefers_cwd_name_when_available() {
        clear_project_cwd_cache();
        let root = unique_temp_dir("projects-cwd");
        let encoded = root.join("d-Hank-Dropbox-Claude-History");
        fs::create_dir_all(&encoded).expect("create encoded project");
        write_file(
            &encoded.join("a.jsonl"),
            "{\"cwd\":\"D:\\\\Hank\\\\Dropbox\\\\Claude-History\\\\actual-project\"}\n",
        );

        let projects = list_projects(Some(root.to_string_lossy().to_string())).expect("list projects");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "actual-project");
        assert_eq!(
            projects[0].cwd_path.as_deref(),
            Some("D:\\Hank\\Dropbox\\Claude-History\\actual-project")
        );

        fs::remove_dir_all(root).expect("cleanup");
    }
}
