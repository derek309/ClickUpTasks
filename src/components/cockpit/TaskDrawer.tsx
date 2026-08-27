"use client";

// The task detail window (sidebar or full-page "document" view).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  users, labels, userById, labelById, timeAgo, isOverdue, htmlToText, plainTextToHtml, clientStatusMeta,
  STATUS_META, STATUS_ORDER, PRIORITY_META, manualPriorityOptions, parseDaysOfMonth, PLAYBOOK_STEP_BY_KEY,
  type Task, type Client, type Project, type Contact, type Attachment, type Priority, type RecurrenceUnit, type Subtask, type TaskTemplate, type MessageChannel, type Message, type TaskStatus,
} from "@/lib/data";
import { I, Row, CollapsibleText, SearchableSelect, newId } from "./ui";
import { AttachmentTile } from "./AttachmentTile";
import { InlineAssignee, InlineDue } from "./GroupedList";
import { RichTextEditor } from "./RichTextEditor";
import { useTaskMessaging } from "./TaskMessaging";

const ATT_KIND_ORDER: Record<Attachment["kind"], number> = { image: 0, pdf: 1, doc: 2, sheet: 3, link: 4 };

// Title/description onChange used to call onPatch on every keystroke, which
// writes through Cockpit.tsx's top-level `tasks` state (a full-array clone +
// re-render of the whole unmemoized app tree, on a client with thousands of
// tasks) AND fires a Supabase write, per character typed — the cause of the
// multi-second-per-keystroke lag reported live (screenshot: 5-10s to see
// typed text appear, on task titles specifically). Debouncing the commit
// keeps the field itself instant (it's driven by local/editor-internal state,
// not the patched value) while the expensive save only fires once typing
// pauses. The commit closure is captured fresh at schedule() time (not read
// from a ref later), so it stays bound to whichever task was open when the
// keystroke happened even if the drawer has since switched to a different
// task by the time the timer fires — no cross-task write-to-the-wrong-task
// risk from debouncing.
function useDebouncedCommit(delayMs = 600) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const commit = pendingRef.current;
    pendingRef.current = null;
    if (commit) commit();
  }, []);
  const schedule = useCallback((commit: () => void) => {
    pendingRef.current = commit;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, delayMs);
  }, [flush, delayMs]);
  useEffect(() => flush, [flush]); // flush on unmount rather than drop a trailing edit
  return { schedule, flush };
}

