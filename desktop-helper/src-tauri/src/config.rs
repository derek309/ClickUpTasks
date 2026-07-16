use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Config {
    pub repo_path: Option<String>,
}

fn config_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("config.json"))
}

pub fn load(app: &AppHandle) -> Config {
    config_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, config: &Config) -> std::io::Result<()> {
    let p = config_path(app)?;
    let s = serde_json::to_string_pretty(config)?;
    std::fs::write(p, s)
}

// Cheap sanity check from the plan: does this look like the clickuptasks
// repo (does mcp/server.mjs exist under it)? A missing or bad path falls
// back to the user's home dir at launch time rather than blocking outright —
// the cd target is just a sane default cwd, not required for MCP access
// (that's registered globally, independent of this app).
pub fn looks_like_repo(path: &str) -> bool {
    std::path::Path::new(path)
        .join("mcp")
        .join("server.mjs")
        .exists()
}
