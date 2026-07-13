"use client";

// The task detail window (sidebar or full-page "document" view).
import { useEffect, useRef, useState } from "react";
import {
  users, labels, userById, labelById, timeAgo,
  STATUS_META, STATUS_ORDER, PRIORITY_META, PRIORITY_ORDER, RECURRENCE_LABEL,
  type Task, type Client, type Project, type Contact, type Attachment, type Priority, type Recurrence,
} from "@/lib/data";
import { I, Avatar, Row, renderMentions, FileBadge } from "./ui";

export function TaskDrawer({ task, comment, setComment, clientById, projectById, contactById, full, onToggleFull, navIndex, navTotal, navTasks, onOpenTask, onAddSibling, onPrev, onNext, onClose, onPatch, onDelete, onAddComment, onAddFiles, onDownloadFile, onRemoveFile, uploadProgress, onPushGhl, ghlBusy, ghlLinkable, onUnlinkGhl, allClients, onMoveClient, clientProjects, onSetProject, onNewProject, onRenameProject, onToggleSub, onAddSub, onRenameSub, onDeleteSub, onToggleLabel }: {
  task: Task; comment: string; setComment: (v: string) => void;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => Contact | null;
  full: boolean; onToggleFull: () => void; navIndex: number; navTotal: number; navTasks: Task[]; onOpenTask: (id: string) => void; onAddSibling: (title: string) => void; onPrev: () => void; onNext: () => void;
  onClose: () => void; onPatch: (patch: Partial<Task>) => void; onDelete: () => void; onAddComment: () => void; onAddFiles: (files: FileList) => void; onDownloadFile: (path: string) => void; onRemoveFile: (att: Attachment) => void; uploadProgress: { done: number; total: number } | null; onPushGhl: () => void; ghlBusy: boolean; ghlLinkable: boolean; onUnlinkGhl: () => void; allClients: Client[]; onMoveClient: (clientId: string) => void; clientProjects: Project[]; onSetProject: (pid: string) => void; onNewProject: () => void; onRenameProject: () => void; onToggleSub: (sid: string) => void; onAddSub: (title: string) => void; onRenameSub: (sid: string, title: string) => void; onDeleteSub: (sid: string) => void; onToggleLabel: (lid: string) => void;
}) {
  const client = clientById(task.clientId)!;
  const project = projectById(task.projectId)!;
  const linkedContact = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId);
  const ghlSub = linkedContact ? clientById(linkedContact.clientId) : null;
  const ghlContactUrl = linkedContact && ghlSub?.ghlLocationId ? `https://app.gohighlevel.com/v2/location/${ghlSub.ghlLocationId}/contacts/detail/${linkedContact.ghlContactId}` : null;
  const [subDraft, setSubDraft] = useState("");
  const [siblingDraft, setSiblingDraft] = useState("");
  const [labelOpen, setLabelOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Resizable Activity column (full-page mode): drag its left edge; width
  // persists per browser.
  const [activityW, setActivityW] = useState(400);
  useEffect(() => { try { const w = parseInt(localStorage.getItem("cut_activityW") ?? "", 10); if (w >= 280 && w <= 720) setActivityW(w); } catch {} }, []);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(720, Math.max(280, window.innerWidth - ev.clientX));
      setActivityW(w);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const w = Math.min(720, Math.max(280, window.innerWidth - ev.clientX));
      try { localStorage.setItem("cut_activityW", String(w)); } catch {}
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const commentCount = task.comments.filter((c) => c.kind !== "event").length;

  // Packages the task as a ready-to-paste brief for a Claude Code session.
  // (There's no supported deep link to launch Claude Code with a prompt, so
  // clipboard + paste is the reliable hand-off.)
  const copyForClaude = async () => {
    const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId);
    const brief = [
      `Work on this task from ClickUpTasks (https://clickuptasks.vercel.app):`,
      ``,
      `Task: ${task.title}`,
      `Client: ${client.name}${ct?.email ? ` (${ct.email})` : ""}`,
      `Project: ${project?.name ?? "—"}`,
      `Status: ${STATUS_META[task.status].label} · Priority: ${PRIORITY_META[task.priority].label}${task.due ? ` · Due: ${task.due}` : ""}`,
      task.description ? `\nDescription:\n${task.description}` : "",
      task.subtasks.length ? `\nSubtasks:\n${task.subtasks.map((s) => `- [${s.done ? "x" : " "}] ${s.title}`).join("\n")}` : "",
      task.comments.length ? `\nRecent comments:\n${task.comments.slice(-3).map((c) => `- ${userById(c.authorId)?.name ?? "?"}: ${c.body}`).join("\n")}` : "",
      ghlContactUrl ? `\nGHL contact: ${ghlContactUrl}` : "",
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };
  const doneSubs = task.subtasks.filter((s) => s.done).length;
  const mentionMatch = /@([\w]*)$/.exec(comment);
  const mentionCands = mentionMatch ? users.filter((u) => u.name.toLowerCase().includes(mentionMatch[1].toLowerCase())) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const titleBlock = (
    <textarea value={task.title} onChange={(e) => onPatch({ title: e.target.value })} rows={1} className={`-mx-1 w-full resize-none rounded-md bg-transparent px-1 font-semibold leading-snug outline-none [field-sizing:content] transition focus:bg-background ${full ? "text-[28px]" : "text-[18px]"}`} />
  );
  const statusBlock = (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {STATUS_ORDER.map((s) => { const m = STATUS_META[s]; const on = task.status === s; return (<button key={s} onClick={() => onPatch({ status: s })} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${on ? "text-white shadow-soft" : "border-transparent text-muted hover:bg-background"}`} style={on ? { background: m.dot, borderColor: m.dot } : {}}><span className={`h-1.5 w-1.5 rounded-full ${on ? "" : "opacity-40"}`} style={{ background: on ? "#fff" : m.dot }} /> {m.label}</button>); })}
    </div>
  );
  const propsBlock = (
    <dl className={full ? "grid grid-cols-1 gap-x-12 gap-y-2 lg:grid-cols-2" : "space-y-3"}>
      <Row label="Priority"><select value={task.priority} onChange={(e) => onPatch({ priority: e.target.value as Priority })} className="rounded-md border border-transparent px-2 py-1 text-[14px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background" style={{ color: PRIORITY_META[task.priority].color }}>{PRIORITY_ORDER.map((p) => (<option key={p} value={p}>{PRIORITY_META[p].label}</option>))}</select></Row>
      <Row label="Assignee"><select value={task.assigneeId ?? ""} onChange={(e) => onPatch({ assigneeId: e.target.value || null })} className="rounded-md border border-transparent px-2 py-1 text-[14px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background"><option value="">Unassigned</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name} {u.role === "va" ? "(VA)" : "(Admin)"}</option>))}</select></Row>
      <Row label="Client"><select value={task.clientId} onChange={(e) => onMoveClient(e.target.value)} className="max-w-[200px] rounded-md border border-transparent px-2 py-1 text-[14px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background">{allClients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}{allClients.every((c) => c.id !== task.clientId) && <option value={task.clientId}>{client?.name ?? "—"}</option>}</select></Row>
      <Row label="Project"><select value={task.projectId} onChange={(e) => { if (e.target.value === "__new") onNewProject(); else onSetProject(e.target.value); }} className="max-w-[200px] rounded-md border border-transparent px-2 py-1 text-[14px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background">{clientProjects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}{clientProjects.every((p) => p.id !== task.projectId) && <option value={task.projectId}>{project?.name ?? "—"}</option>}<option value="__new">+ New project…</option></select></Row>
      <Row label="Contact">{(() => { const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId); return ct ? (<span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[14px] text-muted"><I.user /> {ct.name}</span>) : <span className="text-[14px] text-muted">—</span>; })()}</Row>
      <Row label="Due date"><input type="date" value={task.due ?? ""} onChange={(e) => onPatch({ due: e.target.value || null })} className="rounded-md border border-transparent px-2 py-1 text-[14px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background" /></Row>
      <Row label="Repeat"><select value={task.recurrence} onChange={(e) => onPatch({ recurrence: e.target.value as Recurrence })} className="rounded-md border border-transparent px-2 py-1 text-[14px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background">{(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => (<option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>))}</select></Row>
      <Row label="Labels">
        <div className="flex flex-wrap items-center gap-1.5">
          {task.labelIds.map((id) => { const l = labelById(id); return l ? (<button key={id} onClick={() => onToggleLabel(id)} className="group inline-flex items-center gap-1 rounded px-1.5 py-0 text-[13px] font-medium" style={{ background: l.color + "1a", color: l.color }}>{l.name} <span className="opacity-50 group-hover:opacity-100">×</span></button>) : null; })}
          <div className="relative">
            <button onClick={() => setLabelOpen((o) => !o)} className="inline-flex items-center gap-0.5 rounded border border-dashed px-1.5 py-0.5 text-[13px] text-muted hover:bg-background"><I.plus /> Label</button>
            {labelOpen && (<div className="absolute z-30 mt-1 w-40 rounded-lg border bg-surface p-1 shadow-lg">{labels.map((l) => { const on = task.labelIds.includes(l.id); return (<button key={l.id} onClick={() => onToggleLabel(l.id)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-background"><span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} /> {l.name}{on && <I.check className="ml-auto text-accent" />}</button>); })}</div>)}
          </div>
        </div>
      </Row>
      <Row label="GoHighLevel">{task.ghlTaskId ? (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-success-soft px-2 py-1 text-[13px] font-medium text-success"><I.bolt /> Synced — changes push automatically</span>
          {ghlContactUrl && <a href={ghlContactUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-accent hover:underline">Open contact ↗</a>}
          <button onClick={onUnlinkGhl} className="text-[13px] text-muted hover:text-danger">Unlink</button>
        </span>
      ) : ghlLinkable ? (
        <button onClick={onPushGhl} disabled={ghlBusy} className="inline-flex items-center gap-1.5 rounded-md border border-accent px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50"><I.bolt /> {ghlBusy ? "Pushing…" : "Push to GHL"}</button>
      ) : (
        <span className="text-[13px] text-muted">Not linkable — this client has no GHL contact/location.</span>
      )}</Row>
    </dl>
  );
  const descriptionBlock = (
    <div className="mt-5"><div className="mb-1.5 text-[13px] font-semibold uppercase tracking-wider text-muted">Description</div><textarea value={task.description} onChange={(e) => onPatch({ description: e.target.value })} placeholder="Add a description…" rows={3} className="w-full resize-none rounded-lg border border-transparent px-3 py-2 text-[15px] outline-none transition placeholder:text-muted hover:bg-background focus:border-accent focus:bg-background -mx-3" /></div>
  );
  const subtasksBlock = (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-semibold uppercase tracking-wider text-muted">Checklist {task.subtasks.length > 0 && `· ${doneSubs}/${task.subtasks.length}`}</span></div>
      {task.subtasks.length > 0 && (<div className="mb-2 h-1.5 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneSubs / task.subtasks.length) * 100}%` }} /></div>)}
      <div className="space-y-1">{task.subtasks.map((s) => (<div key={s.id} className="group/sub flex items-center gap-2 rounded-md px-1 py-1 hover:bg-background"><button onClick={() => onToggleSub(s.id)} className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${s.done ? "border-accent bg-accent text-white" : "border-border"}`}>{s.done && <I.check />}</button><input value={s.title} onChange={(e) => onRenameSub(s.id, e.target.value)} className={`-mx-1 flex-1 rounded bg-transparent px-1 text-[15px] outline-none transition focus:bg-background ${s.done ? "text-muted line-through" : ""}`} /><button onClick={() => onDeleteSub(s.id)} title="Delete checklist item" className="shrink-0 text-muted opacity-0 hover:text-red-500 group-hover/sub:opacity-100"><I.trash /></button></div>))}</div>
      <div className="mt-1.5"><input value={subDraft} onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAddSub(subDraft); setSubDraft(""); } }} placeholder="+ Add a checklist item…" className="w-full rounded-md border border-transparent px-2 py-1 text-[15px] outline-none transition placeholder:text-muted hover:bg-background focus:border-accent focus:bg-background" /></div>
    </div>
  );
  const attachmentsBlock = (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-semibold uppercase tracking-wider text-muted">Attachments · {task.attachments.length}</span><button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 text-[15px] font-medium text-accent"><I.plus /> Attach</button></div>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) onAddFiles(e.target.files); e.target.value = ""; }} />
      {uploadProgress && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[15px] text-muted">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Uploading {uploadProgress.done + 1} of {uploadProgress.total}…
        </div>
      )}
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) onAddFiles(e.dataTransfer.files); }} className="space-y-1.5">
        {task.attachments.length === 0 && !uploadProgress && (<div className="rounded-lg border border-dashed px-3 py-4 text-center text-[15px] text-muted">Drop files here or click Attach · max 25MB each</div>)}
        {task.attachments.map((a) => (
          <div key={a.id} className="group/att flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
            <FileBadge kind={a.kind} />
            {a.path ? (
              <button onClick={() => onDownloadFile(a.path!)} className="truncate text-left text-[15px] text-accent hover:underline" title="Download">{a.name}</button>
            ) : (
              <span className="truncate text-[15px]" title="Not stored — re-upload once the storage bucket exists">{a.name}</span>
            )}
            <span className="ml-auto text-[13px] text-muted">{a.size}</span>
            <button onClick={() => onRemoveFile(a)} title="Remove" className="text-muted opacity-0 hover:text-red-500 group-hover/att:opacity-100"><I.trash /></button>
          </div>
        ))}
      </div>
    </div>
  );
  // Quick-jump list of the other tasks in this same list (project), so you
  // don't have to close the drawer and reopen another. Shown below
  // attachments. Scoped to the current task's list, not the whole view.
  const listSiblings = navTasks.filter((t) => t.projectId === task.projectId);
  const siblingsBlock = (
    <div className="mt-6 border-t pt-5">
      <div className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted">{project?.name ?? "This list"} · {listSiblings.length}</div>
      <div className="overflow-hidden rounded-lg border">
        {listSiblings.map((t) => {
          const active = t.id === task.id;
          return (
            <button key={t.id} onClick={() => { if (!active) onOpenTask(t.id); }} disabled={active}
              className={`flex w-full items-center gap-2.5 border-b px-3 py-2 text-left text-[15px] last:border-0 ${active ? "bg-accent-soft font-medium text-accent" : "hover:bg-background"}`}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_META[t.status].dot }} title={STATUS_META[t.status].label} />
              <Avatar id={t.assigneeId} size={20} />
              <span className={`min-w-0 flex-1 truncate ${t.status === "done" ? "text-muted line-through" : ""}`}>{t.title}</span>
              {t.due && <span className="shrink-0 text-[13px] text-muted">{t.due}</span>}
            </button>
          );
        })}
        <div className="flex items-center gap-2 border-t px-3 py-2">
          <I.plus className="shrink-0 text-muted" />
          <input value={siblingDraft} onChange={(e) => setSiblingDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && siblingDraft.trim()) { onAddSibling(siblingDraft); setSiblingDraft(""); } }}
            placeholder="Add task…" className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
        </div>
      </div>
    </div>
  );
  const commentsBlock = (
    <div className="mt-6">
      <div className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted">Activity · {commentCount}</div>
      <div className="space-y-2.5">
        {task.comments.map((c) => {
          if (c.kind === "event") { const u = userById(c.authorId); return (<div key={c.id} className="flex items-center gap-2 py-0.5 text-[13px] text-muted"><Avatar id={c.authorId} size={16} /><span><span className="font-medium text-foreground">{u?.name}</span> {c.body} · {timeAgo(c.at)}</span></div>); }
          const u = userById(c.authorId);
          return (<div key={c.id} className="flex gap-2.5"><Avatar id={c.authorId} size={28} /><div className="min-w-0"><div className="text-[14px]"><span className="font-medium">{u?.name}</span> <span className="text-[12px] text-muted">· {timeAgo(c.at)}</span></div><div className="text-[15px]">{renderMentions(c.body)}</div></div></div>);
        })}
        {task.comments.length === 0 && (<div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-7 text-center text-muted"><I.comment /><span className="text-[15px]">No activity yet</span><span className="text-[13px]">Start the thread — type @ to mention a teammate.</span></div>)}
      </div>
    </div>
  );
  const composer = (
    <div className="relative border-t bg-surface p-3">
      {mentionMatch && mentionCands.length > 0 && (<div className="absolute bottom-full left-3 mb-1 w-56 overflow-hidden rounded-lg border bg-surface shadow-lg">{mentionCands.map((u) => (<button key={u.id} onClick={() => setComment(comment.replace(/@([\w]*)$/, `@${u.name} `))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[15px] hover:bg-background"><Avatar id={u.id} size={22} /> {u.name}{u.role === "va" && <span className="text-[13px] text-muted">VA</span>}</button>))}</div>)}
      <div className="flex items-end gap-2 rounded-xl border bg-background px-2.5 py-2 focus-within:border-accent">
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(mentionMatch && mentionCands.length)) { e.preventDefault(); onAddComment(); } }} placeholder="Write a comment…  (type @ to mention)" rows={1} className="max-h-72 min-h-[38px] flex-1 resize-y bg-transparent text-[15px] outline-none placeholder:text-muted" />
        <button onClick={onAddComment} disabled={!comment.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Send</button>
      </div>
    </div>
  );

  return (
    <>
      <div className={`fixed inset-0 bg-black/20 ${full ? "z-40" : "z-10"}`} onClick={onClose} />
      <aside className={full ? "fixed inset-0 z-50 flex flex-col bg-surface" : "fixed inset-y-0 right-0 z-20 flex w-full max-w-[460px] flex-col border-l bg-surface shadow-xl"}>
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-[15px] text-muted">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: client.color }} /> <span className="truncate">{client.name}</span> <span className="shrink-0">/</span>
            <button onClick={onRenameProject} title="Rename list" className="truncate rounded px-1 -mx-1 hover:bg-background hover:text-foreground hover:underline">{project.name}</button>
          </span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
            {navTotal > 1 && (
              <div className="mr-1 flex items-center gap-0.5">
                <button onClick={onPrev} disabled={navIndex <= 0} title="Previous task (k)" className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground disabled:opacity-30"><I.chevron className="rotate-90" /></button>
                <span className="min-w-[54px] text-center text-[13px] tabular-nums text-muted">{navIndex + 1} of {navTotal}</span>
                <button onClick={onNext} disabled={navIndex < 0 || navIndex >= navTotal - 1} title="Next task (j)" className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground disabled:opacity-30"><I.chevron className="-rotate-90" /></button>
              </div>
            )}
            <button onClick={copyForClaude} title="Copy this task as a brief to paste into Claude Code" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">
              <span aria-hidden>{copied ? "✓" : "✳"}</span><span className="hidden sm:inline">{copied ? "Copied" : "Copy for Claude"}</span>
            </button>
            {ghlContactUrl && (
              <a href={ghlContactUrl} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="inline-flex items-center gap-1 rounded-md border border-accent px-2 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft">
                <I.bolt /> <span className="hidden sm:inline">Open in GHL</span>
              </a>
            )}
            <button onClick={onToggleFull} title={full ? "Collapse to sidebar" : "Expand to full page"} className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground">{full ? <I.minimize /> : <I.expand />}</button>
            <button onClick={onDelete} title="Delete task" className="rounded-md p-1 text-muted hover:bg-background hover:text-danger"><I.trash /></button>
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background"><I.close /></button>
          </div>
        </div>

        {full ? (
          // ClickUp-style split: task content (document) on the left,
          // the Activity/comments conversation in its own column on the right
          // with the composer pinned to the bottom.
          <div className="flex flex-1 overflow-hidden">
            <div className="min-w-0 flex-1 overflow-y-auto px-8 py-7 lg:px-12">
              <div className="mx-auto w-full max-w-4xl">
                {titleBlock}
                {statusBlock}
                <div className="my-6 border-t" />
                {propsBlock}
                <div className="my-6 border-t" />
                {descriptionBlock}
                {subtasksBlock}
                {attachmentsBlock}
                {siblingsBlock}
              </div>
            </div>
            <div className="relative flex shrink-0 flex-col border-l bg-background/50" style={{ width: activityW }}>
              <div onMouseDown={startResize} title="Drag to resize"
                className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/30 active:bg-accent/40" />
              <div className="flex items-center gap-2 border-b bg-surface px-5 py-3">
                <span className="text-[15px] font-semibold">Activity</span>
                <span className="rounded-full bg-background px-2 py-0.5 text-[13px] text-muted">{commentCount}</span>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="space-y-3">
                  {task.comments.map((c) => {
                    const u = userById(c.authorId);
                    if (c.kind === "event") return (
                      <div key={c.id} className="flex items-center gap-2 pl-1 text-[13px] text-muted">
                        <Avatar id={c.authorId} size={18} />
                        <span><span className="font-medium text-foreground">{u?.name}</span> {c.body} <span className="text-muted">· {timeAgo(c.at)}</span></span>
                      </div>
                    );
                    return (
                      <div key={c.id} className="flex gap-2.5">
                        <Avatar id={c.authorId} size={28} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px]"><span className="font-medium">{u?.name}</span> <span className="text-[12px] text-muted">· {timeAgo(c.at)}</span></div>
                          <div className="mt-1 rounded-xl rounded-tl-sm border bg-surface px-3 py-2 text-[15px] shadow-soft">{renderMentions(c.body)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {task.comments.length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><I.comment /></span>
                      <span className="text-[15px] font-medium">No activity yet</span>
                      <span className="max-w-[220px] text-[13px] leading-relaxed">Start the conversation below — type @ to loop in a teammate.</span>
                    </div>
                  )}
                </div>
              </div>
              {composer}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {titleBlock}
              {statusBlock}
              <div className="mt-5">{propsBlock}</div>
              {descriptionBlock}
              {subtasksBlock}
              {attachmentsBlock}
              {siblingsBlock}
              {commentsBlock}
            </div>
            {composer}
          </>
        )}
      </aside>
    </>
  );
}
