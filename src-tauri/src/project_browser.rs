use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const ERR_NOT_FOUND: &str = "NOT_FOUND";
const ERR_READ_FAILED: &str = "READ_FAILED";
const ERR_PARSE_PARTIAL: &str = "PARSE_PARTIAL";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    name: String,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    entry_type: String,
    label: String,
    path: String,
    parent_session: Option<String>,
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
pub struct SessionTimelinePayload {
    path: String,
    error_code: Option<String>,
    errors: Vec<ParseError>,
    events: Vec<TimelineEvent>,
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

        let name = item.file_name().to_string_lossy().to_string();
        let path = item.path();
        projects.push(Project {
            name,
            path: path.to_string_lossy().to_string(),
        });
    }

    projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
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
    let memory_path = project.join("memory").join("MEMORY.md");
    if memory_path.is_file() {
        entries.push(Entry {
            entry_type: "memory".to_string(),
            label: "MEMORY.md".to_string(),
            path: memory_path.to_string_lossy().to_string(),
            parent_session: None,
        });
    }

    let mut sessions: Vec<PathBuf> = fs::read_dir(&project)
        .map_err(map_read_error)?
        .filter_map(|item| item.ok().map(|v| v.path()))
        .filter(|path| path.is_file() && has_jsonl_extension(path))
        .collect();
    sessions.sort_by_key(|path| {
        path.file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_default()
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

        entries.push(Entry {
            entry_type: "session".to_string(),
            label: session_label,
            path: session.to_string_lossy().to_string(),
            parent_session: None,
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
            entries.push(Entry {
                entry_type: "subagent_session".to_string(),
                label,
                path: subagent_file.to_string_lossy().to_string(),
                parent_session: Some(stem.clone()),
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

    for (index, line) in content.lines().enumerate() {
        let line_number = index + 1;
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<Value>(line) {
            Ok(value) => events.push(build_timeline_event(line_number, value)),
            Err(_) => errors.push(ParseError {
                line: line_number,
                message: "invalid json".to_string(),
            }),
        }
    }

    sort_events_by_time(&mut events);

    Ok(SessionTimelinePayload {
        path: session_file.to_string_lossy().to_string(),
        error_code: if errors.is_empty() {
            None
        } else {
            Some(ERR_PARSE_PARTIAL.to_string())
        },
        errors,
        events,
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

fn has_jsonl_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("jsonl"))
        .unwrap_or(false)
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