export function TaskDrawer({ task, clientById, projectById, contactById, full, onToggleFull, navIndex, navTotal, onPrev, onNext, onClose, onPatch, onDelete, onAddComment, onAddFiles, onDownloadFile, onDownloadFileAs, onDownloadAll, zippingIds, onRemoveFile, uploadProgress, onPushGhl, ghlBusy, ghlLinkable, onUnlinkGhl, allClients, onMoveClient, clientProjects, onSetProject, onNewProject, onRenameProject, onToggleSub, onAddSub, onRenameSub, onDeleteSub, onPatchSub, onToggleLabel, onCopyLink, onOpenMerge, onOpenClientList, templates, onApplyTemplate, onUploadCommentImage, onCopyAttachmentLink, onGetSignedUrl, messages, onMarkChannelRead, linkedContactInfo, ccContacts, onUploadMessageImage, onSendTaskMessage, onScheduleTaskMessage, sendingMessage, onDraftMessage, draftingMessage, onGetTaskLink, canAdmin, onDeleteMessage, onEditMessage, onCopyClientLink, onDraftDescription, draftingDescription, pushToast }: {
  task: Task;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => Contact | null;
  full: boolean; onToggleFull: () => void; navIndex: number; navTotal: number; onPrev: () => void; onNext: () => void;
  onClose: () => void; onPatch: (patch: Partial<Task>) => void; onDelete: () => void; onAddComment: (body: string, attachments?: Attachment[]) => void; onAddFiles: (files: FileList) => void; onDownloadFile: (path: string) => void; onDownloadFileAs: (path: string, filename: string) => void; onDownloadAll: (items: Attachment[], zipName: string, batchId: string) => void; zippingIds: Set<string>; onRemoveFile: (att: Attachment) => void; uploadProgress: { done: number; total: number } | null; onPushGhl: () => void; ghlBusy: boolean; ghlLinkable: boolean; onUnlinkGhl: () => void; allClients: Client[]; onMoveClient: (clientId: string) => void; clientProjects: Project[]; onSetProject: (pid: string) => void; onNewProject: () => void; onRenameProject: () => void; onToggleSub: (sid: string) => void; onAddSub: (title: string) => void; onRenameSub: (sid: string, title: string) => void; onDeleteSub: (sid: string) => void; onPatchSub: (sid: string, patch: Partial<Subtask>) => void; onToggleLabel: (lid: string) => void; onCopyLink: () => void; onOpenMerge: () => void; onOpenClientList: () => void;
  templates: TaskTemplate[]; onApplyTemplate: (templateId: string) => void;
  onUploadCommentImage: (file: File) => Promise<Attachment | null>;
  onCopyAttachmentLink: (path: string) => void;
  onGetSignedUrl: (path: string) => Promise<string | null>;
  messages?: Message[] | null; // this task's own email/SMS (composed from here, or an inbound reply matched to this Conversation task), merged into the Activity feed
  // Clears the unread dot on a Chat/Email/SMS tab — called the moment that
  // tab is opened. Optional so a caller that doesn't track read state (none
  // today) just never shows the dot.
  onMarkChannelRead?: (channel: MessageChannel) => void;
  linkedContactInfo?: Contact | null; // authoritative send target (matches what onSendTaskMessage actually resolves) — shown as "Sending to" in the SMS/Email composer
  ccContacts?: Contact[]; // searchable contacts for the email Cc/Bcc pickers
  onUploadMessageImage?: (file: File) => Promise<Attachment | null>;
  onSendTaskMessage?: (channel: MessageChannel, subject: string, body: string, attachments?: Attachment[], cc?: string[], bcc?: string[]) => void;
  onScheduleTaskMessage?: (channel: MessageChannel, subject: string, body: string, scheduledAt: string, attachments?: Attachment[], cc?: string[], bcc?: string[]) => void;
  sendingMessage?: boolean;
  onDraftMessage?: (channel: "email" | "sms" | "chat", prompt?: string) => Promise<{ subject?: string; body: string } | null>; // Gemini draft, never sends
  draftingMessage?: boolean;
  // Mints/reuses this task's client's public /waiting/[token] link, scoped to
  // this one task (?task=<id>) — used by the email composer's "Add task
  // link" quick-fill. Null when the client has no share token yet and the
  // caller isn't an admin (Cockpit's getClientShareUrl already toasts why).
  onGetTaskLink?: () => string | null;
  canAdmin?: boolean; // gates message edit/delete — a wrongly sent client-facing message is corrected by an admin, not any assignee
  onDeleteMessage?: (id: string) => void;
  onEditMessage?: (id: string, body: string, subject?: string | null) => void;
  onCopyClientLink?: () => void; // copies this client's public /waiting/[token] link — same link onGetTaskLink mints, just for the person, not one task
  onDraftDescription?: (title: string, description: string, prompt?: string) => Promise<string | null>; // Gemini draft, never saves
  draftingDescription?: boolean;
  pushToast: (text: string, action?: { label: string; run: () => void }, secondaryAction?: { label: string; run: () => void }) => void;
}) {
  const client = clientById(task.clientId)!;
  const project = projectById(task.projectId)!;
  // The task's own client is appended when it isn't in `allClients` (an
  // archived or otherwise filtered-out one), so the field still shows where
  // the task actually lives instead of falling back to the placeholder.
  const clientSelectOptions = [
    ...allClients.map((c) => ({ value: c.id, label: c.name })),
    ...(allClients.some((c) => c.id === task.clientId) ? [] : [{ value: task.clientId, label: client?.name ?? "—" }]),
  ];
  const linkedContact = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId);
  const messageDest = linkedContactInfo ?? linkedContact;
  const ghlSub = linkedContact ? clientById(linkedContact.clientId) : null;
  const ghlContactUrl = linkedContact && ghlSub?.ghlLocationId ? `https://app.gohighlevel.com/v2/location/${ghlSub.ghlLocationId}/contacts/detail/${linkedContact.ghlContactId}` : null;
  const [subDraft, setSubDraft] = useState("");
  // Team-chat draft — lives here (not lifted to Cockpit.tsx) so typing it
  // only re-renders this drawer, not the whole app; see useDebouncedCommit's
  // comment above for the sibling title/description fix to the same root
  // cause. Reset per task the same way openSections is (this drawer isn't
  // remounted per task), so switching tasks doesn't leak a draft between them.
  const [comment, setComment] = useState("");
  const [commentTaskId, setCommentTaskId] = useState(task.id);
  if (commentTaskId !== task.id) { setCommentTaskId(task.id); setComment(""); }
  // Title textarea is fully controlled, so it needs its own local draft (the
  // description field below doesn't — RichTextEditor already treats `value`
  // as boot-time-only content, see its own comment).
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [titleDraftTaskId, setTitleDraftTaskId] = useState(task.id);
  if (titleDraftTaskId !== task.id) { setTitleDraftTaskId(task.id); setTitleDraft(task.title); }
  const titleCommit = useDebouncedCommit();
  const descriptionCommit = useDebouncedCommit();
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
  const [descDraftPrompt, setDescDraftPrompt] = useState("");
  // RichTextEditor only takes `value` as its boot-time content and never
  // re-syncs from props after mount (see its own comment) — a caller that
  // programmatically replaces the content, like the AI draft below, has to
  // force a remount via a changing `key`, same as the email composer's
  // emailFocusNonce.
  const [descFocusNonce, setDescFocusNonce] = useState(0);
  const [attSort, setAttSort] = useState<"added" | "name" | "type">("added");
  // Drag-to-reorder — only meaningful in "added" order (the stored array
  // order); dragging a name/type-sorted view and writing that back as
  // storage order would surprise the user the next time they switch back.
  const [dragAttId, setDragAttId] = useState<string | null>(null);
  const reorderAttachments = (targetId: string) => {
    if (!dragAttId || dragAttId === targetId) { setDragAttId(null); return; }
    const ids = task.attachments.map((a) => a.id).filter((id) => id !== dragAttId);
    ids.splice(ids.indexOf(targetId), 0, dragAttId);
    const byId = new Map(task.attachments.map((a) => [a.id, a] as const));
    onPatch({ attachments: ids.map((id) => byId.get(id)!) });
    setDragAttId(null);
  };
  const [attFileDragOver, setAttFileDragOver] = useState(false);
  const [previewAtt, setPreviewAtt] = useState<Attachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const openPreview = async (att: Attachment) => {
    setPreviewAtt(att);
    setPreviewUrl(null);
    if (att.path) setPreviewUrl(await onGetSignedUrl(att.path));
  };
  // Copies a message attachment (e.g. a photo the client sent over chat)
  // onto the task's own Attachments section — same storage object, just a
  // second reference with its own id, same idiom as fillFromTask's link
  // attachment below. A no-op if it's already there (matched by path).
  const attachToTask = (a: Attachment) => {
    if (a.path && task.attachments.some((x) => x.path === a.path)) { pushToast("Already on this task's attachments."); return; }
    onPatch({ attachments: [...task.attachments, { ...a, id: newId("at_") }] });
    pushToast("Added to task attachments.");
  };
  // Gallery grid needs every visible image thumbnail up front, not resolved
  // one at a time on click like openPreview above — batch-fetch in
  // parallel. Includes message attachments (e.g. a photo the client sent
  // over chat) and comment
  // attachments (a screenshot dropped into the Activity tab) so those render
  // as real thumbnails in the feed too, not just a filename chip.
  const attImagePaths = useMemo(
    () => [...task.attachments, ...(task.clientResponse?.attachments ?? []), ...(messages ?? []).flatMap((m) => m.attachments ?? []), ...task.comments.flatMap((c) => c.attachments ?? [])].filter((a) => a.kind === "image" && a.path).map((a) => a.path as string).join(","),
    [task.attachments, task.clientResponse, messages, task.comments]
  );
  const [attImageUrls, setAttImageUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const paths = attImagePaths ? attImagePaths.split(",") : [];
    if (paths.length === 0) return;
    Promise.all(paths.map(async (p) => [p, await onGetSignedUrl(p)] as const)).then((pairs) => {
      if (cancelled) return;
      setAttImageUrls((prev) => ({ ...prev, ...Object.fromEntries(pairs.filter(([, u]) => u).map(([p, u]) => [p, u as string])) }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attImagePaths]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Resizable Activity column (full-page mode): drag its left edge; width
  // persists per browser. Default bumped 400 -> 480 and the floor raised
  // 280 -> 340 (Derek: the messaging panel "feels small") — stored under a
  // new key (cut_activityW2, not cut_activityW) so browsers that already
  // persisted the old 400px default actually pick up the wider one instead
  // of silently keeping their "unchanged" value forever.
  const [activityW, setActivityW] = useState(480);
  useEffect(() => { try { const w = parseInt(localStorage.getItem("cut_activityW2") ?? "", 10); if (w >= 340 && w <= 760) setActivityW(w); } catch {} }, []);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(760, Math.max(340, window.innerWidth - ev.clientX));
      setActivityW(w);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const w = Math.min(760, Math.max(340, window.innerWidth - ev.clientX));
      try { localStorage.setItem("cut_activityW2", String(w)); } catch {}
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Packages the task as a ready-to-paste brief for a Claude Code session.
  const copyForClaude = async () => {
    const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId);
    const descText = htmlToText(task.description);
    const brief = [
      `Work on this task from ClickUpTasks (https://clickuptasks.vercel.app):`,
      ``,
      `Task: ${task.title}`,
      `Client: ${client.name}${ct?.email ? ` (${ct.email})` : ""}`,
      `Project: ${project?.name ?? "—"}`,
      `Status: ${STATUS_META[task.status].label} · Priority: ${PRIORITY_META[task.priority].label}${task.due ? ` · Due: ${task.due}` : ""}`,
      descText ? `\nDescription:\n${descText}` : "",
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Owner Growth Plan steps stay word-for-word in sync with the catalog
  // (reconcilePlaybookTasks resyncs the title if it ever drifts) — letting an
  // ambassador rename one here would just get silently reverted next time,
  // so it's read-only instead, with a title explaining why.
  const titleBlock = (
    <textarea value={titleDraft} readOnly={!!task.playbookStepKey}
      onChange={(e) => { const v = e.target.value; setTitleDraft(v); titleCommit.schedule(() => onPatch({ title: v })); }}
      onBlur={titleCommit.flush}
      title={task.playbookStepKey ? "Synced from the Owner Growth Plan — always the same for every business" : undefined}
      rows={1} className={`-mx-1 w-full resize-none rounded-md bg-transparent px-1 font-semibold leading-snug outline-none [field-sizing:content] transition focus:bg-background ${full ? "text-[28px]" : "text-[18px]"} ${task.playbookStepKey ? "cursor-default" : ""}`} />
  );
  // Completion checkbox to the title's left (item 4) — the fastest way to
  // close out a task without hunting for the Status chip.
  const titleRow = (
    <div className="flex items-start gap-2.5">
      <button onClick={() => onPatch({ status: task.status === "done" ? "todo" : "done" })} title={task.status === "done" ? "Mark not done" : "Mark done"}
        className={`mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${task.status === "done" ? "border-accent bg-accent text-white" : "border-border hover:border-accent"}`}>
        {task.status === "done" && <I.check className="h-3 w-3" />}
      </button>
      <div className="min-w-0 flex-1">{titleBlock}</div>
    </div>
  );
  // Comment/event timestamps already cover every field-change and message —
  // the latest one is a true "last updated", not just a metadata guess.
  const lastActivityAt = task.comments.reduce((max, c) => (c.at > max ? c.at : max), task.createdAt);
  const creatorName = task.createdBy === "u_claude" ? "Automated"
    : task.createdBy === "client" ? "the client"
    : task.createdBy ? (userById(task.createdBy)?.name ?? null) : null;
  const metaLine = (
    <div className="-mt-0.5 mb-1 text-[13px] text-muted">Created {new Date(task.createdAt).toLocaleDateString()}{creatorName ? ` by ${creatorName}` : ""} · Updated {timeAgo(lastActivityAt)}</div>
  );
  // Used to be its own 6-button grid, wrapping to two cramped, hard-to-read
  // rows in the drawer's narrow (non-full) width — the exact thing that
  // looked broken. Folded into the same Task Details list as Priority,
  // Assignee, and everything else below now, same dropdown treatment (a
  // colored label, no chrome until you touch it), so Status stops being the
  // one field styled like a different app.
  // Prominent warning, not just the compact badge buried in the properties
  // grid below — a client with no linked GHL contact/location is a real
  // gap (this task can never sync), worth catching at a glance.
  const ghlWarningBanner = !task.ghlTaskId && !ghlLinkable ? (
    <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
      <I.bolt className="mt-0.5 shrink-0 text-amber-500" />
      <span>This client has no linked GoHighLevel contact or location, so this task can&apos;t sync to GHL.</span>
    </div>
  ) : null;
  // The old "Task Details" card (nine stacked form-field rows) is now one
  // row of inline editable chips (item 4) — status, due date, assignee,
  // type (reuses the priority field/scale — see the brief's own open
  // question about splitting a real `type` field out of priority someday;
  // no schema change here), and labels. Client/Project/Contact/GoHighLevel
  // stay editable too, just folded into a smaller secondary "Details"
  // block below instead of sharing top billing with the fields someone
  // actually touches on every task.
  // Chip base: a real bordered pill against bg-surface so it reads as a
  // discrete control against the page's bg-background — plain bg-background
  // chips over a bg-background page were invisible, reading as bare native
  // selects in a row instead of chips (Derek: "seems clunky").
  // Phase 1 tokens: "radius … pill 5" — pills are 5px, not fully rounded.
  const chip = "inline-flex items-center rounded-[5px] border bg-surface shadow-sm px-1 py-0.5";
  const chipRow = (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className={chip} style={{ borderColor: STATUS_META[task.status].dot + "55" }}>
        <span className="ml-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_META[task.status].dot }} />
        <select value={task.status} onChange={(e) => onPatch({ status: e.target.value as TaskStatus })} className="rounded-[5px] bg-transparent py-0.5 pl-1.5 pr-1 text-[13px] font-medium outline-none" style={{ color: STATUS_META[task.status].dot }}>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </span>
      <span className={chip}>
        <InlineDue value={task.due} overdue={isOverdue(task.due) && task.status !== "done"} recurrence={task.recurrence} recurrenceInterval={task.recurrenceInterval} recurrenceUnit={task.recurrenceUnit} recurrenceDaysOfMonth={task.recurrenceDaysOfMonth} showRecurrenceLabel={task.recurrence !== "custom"} onChange={(d) => onPatch({ due: d })} onRecurrenceChange={(r) => onPatch({ recurrence: r })} emptyLabel={<I.calendar className="h-3.5 w-3.5" />} />
      </span>
      {task.recurrence === "custom" && (
        <span className={`${chip} gap-1.5 px-2 py-1 text-[13px] text-muted`}>
          {task.recurrenceUnit === "day-of-month" ? (
            <>
              On day(s)
              <input type="text" placeholder="1, 15" defaultValue={(task.recurrenceDaysOfMonth ?? []).join(", ")}
                onBlur={(e) => onPatch({ recurrenceDaysOfMonth: parseDaysOfMonth(e.target.value) })}
                className="w-16 rounded-md border bg-background px-1.5 py-0.5 text-center text-[13px] outline-none focus:border-accent" />
              of month
            </>
          ) : (
            <>
              Every
              <input type="number" min={1} value={task.recurrenceInterval ?? 1} onChange={(e) => onPatch({ recurrenceInterval: Math.max(1, parseInt(e.target.value, 10) || 1) })} className="w-12 rounded-md border bg-background px-1.5 py-0.5 text-center text-[13px] outline-none focus:border-accent" />
            </>
          )}
          <select value={task.recurrenceUnit ?? "week"} onChange={(e) => onPatch({ recurrenceUnit: e.target.value as RecurrenceUnit })} className="rounded-md border bg-background px-1.5 py-0.5 text-[13px] outline-none focus:border-accent">
            <option value="day">day(s)</option>
            <option value="week">week(s)</option>
            <option value="month">month(s)</option>
            <option value="day-of-month">day(s) of month</option>
          </select>
        </span>
      )}
      {/* w-full/min-w-0: a native <select> sizes itself to its WIDEST option,
          and "⏳ Waiting on {long business name}" pushed it clean out of the
          properties grid (Derek, 2026-08-11). Filling the cell instead keeps
          the layout stable no matter how long a client's name is. */}
      <span className={`${chip} max-w-[220px] gap-1`}>
        <I.user className="ml-1.5 shrink-0 text-muted" />
        <select value={task.waitingOnClient ? "__waiting__" : (task.assigneeId ?? "")} onChange={(e) => { const v = e.target.value; if (v === "__waiting__") onPatch({ waitingOnClient: true, assigneeId: null }); else onPatch({ assigneeId: v || null, waitingOnClient: false }); }} className="w-full min-w-0 rounded-[5px] bg-transparent py-0.5 pl-0.5 pr-1 text-[13px] outline-none"><option value="__waiting__">⏳ {client ? `Waiting on ${client.name}` : "Waiting on client"}</option><option value="">Unassigned</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name} {u.role === "va" ? "(VA)" : "(Admin)"}</option>))}</select>
      </span>
      <span className={chip} style={{ borderColor: PRIORITY_META[task.priority].color + "55" }}>
        <span className="ml-1.5 shrink-0" style={{ color: PRIORITY_META[task.priority].color }}><I.flag /></span>
        <select value={task.priority} onChange={(e) => onPatch({ priority: e.target.value as Priority })} className="rounded-[5px] bg-transparent py-0.5 pl-1 pr-1 text-[13px] outline-none" style={{ color: PRIORITY_META[task.priority].color }}>{manualPriorityOptions(task.priority).map((p) => (<option key={p} value={p}>{PRIORITY_META[p].label}</option>))}</select>
      </span>
      {task.labelIds.map((id) => { const l = labelById(id); return l ? (<button key={id} onClick={() => onToggleLabel(id)} className="group inline-flex items-center gap-1 rounded-[5px] border px-2 py-1 text-[13px] font-medium" style={{ background: l.color + "1a", color: l.color, borderColor: l.color + "40" }}>{l.name} <span className="opacity-50 group-hover:opacity-100">×</span></button>) : null; })}
      <div className="relative">
        <button onClick={() => setLabelOpen((o) => !o)} className="inline-flex items-center gap-0.5 rounded-[5px] border border-dashed px-2 py-1 text-[13px] text-muted hover:bg-surface"><I.plus /> Label</button>
        {labelOpen && (<div className="absolute z-30 mt-1 w-40 rounded-lg border bg-surface p-1 shadow-lg">{labels.map((l) => { const on = task.labelIds.includes(l.id); return (<button key={l.id} onClick={() => onToggleLabel(l.id)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-background"><span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} /> {l.name}{on && <I.check className="ml-auto text-accent" />}</button>); })}</div>)}
      </div>
    </div>
  );
  const detailsBlock = (
    <div className="mt-3 rounded-xl border bg-surface p-4">
    <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Details</div>
    <dl className={full ? "grid grid-cols-1 gap-x-12 gap-y-1.5 lg:grid-cols-2" : "space-y-2"}>
      {/* Owner Growth Plan steps stay put — moving one to a different client or
          list would pull it out of that business's checklist (and its fixed
          position) entirely, which reconcilePlaybookTasks would just quietly
          patch over by recreating the step, orphaning the moved task. */}
      {task.playbookStepKey ? (
        <>
          <Row label="Client" icon={<I.folder />}><span title="Part of the Owner Growth Plan — can't be moved" className="px-2 py-1 text-[14px] text-muted">{client?.name ?? "—"}</span></Row>
          <Row label="Project" icon={<I.list />}><span title="Part of the Owner Growth Plan — can't be moved" className="px-2 py-1 text-[14px] text-muted">{project?.name ?? "—"}</span></Row>
        </>
      ) : (
        <>
          {/* Type-to-filter rather than a plain select: this list is every
              client on the account, which is far past the point where
              scrolling a native dropdown is the fast way to find one. */}
          <Row label="Client" icon={<I.folder />}><div className="w-[200px]"><SearchableSelect value={task.clientId} onChange={onMoveClient} options={clientSelectOptions} searchPlaceholder="Search clients…" className="rounded-md border border-transparent px-2 py-1 text-[14px] transition hover:border-border hover:bg-background" /></div></Row>
          <Row label="Project" icon={<I.list />}><select value={task.projectId} onChange={(e) => { if (e.target.value === "__new") onNewProject(); else onSetProject(e.target.value); }} className="max-w-[200px] rounded-md border border-transparent px-2 py-1 text-[14px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background">{clientProjects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}{clientProjects.every((p) => p.id !== task.projectId) && <option value={task.projectId}>{project?.name ?? "—"}</option>}<option value="__new">+ New project…</option></select></Row>
        </>
      )}
      <Row label="Contact">{(() => { const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId); return ct ? (<span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[14px] text-muted"><I.user /> {ct.name}</span>) : <span className="text-[14px] text-muted">—</span>; })()}</Row>
      <Row label="GoHighLevel" icon={<I.bolt />}>{task.ghlTaskId ? (
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
    </div>
  );
  // The client's own reply, submitted through the public /waiting/[token]
  // page — surfaced prominently (its own bordered card, above Description)
  // since it's the reason this task just landed back on someone's plate.
  // Read-only reference panel for an Owner Growth Plan step — looked up live
  // from the catalog by key, never stored on the task, so it can't drift per
  // client and needs no reconciliation if the wording changes later. Fully
  // separate from the Description field below, which stays free for the
  // ambassador's own working notes on this business.
  const playbookStep = task.playbookStepKey ? PLAYBOOK_STEP_BY_KEY.get(task.playbookStepKey) : undefined;
  const scoreImpactDots: Record<string, string> = { low: "⚡", medium: "⚡⚡", high: "⚡⚡⚡" };
  const playbookGuideBlock = playbookStep ? (
    <div className="mt-4 rounded-xl border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[15px] font-semibold">Playbook guide</div>
        <span className="shrink-0 rounded-md bg-background px-2 py-0.5 text-[12px] font-medium text-muted" title="Score impact">{scoreImpactDots[playbookStep.scoreImpact]} · {playbookStep.timeEstimate}</span>
      </div>
      <p className="text-[14px]">{playbookStep.whyItMatters}</p>
      <div className="mt-3 text-[13px] font-semibold uppercase tracking-wide text-muted">How to do it</div>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-[14px]">
        {playbookStep.howTo.map((step, i) => <li key={i}>{step}</li>)}
      </ol>
      {playbookStep.commonMistake && (
        <div className="mt-3 rounded-lg bg-background p-2.5 text-[13px]"><span className="font-medium">Common mistake:</span> {playbookStep.commonMistake}</div>
      )}
      {(playbookStep.weGive || playbookStep.youGet) && (
        <div className="mt-3 space-y-1 text-[13px] text-muted">
          {playbookStep.weGive && <div>🎁 {playbookStep.weGive}</div>}
          {playbookStep.youGet && <div>📈 {playbookStep.youGet}</div>}
        </div>
      )}
    </div>
  ) : null;

  const clientResponseBlock = task.clientResponse && (task.clientResponse.body || task.clientResponse.attachments.length > 0) ? (
    <div className="mt-4 rounded-xl border border-accent/30 bg-surface p-4">
      <div className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold text-accent"><I.user className="h-4 w-4" /> Client response</div>
      {task.clientResponse.body && <CollapsibleText text={task.clientResponse.body} className="text-[14px]" />}
      {task.clientResponse.attachments.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {task.clientResponse.attachments.map((a) => {
            const isLink = a.kind !== "image" && !!a.url;
            return (
              <div key={a.id} className="flex flex-col gap-1">
                <AttachmentTile
                  item={a}
                  url={a.kind === "image" && a.path ? attImageUrls[a.path] : undefined}
                  href={isLink ? a.url : undefined}
                  onOpen={a.kind === "image" && a.path ? () => openPreview(a) : !isLink && a.path ? () => onDownloadFile(a.path!) : undefined}
                  actions={a.path ? (
                    <>
                      <button onClick={() => onDownloadFileAs(a.path!, a.name)} title="Download" className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.download className="h-3.5 w-3.5" /></button>
                      <button onClick={() => onCopyAttachmentLink(a.path!)} title="Copy direct link" className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.link className="h-3.5 w-3.5" /></button>
                    </>
                  ) : undefined}
                />
                <div className="truncate text-center text-[11px]" title={a.name}>{a.name}</div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-1.5 text-[12px] text-muted">Submitted {timeAgo(task.clientResponse.submittedAt)}</div>
    </div>
  ) : null;
  // "Prompt Claude" for the description — same intent-in, Gemini-drafts-it
  // pattern as the message composers below, just replacing the description
  // instead of filling a subject/body. Never saves on its own; the drafted
  // text lands in the editor exactly like typing it, so Save still works
  // the normal way.
  const runDraftDescription = async () => {
    if (!onDraftDescription || draftingDescription) return;
    const body = await onDraftDescription(task.title, task.description, descDraftPrompt.trim() || undefined);
    if (body) { onPatch({ description: plainTextToHtml(body) }); setDescFocusNonce((n) => n + 1); }
  };

  // Description / Checklist / Attachments are empty on most tasks — the
  // auto-created "Reply to <person>" conversation ones especially — but each
  // still rendered a full card regardless: header, rich-text toolbar, empty
  // input, dropzone. Three empty cards cost ~430px of pure scaffolding and
  // pushed the actual work below the fold. Collapse them into one row of add
  // chips until there's something to show, or until asked for.
  //
  // Keyed by task id rather than reset in an effect: this drawer isn't
  // remounted per task (no key prop at the call site), so plain boolean state
  // would leak one task's expanded sections onto the next one you open.
  const [openSections, setOpenSections] = useState<{ taskId: string; keys: string[] }>({ taskId: task.id, keys: [] });
  const sectionOpen = (k: string) => openSections.taskId === task.id && openSections.keys.includes(k);
  const openSection = (k: string) =>
    setOpenSections((s) => (s.taskId === task.id ? { taskId: task.id, keys: [...s.keys, k] } : { taskId: task.id, keys: [k] }));
  const showDescription = htmlToText(task.description).trim().length > 0 || sectionOpen("description");
  const showChecklist = task.subtasks.length > 0 || sectionOpen("checklist");
  const showAttachments = task.attachments.length > 0 || sectionOpen("attachments");
  // The hidden file input lives in whichever of the two is actually mounted
  // (never both, since they're mutually exclusive) so fileRef always resolves.
  const hiddenFileInput = (
    <input ref={fileRef} type="file" multiple className="hidden"
      onChange={(e) => { if (e.target.files) onAddFiles(e.target.files); e.target.value = ""; }} />
  );

  const descriptionBlock = !showDescription ? null : (
    <div className="mt-4 rounded-xl border bg-surface p-4">
      <div className="mb-2 text-[15px] font-semibold">Description</div>
      <RichTextEditor key={`task-desc-${task.id}-${descFocusNonce}`} value={task.description} onChange={(html) => descriptionCommit.schedule(() => onPatch({ description: html }))} placeholder="Add a description…" />
      {onDraftDescription && (
        <div className="mt-2 flex shrink-0 items-start gap-1.5 rounded-lg border border-accent/30 bg-accent-soft/40 p-1.5">
          <span aria-hidden className="pt-1 pl-1 text-[13px]">✨</span>
          {/* A textarea that grows with the text rather than an input that
              scrolls it sideways — a real instruction runs past one line, and
              you can't check what you asked for if you can't see it. Enter
              still writes, Shift+Enter now gets a new line. */}
          <textarea value={descDraftPrompt} rows={1}
            onChange={(e) => { setDescDraftPrompt(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`; }}
            onKeyDown={(e) => { if (e.key !== "Enter" || e.shiftKey || draftingDescription) return; e.preventDefault(); runDraftDescription(); }}
            placeholder="Tell Claude what to write… (Enter to write, Shift+Enter for a new line)"
            className="max-h-[200px] min-w-0 flex-1 resize-none self-center overflow-y-auto bg-transparent px-1 py-1 text-[13px] leading-snug outline-none placeholder:text-muted" />
          <button onClick={runDraftDescription} disabled={draftingDescription}
            title={descDraftPrompt.trim() ? "Draft this with Claude" : "Draft a description from the task title"}
            className="mt-0.5 shrink-0 rounded-md border border-accent/40 bg-surface px-2.5 py-1 text-[13px] font-medium text-accent disabled:opacity-40">
            {draftingDescription ? "Drafting…" : descDraftPrompt.trim() ? "Write it" : "Draft it"}
          </button>
        </div>
      )}
    </div>
  );
  // Message this task's linked GHL contact directly, without leaving the
  // drawer — sends via the same GHL Conversations API path as the Chat
  // tab's Messages composer, so it shows up there too (a message isn't
  // tied to one task in the data model, just the contact/client).
  const hasMessaging = !!(linkedContact && onSendTaskMessage);
  // Everything below (merged feed, filter chips, search, inline reply, CTA
  // compose row, AI summary slide-over, draft-email persistence) lives in
  // TaskMessaging.tsx — see its own comment for why it's a hook rather than
  // a component (the three drawer layouts nest feedArea/composerFooter
  // differently, so this file controls placement, not TaskMessaging).
  const { feedArea, composerFooter } = useTaskMessaging({
    task, client, comment, setComment, onPatch, onAddComment, onUploadCommentImage, onDownloadFile, onDownloadFileAs, onDownloadAll, zippingIds,
    attImageUrls, openPreview, attachToTask, messages, onMarkChannelRead, messageDest, ccContacts, onUploadMessageImage,
    onSendTaskMessage, onScheduleTaskMessage, sendingMessage, onDraftMessage, draftingMessage, onGetTaskLink, canAdmin,
    onDeleteMessage, onEditMessage, hasMessaging,
  });
  const subtasksBlock = !showChecklist ? null : (
    <div className="mt-4 rounded-xl border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[15px] font-semibold">Checklist {task.subtasks.length > 0 && <span className="text-muted">· {doneSubs}/{task.subtasks.length} · {Math.round((doneSubs / task.subtasks.length) * 100)}%</span>}</span>
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
      {task.subtasks.length > 0 && (<div className="mb-2 h-2 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneSubs / task.subtasks.length) * 100}%` }} /></div>)}
      <div className="space-y-1">{task.subtasks.map((s) => (
        <div key={s.id}>
          <div className="group/sub flex items-start gap-2 rounded-md px-1 py-1 hover:bg-background"><button onClick={() => onToggleSub(s.id)} className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${s.done ? "border-accent bg-accent text-white" : "border-border"}`}>{s.done && <I.check />}</button><textarea value={s.title} onChange={(e) => onRenameSub(s.id, e.target.value)} rows={1} className={`-mx-1 mt-0.5 flex-1 resize-none rounded bg-transparent px-1 text-[15px] leading-snug outline-none [field-sizing:content] transition focus:bg-background ${s.done ? "text-muted line-through" : ""}`} /><InlineDue value={s.due ?? null} overdue={isOverdue(s.due ?? null) && !s.done} onChange={(d) => onPatchSub(s.id, { due: d })} /><InlineAssignee value={s.assigneeId ?? null} onChange={(a) => onPatchSub(s.id, { assigneeId: a })} size={20} /><button onClick={() => onDeleteSub(s.id)} title="Delete checklist item" className="mt-0.5 shrink-0 text-muted opacity-0 hover:text-red-500 group-hover/sub:opacity-100"><I.trash /></button></div>
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
  const sortedAttachments = useMemo(() => [...task.attachments].sort((a, b) => {
    if (attSort === "name") return a.name.localeCompare(b.name);
    if (attSort === "type") return ATT_KIND_ORDER[a.kind] - ATT_KIND_ORDER[b.kind];
    return 0; // "added" — keep stored order (oldest first, matches how they were attached)
  }), [task.attachments, attSort]);
  const attachmentsBlock = !showAttachments ? null : (
    <div className="mt-4 rounded-xl border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[15px] font-semibold">Attachments {task.attachments.length > 0 && <span className="text-muted">· {task.attachments.length}</span>}</span>
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
      {hiddenFileInput}
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
      <div
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setAttFileDragOver(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setAttFileDragOver(false); }}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setAttFileDragOver(false); onAddFiles(e.dataTransfer.files); } }}
        className={`grid grid-cols-3 gap-2 rounded-lg transition sm:grid-cols-4 md:grid-cols-5 ${attFileDragOver ? "outline-2 outline-dashed outline-accent bg-accent-soft/30" : ""}`}
      >
        {task.attachments.length === 0 && !uploadProgress && (<div className="col-span-full rounded-lg border border-dashed px-3 py-2 text-[13px] text-muted">Drop, paste, or click Attach · max 25MB each</div>)}
        {sortedAttachments.filter((a) => a.kind === "image").map((a) => (
          <div key={a.id} className="flex flex-col gap-1">
            <AttachmentTile
              item={a}
              url={a.path ? attImageUrls[a.path] : undefined}
              onOpen={a.path ? () => openPreview(a) : undefined}
              drag={attSort === "added" ? { dragging: dragAttId === a.id, onDragStart: () => setDragAttId(a.id), onDrop: () => reorderAttachments(a.id) } : undefined}
              actions={
                <>
                  {a.path && (
                    <>
                      <button onClick={() => onDownloadFileAs(a.path!, a.name)} title="Download" className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.download className="h-3.5 w-3.5" /></button>
                      <button onClick={() => onCopyAttachmentLink(a.path!)} title="Copy direct link" className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.link className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                  <button onClick={() => onRemoveFile(a)} title="Remove" className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-red-500"><I.trash className="h-3.5 w-3.5" /></button>
                </>
              }
            />
            <div className="truncate text-center text-[12px]" title={a.name}>{a.name}</div>
            <div className="text-center text-[11px] text-muted">{a.size}</div>
          </div>
        ))}
      </div>
      {/* Non-image attachments (docs, sheets, links) used to render as
          empty-looking AttachmentTile boxes with no real thumbnail to show
          — a compact link chip carries the same info (name, type, size)
          without pretending there's a preview. */}
      {sortedAttachments.some((a) => a.kind !== "image") && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sortedAttachments.filter((a) => a.kind !== "image").map((a) => {
            const isLink = !!a.url;
            return (
              <span key={a.id} className="group inline-flex items-center gap-1.5 rounded-[5px] border bg-background py-1 pl-2.5 pr-1 text-[13px]">
                <a href={isLink ? a.url! : undefined} onClick={!isLink && a.path ? () => onDownloadFile(a.path!) : undefined} target={isLink ? "_blank" : undefined} rel={isLink ? "noreferrer" : undefined}
                  className="flex items-center gap-1.5 font-medium text-accent hover:underline">
                  <I.link className="h-3.5 w-3.5" /> {a.name}{a.size && <span className="font-normal text-muted"> · {a.size}</span>}
                </a>
                {a.path && <button onClick={() => onDownloadFileAs(a.path!, a.name)} title="Download" className="rounded-full p-1 text-muted opacity-0 hover:bg-surface hover:text-foreground group-hover:opacity-100"><I.download className="h-3 w-3" /></button>}
                <button onClick={() => onRemoveFile(a)} title="Remove" className="rounded-full p-1 text-muted opacity-0 hover:bg-surface hover:text-danger group-hover:opacity-100"><I.trash className="h-3 w-3" /></button>
              </span>
            );
          })}
        </div>
      )}
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
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {previewAtt.path && (
                <button onClick={() => onDownloadFileAs(previewAtt.path!, previewAtt.name)} className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-[14px] font-medium text-white hover:bg-white/20"><I.download />Download</button>
              )}
              <button onClick={() => setPreviewAtt(null)} className="rounded-md bg-white/10 px-3 py-1.5 text-[14px] font-medium text-white hover:bg-white/20">Close</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
  // Stands in for whichever of the three sections above are still empty —
  // one ~40px row instead of up to ~430px of empty cards. Also a drop
  // target, so dragging a file in still works when Attachments is collapsed
  // (the expanded block has its own dropzone).
  const addChip = "rounded-lg border border-dashed px-3 py-1.5 text-[13px] font-medium text-muted transition hover:bg-background hover:text-foreground";
  const emptySectionsRow = (showDescription && showChecklist && showAttachments) ? null : (
    <div
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setAttFileDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setAttFileDragOver(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setAttFileDragOver(false); openSection("attachments"); onAddFiles(e.dataTransfer.files); } }}
      className={`mt-4 flex flex-wrap items-center gap-2 rounded-xl p-1 transition ${attFileDragOver ? "outline-2 outline-dashed outline-accent bg-accent-soft/30" : ""}`}
    >
      {!showDescription && <button onClick={() => openSection("description")} className={addChip}>+ Description</button>}
      {!showChecklist && <button onClick={() => openSection("checklist")} className={addChip}>+ Checklist</button>}
      {!showAttachments && (<>
        {hiddenFileInput}
        <button onClick={() => { openSection("attachments"); fileRef.current?.click(); }} className={addChip}>+ Attach</button>
      </>)}
    </div>
  );
  // The embedded sibling-task list used to live here — deleted (item 4):
  // the "N of M" pager (onPrev/onNext below) already does the same job of
  // moving between tasks in this list, without duplicating a whole list
  // view inside the drawer.
  // A task with no linked contact (so SMS/Email can never appear) and no
  // comments yet has nothing the messaging feed could show — that's a
  // ~400px column of dead space next to a document with room to spare. Fold it into the document column instead of reserving a wide
  // empty rail for it; the moment it has a linked contact or a first
  // comment, it's no longer "light" and gets the full two-column layout.
  const isLightTask = !hasMessaging && task.comments.length === 0;

  return (
    <>
      <div className={`fixed inset-0 bg-black/20 ${full ? "z-40" : "z-10"}`} onClick={onClose} />
      {/* Docked mode is no longer a narrow rail (Derek, 2026-08-26): it spans
          everything from the sidebar's right edge to the window's, so the
          task gets the same two-column document/activity layout full mode
          has instead of a 460px column that squeezed both. --drawer-left is
          set by Cockpit and follows the sidebar (16rem, or 0 when hidden);
          below md the sidebar is an overlay, so the drawer is full width.
          left + right define the box there, hence md:w-auto over w-full. */}
      <aside onPaste={handlePaste} className={full ? "fixed inset-0 z-50 flex flex-col bg-surface" : "fixed inset-y-0 right-0 z-20 flex w-full flex-col border-l bg-surface shadow-xl md:left-[var(--drawer-left,16rem)] md:w-auto"}>
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
            {ghlContactUrl && (
              <a href={ghlContactUrl} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="inline-flex items-center gap-1 rounded-md border border-accent px-2 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft">
                <I.bolt /> <span className="hidden sm:inline">Open in GHL</span>
              </a>
            )}
            <button onClick={onCopyLink} title="Copy a shareable link to this task" className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground"><I.link /></button>
            {task.priority === "conversation" && (
              <button onClick={onOpenMerge} title="Merge this conversation into an existing task" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">
                <I.repeat /> <span className="hidden sm:inline">Merge</span>
              </button>
            )}
            <button onClick={onToggleFull} title={full ? "Collapse to sidebar" : "Expand to full page"} className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground">{full ? <I.minimize /> : <I.expand />}</button>
            {!task.playbookStepKey && (
              <button onClick={onDelete} title="Delete task" className="rounded-md p-1 text-muted hover:bg-background hover:text-danger"><I.trash /></button>
            )}
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background"><I.close /></button>
          </div>
        </div>

        {isLightTask ? (
            // No linked contact and no comments yet — nothing the messaging
            // feed could show, so fold it into the document instead of
            // reserving a wide empty column for it (see isLightTask above).
            <div className="flex-1 overflow-y-auto bg-background px-8 py-6 lg:px-12">
              <div className="mx-auto w-full max-w-4xl">
                {titleRow}
                {metaLine}
                {ghlWarningBanner}
                <div className="my-4 border-t" />
                {chipRow}
                {detailsBlock}
                <div className="my-4 border-t" />
                {playbookGuideBlock}
                {clientResponseBlock}
                {descriptionBlock}
                {subtasksBlock}
                {attachmentsBlock}
                {emptySectionsRow}

                <div className="mt-5 border-t pt-4">
                  {feedArea}
                  <div className="mt-3">{composerFooter}</div>
                </div>
              </div>
            </div>
          ) : (
          // ClickUp-style split: task content (document) on the left, the
          // merged communications feed in its own column on the right with
          // an active composer (if any) pinned to the bottom.
          // Splits at 1100px, not md (768px). The activity rail is a fixed
          // 480px, so on an iPad at 1024 the document column was left about
          // 330px: the title wrapped to two lines, the DETAILS fields were
          // squeezed and "Push to GHL" broke across three. Below 1100 the two
          // stack instead, which reads far better on a tablet.
          <div className="flex flex-1 flex-col overflow-hidden min-[1100px]:flex-row">
            <div className="min-w-0 flex-1 overflow-y-auto bg-background px-4 py-6 sm:px-8 lg:px-12">
              <div className="mx-auto w-full max-w-4xl">
                {titleRow}
                {metaLine}
                {ghlWarningBanner}
                <div className="my-4 border-t" />
                {chipRow}
                {detailsBlock}
                <div className="my-4 border-t" />
                {playbookGuideBlock}
                {clientResponseBlock}
                {descriptionBlock}
                {subtasksBlock}
                {attachmentsBlock}
                {emptySectionsRow}

              </div>
            </div>
            {/* Stacks below the document on mobile (each pane its own scroll);
                fixed, resizable side column at md+. Width rides a CSS var so a
                responsive class can override the inline value below md. */}
            <div className="relative flex min-h-0 flex-1 flex-col border-t-4 bg-[color-mix(in_srgb,var(--background)_50%,transparent)] min-[1100px]:w-[var(--activity-w)] min-[1100px]:flex-none min-[1100px]:border-l-4 min-[1100px]:border-t-0"
              style={{ "--activity-w": `${activityW}px` } as React.CSSProperties}>
              <div onMouseDown={startResize} title="Drag to resize"
                className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize hover:bg-accent/30 active:bg-accent/40 min-[1100px]:block" />
              {hasMessaging && (
                <div className="border-b bg-surface px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: clientStatusMeta(client.status).dot }} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{client.name}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-muted">
                    <span>{clientStatusMeta(client.status).label}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {messageDest?.phone ? (
                        <a href={`tel:${messageDest.phone}`} className="font-medium text-accent hover:underline">Call</a>
                      ) : (
                        <span title="No phone on file" className="cursor-not-allowed opacity-40">Call</span>
                      )}
                      {onCopyClientLink && <button onClick={onCopyClientLink} className="font-medium text-accent hover:underline">Copy client link</button>}
                    </span>
                  </div>
                </div>
              )}
              {/* Top-anchored (Derek, 2026-08-19: the bottom-anchored
                  chat-app convention this used to have — mt-auto pinning a
                  short thread near the composer — left a client/task with
                  little activity looking broken, a wall of empty space
                  above one lonely event). The filter bar and feed now sit
                  right under the header where they belong; composerFooter
                  stays pinned below, outside this scroll area. */}
              <div className="flex flex-1 flex-col overflow-y-auto px-5 py-4">{feedArea}</div>
              {composerFooter}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
