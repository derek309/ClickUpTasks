// One color per review stage, everywhere a stage shows: the document's badge
// and stage menu, a step's client work, the waiting step and the "Use with"
// picks (Derek, 2026-10-11: "approve green, changes red, review yellow, draft
// gray"). Its own palette: the task statuses keep theirs.
export const REVIEW_TONE: Record<string, { label: string; dot: string; chip: string; text: string }> = {
  draft: { label: "Draft", dot: "#94a3b8", chip: "#f1f5f9", text: "#475569" },
  with_client: { label: "Client review", dot: "#f59e0b", chip: "#fffbeb", text: "#b45309" },
  client_submitted: { label: "Changes", dot: "#ef4444", chip: "#fef2f2", text: "#b91c1c" },
  approved: { label: "Approved", dot: "#22c55e", chip: "#f0fdf4", text: "#15803d" },
  completed: { label: "Completed", dot: "#3b82f6", chip: "#eff6ff", text: "#1d4ed8" },
};
export const reviewTone = (status: string | null | undefined) => REVIEW_TONE[status ?? "draft"] ?? REVIEW_TONE.draft;
