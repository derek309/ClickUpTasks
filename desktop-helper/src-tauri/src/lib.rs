mod config;
mod terminal;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;

const SETTINGS_LABEL: &str = "settings";

fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then_some(v)
    })
}

// Parses either `clickuptasks://work?task=<id>` (one task) or
// `clickuptasks://work?client=<id>[&project=<id>]` (every open task under a
// client, optionally narrowed to one project) and, once every id present
// passes validation, hands off to the OS-branched terminal spawn. Malformed
// or missing ids are dropped silently (logged to stderr) rather than ever
// reaching a shell string unvalidated.
fn handle_url(app: &AppHandle, url: &str) {
    let Some(query) = url.split_once('?').map(|(_, q)| q) else {
        return;
    };

    let task_id = query_param(query, "task");
    let client_id = query_param(query, "client");
    let project_id = query_param(query, "project");

    for id in [task_id, client_id, project_id].into_iter().flatten() {
        if !terminal::is_valid_id(id) {
            eprintln!("clickuptasks: rejected malformed id: {id:?}");
            return;
        }
    }

    let (label, prompt) = if let Some(id) = task_id {
        (id.to_string(), format!("Look up and start working on ClickUpTasks task {id} using the clickuptasks MCP tools."))
    } else if let Some(cid) = client_id {
        match project_id {
            Some(pid) => (
                format!("{cid}-{pid}"),
                format!("Work through the open tasks for ClickUpTasks client {cid}, project {pid}, using the clickuptasks MCP tools — start with list_client_tasks."),
            ),
            None => (
                cid.to_string(),
                format!("Work through the open tasks for ClickUpTasks client {cid} using the clickuptasks MCP tools — start with list_client_tasks."),
            ),
        }
    } else {
        return;
    };

    let cfg = config::load(app);
    let repo_path = cfg
        .repo_path
        .filter(|p| config::looks_like_repo(p))
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".into());

    if let Err(e) = terminal::open_terminal(&repo_path, &label, &prompt) {
        eprintln!("clickuptasks: failed to open terminal: {e}");
    }
}

#[tauri::command]
fn get_config(app: AppHandle) -> config::Config {
    config::load(&app)
}

#[tauri::command]
fn save_config(app: AppHandle, repo_path: String) -> Result<(), String> {
    config::save(
        &app,
        &config::Config {
            repo_path: Some(repo_path),
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn repo_path_looks_valid(path: String) -> bool {
    config::looks_like_repo(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first — on Windows/Linux this intercepts a
        // second launch (e.g. via the registered clickuptasks:// scheme)
        // and forwards its argv here instead of spawning a new process.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(url) = args.iter().find(|a| a.starts_with("clickuptasks://")) {
                handle_url(app, url);
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            repo_path_looks_valid
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Dev builds aren't installed via the bundler, so on Windows/
            // Linux the OS doesn't know about the scheme yet — register it
            // explicitly there. macOS is a documented no-op here (this
            // plugin only supports dynamic registration on Windows/Linux);
            // on macOS the scheme comes solely from the bundled .app's
            // Info.plist (CFBundleURLTypes, generated from the
            // plugins.deep-link.desktop.schemes config below) — `tauri dev`
            // runs a bare unbundled binary, so deep links can only be
            // tested there against a built .app (`tauri build --debug`).
            #[cfg(debug_assertions)]
            if let Err(e) = app.deep_link().register("clickuptasks") {
                eprintln!("clickuptasks: dev-mode scheme registration skipped: {e}");
            }

            // macOS delivers a deep link to an already-running app via this
            // event (an Apple Event, not argv) — also fires for a cold
            // start's initial URL on every platform.
            {
                let handle2 = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_url(&handle2, url.as_str());
                    }
                });
            }

            // Cold start on Windows/Linux: the URL is a normal argv entry
            // the very first time, before single-instance has a running
            // instance to forward to yet.
            for arg in std::env::args() {
                if arg.starts_with("clickuptasks://") {
                    handle_url(&handle, &arg);
                }
            }

            // Tray icon only — no dock window on ordinary launch.
            let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => show_settings(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // First run, or a saved path that no longer looks like the
            // repo: open Settings automatically instead of silently
            // guessing at a cwd.
            let cfg = config::load(&handle);
            let needs_setup = cfg
                .repo_path
                .as_deref()
                .map_or(true, |p| !config::looks_like_repo(p));
            if needs_setup {
                show_settings(&handle);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Tray-only app — closing the settings window just hides it,
            // it doesn't quit the app or spawn a dock icon again.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
