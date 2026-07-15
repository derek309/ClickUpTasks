"use client";

// The task detail window (sidebar or full-page "document" view).
import { useEffect, useRef, useState } from "react";
import {
  users, labels, userById, labelById, timeAgo, isOverdue, formatDue,
  STATUS_META, STATUS_ORDER, PRIORITY_META, manualPriorityOptions,
  type Task, type Client, type Project, type Contact, type Attachment, type Priority, type RecurrenceUnit, type Subtask, type TaskTemplate, type MessageChannel, type Message,
} from "@/lib/data";
import { I, Avatar, Row, CollapsibleText, FileBadge, newId } from "./ui";
import { AttachmentThumbs } from "./AttachmentThumbs";
import { InlineAssignee, InlineDue } from "./GroupedList";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// A chip-style multi-recipient input for email Cc/Bcc — type to search the
// synced contact list by name or email, or type a raw address and hit Enter.
// Stores plain email strings (that's what GHL's emailCc/emailBcc expect).
function RecipientField({ label, value, onChange, contacts }: { label: string; value: string[]; onChange: (next: string[]) => void; contacts: Contact[] }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const matches = ql
    ? contacts.filter((c) => c.email && !value.includes(c.email) && (c.name.toLowerCase().includes(ql) || c.email.toLowerCase().includes(ql))).slice(0, 6)
    : [];
  const add = (email: string) => { const e = email.trim(); if (e && !value.includes(e)) onChange([...value, e]); setQ(""); };
  const remove = (email: string) => onChange(value.filter((x) => x !== email));
  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 focus-within:border-accent">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
        {value.map((e) => (
          <span key={e} className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[12px] text-accent">
            {e}<button onClick={() => remove(e)} title="Remove" className="hover:text-foreground">×</button>
          </span>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && EMAIL_RE.test(q.trim())) { e.preventDefault(); add(q); }
            else if (e.key === "Backspace" && !q && value.length) { remove(value[value.length - 1]); }
          }}
          placeholder={value.length ? "" : "Search contacts or type an email…"}
          className="min-w-[150px] flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
      </div>
      {matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-surface shadow-soft-md">
          {matches.map((c) => (
            <button key={c.id} onClick={() => add(c.email)} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-background">
              <span className="truncate text-[13px] font-medium">{c.name}</span>
              <span className="shrink-0 truncate text-[12px] text-muted">{c.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskDrawer({ task, comment, setComment, clientById, projectById, contactById, full, onToggleFull, navIndex, navTotal, navTasks, onOpenTask, onAddSibling, onPrev, onNext, onClose, onPatch, onDelete, onAddComment, onAddFiles, onDownloadFile, onRemoveFile, uploadProgress, onPushGhl, ghlBusy, ghlLinkable, onUnlinkGhl, allClients, onMoveClient, clientProjects, onSetProject, onNewProject, onRenameProject, onToggleSub, onAddSub, onRenameSub, onDeleteSub, onPatchSub, onToggleLabel, isQueued, onToggleQueue, onCopyLink, onOpenClientList, templates, onApplyTemplate, onUploadCommentImage, onCopyAttachmentLink, onGetSignedUrl, messages, linkedContactInfo, ccContacts, onUploadMessageImage, onSendTaskMessage, sendingMessage }: {
  task: Task; comment: string; setComment: (v: string) => void;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => Contact | null;
  full: boolean; onToggleFull: () => void; navIndex: number; navTotal: number; navTasks: Task[]; onOpenTask: (id: string) => void; onAddSibling: (title: string) => void; onPrev: () => void; onNext: () => void;
  onClose: () => void; onPatch: (patch: Partial<Task>) => void; onDelete: () => void; onAddComment: (attachments?: Attachment[]) => void; onAddFiles: (files: FileList) => void; onDownloadFile: (path: string) => void; onRemoveFile: (att: Attachment) => void; uploadProgress: { done: number; total: number } | null; onPushGhl: () => void; ghlBusy: boolean; ghlLinkable: boolean; onUnlinkGhl: () => void; allClients: Client[]; onMoveClient: (clientId: string) => void; clientProjects: Project[]; onSetProject: (pid: string) => void; onNewProject: () => void; onRenameProject: () => void; onToggleSub: (sid: string) => void; onAddSub: (title: string) => void; onRenameSub: (sid: string, title: string) => void; onDeleteSub: (sid: string) => void; onPatchSub: (sid: string, patch: Partial<Subtask>) => void; onToggleLabel: (lid: string) => void; isQueued: boolean; onToggleQueue: () => void; onCopyLink: () => void; onOpenClientList: () => void;
  templates: TaskTemplate[]; onApplyTemplate: (templateId: string) => void;
  onUploadCommentImage: (file: File) => Promise<Attachment | null>;
  onCopyAttachmentLink: (path: string) => void;
  onGetSignedUrl: (path: string) => Promise<string | null>;
  messages?: Message[] | null; // this task's linked contact's email/SMS history, merged into the Activity feed
  linkedContactInfo?: Contact | null; // authoritative send target (matches what onSendTaskMessage actually resolves) — shown as "Sending to" in the SMS/Email composer
  ccContacts?: Contact[]; // searchable contacts for the email Cc/Bcc pickers
  onUploadMessageImage?: (file: File) => Promise<Attachment | null>;
  onSendTaskMessage?: (channel: MessageChannel, subject: string, body: string, attachments?: Attachment[], cc?: string[], bcc?: string[]) => void;
  sendingMessage?: boolean;
}) {
  const client = clientById(task.clientId)!;
  const project = projectById(task.projectId)!;
  const linkedContact = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId);
  const messageDest = linkedContactInfo ?? linkedContact;
  const ghlSub = linkedContact ? clientById(linkedContact.clientId) : null;
  const ghlContactUrl = linkedContact && ghlSub?.ghlLocationId ? `https://app.gohighlevel.com/v2/location/${ghlSub.ghlLocationId}/contacts/detail/${linkedContact.ghlContactId}` : null;
  const [subDraft, setSubDraft] = useState("");
  const [siblingDraft, setSiblingDraft] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const addLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    onPatch({ attachments: [...task.attachments, { id: newId("at_"), name: linkLabel.trim() || href.replace(/^https?:\/\//, ""), kind: "link", size: "", url: href }] });
    setLinkUrl(""); setLinkLabel(""); setLinkOpen(false);
  };
  const [labelOpen, setLabelOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [msgCc, setMsgCc] = useState<string[]>([]);
  const [msgBcc, setMsgBcc] = useState<string[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [pendingMsgAtts, setPendingMsgAtts] = useState<Attachment[]>([]);
  const [uploadingMsgAtt, setUploadingMsgAtt] = useState(false);
  const handleMsgPaste = async (e: React.ClipboardEvent) => {
    if (!onUploadMessageImage) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) images.push(f); }
    }
    if (images.length === 0) return;
    e.preventDefault();
    setUploadingMsgAtt(true);
    for (const f of images) { const att = await onUploadMessageImage(f); if (att) setPendingMsgAtts((a) => [...a, att]); }
    setUploadingMsgAtt(false);
  };
  // Merged into the Activity panel as a 3-way switcher rather than its own
  // block in the document body — messaging the contact and the internal
  // comment thread are both "activity on this task", just different
  // channels. The channel is just whichever tab is active, not separate
  // state, so there's one source of truth for what Send will do.
  const [rightTab, setRightTab] = useState<"activity" | "sms" | "email">("activity");
  const submitTaskMessage = () => {
    if ((!msgBody.trim() && pendingMsgAtts.length === 0) || !onSendTaskMessage || rightTab === "activity") return;
    // Cc/Bcc ride along only on email; SMS ignores them (Cockpit also guards this).
    const cc = rightTab === "email" ? msgCc : undefined;
    const bcc = rightTab === "email" ? msgBcc : undefined;
    onSendTaskMessage(rightTab, msgSubject, msgBody.trim(), pendingMsgAtts.length ? pendingMsgAtts : undefined, cc, bcc);
    setMsgSubject(""); setMsgBody(""); setPendingMsgAtts([]); setMsgCc([]); setMsgBcc([]); setShowCcBcc(false);
    setRightTab("activity"); // so the send is immediately visible in the feed
  };
  // Rough SMS segment estimate, matching how carriers actually bill: GSM-7
  // encoding (plain ASCII + a handful of accented/Greek chars) fits 160
  // chars in one segment or 153 per segment once concatenated across
  // multiple; anything outside that set (emoji, curly quotes, etc.) forces
  // UCS-2 encoding at 70/67 chars instead.
  const GSM7_RE = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
  const smsSegments = (text: string): { count: number; encoding: string } => {
    if (!text) return { count: 0, encoding: "GSM-7" };
    const isGsm = GSM7_RE.test(text);
    const [single, multi] = isGsm ? [160, 153] : [70, 67];
    return { count: text.length <= single ? 1 : Math.ceil(text.length / multi), encoding: isGsm ? "GSM-7" : "Unicode" };
  };
  const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
  const [attSort, setAttSort] = useState<"added" | "name" | "type">("added");
  const [previewAtt, setPreviewAtt] = useState<Attachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const openPreview = async (att: Attachment) => {
    setPreviewAtt(att);
    setPreviewUrl(null);
    if (att.path) setPreviewUrl(await onGetSignedUrl(att.path));
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const msgFileRef = useRef<HTMLInputElement>(null);
  const handleMsgFileSelect = async (files: FileList | null) => {
    if (!files || !onUploadMessageImage) return;
    setUploadingMsgAtt(true);
    for (const f of Array.from(files)) { const att = await onUploadMessageImage(f); if (att) setPendingMsgAtts((a) => [...a, att]); }
    setUploadingMsgAtt(false);
  };

  // Resizable Activity column (full-page mode): drag its left edge; width
  // persists per browser.
  const [activityW, setActivityW] = useState(400);
  useEffect(() => { try { const w = parseInt(localStorage.getItem("cut_activityW") ?? "", 10); if (w >= 280 && w <= 720) setActivityW(w); } catch {} }, []);
  const [siblingsCollapsed, setSiblingsCollapsed] = useState(false);
  useEffect(() => { try { setSiblingsCollapsed(localStorage.getItem("cut_siblingsCollapsed") === "1"); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem("cut_siblingsCollapsed", siblingsCollapsed ? "1" : "0"); } catch {} }, [siblingsCollapsed]);
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
  // Pasting an image anywhere in the drawer (title, description, a comment
  // draft — doesn't matter which field has focus) attaches it to the task,
  // same upload pipeline as drag-drop onto the Attachments block. Only
  // intercepts when the clipboard actually carries image data, so a normal
  // text paste into any field is left untouched.
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) images.push(file);
      }
    }
    if (images.length === 0) return;
    e.preventDefault();
    const dt = new DataTransfer();
    images.forEach((f) => dt.items.add(f));
    onAddFiles(dt.files);
  };
  const doneSubs = task.subtasks.filter((s) => s.done).length;
  const mentionMatch = /@([\w]*)$/.exec(comment);
  const mentionCands = mentionMatch ? users.filter((u) => u.name.toLowerCase().includes(mentionMatch[1].toLowerCase())) : [];

  // Pasting into the comment box specifically stages the image on the
  // comment being composed (not the task's own Attachments) — stopPropagation
  // so the drawer-wide handlePaste above doesn't also fire and double-attach.
  const [pendingCommentAtts, setPendingCommentAtts] = useState<Attachment[]>([]);
  const [uploadingCommentAtt, setUploadingCommentAtt] = useState(false);
  const handleCommentPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) images.push(f); }
    }
    if (images.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setUploadingCommentAtt(true);
    for (const f of images) { const att = await onUploadCommentImage(f); if (att) setPendingCommentAtts((a) => [...a, att]); }
    setUploadingCommentAtt(false);
  };
  const submitComment = () => {
    if (!comment.trim() && pendingCommentAtts.length === 0) return;
    onAddComment(pendingCommentAtts.length ? pendingCommentAtts : undefined);
    setPendingCommentAtts([]);
  };

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
      {STATUS_ORDER.map((s) => {
        const m = STATUS_META[s];
        const on = task.status === s;
        // Each icon has its own native size (check=13px, search=16px,
        // repeat=12px) — h-3 w-3 pins all four to the same rendered size
        // (CSS width/height on the <svg> wins over its own attrs), and full-
        // opacity color (not dimmed to 50%) keeps the outline circle for "To
        // do" actually visible instead of nearly invisible at small size.
        const iconCls = `h-3 w-3 shrink-0 ${on ? "text-white" : ""}`;
        return (
          <button key={s} onClick={() => onPatch({ status: s })} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${on ? "text-white shadow-soft" : "border-transparent text-muted hover:bg-background"}`} style={on ? { background: m.dot, borderColor: m.dot } : {}}>
            {s === "done" ? <I.check className={iconCls} />
              : s === "review" ? <I.search className={iconCls} />
              : s === "in_progress" ? <I.repeat className={iconCls} />
              : <span className={`block h-3 w-3 shrink-0 rounded-full border-2 ${on ? "border-white" : ""}`} style={!on ? { borderColor: m.dot } : {}} />}
            {m.label}
          </button>
        );
      })}
    </div>
  );
  // Prominent warning, not just the compact badge buried in the properties
  // grid below — a client with no linked GHL contact/location is a real
  // gap (this task can never sync), worth catching at a glance.
  const ghlWarningBanner = !task.ghlTaskId && !ghlLinkable ? (
    <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
      <I.bolt className="mt-0.5 shrink-0 text-amber-500" />
      <span>This client has no linked GoHighLevel contact or location, so this task can&apos;t sync to GHL.</span>
    </div>
  ) : null;
  const propsBlock = (
    <dl className={full ? "grid grid-cols-1 gap-x-12 gap-y-2 lg:grid-cols-2" : "space-y-3"}>
      <Row label="Due date">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <InlineDue value={task.due} overdue={isOverdue(task.due) && task.status !== "done"} recurrence={task.recurrence} onChange={(d) => onPatch({ due: d })} onRecurrenceChange={(r) => onPatch({ recurrence: r })} />
          {task.recurrence === "custom" && (
            <span className="inline-flex items-center gap-1.5 text-[14px] text-muted">
              Every
              <input type="number" min={1} value={task.recurrenceInterval ?? 1} onChange={(e) => onPatch({ recurrenceInterval: Math.max(1, parseInt(e.target.value, 10) || 1) })} className="w-14 rounded-md border bg-background px-1.5 py-1 text-center text-[14px] outline-none focus:border-accent" />
              <select value={task.recurrenceUnit ?? "week"} onChange={(e) => onPatch({ recurrenceUnit: e.target.value as RecurrenceUnit })} className="rounded-md border bg-background px-1.5 py-1 text-[14px] outline-none focus:border-accent">
                <option value="day">day(s)</option>
                <option value="week">week(s)</option>
                <option value="month">month(s)</option>
              </select>
            </span>
          )}
        </span>
      </Row>
      <Row label="Priority"><select value={task.priority} onChange={(e) => onPatch({ priority: e.target.value as Priority })} className="rounded-md border border-transparent px-2 py-1 text-[14px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background" style={{ color: PRIORITY_META[task.priority].color }}>{manualPriorityOptions(task.priority).map((p) => (<option key={p} value={p}>{PRIORITY_META[p].label}</option>))}</select></Row>
      <Row label="Assignee"><select value={task.assigneeId ?? ""} onChange={(e) => onPatch({ assigneeId: e.target.value || null })} className="rounded-md border border-transparent px-2 py-1 text-[14px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background"><option value="">Unassigned</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name} {u.role === "va" ? "(VA)" : "(Admin)"}</option>))}</select></Row>
      <Row label="Client"><select value={task.clientId} onChange={(e) => onMoveClient(e.target.value)} className="max-w-[200px] rounded-md border border-transparent px-2 py-1 text-[14px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background">{allClients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}{allClients.every((c) => c.id !== task.clientId) && <option value={task.clientId}>{client?.name ?? "—"}</option>}</select></Row>
      <Row label="Project"><select value={task.projectId} onChange={(e) => { if (e.target.value === "__new") onNewProject(); else onSetProject(e.target.value); }} className="max-w-[200px] rounded-md border border-transparent px-2 py-1 text-[14px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background">{clientProjects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}{clientProjects.every((p) => p.id !== task.projectId) && <option value={task.projectId}>{project?.name ?? "—"}</option>}<option value="__new">+ New project…</option></select></Row>
      <Row label="Contact">{(() => { const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId); return ct ? (<span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[14px] text-muted"><I.user /> {ct.name}</span>) : <span className="text-[14px] text-muted">—</span>; })()}</Row>
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
        <span className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-[13px] text-muted" title="This client has no linked GHL contact/location, so this task can't sync to GoHighLevel."><I.bolt className="opacity-40" /> Not linkable</span>
      )}</Row>
    </dl>
  );
  const descriptionBlock = (
    // Auto-grows to fit its content (same [field-sizing:content] technique as
    // the title) instead of a fixed 3-row box with an inner scrollbar — on a
    // full page there's room, and description is the one field with real
    // substance, so it shouldn't be the cramped part.
    <div className="mt-5"><div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Description</div><textarea value={task.description} onChange={(e) => onPatch({ description: e.target.value })} placeholder="Add a description…" rows={3} className="-mx-3 min-h-[80px] w-full resize-none rounded-lg border border-transparent px-3 py-2 text-[15px] outline-none transition [field-sizing:content] placeholder:text-muted hover:bg-background focus:border-accent focus:bg-background" /></div>
  );
  // Message this task's linked GHL contact directly, without leaving the
  // drawer — sends via the same GHL Conversations API path as the Chat
  // tab's Messages composer, so it shows up there too (a message isn't
  // tied to one task in the data model, just the contact/client). Each
  // channel gets real writing room instead of a cramped 1-row box — SMS
  // is short but still deserves more than a single line, and email needs
  // a proper subject-then-body layout. Sending flips back to the Activity
  // tab (see submitTaskMessage) so the send is visible immediately.
  const hasMessaging = !!(linkedContact && onSendTaskMessage);
  const msgAttBar = (pendingMsgAtts.length > 0 || uploadingMsgAtt) && (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
      <AttachmentThumbs items={pendingMsgAtts} onRemove={(id) => setPendingMsgAtts((a) => a.filter((x) => x.id !== id))} />
      {uploadingMsgAtt && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
    </div>
  );
  const msgAttachButton = onUploadMessageImage && (<>
    <button onClick={() => msgFileRef.current?.click()} title="Attach an image" className="rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground"><I.clip /></button>
    <input ref={msgFileRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { handleMsgFileSelect(e.target.files); e.target.value = ""; }} />
  </>);
  const smsSeg = smsSegments(msgBody);
  const smsComposerBlock = hasMessaging ? (
    <div className="flex flex-1 flex-col border-t bg-surface p-3">
      <div className="mb-2 shrink-0 text-[13px] text-muted">Sending to: <span className="font-medium text-foreground">{messageDest?.phone || "no phone on file"}</span></div>
      {msgAttBar}
      <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} onPaste={handleMsgPaste}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitTaskMessage(); } }}
        placeholder="Write a text… (Enter to send, paste to attach an image)"
        className="min-h-[140px] w-full flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted focus:border-accent" />
      <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
        <span className="text-[13px] text-muted">{wordCount(msgBody)} word{wordCount(msgBody) === 1 ? "" : "s"} · {smsSeg.count} segment{smsSeg.count === 1 ? "" : "s"}{smsSeg.count > 0 ? ` (${smsSeg.encoding})` : ""}</span>
        <span className="flex items-center gap-1.5">
          {msgAttachButton}
          <button onClick={submitTaskMessage} disabled={(!msgBody.trim() && pendingMsgAtts.length === 0) || sendingMessage} className="rounded-lg bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">{sendingMessage ? "Sending…" : "Send text"}</button>
        </span>
      </div>
    </div>
  ) : null;
  const emailComposerBlock = hasMessaging ? (
    <div className="flex flex-1 flex-col border-t bg-surface p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] text-muted">To: <span className="font-medium text-foreground">{messageDest?.email || "no email on file"}</span></span>
        {!showCcBcc && <button onClick={() => setShowCcBcc(true)} className="shrink-0 text-[12px] font-medium text-accent hover:underline">Cc / Bcc</button>}
      </div>
      {showCcBcc && (
        <div className="mb-2 flex shrink-0 flex-col gap-1.5">
          <RecipientField label="Cc" value={msgCc} onChange={setMsgCc} contacts={ccContacts ?? []} />
          <RecipientField label="Bcc" value={msgBcc} onChange={setMsgBcc} contacts={ccContacts ?? []} />
        </div>
      )}
      <input value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} placeholder="Subject"
        className="mb-2 w-full shrink-0 rounded-lg border bg-background px-3 py-2 text-[15px] font-medium outline-none placeholder:text-muted focus:border-accent" />
      {msgAttBar}
      <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} onPaste={handleMsgPaste}
        placeholder="Write an email… (paste to attach an image)"
        className="min-h-[220px] w-full flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted focus:border-accent" />
      <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
        <span className="text-[13px] text-muted">{wordCount(msgBody)} word{wordCount(msgBody) === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-1.5">
          {msgAttachButton}
          <button onClick={submitTaskMessage} disabled={(!msgBody.trim() && pendingMsgAtts.length === 0) || sendingMessage} className="rounded-lg bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">{sendingMessage ? "Sending…" : "Send email"}</button>
        </span>
      </div>
    </div>
  ) : null;
  // Falls back to "activity" if an SMS/Email tab was active but the
  // contact got unlinked out from under it.
  const activeRightTab = hasMessaging ? rightTab : "activity";
  const rightTabBar = (
    <div className="flex items-center gap-1">
      <button onClick={() => setRightTab("activity")} className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium ${activeRightTab === "activity" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>Activity · {commentCount}</button>
      {hasMessaging && (<>
        <button onClick={() => setRightTab("sms")} className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium ${activeRightTab === "sms" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>SMS</button>
        <button onClick={() => setRightTab("email")} className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium ${activeRightTab === "email" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>Email</button>
      </>)}
    </div>
  );
  const subtasksBlock = (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Checklist {task.subtasks.length > 0 && `· ${doneSubs}/${task.subtasks.length}`}</span>
        {templates.length > 0 && (
          <div className="relative">
            <button onClick={() => setTemplateOpen((o) => !o)} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent"><I.clipboard /> From template</button>
            {templateOpen && (<>
              <div className="fixed inset-0 z-30" onClick={() => setTemplateOpen(false)} />
              <div className="absolute right-0 z-40 mt-1 w-56 rounded-lg border bg-surface p-1 shadow-lg">
                {templates.map((t) => (
                  <button key={t.id} onClick={() => { onApplyTemplate(t.id); setTemplateOpen(false); }} className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-background">
                    <span className="truncate text-[14px] font-medium">{t.name}</span>
                    <span className="text-[12px] text-muted">{t.checklistItems.length} item{t.checklistItems.length === 1 ? "" : "s"}</span>
                  </button>
                ))}
              </div>
            </>)}
          </div>
        )}
      </div>
      {task.subtasks.length > 0 && (<div className="mb-2 h-1.5 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneSubs / task.subtasks.length) * 100}%` }} /></div>)}
      <div className="space-y-1">{task.subtasks.map((s) => (
        <div key={s.id}>
          <div className="group/sub flex items-center gap-2 rounded-md px-1 py-1 hover:bg-background"><button onClick={() => onToggleSub(s.id)} className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${s.done ? "border-accent bg-accent text-white" : "border-border"}`}>{s.done && <I.check />}</button><input value={s.title} onChange={(e) => onRenameSub(s.id, e.target.value)} className={`-mx-1 flex-1 rounded bg-transparent px-1 text-[15px] outline-none transition focus:bg-background ${s.done ? "text-muted line-through" : ""}`} /><input type="date" value={s.due ?? ""} onChange={(e) => onPatchSub(s.id, { due: e.target.value || null })} title="Due date" className={`shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] outline-none transition hover:border-border hover:bg-surface focus:border-accent focus:bg-surface ${isOverdue(s.due ?? null) && !s.done ? "font-medium text-danger" : "text-muted"}`} /><InlineAssignee value={s.assigneeId ?? null} onChange={(a) => onPatchSub(s.id, { assigneeId: a })} size={20} /><button onClick={() => onDeleteSub(s.id)} title="Delete checklist item" className="shrink-0 text-muted opacity-0 hover:text-red-500 group-hover/sub:opacity-100"><I.trash /></button></div>
          {s.assigneeId && (
            <div className="mb-1 ml-7 flex items-center gap-1.5">
              <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-accent">Delegated</span>
              <input value={s.note ?? ""} onChange={(e) => onPatchSub(s.id, { note: e.target.value })} placeholder="What do you need done? (instructions)" className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] outline-none transition placeholder:text-muted hover:bg-background focus:border-accent focus:bg-background" />
            </div>
          )}
        </div>
      ))}</div>
      <div className="mt-1.5"><input value={subDraft} onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAddSub(subDraft); setSubDraft(""); } }} placeholder="+ Add a checklist item…" className="w-full rounded-md border border-transparent px-2 py-1 text-[15px] outline-none transition placeholder:text-muted hover:bg-background focus:border-accent focus:bg-background" /></div>
    </div>
  );
  const ATT_KIND_ORDER: Record<Attachment["kind"], number> = { image: 0, pdf: 1, doc: 2, sheet: 3, link: 4 };
  const sortedAttachments = [...task.attachments].sort((a, b) => {
    if (attSort === "name") return a.name.localeCompare(b.name);
    if (attSort === "type") return ATT_KIND_ORDER[a.kind] - ATT_KIND_ORDER[b.kind];
    return 0; // "added" — keep stored order (oldest first, matches how they were attached)
  });
  const attachmentsBlock = (
    <div className="mt-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Attachments · {task.attachments.length}</span>
        <span className="flex items-center gap-3">
          {task.attachments.length > 1 && (
            <select value={attSort} onChange={(e) => setAttSort(e.target.value as typeof attSort)} className="rounded-md border bg-background px-1.5 py-1 text-[13px] outline-none" title="Sort attachments">
              <option value="added">Sort: Added</option>
              <option value="name">Sort: Name</option>
              <option value="type">Sort: Type</option>
            </select>
          )}
          <button onClick={() => { setLinkOpen((o) => !o); }} className="inline-flex items-center gap-1 text-[15px] font-medium text-accent"><I.link /> Link</button>
          <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 text-[15px] font-medium text-accent"><I.plus /> Attach</button>
        </span>
      </div>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) onAddFiles(e.target.files); e.target.value = ""; }} />
      {linkOpen && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
          <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLink(); }} placeholder="Paste a link (Drive, website, doc…)" className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
          <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLink(); }} placeholder="Label (optional)" className="w-40 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
          <button onClick={addLink} disabled={!linkUrl.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Add</button>
        </div>
      )}
      {uploadProgress && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[13px] text-muted">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Uploading {uploadProgress.done + 1} of {uploadProgress.total}…
        </div>
      )}
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) onAddFiles(e.dataTransfer.files); }} className="space-y-1.5">
        {task.attachments.length === 0 && !uploadProgress && (<div className="rounded-lg border border-dashed px-3 py-2 text-[13px] text-muted">Drop, paste, or click Attach · max 25MB each</div>)}
        {sortedAttachments.map((a) => (
          <div key={a.id} className="group/att flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
            <FileBadge kind={a.kind} />
            {a.url ? (
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="truncate text-left text-[15px] text-accent hover:underline" title={a.url}>{a.name}</a>
            ) : a.path ? (
              <button onClick={() => onDownloadFile(a.path!)} className="truncate text-left text-[15px] text-accent hover:underline" title="Download">{a.name}</button>
            ) : (
              <span className="truncate text-[15px]" title="Not stored — re-upload once the storage bucket exists">{a.name}</span>
            )}
            <span className="ml-auto text-[13px] text-muted">{a.size}</span>
            {a.kind === "image" && a.path && (
              <button onClick={() => openPreview(a)} title="Preview" className="text-muted opacity-0 hover:text-foreground group-hover/att:opacity-100"><I.search /></button>
            )}
            {a.path && (
              <button onClick={() => onCopyAttachmentLink(a.path!)} title="Copy direct link" className="text-muted opacity-0 hover:text-foreground group-hover/att:opacity-100"><I.link /></button>
            )}
            <button onClick={() => onRemoveFile(a)} title="Remove" className="text-muted opacity-0 hover:text-red-500 group-hover/att:opacity-100"><I.trash /></button>
          </div>
        ))}
      </div>
      {previewAtt && (
        <>
          <div className="fixed inset-0 z-50 bg-black/70" onClick={() => setPreviewAtt(null)} />
          <div className="fixed inset-8 z-50 flex flex-col items-center justify-center gap-3" onClick={() => setPreviewAtt(null)}>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={previewAtt.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
            ) : (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            <button onClick={() => setPreviewAtt(null)} className="rounded-md bg-white/10 px-3 py-1.5 text-[14px] font-medium text-white hover:bg-white/20">Close</button>
          </div>
        </>
      )}
    </div>
  );
  // Quick-jump list of the *whole* list (project) this task belongs to,
  // including itself (highlighted, not clickable) — so the completion
  // fraction/bar below is accurate and you can see where this task sits
  // among its siblings without leaving the drawer. Collapsed state
  // persists per-browser, same pattern as activityW.
  const listSiblings = navTasks.filter((t) => t.projectId === task.projectId);
  const siblingsDone = listSiblings.filter((t) => t.status === "done").length;
  const siblingsPct = listSiblings.length ? Math.round((siblingsDone / listSiblings.length) * 100) : 0;
  const siblingsBlock = (
    <div className="mt-6 border-t pt-5">
      <button onClick={() => setSiblingsCollapsed((c) => !c)} className="mb-2 flex w-full items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-foreground">
        <I.chevron className={`transition ${siblingsCollapsed ? "-rotate-90" : "rotate-180"}`} />
        {project?.name ?? "This list"} · {siblingsDone} of {listSiblings.length} done · {siblingsPct}%
      </button>
      {!siblingsCollapsed && (<>
        {listSiblings.length > 0 && (<div className="mb-2 h-1.5 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${siblingsPct}%` }} /></div>)}
        <div className="overflow-hidden rounded-lg border">
          {listSiblings.map((t) => {
            const active = t.id === task.id;
            // The one badge per row: priority if it's Urgent (the thing most
            // worth flagging), otherwise the task's status — matches the
            // overdue treatment used everywhere else (InlineDue in the
            // properties grid and the main list view), not a bespoke one.
            const badge = t.priority === "urgent" ? { label: PRIORITY_META.urgent.label, color: PRIORITY_META.urgent.color } : { label: STATUS_META[t.status].label, color: STATUS_META[t.status].dot };
            const overdue = isOverdue(t.due) && t.status !== "done";
            return (
              <button key={t.id} onClick={() => { if (!active) onOpenTask(t.id); }} disabled={active}
                className={`flex w-full items-center gap-2.5 border-b px-3 py-2 text-left text-[15px] last:border-0 ${active ? "bg-accent-soft font-medium text-accent" : "hover:bg-background"}`}>
                <Avatar id={t.assigneeId} size={18} />
                <span className={`min-w-0 flex-1 truncate ${t.status === "done" ? "text-muted line-through" : ""}`}>{t.title}</span>
                <span className="shrink-0 rounded px-1.5 py-0 text-[11px] font-semibold" style={{ background: badge.color + "1a", color: badge.color }}>{badge.label}</span>
                {t.due && (
                  <span className={`inline-flex shrink-0 items-center gap-1 text-[13px] ${overdue ? "font-medium text-danger" : "text-muted"}`}>
                    {formatDue(t.due)}
                    {overdue && <span className="rounded bg-danger-soft px-1 py-0 text-[10px] font-semibold uppercase text-danger">Overdue</span>}
                  </span>
                )}
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
      </>)}
    </div>
  );
  // Sent/received emails and texts aren't tied to one task in the data
  // model (just the contact/client), but merging them into this task's feed
  // — instead of only the client-level Chat tab — means sending from here
  // shows up right where you sent it from.
  const activityItems: ({ at: string; kind: "comment" | "event"; comment: (typeof task.comments)[number] } | { at: string; kind: "message"; message: Message })[] = [
    ...task.comments.map((c) => ({ at: c.at, kind: c.kind === "event" ? ("event" as const) : ("comment" as const), comment: c })),
    ...(messages ?? []).map((m) => ({ at: m.at, kind: "message" as const, message: m })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const commentsFeed = (
    <div className="space-y-2.5">
      {activityItems.map((item) => {
        if (item.kind === "event") { const c = item.comment; const u = userById(c.authorId); return (<div key={c.id} className="flex items-center gap-2 py-0.5 text-[13px] text-muted"><Avatar id={c.authorId} size={16} /><span><span className="font-medium text-foreground">{u?.name}</span> {c.body} · {timeAgo(c.at)}</span></div>); }
        if (item.kind === "message") {
          const m = item.message;
          return (
            <div key={m.id} className={`rounded-xl border p-3 ${m.direction === "inbound" ? "bg-surface" : "bg-accent-soft/40"}`}>
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0 font-medium" style={{ background: (m.channel === "email" ? "#3b82f6" : "#22c55e") + "1a", color: m.channel === "email" ? "#3b82f6" : "#22c55e" }}>{m.channel === "email" ? "Email" : "SMS"}</span>
                <span>{m.direction === "inbound" ? "Received" : "Sent"}</span>
                <span>· {timeAgo(m.at)}</span>
              </div>
              {m.subject && <div className="mt-1 text-[15px] font-medium">{m.subject}</div>}
              {((m.cc && m.cc.length > 0) || (m.bcc && m.bcc.length > 0)) && (
                <div className="mt-0.5 text-[12px] text-muted">
                  {m.cc && m.cc.length > 0 && <span>Cc: {m.cc.join(", ")}</span>}
                  {m.cc && m.cc.length > 0 && m.bcc && m.bcc.length > 0 && <span> · </span>}
                  {m.bcc && m.bcc.length > 0 && <span>Bcc: {m.bcc.join(", ")}</span>}
                </div>
              )}
              <CollapsibleText text={m.body} className="mt-1 text-[15px]" />
              {m.attachments && m.attachments.length > 0 && <div className="mt-1.5"><AttachmentThumbs items={m.attachments} onOpen={onDownloadFile} /></div>}
            </div>
          );
        }
        const c = item.comment;
        const u = userById(c.authorId);
        return (<div key={c.id} className="flex gap-2.5"><Avatar id={c.authorId} size={28} /><div className="min-w-0 flex-1"><div className="text-[14px]"><span className="font-medium">{u?.name}</span> <span className="text-[12px] text-muted">· {timeAgo(c.at)}</span></div>{c.body && <CollapsibleText text={c.body} className="text-[15px]" />}{c.attachments && c.attachments.length > 0 && <div className="mt-1"><AttachmentThumbs items={c.attachments} onOpen={onDownloadFile} /></div>}</div></div>);
      })}
      {activityItems.length === 0 && (<div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-7 text-center text-muted"><I.comment /><span className="text-[15px]">No activity yet</span><span className="text-[13px]">Start the thread — type @ to mention a teammate.</span></div>)}
    </div>
  );
  const composer = (
    <div className="relative border-t bg-surface p-3">
      {mentionMatch && mentionCands.length > 0 && (<div className="absolute bottom-full left-3 mb-1 w-56 overflow-hidden rounded-lg border bg-surface shadow-lg">{mentionCands.map((u) => (<button key={u.id} onClick={() => setComment(comment.replace(/@([\w]*)$/, `@${u.name} `))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[15px] hover:bg-background"><Avatar id={u.id} size={22} /> <span className="min-w-0 flex-1 truncate">{u.name}</span>{u.role === "va" && <span className="shrink-0 text-[13px] text-muted">VA</span>}</button>))}</div>)}
      {(pendingCommentAtts.length > 0 || uploadingCommentAtt) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <AttachmentThumbs items={pendingCommentAtts} onRemove={(id) => setPendingCommentAtts((a) => a.filter((x) => x.id !== id))} />
          {uploadingCommentAtt && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-xl border bg-background px-2.5 py-2 focus-within:border-accent">
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} onPaste={handleCommentPaste} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(mentionMatch && mentionCands.length)) { e.preventDefault(); submitComment(); } }} placeholder="Write a comment…  (type @ to mention, paste to attach an image)" rows={1} className="max-h-72 min-h-[38px] flex-1 resize-y bg-transparent text-[15px] outline-none placeholder:text-muted" />
        <button onClick={submitComment} disabled={!comment.trim() && pendingCommentAtts.length === 0} className="rounded-lg bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Send</button>
      </div>
    </div>
  );
  // A task with no linked contact (so SMS/Email can never appear) and no
  // comments yet has nothing the Activity rail could show — in full-page
  // mode that's a ~400px column of dead space next to a document with room
  // to spare. Fold Activity into the document column instead of reserving
  // a wide empty rail for it; the moment it has a linked contact or a first
  // comment, it's no longer "light" and gets the full two-column layout.
  const isLightTask = full && !hasMessaging && activityItems.length === 0;

  return (
    <>
      <div className={`fixed inset-0 bg-black/20 ${full ? "z-40" : "z-10"}`} onClick={onClose} />
      <aside onPaste={handlePaste} className={full ? "fixed inset-0 z-50 flex flex-col bg-surface" : "fixed inset-y-0 right-0 z-20 flex w-full max-w-[460px] flex-col border-l bg-surface shadow-xl"}>
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-[13px] text-muted">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: client.color }} />
            <button onClick={onOpenClientList} title={`Back to ${client.name}'s list`} className="truncate rounded px-1 -mx-1 hover:bg-background hover:text-foreground hover:underline">{client.name}</button>
            <span className="shrink-0">/</span>
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
            <button onClick={onToggleQueue} title={isQueued ? "In Claude Code's queue — click to remove" : "Queue this task for Claude Code to work (say “work my queue” in Claude Code)"} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[13px] font-medium ${isQueued ? "border-accent bg-accent-soft text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}>
              <span aria-hidden>{isQueued ? "★" : "☆"}</span><span className="hidden sm:inline">{isQueued ? "Queued" : "Queue for Claude"}</span>
            </button>
            {ghlContactUrl && (
              <a href={ghlContactUrl} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="inline-flex items-center gap-1 rounded-md border border-accent px-2 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft">
                <I.bolt /> <span className="hidden sm:inline">Open in GHL</span>
              </a>
            )}
            <button onClick={onCopyLink} title="Copy a shareable link to this task" className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground"><I.link /></button>
            <button onClick={onToggleFull} title={full ? "Collapse to sidebar" : "Expand to full page"} className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground">{full ? <I.minimize /> : <I.expand />}</button>
            <button onClick={onDelete} title="Delete task" className="rounded-md p-1 text-muted hover:bg-background hover:text-danger"><I.trash /></button>
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background"><I.close /></button>
          </div>
        </div>

        {full ? (
          isLightTask ? (
            // No linked contact and no comments yet — nothing the Activity
            // rail could show, so fold it into the document instead of
            // reserving a wide empty column for it (see isLightTask above).
            <div className="flex-1 overflow-y-auto px-8 py-7 lg:px-12">
              <div className="mx-auto w-full max-w-4xl">
                {titleBlock}
                {statusBlock}
                {ghlWarningBanner}
                <div className="my-6 border-t" />
                {propsBlock}
                <div className="my-6 border-t" />
                {descriptionBlock}
                {subtasksBlock}
                {attachmentsBlock}
                {siblingsBlock}
                <div className="mt-6 border-t pt-5">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Activity</div>
                  {commentsFeed}
                  <div className="mt-3">{composer}</div>
                </div>
              </div>
            </div>
          ) : (
          // ClickUp-style split: task content (document) on the left,
          // the Activity/comments conversation in its own column on the right
          // with the composer pinned to the bottom.
          <div className="flex flex-1 overflow-hidden">
            <div className="min-w-0 flex-1 overflow-y-auto px-8 py-7 lg:px-12">
              <div className="mx-auto w-full max-w-4xl">
                {titleBlock}
                {statusBlock}
                {ghlWarningBanner}
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
              <div className="flex items-center gap-1 border-b bg-surface px-3 py-2">
                {rightTabBar}
              </div>
              {activeRightTab === "activity" ? (<>
                <div className="flex-1 overflow-y-auto px-5 py-4">{commentsFeed}</div>
                {composer}
              </>) : activeRightTab === "sms" ? smsComposerBlock : emailComposerBlock}
            </div>
          </div>
          )
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {titleBlock}
              {statusBlock}
              {ghlWarningBanner}
              <div className="mt-5">{propsBlock}</div>
              {descriptionBlock}
              {subtasksBlock}
              {attachmentsBlock}
              {siblingsBlock}
              <div className="mt-6">
                {rightTabBar}
                <div className="mt-2">{commentsFeed}</div>
              </div>
            </div>
            {activeRightTab === "activity" ? composer : activeRightTab === "sms" ? smsComposerBlock : emailComposerBlock}
          </>
        )}
      </aside>
    </>
  );
}
