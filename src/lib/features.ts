// Feature switches for capabilities that are built and working but deliberately
// not in use right now.
//
// A switch rather than deleted code: these are paused, not wrong. Ripping out a
// working feature means rebuilding and re-testing it to turn it back on, and
// the data (territories, planner weeks, invite history) stays in Supabase
// either way, so deleting the UI would only strand it.

// Territories: per-city prospecting, the Content Planner, and the daily
// auto-invite queue.
//
// Off since 2026-08-13 — territory work and the Playbooks are moving to
// GoHighLevel. Turning this back on restores the sidebar city list and the
// Settings tab exactly as they were; nothing is destroyed while it is off.
//
// Follow Up goes with it — see the note below.
//
// The planner-auto-invite cron is disabled alongside this, in vercel.json and
// in .github/workflows/planner-auto-invite-backup.yml. Leaving them running
// would keep sending invites for a surface nobody can see.
export const TERRITORIES_ENABLED = false;

// Follow Up went with it on 2026-08-13. It was held back for one deploy on the
// assumption it was still worked daily; it is not. Sales, the Playbook and
// follow-up are all moving to GoHighLevel, so ClickUpTasks stops being where
// that work is managed.
//
// The Playbook itself is NOT unpicked here. It is woven through Clients (the
// per-client Playbook project, its tasks, the completion badges), and Clients
// is still used daily, so tearing it out would risk the surface that still
// matters. What IS switched off is the machinery that runs on its own: the
// playbook-checkins cron, which created stall check-in tasks and reconciled new
// Playbook rows for every client without anyone asking. That is also a real
// contributor to the tasks table being 28k rows.
