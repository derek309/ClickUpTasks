# ClickUpTasks desktop helper

Lets the "Work with Claude" buttons in the app resume the *same* named
Claude Code session every time you click them for a given task or
client/project, instead of starting a brand-new one each click.

Plain Node scripts — no dependencies, no build step, nothing to compile.
Node is already required to run the main app, so there's nothing extra to
install beyond what you already have.

## One-time setup

Run this once per computer, from a terminal, inside your local
`clickuptasks` checkout:

**macOS:**
```
node desktop-helper/install-mac.mjs
```

**Windows:**
```
node desktop-helper/install-windows.mjs
```

Either script will ask for the path to your local `clickuptasks` checkout,
save it, and register the `clickuptasks://` link handler with the OS. Safe
to re-run any time — it overwrites the saved path/registration rather than
duplicating it, so re-running is also how you fix a moved repo.

## What happens when you click "Work with Claude"

The web app opens a `clickuptasks://work?task=<id>` (or
`?client=<id>&project=<id>`) link. The OS hands that off to this helper,
which:

1. Figures out a stable session name for that task/client scope
   (`cut-t-<taskId>` or `cut-c-<clientId>[-p-<projectId>]`).
2. Checks whether a session with that name already exists for this repo.
3. Pops a visible terminal that either starts a new named session
   (`claude -n <name> "..."`) or resumes the existing one
   (`claude --resume <name> "..."`).

The first time `claude` runs in this repo, it'll ask you to trust the
folder — that's normal Claude Code behavior on first use, not a hang.

## Troubleshooting

- **Nothing happens when you click "Work with Claude" (macOS)** — first,
  re-run `install-mac.mjs`; the registration may not have taken, or the
  saved repo path may be stale. If it still does nothing, macOS Gatekeeper
  may be blocking this locally-built app the way it would any other
  homebrew tool without a paid Apple Developer ID: in Finder, go to
  `~/Applications`, right-click `ClickUpTasksHelper` → **Open**, click
  "Open" on the warning dialog (or check **System Settings → Privacy &
  Security** for a blocked-app notice and click **Open Anyway**), then try
  again.
- **A terminal pops with an error message instead of Claude** — the
  helper always shows errors in a terminal window rather than failing
  silently (it has no console of its own when launched by the OS), so read
  what it says — usually a bad/missing repo path.
- **Windows: no terminal appears at all** — confirm the registry key with
  `reg query "HKCU\Software\Classes\clickuptasks\shell\open\command"`; if
  it's missing, re-run `install-windows.mjs`.
