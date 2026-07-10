"use client";

// The "Conversations" inbox under My Work. Two tabs:
//  - Tracked: our own local `messages` table (realtime, unread/read, star) —
//    only exists for contacts already classified as client/prospect/past
//    client/vendor. Cockpit.tsx owns this data and all mutation.
//  - All GoHighLevel: a live, unstored proxy over GHL's own Conversations API
//    across every configured sub-account (src/app/api/ghl/conversations),
//    covering every contact whether classified yet or not. This tab fetches
//    for itself since it isn't part of the app's core Supabase state.
import { useEffect, useState } from "react";
import { timeAgo, CLIENT_TYPE_META, type Client, type Contact, type ClientType, type Message } from "@/lib/data";
import { authedFetch } from "@/lib/supabase";
import { I, ClassifyMenu } from "./ui";

export interface ConversationRow {
  contactId: string;
  client: Client | null;
  last: Message;
  unread: number;
}

interface LiveConvo {
  id: string;
  locationId: string;
  contactId: string;
  contactName: string;
  companyName: string;
  lastMessageBody: string;
  lastMessageDate: string | null;
  lastMessageDirection: "inbound" | "outbound";
  unreadCount: number;
}
interface LiveMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  subject: string | null;
  at: string;
}

type Tab = "tracked" | "all_ghl";
type Filter = "all" | "unread" | "starred";

export function ConversationsInbox({
  conversations, starred, onToggleStar, onOpen,
  resolveLiveContact, onClassify,
}: {
  conversations: ConversationRow[];
  starred: Set<string>;
  onToggleStar: (contactId: string) => void;
  onOpen: (contactId: string) => void;
  resolveLiveContact: (ghlContactId: string) => { contact: Contact; client: Client | null } | null;
  onClassify: (contact: Contact, type: ClientType) => void;
}) {
  const [tab, setTab] = useState<Tab>("tracked");
  const [filter, setFilter] = useState<Filter>("all");
  const rows = conversations.filter((c) =>
    filter === "unread" ? c.unread > 0 : filter === "starred" ? starred.has(c.contactId) : true
  );

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border">
          <button onClick={() => setTab("tracked")} className={`px-2.5 py-1.5 text-[13px] font-medium ${tab === "tracked" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Tracked</button>
          <button onClick={() => setTab("all_ghl")} className={`px-2.5 py-1.5 text-[13px] font-medium ${tab === "all_ghl" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>All GoHighLevel</button>
        </div>
        {tab === "tracked" && (
          <div className="inline-flex overflow-hidden rounded-md border">
            {([["all", "All"], ["unread", "Unread"], ["starred", "Starred"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setFilter(v)} className={`px-2.5 py-1.5 text-[13px] font-medium ${filter === v ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>
                {label}{v === "unread" && conversations.some((c) => c.unread > 0) ? ` · ${conversations.filter((c) => c.unread > 0).length}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "tracked" ? (
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
      ) : (
        <AllGhlList resolveLiveContact={resolveLiveContact} onClassify={onClassify} onOpen={onOpen} />
      )}
    </div>
  );
}

function AllGhlList({ resolveLiveContact, onClassify, onOpen }: {
  resolveLiveContact: (ghlContactId: string) => { contact: Contact; client: Client | null } | null;
  onClassify: (contact: Contact, type: ClientType) => void;
  onOpen: (contactId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [convos, setConvos] = useState<LiveConvo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("query", q.trim());
        const res = await authedFetch(`/api/ghl/conversations?${params}`);
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setConvos(j.conversations ?? []);
        else setError(j.error ?? "Couldn't load GoHighLevel conversations.");
      } catch {
        if (!cancelled) setError("Network error reaching GoHighLevel.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 350 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all GoHighLevel conversations…"
        className="mb-3 w-full max-w-sm rounded-md border bg-background px-3 py-1.5 text-[15px] outline-none focus:border-accent" />
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {loading && <div className="px-4 py-10 text-center text-[15px] text-muted">Loading…</div>}
        {error && <div className="px-4 py-10 text-center text-[15px] text-danger">{error}</div>}
        {!loading && !error && convos?.length === 0 && <div className="px-4 py-10 text-center text-[15px] text-muted">No conversations found</div>}
        {!loading && convos?.map((row) => {
          const resolved = resolveLiveContact(row.contactId);
          const classified = resolved?.client ?? null;
          const isOpen = expanded === row.id;
          return (
            <div key={row.id} className="border-b last:border-0">
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-accent-soft/50">
                <button
                  onClick={() => (classified && resolved ? onOpen(resolved.contact.id) : setExpanded(isOpen ? null : row.id))}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  {row.unreadCount > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-medium">{row.contactName}</span>
                      {row.companyName && <span className="truncate text-[13px] text-muted">· {row.companyName}</span>}
                    </span>
                    <span className="block truncate text-[14px] text-muted">{row.lastMessageDirection === "outbound" ? "You: " : ""}{row.lastMessageBody}</span>
                  </span>
                  <span className="shrink-0 text-[13px] text-muted">{row.lastMessageDate ? timeAgo(row.lastMessageDate) : ""}</span>
                </button>
                {classified ? (
                  <span className="shrink-0 rounded-md px-2.5 py-1 text-[13px] font-medium" style={{ color: CLIENT_TYPE_META[classified.type].color }}>{CLIENT_TYPE_META[classified.type].label}</span>
                ) : resolved ? (
                  <ClassifyMenu onClassify={(type) => onClassify(resolved.contact, type)} />
                ) : (
                  <span title="Not synced yet — re-sync contacts in Settings" className="shrink-0 text-[13px] text-muted">Not synced</span>
                )}
              </div>
              {isOpen && !classified && (
                <ThreadPreview conversationId={row.id} locationId={row.locationId} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThreadPreview({ conversationId, locationId }: { conversationId: string; locationId: string }) {
  const [messages, setMessages] = useState<LiveMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch(`/api/ghl/conversation-messages?${new URLSearchParams({ conversationId, locationId })}`);
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setMessages(j.messages ?? []);
        else setError(j.error ?? "Couldn't load this conversation.");
      } catch {
        if (!cancelled) setError("Network error reaching GoHighLevel.");
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId, locationId]);

  return (
    <div className="border-t bg-background/40 px-4 py-3">
      {messages === null && !error && <div className="text-[14px] text-muted">Loading history…</div>}
      {error && <div className="text-[14px] text-danger">{error}</div>}
      {messages && (
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {messages.length === 0 && <div className="text-[14px] text-muted">No message history.</div>}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg border p-2 text-[14px] ${m.direction === "outbound" ? "bg-accent-soft" : "bg-surface"}`}>
                {m.subject && <div className="mb-0.5 text-[13px] font-semibold">{m.subject}</div>}
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[13px] text-muted">Classify this contact (above) to reply from here — this is a read-only history from GoHighLevel.</p>
    </div>
  );
}
