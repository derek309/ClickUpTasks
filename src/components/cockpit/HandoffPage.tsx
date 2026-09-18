"use client";

// A delegation as a page: everything the teammate needs on one link (Derek,
// 2026-09-16: "turn the delegation into a page ... so the VA has everything
// they need on one link instead of just a multiple line"). The goal, the steps
// to tick off, the links, the task's files and approved deliverables, what
// finished looks like, and the questions between the two people.
//
// It is the delegation checklist item itself, grown a handoff (data.ts
// Handoff), so it saves with the task and whoever the task is delegated to can
// open and update it without anything new in the database. The link is the
// task's link with &handoff= added.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  handoffOf, handoffProgress, formatDue, timeAgo, userById, prettyLinkName, type ClientLink,
  type Attachment, type Handoff, type HandoffDeliverable, type Subtask, type Task,
} from "@/lib/data";
import { fetchTaskDocument, type TaskDocument } from "@/lib/db";
import { kindTitle } from "@/lib/reviewKinds";
import { I, Avatar, LinkedText, newId } from "./ui";
import { useEscapeToClose } from "./useEscapeToClose";

const KINDS: HandoffDeliverable[] = ["page", "image", "video", "doc"];
const KIND_ICON: Record<HandoffDeliverable, string> = { doc: "📄", image: "🖼️", page: "🌐", video: "🎬" };
const STAGE: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-background text-muted" },
  with_client: { label: "With the client", tone: "bg-sky-50 text-sky-700" },
  client_submitted: { label: "Client sent changes", tone: "bg-amber-50 text-amber-800" },
  approved: { label: "Approved", tone: "bg-emerald-50 text-emerald-700" },
  completed: { label: "Completed", tone: "bg-emerald-50 text-emerald-700" },
};

