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
// Note that Follow Up is deliberately NOT behind this switch. It sits inside
// the Territories nav block for historical reasons but is task-driven, not
// city-driven, and is used daily, so it is rendered on its own while
// territories are off.
//
// The planner-auto-invite cron is disabled alongside this, in vercel.json and
// in .github/workflows/planner-auto-invite-backup.yml. Leaving them running
// would keep sending invites for a surface nobody can see.
export const TERRITORIES_ENABLED = false;
