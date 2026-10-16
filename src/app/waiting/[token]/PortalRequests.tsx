"use client";

// What we need from the client (Derek and Justin, 2026-10-15,
// client-reminders-mockup.html section 4): the full list grouped Overdue,
// Today, This week and Later in our own order, each row opening that task's
// page (Derek, 2026-10-16: the task page replaced the one request card).
import { groupedQueue, rowDate, type PortalRequest } from "@/lib/portalRequests";

const TONE = { late: "text-danger", today: "text-highlight", plain: "text-muted" } as const;

/** Everything we need from them, grouped as on our side, each row opening it. */
export function RequestList({ queue, today, listName, onOpen }: {
  queue: PortalRequest[];
  today: string;
  listName: (id: string | null) => string | null;
  onOpen: (r: PortalRequest) => void;
}) {
  const head = { overdue: "bg-danger-soft text-danger", today: "bg-highlight-soft text-highlight", week: "bg-background text-foreground", later: "bg-background text-foreground" } as const;
  return (
    <div className="grid gap-3">
      {groupedQueue(queue, today).map((g) => (
        <section key={g.group} className="overflow-hidden rounded-[5px] border bg-surface shadow-[var(--shadow-sm)]">
          <h3 className={`flex items-center gap-2 border-b px-4 py-2.5 text-[16px] font-bold ${head[g.group]}`}>
            {g.label} <span className="font-semibold text-muted">{g.items.length}</span>
          </h3>
          {g.items.map((r, i) => {
            const d = rowDate(r.needBy, today);
            const list = listName(r.listId);
            return (
              <button key={r.key} onClick={() => onOpen(r)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 text-left hover:bg-background ${i ? "border-t" : ""}`}>
                <span className="min-w-0">
                  <b className="block break-words text-[17px] font-semibold">{r.ask}</b>
                  <span className="block text-[16px] text-muted [overflow-wrap:anywhere]">{[r.taskTitle.trim(), list].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={`whitespace-nowrap text-[16px] ${d ? `${TONE[d.tone]} ${d.tone === "plain" ? "" : "font-bold"}` : "text-muted"}`}>{d?.text ?? ""} <span aria-hidden className="text-muted">›</span></span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
