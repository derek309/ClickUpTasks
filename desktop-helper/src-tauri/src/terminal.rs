use std::process::Command;

// The task id is the only untrusted data that ever gets interpolated into a
// shell string — this regex *is* the injection control. Applied once, at
// the point the id is first received (lib.rs), before it touches anything
// below.
pub fn is_valid_task_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn seed_prompt(task_id: &str) -> String {
    format!("Look up and start working on ClickUpTasks task {task_id} using the clickuptasks MCP tools.")
}

pub fn open_terminal(repo_path: &str, task_id: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    return open_terminal_macos(repo_path, task_id);
    #[cfg(target_os = "windows")]
    return open_terminal_windows(repo_path, task_id);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (repo_path, task_id);
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "clickuptasks helper only supports macOS and Windows",
        ))
    }
}

// POSIX single-quote escaping: close the quote, insert an escaped literal
// quote, reopen the quote. Safe for any byte string, not just the id.
#[cfg(target_os = "macos")]
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

// AppleScript's `"..."` string literal needs its own backslash/quote
// escaping, applied to the *already POSIX-quoted* shell command — two
// nested escaping layers, per the plan.
#[cfg(target_os = "macos")]
fn escape_for_applescript(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
fn open_terminal_macos(repo_path: &str, task_id: &str) -> std::io::Result<()> {
    let prompt = seed_prompt(task_id);
    let shell_cmd = format!(
        "cd {} && claude {}",
        shell_quote(repo_path),
        shell_quote(&prompt)
    );
    let osa_script = format!(
        "tell application \"Terminal\" to do script \"{}\"",
        escape_for_applescript(&shell_cmd)
    );
    Command::new("osascript")
        .arg("-e")
        .arg(osa_script)
        .spawn()?;
    Ok(())
}

// UNTESTED — written carefully against documented cmd.exe/Windows Terminal
// behavior, but this machine is macOS-only and there's no substitute for
// running it on a real Windows box. Flag any failure here first.
//
// Rather than fight wt.exe's fragile argv parsing with a fully-quoted
// inline command, the whole command lives inside a short-lived .cmd script
// written to the temp dir — all the quoting complexity stays in the file,
// not on wt.exe's command line.
#[cfg(target_os = "windows")]
fn open_terminal_windows(repo_path: &str, task_id: &str) -> std::io::Result<()> {
    let prompt = seed_prompt(task_id);
    let script_path = std::env::temp_dir().join(format!("clickuptasks-launch-{task_id}.cmd"));
    let script = format!(
        "@echo off\r\ncd /d \"{}\"\r\nclaude \"{}\"\r\n",
        repo_path.replace('"', "\"\""),
        prompt.replace('"', "\"\"")
    );
    std::fs::write(&script_path, script)?;

    let wt = Command::new("wt.exe")
        .arg("-d")
        .arg(repo_path)
        .arg("cmd")
        .arg("/k")
        .arg(&script_path)
        .spawn();
    if wt.is_err() {
        Command::new("cmd.exe").arg("/K").arg(&script_path).spawn()?;
    }
    Ok(())
}