export function HandoffPage({ task, sub, meId, link, onPatchSub, onToggleSub, onClose, onOpenFile, onSendDm, onOpenDeliverables, clientLinks = [], pushToast }: {
  task: Task;
  sub: Subtask;
  meId?: string | null;
  /** This handoff's own link, to copy. */
  link: string;
  onPatchSub: (sid: string, patch: Partial<Subtask>) => void;
  onToggleSub: (sid: string) => void;
  onClose: () => void;
  onOpenFile: (att: Attachment) => void;
  onSendDm?: (memberId: string, body: string) => void;
  /** Close the page and show the task's reviews. */
  onOpenDeliverables: () => void;
  /** The client's saved links, offered one tap at a time. Retyping a URL that
   *  is already saved is the reason nobody attaches them. */
  clientLinks?: ClientLink[];
  pushToast: (msg: string) => void;
}) {
  useEscapeToClose(onClose);
  const h = handoffOf(sub);
  const { done, total } = handoffProgress(h);
  const owner = task.assigneeId ? userById(task.assigneeId) : null;
  const holder = sub.assigneeId ? userById(sub.assigneeId) : null;
  // A brand new handoff opens ready to fill in; one with content opens to read.
  const [editing, setEditing] = useState(() => !h.steps.length && !h.links.length && !h.doneWhen.length && !h.fileIds.length);
  const [docs, setDocs] = useState<Partial<Record<HandoffDeliverable, TaskDocument>>>({});
  const [question, setQuestion] = useState("");
  const [stepDraft, setStepDraft] = useState("");
  const [linkDraft, setLinkDraft] = useState({ label: "", url: "" });
  const [doneDraft, setDoneDraft] = useState("");

  // The task's reviews, so they can be picked and shown with where they stand.
  useEffect(() => {
    let live = true;
    void Promise.all(KINDS.map(async (k) => [k, await fetchTaskDocument(task.id, k)] as const)).then((pairs) => {
      if (live) setDocs(Object.fromEntries(pairs.filter((p) => !!p[1])) as Partial<Record<HandoffDeliverable, TaskDocument>>);
    });
    return () => { live = false; };
  }, [task.id]);

  // Every change saves the whole handoff on the checklist item. The goal is
  // also kept as the item's instructions, which the rest of the app reads.
  const save = (next: Partial<Handoff>) => {
    const merged = { ...h, ...next };
    onPatchSub(sub.id, { handoff: merged, note: merged.goal });
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(link).then(() => pushToast("Handoff link copied"), () => pushToast(`Share this link: ${link}`));
  };

  // A question or update goes on the page and as a DM to the other person, so
  // it reaches them in the one place they read.
  const post = () => {
    const body = question.trim();
    if (!body) return;
    save({ thread: [...h.thread, { id: newId("hm_"), authorId: meId ?? null, body, at: new Date().toISOString() }] });
    const to = meId && meId === sub.assigneeId ? task.assigneeId : sub.assigneeId;
    if (to && to !== meId) onSendDm?.(to, `${body}\n\nRe: handoff "${sub.title}"\n${link}`);
    setQuestion("");
  };

  const markDone = () => {
    if (sub.done) { onToggleSub(sub.id); return; }
    onToggleSub(sub.id);
    if (task.assigneeId && task.assigneeId !== meId) onSendDm?.(task.assigneeId, `Handoff done: "${sub.title}"\n${link}`);
    pushToast("Marked done");
    onClose();
  };

  const files = task.attachments.filter((a) => h.fileIds.includes(a.id));
  const shownDocs = h.deliverables.filter((k) => docs[k]);
  const input = "w-full rounded-lg border bg-surface px-3 py-2 text-[16px] outline-none focus:border-accent";
  const tile = "block rounded-xl bg-surface p-3.5 text-left ring-1 ring-border transition hover:ring-accent";
  const section = (title: string, count: number | null, children: React.ReactNode, show = true) => !show ? null : (
    <section className="mt-9">
      <h2 className="mb-3 flex items-baseline gap-2 text-[21px] font-bold">{title}{count !== null && <span className="text-[16px] font-medium text-muted">{count}</span>}</h2>
      {children}
    </section>
  );

  // Rendered on the page body, not inside the task drawer: inside it the page
  // was held under the sidebar and its header was cut off (Derek, 2026-09-16).
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex min-w-0 flex-col bg-surface" role="dialog" aria-label={`Handoff: ${sub.title}`}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:px-6">
        <span className="rounded-[5px] bg-violet-100 px-2 py-0.5 text-[16px] font-bold tracking-wide text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">HANDOFF</span>
        <span className="min-w-0 flex-1 truncate text-[16px] text-muted">from the task &quot;{task.title}&quot;</span>
        <button onClick={copyLink} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[16px] font-medium hover:bg-background"><I.link /> Copy link</button>
        <button onClick={() => setEditing((e) => !e)} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[16px] font-medium hover:bg-background">
          {editing ? <><I.check /> Done editing</> : <><I.pencil /> Edit</>}
        </button>
        <button onClick={onClose} title="Back to the task" aria-label="Back to the task" className="rounded-lg p-2 text-muted hover:bg-background hover:text-foreground"><I.close /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pb-40 pt-8 sm:px-8">
          {editing ? (
            <textarea value={sub.title} onChange={(e) => onPatchSub(sub.id, { title: e.target.value })} rows={1} aria-label="Handoff name"
              className="-mx-1 w-full resize-none rounded-md bg-transparent px-1 text-[32px] font-extrabold leading-tight outline-none [field-sizing:content] focus:bg-background" />
          ) : (
            <h1 className="text-[32px] font-extrabold leading-tight tracking-[-0.01em]">{sub.title || "Untitled handoff"}</h1>
          )}

          <div className="mt-4 flex flex-wrap gap-2 text-[16px]">
            {holder && <span className="inline-flex items-center gap-2 rounded-[5px] bg-background px-3 py-2"><Avatar id={holder.id} size={22} /> For {holder.name}</span>}
            {owner && <span className="inline-flex items-center gap-2 rounded-[5px] bg-background px-3 py-2"><Avatar id={owner.id} size={22} /> From {owner.name}</span>}
            {sub.due && <span className="rounded-[5px] bg-highlight-soft px-3 py-2 font-semibold text-highlight">Due {formatDue(sub.due)}</span>}
            {total > 0 && <span className="rounded-[5px] bg-violet-50 px-3 py-2 font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">{done} of {total} steps done</span>}
            {sub.done && <span className="rounded-[5px] bg-success-soft px-3 py-2 font-semibold text-success">✓ Done</span>}
          </div>

          {section("The goal", null, editing ? (
            <textarea value={h.goal} onChange={(e) => save({ goal: e.target.value })} rows={3} placeholder="What needs to happen, and what good looks like"
              className={`${input} min-h-[96px] resize-y [field-sizing:content]`} />
          ) : (
            <div className="whitespace-pre-wrap rounded-2xl bg-background px-5 py-4 text-[16px] leading-relaxed [overflow-wrap:anywhere]">{h.goal ? <LinkedText text={h.goal} chip /> : <span className="text-muted">No goal written yet.</span>}</div>
          ))}

          {section("Steps", total ? total : null, (
            <>
              <ol className="divide-y">
                {h.steps.map((st, i) => (
                  <li key={st.id} className="flex gap-3 py-3">
                    <input type="checkbox" checked={st.done} aria-label={`Step ${i + 1} done`}
                      onChange={(e) => save({ steps: h.steps.map((x) => (x.id === st.id ? { ...x, done: e.target.checked } : x)) })}
                      className="mt-1 h-5 w-5 shrink-0 accent-violet-600" />
                    <span className="mt-0.5 w-6 shrink-0 text-[16px] font-bold text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      {editing ? (
                        <>
                          <input value={st.text} onChange={(e) => save({ steps: h.steps.map((x) => (x.id === st.id ? { ...x, text: e.target.value } : x)) })} aria-label={`Step ${i + 1}`} className={`${input} font-semibold`} />
                          <textarea value={st.how ?? ""} onChange={(e) => save({ steps: h.steps.map((x) => (x.id === st.id ? { ...x, how: e.target.value } : x)) })} rows={1}
                            placeholder="How to do it, links welcome" aria-label={`How to do step ${i + 1}`} className={`${input} mt-1.5 resize-none [field-sizing:content]`} />
                        </>
                      ) : (
                        <>
                          {/* A pasted link reads as its name and wraps, instead of
                              one long address running off the page (Derek, 2026-09-16). */}
                          <div className={`text-[16px] font-semibold [overflow-wrap:anywhere] ${st.done ? "text-muted line-through" : ""}`}><LinkedText text={st.text} chip /></div>
                          {st.how && <div className="mt-0.5 whitespace-pre-wrap text-[16px] leading-relaxed text-foreground/80 [overflow-wrap:anywhere]"><LinkedText text={st.how} chip /></div>}
                        </>
                      )}
                    </div>
                    {editing && (
                      <div className="flex shrink-0 flex-col gap-1">
                        <button onClick={() => i > 0 && save({ steps: h.steps.map((x, n) => (n === i - 1 ? h.steps[i] : n === i ? h.steps[i - 1] : x)) })} disabled={i === 0} title="Move up" aria-label="Move up" className="rounded p-1 text-muted hover:text-foreground disabled:opacity-30">↑</button>
                        <button onClick={() => save({ steps: h.steps.filter((x) => x.id !== st.id) })} title="Remove step" aria-label="Remove step" className="rounded p-1 text-muted hover:text-danger"><I.trash className="h-4 w-4" /></button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {editing && (
                <form onSubmit={(e) => { e.preventDefault(); if (!stepDraft.trim()) return; save({ steps: [...h.steps, { id: newId("hs_"), text: stepDraft.trim(), done: false }] }); setStepDraft(""); }} className="mt-2 flex gap-2">
                  <input value={stepDraft} onChange={(e) => setStepDraft(e.target.value)} placeholder="Add a step, then Enter" aria-label="New step" className={input} />
                  <button type="submit" className="shrink-0 rounded-lg bg-accent px-4 text-[16px] font-semibold text-white">Add</button>
                </form>
              )}
              {/* The links already saved against this client, one tap each. */}
              {editing && clientLinks.some((c) => !h.links.some((l) => l.url === c.url)) && (
                <div className="mt-2 rounded-[10px] border bg-background px-2.5 py-2">
                  <div className="mb-1.5 text-[16px] font-bold uppercase tracking-wider text-muted">From this client, one tap to add</div>
                  <div className="flex flex-wrap gap-1.5">
                    {clientLinks.filter((c) => !h.links.some((l) => l.url === c.url)).map((c) => (
                      <button key={c.url} title={c.url}
                        onClick={() => save({ links: [...h.links, { id: newId("hl_"), label: c.label, url: c.url }] })}
                        className="max-w-[220px] truncate rounded-md border bg-surface px-2 py-1 text-[16px] font-medium text-accent hover:border-accent hover:bg-accent-soft">🔗 {c.label}</button>
                    ))}
                  </div>
                </div>
              )}
              {!editing && !total && <p className="text-[16px] text-muted">No steps yet.</p>}
            </>
          ), editing || total > 0)}

          {section("Deliverables", shownDocs.length || null, (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {(editing ? KINDS.filter((k) => docs[k]) : shownDocs).map((k) => {
                  const d = docs[k]!;
                  const on = h.deliverables.includes(k);
                  const stage = STAGE[d.status] ?? STAGE.draft;
                  return editing ? (
                    <label key={k} className={`${tile} flex cursor-pointer items-start gap-2.5 ${on ? "ring-2 ring-accent" : ""}`}>
                      <input type="checkbox" checked={on} onChange={(e) => save({ deliverables: e.target.checked ? [...h.deliverables, k] : h.deliverables.filter((x) => x !== k) })} className="mt-1 h-4 w-4" />
                      <span><span className="block font-bold">{KIND_ICON[k]} {d.title || kindTitle(k)}</span><span className={`mt-1.5 inline-block rounded-[5px] px-2 py-0.5 text-[16px] font-semibold ${stage.tone}`}>{stage.label}</span></span>
                    </label>
                  ) : (
                    <button key={k} onClick={onOpenDeliverables} className={tile}>
                      <span className="block text-[22px]">{KIND_ICON[k]}</span>
                      <span className="mt-1 block font-bold">{d.title || kindTitle(k)}</span>
                      <span className="block text-[16px] text-muted">{kindTitle(k)}</span>
                      <span className={`mt-2 inline-block rounded-[5px] px-2 py-0.5 text-[16px] font-semibold ${stage.tone}`}>{stage.label}</span>
                    </button>
                  );
                })}
              </div>
              {editing && !KINDS.some((k) => docs[k]) && <p className="text-[16px] text-muted">This task has no reviews yet. Add one under Deliverables on the task, then pick it here.</p>}
            </>
          ), editing || shownDocs.length > 0)}

          {section("Links", h.links.length || null, (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {h.links.map((l) => (
                  <div key={l.id} className="relative">
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className={tile}>
                      <span className="block truncate font-bold">{l.label || prettyLinkName(l.url)}</span>
                      <span className="block truncate text-[16px] text-muted">{prettyLinkName(l.url)}</span>
                    </a>
                    {editing && (
                      <button onClick={() => save({ links: h.links.filter((x) => x.id !== l.id) })} title="Remove link" aria-label="Remove link"
                        className="absolute right-2 top-2 rounded bg-surface p-1 text-muted hover:text-danger"><I.trash className="h-4 w-4" /></button>
                    )}
                  </div>
                ))}
              </div>
              {editing && (
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const url = linkDraft.url.trim();
                  if (!url) return;
                  save({ links: [...h.links, { id: newId("hl_"), label: linkDraft.label.trim(), url: /^https?:\/\//i.test(url) ? url : `https://${url}` }] });
                  setLinkDraft({ label: "", url: "" });
                }} className="mt-3 flex flex-wrap gap-2">
                  <input value={linkDraft.label} onChange={(e) => setLinkDraft((d) => ({ ...d, label: e.target.value }))} placeholder="Name, like Smart list: Stores we're in" aria-label="Link name" className={`${input} min-w-[200px] flex-1`} />
                  <input value={linkDraft.url} onChange={(e) => setLinkDraft((d) => ({ ...d, url: e.target.value }))} placeholder="Paste the link" aria-label="Link address" className={`${input} min-w-[200px] flex-1`} />
                  <button type="submit" className="shrink-0 rounded-lg bg-accent px-4 text-[16px] font-semibold text-white">Add</button>
                </form>
              )}
            </>
          ), editing || h.links.length > 0)}

          {section("Files", files.length || null, (
            <>
              <div className="space-y-2">
                {(editing ? task.attachments.filter((a) => a.kind !== "link") : files).map((a) => {
                  const on = h.fileIds.includes(a.id);
                  return (
                    <div key={a.id} className={`flex items-center gap-3 rounded-xl px-3.5 py-3 ring-1 ${editing && on ? "ring-2 ring-accent" : "ring-border"}`}>
                      {editing && <input type="checkbox" checked={on} aria-label={`Show ${a.name}`} onChange={(e) => save({ fileIds: e.target.checked ? [...h.fileIds, a.id] : h.fileIds.filter((x) => x !== a.id) })} className="h-4 w-4" />}
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background text-[16px] font-bold uppercase text-muted">{a.kind === "image" ? "🖼️" : a.kind}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{a.name}</span>{a.size && <span className="text-[16px] text-muted">{a.size}</span>}</span>
                      {!editing && <button onClick={() => onOpenFile(a)} className="shrink-0 rounded-lg px-3 py-1.5 text-[16px] font-medium ring-1 ring-border hover:bg-background">Open</button>}
                    </div>
                  );
                })}
              </div>
              {editing && !task.attachments.some((a) => a.kind !== "link") && <p className="text-[16px] text-muted">This task has no files yet. Drop them on the task, then pick them here.</p>}
            </>
          ), editing || files.length > 0)}

          {section("Done when", null, (
            <>
              <ul className="space-y-2">
                {h.doneWhen.map((d, i) => (
                  <li key={`${i}_${d}`} className="flex items-start gap-2.5 rounded-xl bg-success-soft px-4 py-2.5 text-[16px]">
                    <span className="text-success">✓</span><span className="min-w-0 flex-1">{d}</span>
                    {editing && <button onClick={() => save({ doneWhen: h.doneWhen.filter((_, n) => n !== i) })} title="Remove" aria-label="Remove" className="text-muted hover:text-danger"><I.trash className="h-4 w-4" /></button>}
                  </li>
                ))}
              </ul>
              {editing && (
                <form onSubmit={(e) => { e.preventDefault(); if (!doneDraft.trim()) return; save({ doneWhen: [...h.doneWhen, doneDraft.trim()] }); setDoneDraft(""); }} className="mt-2 flex gap-2">
                  <input value={doneDraft} onChange={(e) => setDoneDraft(e.target.value)} placeholder="Like: both emails are scheduled, each to its own list" aria-label="New done check" className={input} />
                  <button type="submit" className="shrink-0 rounded-lg bg-accent px-4 text-[16px] font-semibold text-white">Add</button>
                </form>
              )}
            </>
          ), editing || h.doneWhen.length > 0)}

          {section("Questions and updates", h.thread.length || null, (
            <div className="space-y-2.5">
              {h.thread.length === 0 && <p className="text-[16px] text-muted">Ask anything below. It also goes to {meId === sub.assigneeId ? (owner?.name ?? "the owner") : (holder?.name ?? "them")} as a message.</p>}
              {h.thread.map((m) => {
                const mine = m.authorId === meId;
                return (
                  <div key={m.id} className={`flex items-end gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                    {m.authorId ? <Avatar id={m.authorId} size={30} /> : <span className="h-[30px] w-[30px]" />}
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ring-1 ring-violet-200 bg-violet-50 dark:bg-violet-500/10 dark:ring-violet-500/30 ${mine ? "rounded-br-md" : "rounded-bl-md"}`}>
                      <div className="text-[16px] text-muted"><span className="font-semibold text-foreground">{m.authorId ? (userById(m.authorId)?.name ?? "Someone") : "Someone"}</span> · {timeAgo(m.at)}</div>
                      <div className="whitespace-pre-wrap text-[16px] leading-relaxed [overflow-wrap:anywhere]"><LinkedText text={m.body} chip /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); post(); } }}
            placeholder={meId === sub.assigneeId ? `Ask ${owner?.name?.split(" ")[0] ?? "the owner"} a question or post an update` : `Message ${holder?.name?.split(" ")[0] ?? "them"} about this handoff`}
            aria-label="Question or update" className="h-11 min-w-[200px] flex-1 rounded-xl bg-background px-4 text-[16px] outline-none ring-1 ring-transparent focus:ring-accent" />
          {question.trim() && <button onClick={post} className="h-11 rounded-xl bg-accent px-4 text-[16px] font-semibold text-white">Send</button>}
          <button onClick={markDone} className={`h-11 rounded-xl px-4 text-[16px] font-semibold ${sub.done ? "bg-background text-foreground" : "bg-violet-600 text-white hover:opacity-90"}`}>
            {sub.done ? "Reopen" : "✓ Mark done"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
