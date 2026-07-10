"use client";

// The "Conversations" inbox under My Work — a Gmail-style list of every
// message thread (one row per contact), newest first, with unread/read and
// star state. Rows are presentational only; Cockpit.tsx owns the derived
// `conversations` list and all mutation (marking read, starring).
import { useState } from "react";
import { timeAgo, type Client, type Message } from "@/lib/data";
import { I } from "./ui";

export interface ConversationRow {
  contactId: string;
  client: Client | null;
  last: Message;
  unread: number;
}

type Filter = "all" | "unread" | "starred";

export function ConversationsInbox({ conversations, starred, onToggleStar, onOpen }: {
  conversations: ConversationRow[];
  starred: Set<string>;
  onToggleStar: (contactId: string) => void;
  onOpen: (contactId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = conversations.filter((c) =>
    filter === "unread" ? c.unread > 0 : filter === "starred" ? starred.has(c.contactId) : true
  );

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mb-3 inline-flex overflow-hidden rounded-md border">
        {([["all", "All"], ["unread", "Unread"], ["starred", "Starred"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setFilter(v)} className={`px-2.5 py-1.5 text-[13px] font-medium ${filter === v ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>
            {label}{v === "unread" && conversations.some((c) => c.unread > 0) ? ` · ${conversations.filter((c) => c.unread > 0).length}` : ""}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {rows.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center text-muted">
            <I.comment />
            <span className="text-[15px]">
              {filter === "unread" ? "No unread conversations" : filter === "starred" ? "No starred conversations" : "No conversations yet"}
            </span>
          </div>
        )}
        {rows.map((c) => {
          const unread = c.unread > 0;
          return (
            <div key={c.contactId} className="flex items-center gap-3 border-b px-4 py-3 transition-colors last:border-0 hover:bg-accent-soft/50">
              <button onClick={() => onOpen(c.contactId)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: unread ? "var(--accent)" : "transparent" }} />
                <span className="h-8 w-8 shrink-0 rounded-full text-center text-[13px] font-semibold leading-8 text-white" style={{ background: c.client?.color ?? "#94a3b8" }}>
                  {(c.client?.name ?? "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`truncate text-[15px] ${unread ? "font-semibold" : "font-medium"}`}>{c.client?.name ?? "Unknown contact"}</span>
                    {unread && <span className="shrink-0 rounded-full bg-accent px-1.5 text-[12px] font-semibold text-white">{c.unread}</span>}
                  </span>
                  <span className={`block truncate text-[14px] ${unread ? "text-foreground" : "text-muted"}`}>
                    {c.last.direction === "outbound" ? "You: " : ""}{c.last.subject ? `${c.last.subject} — ` : ""}{c.last.body}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] text-muted">{timeAgo(c.last.at)}</span>
              </button>
              <button onClick={() => onToggleStar(c.contactId)} title={starred.has(c.contactId) ? "Unstar" : "Star"}
                className={`shrink-0 rounded p-1 hover:bg-background ${starred.has(c.contactId) ? "text-amber-400" : "text-muted"}`}>
                <I.star filled={starred.has(c.contactId)} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
