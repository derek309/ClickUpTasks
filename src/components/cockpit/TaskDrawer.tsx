"use client";

// The task detail window (sidebar or full-page "document" view).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  users, labels, userById, labelById, timeAgo, isOverdue, htmlToText, plainTextToHtml, clientStatusMeta, PERSONAL_CLIENT_ID,
  TaskAction, TaskActionKind, prettyLinkName, effectiveStatus, openNextStep, followUpAfterStepDone, initialsOf,
  STATUS_META, pickableStatuses, stepDateLabel, followUpMoves, doneSteps, dateQuickPicks, TASK_ACTION_META, handoffOf, handoffProgress, handoffLink, type DelegateSpec, type ClientLink, PRIORITY_META, manualPriorityOptions, parseDaysOfMonth, WEEKDAY_LABEL, daysUntilDue, formatDue, dueCountdown,
  type Task, type Client, type Project, type Contact, type Attachment, type Priority, type RecurrenceUnit, type Subtask, type TaskTemplate, type MessageChannel, type Message, type TaskStatus,
} from "@/lib/data";
import { I, Avatar, Row, CollapsibleText, SearchableSelect, newId, LinkFavicon } from "./ui";
import { authedFetch } from "@/lib/supabase";
import { ActionDock } from "./ActionDock";
import { ActionMenu } from "./ActionMenu";
import { fetchTaskActions, insertTaskAction, setNextStepDoneDb, deleteTaskActionDb, editTaskActionDb, patchNextStepDb } from "@/lib/db";
import { AttachmentTile } from "./AttachmentTile";
import { SizePicker } from "./SizePicker";
import { InlineAssignee, InlineDate, InlineDue } from "./GroupedList";
import { RichTextEditor } from "./RichTextEditor";
import { useTaskMessaging } from "./TaskMessaging";
import { useDebouncedCommit } from "./useDebouncedCommit";
import { useEscapeToClose } from "./useEscapeToClose";
import { TaskDocument } from "./TaskDocument";
import { HandoffPage } from "./HandoffPage";

// A handoff link (?task=…&handoff=…) names the delegation to open. Read once
// when the app loads, because the app rewrites the address as you move around,
// and handed to the first drawer that holds that delegation.
let handoffFromUrl: string | null = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("handoff");
import { DraftEmail } from "./DraftEmail";
import { buildReviewEmail, greetingHtml, type ReviewEmailInput } from "@/lib/reviewEmail";
import { type FileKind } from "@/lib/reviewKinds";

// The review lines a task can add beside its client document, in order.
const REVIEW_LINES: { kind: FileKind; label: string }[] = [
  { kind: "image", label: "Image review" },
  { kind: "page", label: "HTML review" },
];

const ATT_KIND_ORDER: Record<Attachment["kind"], number> = { image: 0, pdf: 1, doc: 2, sheet: 3, link: 4 };

export function TaskDrawer({ task, clientById, projectById, contactById, full, onToggleFull, navIndex, navTotal, onPrev, onNext, onClose, onPatch, onDelete, onAddComment, onAddFiles, onDownloadFile, onDownloadFileAs, onDownloadAll, zippingIds, onRemoveFile, uploadProgress, allClients, onMoveClient, clientProjects, onSetProject, onNewProject, onRenameProject, onToggleSub, onAddSub, onRenameSub, onDeleteSub, onPatchSub, onToggleLabel, onCopyLink, onDuplicate, projectsFor, onOpenMerge, onOpenClientList, templates, onApplyTemplate, onUploadCommentImage, onCopyAttachmentLink, onGetSignedUrl, messages, onMarkChannelRead, linkedContactInfo, ccContacts, onUploadMessageImage, onSendTaskMessage, onScheduleTaskMessage, sendingMessage, onDraftMessage, draftingMessage, canAdmin, onDeleteMessage, onEditMessage, onCopyClientLink, onDraftDescription, draftingDescription, pushToast, meId, onSendDm, onDelegate, clientLinks, taskLink, onDeleteComment }: {
  task: Task;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => Contact | null;
  full: boolean; onToggleFull: () => void; navIndex: number; navTotal: number; onPrev: () => void; onNext: () => void;
  onClose: () => void; onPatch: (patch: Partial<Task>) => void; onDelete: () => void; onAddComment: (body: string, attachments?: Attachment[]) => void; onAddFiles: (files: FileList) => void; onDownloadFile: (path: string) => void; onDownloadFileAs: (path: string, filename: string) => void; onDownloadAll: (items: Attachment[], zipName: string, batchId: string) => void; zippingIds: Set<string>; onRemoveFile: (att: Attachment) => void; uploadProgress: { done: number; total: number } | null; allClients: Client[]; onMoveClient: (clientId: string) => void; clientProjects: Project[]; onSetProject: (pid: string) => void; onNewProject: () => void; onRenameProject: () => void; onToggleSub: (sid: string) => void; onAddSub: (title: string) => void; onRenameSub: (sid: string, title: string) => void; onDeleteSub: (sid: string) => void; onPatchSub: (sid: string, patch: Partial<Subtask>) => void; onToggleLabel: (lid: string) => void; onCopyLink: () => void; onDuplicate: (target?: { clientId: string; projectId: string }) => void; projectsFor: (clientId: string) => Project[]; onOpenMerge: () => void; onOpenClientList: () => void;
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
  onSendTaskMessage?: (channel: MessageChannel, subject: string, body: string, attachments?: Attachment[], cc?: string[], bcc?: string[], replyToMessageId?: string | null) => void;
  onScheduleTaskMessage?: (channel: MessageChannel, subject: string, body: string, scheduledAt: string, attachments?: Attachment[], cc?: string[], bcc?: string[], replyToMessageId?: string | null) => void;
  sendingMessage?: boolean;
  onDraftMessage?: (channel: "email" | "sms" | "chat", prompt?: string, context?: string) => Promise<{ subject?: string; body: string } | null>; // Gemini draft, never sends
  draftingMessage?: boolean;
  canAdmin?: boolean; // gates message edit/delete — a wrongly sent client-facing message is corrected by an admin, not any assignee
  onDeleteMessage?: (id: string) => void;
  onEditMessage?: (id: string, body: string, subject?: string | null) => void;
  onCopyClientLink?: () => void; // copies this client's public /waiting/[token] link
  onDraftDescription?: (title: string, description: string, prompt?: string) => Promise<string | null>; // Gemini draft, never saves
  draftingDescription?: boolean;
  pushToast: (text: string, action?: { label: string; run: () => void }, secondaryAction?: { label: string; run: () => void }) => void;
  meId: string;
  onDeleteComment?: (commentId: string) => void;
  onSendDm?: (userId: string, body: string) => void;
  /** Hands the task to a teammate: writes the assigned checklist item, the
   *  dates, the sizing and the hidden Delegated stage, and pings them. */
  onDelegate?: (spec: DelegateSpec) => void;
  clientLinks?: ClientLink[];
  taskLink?: () => string;
}) {
  // Never asserted. Delegation is exactly the case where these are missing:
  // a delegatee can see a task through tasks.delegated_to while RLS still
  // hides the client and the list it belongs to, so clientById returns null
  // and `client.color` a line later threw, tearing down the whole app on
  // open. It cost Michaella a working afternoon. A stand-in keeps the drawer
  // readable and says plainly that the record is not shared with her.
  const client = clientById(task.clientId) ?? {
    id: task.clientId, name: "Not shared with you", color: "#94a3b8",
    ghlLocationId: "", status: "active_client" as const, type: "client" as const, assignedTo: [],
  };
  const project = projectById(task.projectId) ?? {
    id: task.projectId, clientId: task.clientId, name: "List", description: "",
  };
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
  // The task as it is NOW, not as it was when a callback was created.
  //
  // Every attachment edit rebuilds the whole array, so one built from a stale
  // copy silently deletes anything added since. That is what made a new link
  // appear and then vanish: addLink patched in the link, the title fetch came
  // back a moment later and called renameAttachment, and renameAttachment
  // mapped over the attachments from the render that had ALREADY happened —
  // an array without the new link — writing it straight back out. The feed
  // recorded it honestly as "added a link" then "removed the link".
  const taskRef = useRef(task);
  // Updated on commit, not during render: writing a ref while rendering is a
  // side effect in the render path. The reads that matter happen well after
  // commit anyway (a title fetch resolving hundreds of ms later).
  useEffect(() => { taskRef.current = task; }, [task]);

  const addLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const id = newId("at_");
    const typed = linkLabel.trim();
    // Named immediately from the URL so the row never shows a raw link, then
    // upgraded in place if the page has a real title. Doing it the other way
    // round would leave a blank row while a slow site thinks about it.
    onPatch({ attachments: [...taskRef.current.attachments, { id, name: typed || prettyLinkName(href), kind: "link", size: "", url: href }] });
    setLinkUrl(""); setLinkLabel(""); setLinkOpen(false);
    if (!typed) void fetchLinkTitle(id, href);
  };
  // Reads the <title> server-side (CORS puts it out of reach here) and renames
  // the attachment if it finds one. Silent on failure: the URL-derived name is
  // already a reasonable answer, so a dead link or a slow host costs nothing.
  const fetchLinkTitle = async (id: string, href: string) => {
    try {
      const res = await authedFetch("/api/link-title", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: href }),
      });
      const j = await res.json().catch(() => ({}));
      const title = typeof j?.title === "string" ? j.title.trim() : "";
      if (!title) return;
      renameAttachment(id, title);
    } catch { /* keep the URL-derived name */ }
  };
  const renameAttachment = (id: string, name: string) => {
    const clean = name.trim().slice(0, 200);
    if (!clean) return;
    const current = taskRef.current.attachments;
    // Nothing to rename means the row is gone (deleted while the title was in
    // flight). Patching anyway would resurrect a stale array.
    if (!current.some((a) => a.id === id)) return;
    onPatch({ attachments: current.map((a) => (a.id === id ? { ...a, name: clean } : a)) });
  };
  // Reads as text until you click Edit: a live editor on every task put a
  // formatting toolbar in front of what the description actually says.
  const [descEditing, setDescEditing] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  // The delegation whose handoff page is open. A handoff link (?task=…&handoff=…)
  // opens it straight away; read once, since the app rewrites the address.
  const [openHandoff, setOpenHandoff] = useState<string | null>(() => {
    const id = handoffFromUrl;
    if (!id || !task.subtasks.some((x) => x.id === id)) return null;
    handoffFromUrl = null;
    return id;
  });
  const [dupClient, setDupClient] = useState(task.clientId);
  const [renamingAttId, setRenamingAttId] = useState<string | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
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
  // Drop a file anywhere on the drawer, not just on the Attachments block
  // (Derek: "I want to be able to drag any place to attach an image"). Aiming
  // at one small target to attach something is a rule the drawer had no
  // reason to impose.
  //
  // Counted rather than a boolean: dragleave fires every time the pointer
  // crosses into a child element, so a plain flag flickers off the moment you
  // move over anything inside the drawer.
  // The client's SaaS URL, mirrored from GoHighLevel. Seeded from the synced
  // contact so it shows instantly, then confirmed against GHL on open because
  // the mirror can be a sync behind and this is the kind of link people paste
  // into GHL directly.
  const [saasFor, setSaasFor] = useState<{ id: string; url: string }>({ id: linkedContactInfo?.id ?? "", url: linkedContactInfo?.saasUrl ?? "" });
  // Read through the contact it belongs to, so opening a different task never
  // shows the previous client's link for a frame.
  const saasUrl = saasFor.id === (linkedContactInfo?.id ?? "") ? saasFor.url : (linkedContactInfo?.saasUrl ?? "");
  const setSaasUrl = (url: string) => setSaasFor({ id: linkedContactInfo?.id ?? "", url });
  const [saasEditing, setSaasEditing] = useState(false);
  const [saasSaving, setSaasSaving] = useState(false);
  const [saasEditable, setSaasEditable] = useState(true);
  useEffect(() => {
    const ghlId = linkedContactInfo?.ghlContactId;
    const contactRowId = linkedContactInfo?.id ?? "";
    if (!ghlId) return;
    let live = true;
    // Seeding happens in the same async path as the confirm, so nothing sets
    // state synchronously in the effect body. The mirrored value renders
    // immediately anyway, as the initial state.
    authedFetch("/api/ghl/saas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ghlContactId: ghlId, contactId: contactRowId }),
    })
      .then((r) => r.json())
      // setSaasFor directly rather than the setSaasUrl wrapper: the wrapper is
      // rebuilt every render, so depending on it would re-run this effect
      // forever.
      .then((j) => { if (live && typeof j?.url === "string") { setSaasFor({ id: contactRowId, url: j.url }); setSaasEditable(j.editable !== false); } })
      .catch(() => { /* keep the mirrored value */ });
    return () => { live = false; };
  }, [linkedContactInfo?.ghlContactId, linkedContactInfo?.id, linkedContactInfo?.saasUrl]);

  const saveSaas = async (value: string) => {
    const ghlId = linkedContactInfo?.ghlContactId;
    if (!ghlId) return;
    setSaasSaving(true);
    try {
      const res = await authedFetch("/api/ghl/saas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ghlContactId: ghlId, contactId: linkedContactInfo?.id, url: value }),
      });
      const j = await res.json();
      if (!res.ok) { pushToast(j?.error ?? "Couldn't save to GoHighLevel."); return; }
      setSaasUrl(j.url ?? "");
      setSaasEditing(false);
      pushToast(j.url ? "SaaS link saved to GoHighLevel" : "SaaS link cleared");
    } catch { pushToast("Couldn't reach GoHighLevel."); }
    finally { setSaasSaving(false); }
  };

  const [fileOverDrawer, setFileOverDrawer] = useState(false);
  const dragDepth = useRef(0);
  const carriesFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const drawerDropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!carriesFiles(e)) return;
      dragDepth.current += 1;
      setFileOverDrawer(true);
    },
    onDragOver: (e: React.DragEvent) => { if (carriesFiles(e)) e.preventDefault(); },
    onDragLeave: (e: React.DragEvent) => {
      if (!carriesFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setFileOverDrawer(false);
    },
    onDrop: (e: React.DragEvent) => {
      dragDepth.current = 0;
      setFileOverDrawer(false);
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      openSection("attachments");
      onAddFiles(e.dataTransfer.files);
    },
  };
  const [previewAtt, setPreviewAtt] = useState<Attachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Escape closes the photo preview, not the drawer behind it.
  useEscapeToClose(() => setPreviewAtt(null), !!previewAtt);
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

  // Packages the task as a ready-to-paste brief for a Claude Code session.
  const copyForClaude = async () => {
    const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId);
    const descText = htmlToText(task.description);
    // The link opens this task, not the app's front page (Derek: "can we have
    // the direct link please not just the link to task manager"). taskLink is
    // the same builder the dock uses for a delegated task; new URL makes it
    // absolute whether it comes back as a full URL or just "?task=...".
    const taskUrl = new URL(taskLink?.() ?? "", window.location.origin).href;
    const brief = [
      `Work on this task from ClickUpTasks (${taskUrl}):`,
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
      pushToast("Copied for Claude");
    } catch { pushToast("Couldn't copy to the clipboard."); }
  };
  // Pasting a FILE anywhere in the drawer (title, description, a comment
  // draft — doesn't matter which field has focus) attaches it to the task,
  // same upload pipeline as drag-drop onto the Attachments block. Only
  // intercepts when the clipboard actually carries a file, so a normal text
  // paste into any field is left untouched.
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    // Any file, not just images. A pasted PDF, video or doc is exactly as
    // much an attachment as a screenshot, and it used to fall through to the
    // URL branch and then to nothing at all.
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (files.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      onAddFiles(dt.files);
      return;
    }
    // A pasted URL attaches itself, no "+ Attach → Link → Add" trip (Derek:
    // "if I copy and paste a link just attach it"). Guarded hard, because the
    // failure mode is stealing an ordinary paste:
    //   - only when focus is NOT in a field you can type into, so pasting a
    //     URL into the description, the title or a comment still just types
    //     it, which is almost always what you meant there;
    //   - only for a single bare http(s) URL with no surrounding prose, so
    //     pasting a paragraph that happens to contain a link is untouched;
    //   - and not for one already attached, which would otherwise stack
    //     duplicates every time you pasted the same thing twice.
    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (!text) return;
    const el = document.activeElement as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
    if (!/^https?:\/\/[^\s]+$/i.test(text)) return;
    if (task.attachments.some((a) => a.url === text)) {
      pushToast?.("That link is already attached");
      e.preventDefault();
      return;
    }
    e.preventDefault();
    // Same naming as the Link form: a readable name immediately, upgraded to
    // the page title if we can read one. Pasting used to keep the raw URL, so
    // the two ways of adding a link produced different-looking rows.
    const pastedId = newId("at_");
    onPatch({ attachments: [...taskRef.current.attachments, { id: pastedId, name: prettyLinkName(text), kind: "link", size: "", url: text }] });
    void fetchLinkTitle(pastedId, text);
    pushToast?.("Link attached");
  };
  // Loaded here rather than with the initial payload: unlike tasks or clients
  // this grows without bound and only one task's worth is ever on screen.
  // Stored with the id it belongs to, and read back only when they match, so
  // switching tasks shows nothing rather than the previous task's history for
  // a frame. Clearing it with a setState in the effect body would do the same
  // job at the cost of a cascading render.
  const [loaded, setLoaded] = useState<{ id: string; rows: TaskAction[] }>({ id: "", rows: [] });
  const actions = loaded.id === task.id ? loaded.rows : [];
  useEffect(() => {
    let live = true;
    fetchTaskActions(task.id).then((rows) => { if (live) setLoaded({ id: task.id, rows }); });
    return () => { live = false; };
  }, [task.id]);
  const logAction = (a: TaskAction) => { setLoaded((p) => ({ id: task.id, rows: [a, ...(p.id === task.id ? p.rows : [])] })); insertTaskAction(a); };
  // Removes a logged action outright. Needed because the commonest mistake
  // with a paste-heavy log is pasting into the wrong task, and until now the
  // only fix was living with it (Derek: "I added this all to the wrong task").
  // RLS lets an admin or the author delete; anyone else gets a no-op and the
  // row reappears on the next load, which is the honest outcome.
  const deleteAction = (id: string) => {
    setLoaded((p2) => ({ ...p2, rows: p2.rows.filter((a) => a.id !== id) }));
    deleteTaskActionDb(id);
  };
  const editAction = (id: string, body: string) => {
    setLoaded((p2) => ({ ...p2, rows: p2.rows.map((a) => (a.id === id ? { ...a, body } : a)) }));
    editTaskActionDb(id, body);
  };
  // The one open commitment, and the three ways to change it from its card.
  // The follow up date IS the open step's date, so each of these keeps the
  // two together: they used to be edited in different places and a real task
  // showed Sep 15 and Sep 17 for the same thing (2026-09-14 redesign).
  const openStep = openNextStep(actions);
  const updateActionRow = (id: string, patch: Partial<TaskAction>) =>
    setLoaded((p) => ({ ...p, rows: p.rows.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const setNextStepDone = (id: string, done: boolean) => {
    const at = done ? new Date().toISOString() : null;
    updateActionRow(id, { nextStepDoneAt: at });
    setNextStepDoneDb(id, at);
    // Ticking off the open step moves the follow up to the step still open,
    // or clears it, so the task never keeps waiting on finished work.
    if (done && openStep?.id === id) {
      const next = followUpAfterStepDone(actions, id);
      if (next !== (task.followUpAt ?? null)) onPatch({ followUpAt: next });
    }
  };
  const moveFollowUp = (date: string | null) => {
    onPatch({ followUpAt: date });
    if (openStep) { updateActionRow(openStep.id, { nextStepDue: date }); patchNextStepDb(openStep.id, { nextStepDue: date }); }
  };
  const renameNextStep = (id: string, text: string) => { updateActionRow(id, { nextStep: text }); patchNextStepDb(id, { nextStep: text }); };
  // Keyed by task like the other drafts here, since this drawer is not
  // remounted when the task changes.
  const [stepDraft, setStepDraft] = useState<{ taskId: string; text: string } | null>(null);
  // The task whose next step was just ticked and is asking what happens next.
  const [askNext, setAskNext] = useState<string | null>(null);
  const [nextDraft, setNextDraft] = useState("");

  // One name for "may this person contact this client", used by the dock, the
  // Open in GHL link and the Call link. Cockpit only passes onSendTaskMessage
  // when canMessageClient says yes, so this is that permission arriving by
  // the back door; naming it keeps the three places from drifting.
  const mayContactClient = !!onSendTaskMessage;
  // A delegation is stored as an assigned checklist item, but reading it as
  // one buried it: a truncated row inside Checklist, under a "0/1 · 0%"
  // counter, saying nothing about who has it (Derek: "move the delegate out
  // of checklist and over under the stage selection ... with Michaella's
  // icon, who it's assigned to"). Split here, shown as its own row below the
  // stage chips, and left out of the checklist and its progress entirely.
  const delegations = task.subtasks.filter((s) => !!s.assigneeId && s.assigneeId !== task.assigneeId);  const plainSubs = task.subtasks.filter((s) => !delegations.includes(s));
  const doneSubs = plainSubs.filter((s) => s.done).length;

  // Bottom of the Escape stack: anything opened over the drawer closes first.
  useEscapeToClose(onClose);

  const titleBlock = (
    <textarea value={titleDraft}
      onChange={(e) => { const v = e.target.value; setTitleDraft(v); titleCommit.schedule(() => onPatch({ title: v })); }}
      onBlur={titleCommit.flush}
      rows={1} className={`-mx-1 w-full resize-none rounded-md bg-transparent px-1 font-bold leading-tight tracking-[-0.01em] outline-none [field-sizing:content] transition focus:bg-surface ${full ? "text-[30px]" : "text-[26px]"} `} />
  );
  // Completion checkbox to the title's left (item 4) — the fastest way to
  // close out a task without hunting for the Status chip.
  // Comment/event timestamps already cover every field-change and message —
  // the latest one is a true "last updated", not just a metadata guess.
  const lastActivityAt = task.comments.reduce((max, c) => (c.at > max ? c.at : max), task.createdAt);
  const creatorName = task.createdBy === "u_claude" ? "Automated"
    : task.createdBy === "client" ? "the client"
    : task.createdBy ? (userById(task.createdBy)?.name ?? null) : null;
  const titleRow = (
    <div className="flex items-start gap-2.5">
      {/* No done circle here. It never worked reliably from the drawer, and
          the Stage control in the chip row below already sets Done — two
          controls for one field, one of them broken. */}
      {/* The title gets the whole line. Riding the byline alongside it cost
          a long title a second row of wrapping to make room for text nobody
          acts on (Derek: "the city ir line wrapping"). Who added it now sits
          under the Created date in the band below, which is the fact it
          actually describes. */}
      <div className="min-w-0 flex-1">{titleBlock}</div>
    </div>
  );
  // One quiet line under the title: who made it and when, then its labels.
  // Created used to be the first of three tinted date cards with a runway bar
  // under them, about 170px of the drawer for three dates (2026-09-14
  // redesign). Due lives in the chips below; the follow up is the Next step
  // card's date.
  const createdDay = task.createdAt.slice(0, 10);
  const subMeta = (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[16px] text-muted">
      <span title={`Updated ${timeAgo(lastActivityAt)}`}>Created {formatDue(createdDay)}{creatorName ? ` by ${creatorName}` : ""}</span>
      {task.labelIds.map((id) => {
        const l = labelById(id);
        return l ? (
          <button key={id} onClick={() => onToggleLabel(id)} title="Remove this label"
            className="group inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[16px] font-medium" style={{ background: l.color + "1a", color: l.color }}>
            {l.name} <span className="opacity-50 group-hover:opacity-100">×</span>
          </button>
        ) : null;
      })}
      <div className="relative">
        <button onClick={() => setLabelOpen((o) => !o)} className="rounded-md px-1.5 py-0.5 hover:bg-surface hover:text-foreground">+ Label</button>
        {labelOpen && (<>
          <div className="fixed inset-0 z-30" onClick={() => setLabelOpen(false)} />
          <div className="absolute left-0 z-40 mt-1 w-56 rounded-lg border bg-surface p-1.5 shadow-lg">
            {labels.map((l) => {
              const on = task.labelIds.includes(l.id);
              return (
                <button key={l.id} onClick={() => onToggleLabel(l.id)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[16px] text-foreground hover:bg-background">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} /> {l.name}{on && <I.check className="ml-auto text-accent" />}
                </button>
              );
            })}
          </div>
        </>)}
      </div>
    </div>
  );

  // Five fields with one look. Status, owner, priority, due and time were five
  // different kinds of control with their own borders and colours, and the
  // status and priority text was painted in its own colour on top of that.
  // Tinted blocks with 5px corners, no outlines, and colour only where it
  // means something (Derek, 2026-09-16: the page read "very flat"; "I don't
  // like pills so make them 5px").
  const chip = "inline-flex min-h-10 items-center gap-2 rounded-[5px] bg-background px-3 text-[16px]";
  const tint = (color: string) => ({ background: `${color}1f` });
  // Each dropdown is only as wide as what it shows. Sized to their longest
  // option ("Changes requested", "Michaella Pastrana") the row ran out of room
  // and pushed the time estimate onto a line of its own (Derek, 2026-09-16:
  // "move it up on the same line as the date").
  const chipSelect = "min-w-0 cursor-pointer bg-transparent py-1 outline-none [field-sizing:content]";
  const dueDays = task.due && task.status !== "done" ? daysUntilDue(task.due) : null;
  // Colour only when it means something: amber inside three days, red once late.
  const dueTone = dueDays === null ? "" : dueDays < 0 ? "late" : dueDays <= 3 ? "soon" : "";
  const recurrenceInput = "rounded-md border bg-background px-2 py-0.5 text-[16px] outline-none focus:border-accent";
  const chipRow = (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <label className={chip} style={tint(STATUS_META[effectiveStatus(task)].dot)}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_META[effectiveStatus(task)].dot }} />
        <select value={effectiveStatus(task)} onChange={(e) => onPatch({ status: e.target.value as TaskStatus })} aria-label="Status" className={`${chipSelect} font-medium`}>
          {pickableStatuses(effectiveStatus(task)).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </label>
      {/* Waiting on the client is not an owner option. It is a stage, set from
          the status chip, and it keeps the owner (Derek, 2026-09-10). */}
      <label className={`${chip} max-w-[280px]`}>
        <span className="shrink-0 text-muted">Owner</span>
        <select value={task.assigneeId ?? ""} onChange={(e) => onPatch({ assigneeId: e.target.value || null })} aria-label="Owner" className={chipSelect}>
          <option value="">Unassigned</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <label className={`${chip} ${task.priority === "urgent" ? "text-danger" : ""}`} style={task.priority === "urgent" ? tint(PRIORITY_META.urgent.color) : undefined}>
        <span className={task.priority === "urgent" ? "" : "text-muted"}>Priority</span>
        <select value={task.priority} onChange={(e) => onPatch({ priority: e.target.value as Priority })} aria-label="Priority" className={`${chipSelect} ${task.priority === "urgent" ? "font-semibold" : ""}`}>
          {manualPriorityOptions(task.priority).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
        </select>
      </label>
      <span className={`${chip} ${dueTone === "late" ? "!bg-danger-soft" : dueTone === "soon" ? "!bg-highlight-soft" : ""}`}>
        <span className="text-muted">Due</span>
        <InlineDue value={task.due} overdue={false} recurrence={task.recurrence} recurrenceInterval={task.recurrenceInterval} recurrenceUnit={task.recurrenceUnit} recurrenceDaysOfMonth={task.recurrenceDaysOfMonth} recurrenceNth={task.recurrenceNth} recurrenceWeekday={task.recurrenceWeekday}
          showRecurrenceLabel={task.recurrence !== "custom"} showCountdown={false} showSnooze={false} formatValue={formatDue}
          textClass="-mx-1 text-[16px] font-medium" toneClass="text-foreground"
          onChange={(d) => onPatch({ due: d })} onRecurrenceChange={(r) => onPatch({ recurrence: r })} emptyLabel="Not set" />
        {task.due && task.status !== "done" && (
          <span className={dueTone === "late" ? "font-semibold text-danger" : dueTone === "soon" ? "font-semibold text-highlight" : "text-muted"}>{dueCountdown(task.due)}</span>
        )}
      </span>
      {/* Sizing sits with the other chips: it is one decision, made once. */}
      <SizePicker size={task.size} sizeHours={task.sizeHours} onChange={onPatch} chipClass={chip} />
      {task.recurrence === "custom" && (
        <span className={`${chip} flex-wrap py-1 text-muted`}>
          {task.recurrenceUnit === "nth-weekday" ? (
            <>
              On the
              <select value={task.recurrenceNth ?? 1} onChange={(e) => onPatch({ recurrenceNth: parseInt(e.target.value, 10) })} className={recurrenceInput}>
                <option value={1}>1st</option>
                <option value={2}>2nd</option>
                <option value={3}>3rd</option>
                <option value={4}>4th</option>
                <option value={-1}>last</option>
              </select>
              <select value={task.recurrenceWeekday ?? 1} onChange={(e) => onPatch({ recurrenceWeekday: parseInt(e.target.value, 10) })} className={recurrenceInput}>
                {WEEKDAY_LABEL.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
              of the month
            </>
          ) : task.recurrenceUnit === "day-of-month" ? (
            <>
              On day(s)
              <input type="text" placeholder="1, 15" defaultValue={(task.recurrenceDaysOfMonth ?? []).join(", ")}
                onBlur={(e) => onPatch({ recurrenceDaysOfMonth: parseDaysOfMonth(e.target.value) })}
                className={`${recurrenceInput} w-20 text-center`} />
              of month
            </>
          ) : (
            <>
              Every
              <input type="number" min={1} value={task.recurrenceInterval ?? 1} onChange={(e) => onPatch({ recurrenceInterval: Math.max(1, parseInt(e.target.value, 10) || 1) })} className={`${recurrenceInput} w-16 text-center`} />
            </>
          )}
          <select value={task.recurrenceUnit ?? "week"} onChange={(e) => onPatch({ recurrenceUnit: e.target.value as RecurrenceUnit })} className={recurrenceInput}>
            <option value="day">day(s)</option>
            <option value="week">week(s)</option>
            <option value="month">month(s)</option>
            <option value="day-of-month">day(s) of month</option>
            {/* No 5th on offer: most months haven't got one, so a "5th Monday"
                rule would silently skip months rather than repeat monthly. */}
            <option value="nth-weekday">nth weekday of month</option>
          </select>
        </span>
      )}
    </div>
  );

  // The one commitment on this task, shown once. Its date is the follow up.
  // The task's own follow up wins when the two disagree, because the task
  // list edits it without the steps loaded.
  const followUp = task.followUpAt ?? openStep?.nextStepDue ?? null;
  const editingStep = !!openStep && stepDraft?.taskId === task.id;
  const saveStepDraft = () => {
    if (openStep && stepDraft && stepDraft.text.trim() && stepDraft.text.trim() !== openStep.nextStep) renameNextStep(openStep.id, stepDraft.text.trim());
    setStepDraft(null);
  };
  // The next step as one item you tick (Derek, 2026-09-16, option A): a round
  // tick to finish it, the words to click and edit, the date to click for the
  // quick dates, who it's for, where it came from, and how often it has slid.
  // Ticking asks what happens next right in the card.
  const stepOwner = task.assigneeId ? userById(task.assigneeId) : null;
  const stepDate = stepDateLabel(followUp);
  const stepMoves = openStep ? followUpMoves(task.comments, openStep.at) : 0;
  const finished = doneSteps(actions);
  const asking = askNext === task.id;
  // Lands on the entry that set the step in the conversation, and flashes it.
  const jumpToAction = (id: string) => {
    const el = document.getElementById(`action-${id}`);
    if (!el) { pushToast("That entry is further back in the conversation."); return; }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate([{ backgroundColor: "rgba(250, 204, 21, 0.35)" }, { backgroundColor: "transparent" }], { duration: 1400, easing: "ease-out" });
  };
  const tickStep = () => {
    if (openStep) setNextStepDone(openStep.id, true);
    else if (followUp) onPatch({ followUpAt: null });
    setAskNext(task.id);
    setNextDraft("");
  };
  // A new next step on its own, logged as a quiet entry so the conversation
  // keeps the story of what was planned.
  const setNewStep = (text: string, date: string | null) => {
    const step = text.trim();
    if (!step) { pushToast("Write the next step first."); return; }
    logAction({ id: newId("ta_"), taskId: task.id, kind: "note", authorId: meId ?? null, toId: null, parentId: null,
      body: "", at: new Date().toISOString(), nextStep: step, nextStepDue: date, nextStepDoneAt: null });
    if (date !== (task.followUpAt ?? null)) onPatch({ followUpAt: date });
    setAskNext(null);
    setNextDraft("");
  };
  const dateTone = { late: "bg-danger-soft text-danger", soon: "bg-highlight-soft text-highlight", later: "bg-background text-foreground", none: "bg-background text-muted" }[stepDate.tone];
  const quickChip = "rounded-[5px] bg-surface px-3 py-1.5 text-[16px] font-semibold ring-1 ring-border hover:ring-accent";
  const nextStepCard = task.status === "done" && !openStep && !asking ? null : (
    <div className={`mt-7 flex items-start gap-3.5 rounded-2xl px-4 py-4 sm:px-5 ${openStep || followUp || asking ? "bg-surface shadow-soft ring-1 ring-border" : "border-2 border-dashed"}`}>
      <button onClick={tickStep} disabled={!openStep && !followUp} title="Mark done" aria-label="Mark done"
        className={`group/tick mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition disabled:cursor-default disabled:border-dashed disabled:opacity-50 ${asking ? "border-success bg-success text-white" : "border-accent bg-surface text-transparent hover:bg-accent-soft hover:text-accent"}`}>
        <I.check className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-bold tracking-wide text-muted">NEXT STEP</div>
        {asking ? (
          // Done: what happens next, with the quick dates as the way to save it.
          <div className="mt-2 rounded-xl bg-background p-3">
            <div className="font-semibold">Done. What happens next?</div>
            <input autoFocus value={nextDraft} onChange={(e) => setNextDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setNewStep(nextDraft, dateQuickPicks()[1].date); if (e.key === "Escape") { e.stopPropagation(); setAskNext(null); } }}
              placeholder="Like: send the approved emails to Michaella" aria-label="Next step"
              className="mt-2 w-full rounded-lg bg-surface px-3 py-2 text-[16px] outline-none ring-1 ring-border focus:ring-2 focus:ring-accent" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {dateQuickPicks().slice(1, 4).map((q) => (
                <button key={q.label} onClick={() => setNewStep(nextDraft, q.date)} className={quickChip}>{q.label}</button>
              ))}
              <InlineDate value={null} onChange={(d) => setNewStep(nextDraft, d)} emptyLabel="📅 Pick a date" className={quickChip} />
              <button onClick={() => setAskNext(null)} className="ml-auto rounded-lg px-3 py-1.5 text-[16px] font-medium text-muted hover:text-foreground">Nothing for now</button>
            </div>
          </div>
        ) : (
          <>
            {editingStep ? (
              <input autoFocus value={stepDraft.text} onChange={(e) => setStepDraft({ taskId: task.id, text: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") saveStepDraft(); if (e.key === "Escape") { e.stopPropagation(); setStepDraft(null); } }}
                onBlur={saveStepDraft} aria-label="Next step"
                className="mt-0.5 w-full rounded-lg bg-background px-2 py-1 text-[21px] font-bold outline-none ring-2 ring-accent" />
            ) : openStep ? (
              <button onClick={() => setStepDraft({ taskId: task.id, text: openStep.nextStep ?? "" })} title="Click to edit"
                className="-ml-1.5 mt-0.5 block max-w-full rounded-md px-1.5 py-0.5 text-left text-[21px] font-bold leading-snug [overflow-wrap:anywhere] hover:bg-background">
                {openStep.nextStep}
              </button>
            ) : (
              <button onClick={() => { setAskNext(task.id); setNextDraft(""); }}
                className="-ml-1.5 mt-0.5 block rounded-md px-1.5 py-0.5 text-left text-[21px] font-bold leading-snug text-muted hover:bg-background">
                {followUp ? "Check back on this task" : "What happens next? Click to write it"}
              </button>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <InlineDate value={followUp} onChange={moveFollowUp} onClear={followUp ? () => moveFollowUp(null) : undefined}
                formatValue={() => `📅 ${stepDate.label}`} emptyLabel="📅 Set a date"
                className={`rounded-[5px] !px-2.5 !py-1.5 text-[16px] font-semibold ${dateTone}`} />
              {stepOwner && (
                <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-background py-1 pl-1 pr-2.5 text-[16px] font-semibold">
                  <Avatar id={stepOwner.id} size={24} />{stepOwner.id === meId ? "You" : stepOwner.name}
                </span>
              )}
              {openStep && (
                <button onClick={() => jumpToAction(openStep.id)} title="Show where this step was set"
                  className="text-[16px] text-muted underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-current">
                  {TASK_ACTION_META[openStep.kind].verb} · {timeAgo(openStep.at)}
                </button>
              )}
            </div>
            {stepMoves >= 3 && (
              <div className="mt-2.5 rounded-lg bg-amber-50 px-3 py-2 text-[16px] font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                ⚠ Moved {stepMoves} times since it was set. Is it stuck?
              </div>
            )}
            {finished.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[16px] text-muted">
                <span>Done so far:</span>
                {finished.map((f) => (
                  <span key={`${f.doneAt}_${f.text}`} className="rounded-[5px] bg-background px-2 py-0.5"><span className="text-success">✓</span> {f.text} {formatDue(f.doneAt.slice(0, 10))}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  // Where the task lives, always open in the rail. It was a dashed button
  // that hid three facts behind a click (2026-09-14 redesign).
  const detailsBlock = (
    <dl className="space-y-3">
      {/* Type-to-filter rather than a plain select: this list is every client
          on the account, far past where scrolling a native dropdown is fast. */}
      <Row label="Client" icon={<I.folder />}><SearchableSelect value={task.clientId} onChange={onMoveClient} options={clientSelectOptions} searchPlaceholder="Search clients…" className="w-full rounded-md border border-transparent px-2 py-1 text-[16px] transition hover:border-border hover:bg-background" /></Row>
      <Row label="Project" icon={<I.list />}>
        <select value={task.projectId} onChange={(e) => { if (e.target.value === "__new") onNewProject(); else onSetProject(e.target.value); }}
          className="w-full rounded-md border border-transparent px-2 py-1 text-[16px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background">
          {clientProjects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          {clientProjects.every((p) => p.id !== task.projectId) && <option value={task.projectId}>{project?.name ?? "List"}</option>}
          <option value="__new">+ New project…</option>
        </select>
      </Row>
      <Row label="Contact" icon={<I.user />}>
        {(() => { const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId); return <span className={`block truncate px-2 py-1 text-[16px] ${ct ? "" : "text-muted"}`}>{ct ? ct.name : "None"}</span>; })()}
      </Row>
    </dl>
  );
  // The client's own reply, submitted through the public /waiting/[token]
  // page — surfaced prominently (its own bordered card, above Description)
  // since it's the reason this task just landed back on someone's plate.
  // Read-only reference panel for an Owner Growth Plan step — looked up live
  // from the catalog by key, never stored on the task, so it can't drift per

  const clientResponseBlock = task.clientResponse && (task.clientResponse.body || task.clientResponse.attachments.length > 0) ? (
    <div className="mt-4 rounded-xl border border-accent/30 bg-surface p-4">
      <div className="mb-2 flex items-center gap-1.5 text-[16px] font-semibold text-accent"><I.user className="h-4 w-4" /> Client response</div>
      {task.clientResponse.body && <CollapsibleText text={task.clientResponse.body} className="text-[16px]" />}
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
                <div className="truncate text-center text-[16px]" title={a.name}>{a.name}</div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-1.5 text-[16px] text-muted">Submitted {timeAgo(task.clientResponse.submittedAt)}</div>
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
  // A client document is for sharing, so a private task and the Personal client
  // never get one. Whether one exists is only known once TaskDocument loads it,
  // so it reports back; keyed by task id like openSections, because this drawer
  // is not remounted when the task changes.
  const canHaveDocument = !task.private && task.clientId !== PERSONAL_CLIENT_ID;
  const [docPresence, setDocPresence] = useState<{ taskId: string; exists: boolean }>({ taskId: task.id, exists: false });
  const docExists = docPresence.taskId === task.id && docPresence.exists;
  const showDocument = canHaveDocument && docExists;
  // Image and web page reviews report the same way, one kind each (Derek, 2026-09-12).
  const [reviewPresence, setReviewPresence] = useState<{ taskId: string; kinds: FileKind[] }>({ taskId: task.id, kinds: [] });
  const hasReview = (kind: FileKind) => canHaveDocument && reviewPresence.taskId === task.id && reviewPresence.kinds.includes(kind);
  // The document, the reviews and the draft email each open full screen from their
  // line, and their chips open them straight away. Bumping a number is the signal,
  // so a second click opens it again after it was closed; one counter per review
  // kind, so opening one never reopens the other.
  const [docStartNonce, setDocStartNonce] = useState(0);
  const [reviewStartNonce, setReviewStartNonce] = useState<Record<FileKind, number>>({ image: 0, page: 0 });
  const [emailOpenNonce, setEmailOpenNonce] = useState(0);
  // Email on this task, from the dock, the "+ Draft email" chip or Reply on a
  // message, opens the draft email window. A draft already here opens as it is;
  // a reply replaces it, after a confirm when it has writing in it.
  const startDraftEmail = (reply?: { subject?: string; replyTo?: string }) => {
    const current = task.draftEmail;
    const keepCurrent = !!current && (!reply || (!!htmlToText(current.body).trim() && !window.confirm("Replace the draft email on this task with this reply?")));
    if (!keepCurrent) {
      const now = new Date().toISOString();
      onPatch({ draftEmail: { subject: reply?.subject ?? task.title, body: greetingHtml(messageDest?.name), replyTo: reply?.replyTo ?? null, createdAt: now, updatedAt: now } });
    }
    setEmailOpenNonce((n) => n + 1);
  };
  // The hidden file input lives in whichever of the two is actually mounted
  // (never both, since they're mutually exclusive) so fileRef always resolves.
  const hiddenFileInput = (
    <input ref={fileRef} type="file" multiple className="hidden"
      onChange={(e) => { if (e.target.files) onAddFiles(e.target.files); e.target.value = ""; }} />
  );

  const documentBlock = !canHaveDocument ? null : (
    // Keyed apart from the draft email line beside it: two siblings sharing a
    // key made React mount a new document line on every render and never drop
    // the old ones (Derek, 2026-09-11: "there's like 100 on there").
    <TaskDocument key={`doc-${task.id}`} task={task} onPatch={onPatch} pushToast={pushToast} canAdmin={!!canAdmin} meId={meId}
      onEmailClient={(review) => startReviewEmail(review)}
      startNonce={docStartNonce}
      onPresence={(exists) => setDocPresence((p) => (p.taskId === task.id && p.exists === exists ? p : { taskId: task.id, exists }))} />
  );
  const descriptionBlock = !showDescription ? null : (
    <div>
      {/* Reads as text until you click it. A permanently-live editor put a
          formatting toolbar and an AI prompt box in the rail on every task,
          which is most of why this column looked twice the weight of the
          mockup it came from. */}
      {descEditing || !htmlToText(task.description).trim() ? (
        <RichTextEditor key={`task-desc-${task.id}-${descFocusNonce}`} value={task.description} onChange={(html) => descriptionCommit.schedule(() => onPatch({ description: html }))} placeholder="Add a description…" />
      ) : (
        <button onClick={() => setDescEditing(true)} title="Click to edit"
          className="-mx-2 block w-full max-w-[72ch] rounded-lg px-2 py-1 text-left text-[16px] leading-relaxed hover:bg-surface">
          <CollapsibleText text={htmlToText(task.description)} maxLines={5} />
        </button>
      )}
      {descEditing && (
        <button onClick={() => { descriptionCommit.flush(); setDescEditing(false); }}
          className="mt-1.5 text-[16px] text-accent underline underline-offset-[3px]">Done editing</button>
      )}
      {descEditing && onDraftDescription && (
        <div className="mt-2 flex shrink-0 items-start gap-1.5 rounded-lg border border-accent/30 bg-accent-soft/40 p-1.5">
          <span aria-hidden className="pt-1 pl-1 text-[16px]">✨</span>
          {/* A textarea that grows with the text rather than an input that
              scrolls it sideways — a real instruction runs past one line, and
              you can't check what you asked for if you can't see it. Enter
              still writes, Shift+Enter now gets a new line. */}
          <textarea value={descDraftPrompt} rows={1}
            onChange={(e) => { setDescDraftPrompt(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`; }}
            onKeyDown={(e) => { if (e.key !== "Enter" || e.shiftKey || draftingDescription) return; e.preventDefault(); runDraftDescription(); }}
            placeholder="Tell Claude what to write… (Enter to write, Shift+Enter for a new line)"
            className="max-h-[200px] min-w-0 flex-1 resize-none self-center overflow-y-auto bg-transparent px-1 py-1 text-[16px] leading-snug outline-none placeholder:text-muted" />
          <button onClick={runDraftDescription} disabled={draftingDescription}
            title={descDraftPrompt.trim() ? "Draft this with Claude" : "Draft a description from the task title"}
            className="mt-0.5 shrink-0 rounded-md border border-accent/40 bg-surface px-2.5 py-1 text-[16px] font-medium text-accent disabled:opacity-40">
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
  // A sent message parks here until the dock picks it up and asks what
  // happens next. Sending used to end the interaction; the follow-up date
  // never got set, which is how a task goes quiet after real work on it.
  const [pendingNextStep, setPendingNextStep] = useState<{ kind: TaskActionKind; body: string } | null>(null);
  // Reply on a client's chat or text: the dock's box switches to it (Derek, 2026-09-16).
  const [replyTarget, setReplyTarget] = useState<{ id: string; channel: "chat" | "sms"; preview: string; n: number } | null>(null);
  const { feedArea, composerFooter, openCompose } = useTaskMessaging({
    actions, onDeleteAction: deleteAction, onEditAction: editAction, onLogAction: logAction, meId, onSendDm, onDeleteComment,
    onMessageSent: (channel, body) => setPendingNextStep({ kind: channel, body }),
    onComposeEmail: hasMessaging ? startDraftEmail : undefined,
    onReplyInDock: (id, channel, preview) => setReplyTarget((r) => ({ id, channel, preview, n: (r?.n ?? 0) + 1 })),
    task, client, comment, setComment, onAddComment, onUploadCommentImage, onDownloadFile, onDownloadFileAs, onDownloadAll, zippingIds,
    attImageUrls, openPreview, attachToTask, messages, onMarkChannelRead, messageDest, onUploadMessageImage,
    onSendTaskMessage, onScheduleTaskMessage, sendingMessage, onDraftMessage, draftingMessage, canAdmin,
    onDeleteMessage, onEditMessage, hasMessaging,
  });
  // Reads like the task row it effectively is: a tick box, their face, what
  // they were asked for, and when they owe it. Sits directly under the stage
  // chips, because "Delegated" in that row and the person holding it are one
  // fact and were two screens apart.
  const delegationRow = delegations.length === 0 ? null : (
    <div className="mt-2 space-y-1.5">
      {delegations.map((s) => (
        // Purple, taken straight from the Delegated stage's own colour, so
        // the chip above the box and the box itself are visibly the same
        // fact (Derek: "make the box purple since the stage name is
        // purple"). Read from STATUS_META rather than restated, so recolouring
        // the stage recolours this with it.
        <div key={s.id} className="group/deleg rounded-xl border px-3 py-2"
          style={{ borderColor: STATUS_META.delegated.dot, background: STATUS_META.delegated.chip }}>
          <div className="flex items-start gap-2.5">
            <button onClick={() => onToggleSub(s.id)} title={s.done ? "Reopen" : "Mark done"}
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${s.done ? "border-accent bg-accent text-white" : "bg-surface hover:border-accent"}`}>
              {s.done && <I.check className="h-3 w-3" />}
            </button>
            <Avatar id={s.assigneeId!} size={22} />
            <div className="min-w-0 flex-1">
              {/* Editable in place: a handoff gets renamed as often as a
                  task does, and the derived title is a first guess at what
                  to call it (Derek: "I also want to be able to edit the task
                  title"). */}
              <textarea value={s.title} onChange={(e) => onPatchSub(s.id, { title: e.target.value })} rows={1}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                className={`-mx-1 w-full resize-none rounded bg-transparent px-1 text-[16px] font-medium leading-snug outline-none [field-sizing:content] focus:bg-surface ${s.done ? "text-muted line-through" : ""}`} />
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[16px] text-muted">
                <span className="font-semibold uppercase tracking-wide text-accent">Delegated</span>
                <span aria-hidden>·</span>
                <span>{userById(s.assigneeId!)?.name ?? "a teammate"}</span>
              </div>
            </div>
            {/* The due date once, here, where it can be changed (Derek,
                2026-09-16: "we have due date twice"). */}
            <InlineDate value={s.due ?? null} onChange={(d) => onPatchSub(s.id, { due: d })} onClear={() => onPatchSub(s.id, { due: null })}
              className={`shrink-0 text-[16px] ${s.due && isOverdue(s.due) && !s.done ? "font-semibold text-danger" : "text-muted"}`} formatValue={(d) => `Due ${formatDue(d)}`} emptyLabel={<span className="text-[16px] text-muted">Set a due date</span>} />
            {/* Taking it back. Confirmed in Cockpit's deleteSub, which names
                the person and says they lose access, because this is the one
                thing giving them the task at all. */}
            <button onClick={() => onDeleteSub(s.id)} title="Take this back"
              className="mt-0.5 shrink-0 rounded p-1 text-muted opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover/deleg:opacity-100">
              <I.trash className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* The handoff, summed up: how far along it is and what is on it, one
              click from the page itself (Derek, 2026-09-16). The instructions
              live on that page now instead of in a tall box here. */}
          {(() => {
            const h = handoffOf(s);
            const { done, total } = handoffProgress(h);
            const facts = [
              h.deliverables.length ? `${h.deliverables.length} ${h.deliverables.length === 1 ? "deliverable" : "deliverables"}` : null,
              h.links.length ? `${h.links.length} ${h.links.length === 1 ? "link" : "links"}` : null,
              h.fileIds.length ? `${h.fileIds.length} ${h.fileIds.length === 1 ? "file" : "files"}` : null,
              h.thread.length ? `${h.thread.length} ${h.thread.length === 1 ? "message" : "messages"}` : null,
            ].filter(Boolean);
            return (
              <div className="mt-2.5 space-y-2 pl-[3.25rem]">
                {total > 0 && (
                  <div className="flex items-center gap-2.5 text-[16px] text-muted">
                    <span className="shrink-0">{done} of {total} steps</span>
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
                      <span className="block h-full rounded-full" style={{ width: `${Math.round((done / total) * 100)}%`, background: STATUS_META.delegated.dot }} />
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {facts.map((f) => <span key={f} className="rounded-[5px] bg-surface px-2 py-0.5 text-[16px] text-muted">{f}</span>)}
                  <span className="ml-auto flex gap-2">
                    <button onClick={() => { const url = handoffLink(taskLink?.() ?? `?task=${task.id}`, s.id); navigator.clipboard?.writeText(url).then(() => pushToast("Handoff link copied"), () => pushToast(`Share this link: ${url}`)); }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-surface px-3 text-[16px] font-medium shadow-soft hover:bg-background"><I.link /> Copy link</button>
                    <button onClick={() => setOpenHandoff(s.id)}
                      className="inline-flex h-9 items-center rounded-lg px-3 text-[16px] font-semibold text-white shadow-soft hover:opacity-90" style={{ background: STATUS_META.delegated.dot }}>
                      {total || h.goal.trim() ? "Open handoff" : "Write the handoff"}
                    </button>
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      ))}
    </div>
  );
  const subtasksBlock = !showChecklist ? null : (
    <div className="rounded-xl border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[18px] font-semibold">Checklist {plainSubs.length > 0 && <span className="text-[16px] font-normal text-muted">· {doneSubs}/{plainSubs.length} · {Math.round((doneSubs / task.subtasks.length) * 100)}%</span>}</span>
        {templates.length > 0 && (
          <div className="relative">
            <button onClick={() => setTemplateOpen((o) => !o)} className="inline-flex items-center gap-1 text-[16px] font-medium text-accent"><I.clipboard /> From template</button>
            {templateOpen && (<>
              <div className="fixed inset-0 z-30" onClick={() => setTemplateOpen(false)} />
              <div className="absolute right-0 z-40 mt-1 w-56 rounded-lg border bg-surface p-1 shadow-lg">
                {templates.map((t) => (
                  <button key={t.id} onClick={() => { onApplyTemplate(t.id); setTemplateOpen(false); }} className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-background">
                    <span className="truncate text-[16px] font-medium">{t.name}</span>
                    <span className="text-[16px] text-muted">{t.checklistItems.length} item{t.checklistItems.length === 1 ? "" : "s"}</span>
                  </button>
                ))}
              </div>
            </>)}
          </div>
        )}
      </div>
      {plainSubs.length > 0 && (<div className="mb-2 h-2 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneSubs / task.subtasks.length) * 100}%` }} /></div>)}
      <div className="space-y-1">{plainSubs.map((s) => (
        <div key={s.id}>
          <div className="group/sub flex items-start gap-2 rounded-md px-1 py-1 hover:bg-background"><button onClick={() => onToggleSub(s.id)} className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${s.done ? "border-accent bg-accent text-white" : "border-border"}`}>{s.done && <I.check />}</button><textarea value={s.title} onChange={(e) => onRenameSub(s.id, e.target.value)} rows={1} className={`-mx-1 mt-0.5 flex-1 resize-none rounded bg-transparent px-1 text-[16px] leading-snug outline-none [field-sizing:content] transition focus:bg-background ${s.done ? "text-muted line-through" : ""}`} /><InlineDue value={s.due ?? null} overdue={isOverdue(s.due ?? null) && !s.done} onChange={(d) => onPatchSub(s.id, { due: d })} textClass="text-[16px]" emptyLabel="Set date" /><InlineAssignee value={s.assigneeId ?? null} onChange={(a) => onPatchSub(s.id, { assigneeId: a })} size={20} /><button onClick={() => onDeleteSub(s.id)} title="Delete checklist item" className="mt-0.5 shrink-0 text-muted opacity-0 hover:text-red-500 group-hover/sub:opacity-100"><I.trash /></button></div>
          {s.assigneeId && (
            <div className="mb-1 ml-7 flex items-center gap-1.5">
              <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[16px] font-medium uppercase tracking-wide text-accent">Delegated</span>
              <input value={s.note ?? ""} onChange={(e) => onPatchSub(s.id, { note: e.target.value })} placeholder="What do you need done? (instructions)" className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[16px] outline-none transition placeholder:text-muted hover:bg-background focus:border-accent focus:bg-background" />
            </div>
          )}
        </div>
      ))}</div>
      <div className="mt-1.5"><input value={subDraft} onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAddSub(subDraft); setSubDraft(""); } }} placeholder="+ Add a checklist item…" className="w-full rounded-md border border-transparent px-2 py-1 text-[16px] outline-none transition placeholder:text-muted hover:bg-background focus:border-accent focus:bg-background" /></div>
    </div>
  );
  const sortedAttachments = useMemo(() => [...task.attachments].sort((a, b) => {
    if (attSort === "name") return a.name.localeCompare(b.name);
    if (attSort === "type") return ATT_KIND_ORDER[a.kind] - ATT_KIND_ORDER[b.kind];
    return 0; // "added" — keep stored order (oldest first, matches how they were attached)
  }), [task.attachments, attSort]);
  const attachmentsBlock = !showAttachments ? null : (
    <div className={`mt-4 rounded-xl bg-surface p-4 ${!hasMessaging && task.comments.length === 0 ? "border" : "shadow-soft"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[16px] font-semibold">Links and files {task.attachments.length > 0 && <span className="font-normal text-muted">· {task.attachments.length}</span>}</span>
        <span className="flex items-center gap-3">
          {/* Sorting two things is not a job. It earns its place at five. */}
          {task.attachments.length >= 5 && (
            <select value={attSort} onChange={(e) => setAttSort(e.target.value as typeof attSort)} className="rounded-md border bg-background px-1.5 py-1 text-[16px] outline-none" title="Sort attachments">
              <option value="added">Sort: Added</option>
              <option value="name">Sort: Name</option>
              <option value="type">Sort: Type</option>
            </select>
          )}
          <button onClick={() => { setLinkOpen((o) => !o); }} className="inline-flex items-center gap-1 text-[16px] font-medium text-accent"><I.link /> Link</button>
          <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 text-[16px] font-medium text-accent"><I.plus /> Attach</button>
        </span>
      </div>
      {linkOpen && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
          <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLink(); }} placeholder="Paste a link (Drive, website, doc…)" className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent" />
          <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLink(); }} placeholder="Label (optional)" className="w-40 rounded-md border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent" />
          <button onClick={addLink} disabled={!linkUrl.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Add</button>
        </div>
      )}
      {uploadProgress && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[16px] text-muted">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Uploading {uploadProgress.done + 1} of {uploadProgress.total}…
        </div>
      )}
      <div
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setAttFileDragOver(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setAttFileDragOver(false); }}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setAttFileDragOver(false); onAddFiles(e.dataTransfer.files); } }}
        className={`grid grid-cols-3 gap-2 rounded-lg transition ${attFileDragOver ? "outline-2 outline-dashed outline-accent bg-accent-soft/30" : ""}`}
      >
        {task.attachments.length === 0 && !uploadProgress && (<div className="col-span-full rounded-lg border border-dashed px-3 py-2 text-[16px] text-muted">Drop, paste, or click Attach · max 25MB each</div>)}
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
            <div className="truncate text-center text-[16px]" title={a.name}>{a.name}</div>
            <div className="text-center text-[16px] text-muted">{a.size}</div>
          </div>
        ))}
      </div>
      {/* Non-image attachments (docs, sheets, links) used to render as
          empty-looking AttachmentTile boxes with no real thumbnail to show
          — a compact link chip carries the same info (name, type, size)
          without pretending there's a preview. */}
      {/* One per row, not wrapped chips: a 90 character URL in an inline-flex
          chip either burst the card or wrapped into an unreadable block, and
          a full-width row can truncate cleanly with room for the buttons. */}
      {sortedAttachments.some((a) => a.kind !== "image") && (
        <div className="mt-2 flex flex-col gap-1.5">
          {sortedAttachments.filter((a) => a.kind !== "image").map((a) => {
            const isLink = !!a.url;
            const editing = renamingAttId === a.id;
            return (
              <span key={a.id} className="group flex min-w-0 items-center gap-1.5 rounded-[5px] border bg-background py-1 pl-2.5 pr-1 text-[16px]">
                {editing ? (
                  <input autoFocus defaultValue={a.name}
                    onBlur={(e) => { renameAttachment(a.id, e.target.value); setRenamingAttId(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { renameAttachment(a.id, e.currentTarget.value); setRenamingAttId(null); }
                      if (e.key === "Escape") setRenamingAttId(null);
                    }}
                    className="min-w-0 flex-1 rounded border bg-surface px-1.5 py-0.5 text-[16px] outline-none focus:border-accent" />
                ) : (
                <a href={isLink ? a.url! : undefined} onClick={!isLink && a.path ? () => onDownloadFile(a.path!) : undefined} target={isLink ? "_blank" : undefined} rel={isLink ? "noreferrer" : undefined}
                  title={isLink ? a.url! : a.name}
                  className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-accent hover:underline">
                  {isLink ? <LinkFavicon url={a.url!} /> : <I.link className="h-3.5 w-3.5 shrink-0" />} <span className="min-w-0 truncate">{a.name}</span>{a.size && <span className="shrink-0 font-normal text-muted"> · {a.size}</span>}
                </a>
                )}
                {!editing && isLink && (
                  <button onClick={() => { navigator.clipboard?.writeText(a.url!).then(() => pushToast("🔗 Link copied"), () => pushToast("⚠️ Couldn't copy link")); }}
                    title="Copy this link" className="shrink-0 rounded-full p-1 text-muted opacity-0 hover:bg-surface hover:text-foreground group-hover:opacity-100"><I.copy className="h-3 w-3" /></button>
                )}
                {!editing && (
                  <button onClick={() => setRenamingAttId(a.id)} title="Rename" className="shrink-0 rounded-full p-1 text-muted opacity-0 hover:bg-surface hover:text-foreground group-hover:opacity-100"><I.pencil className="h-3 w-3" /></button>
                )}
                {a.path && <button onClick={() => onDownloadFileAs(a.path!, a.name)} title="Download" className="shrink-0 rounded-full p-1 text-muted opacity-0 hover:bg-surface hover:text-foreground group-hover:opacity-100"><I.download className="h-3 w-3" /></button>}
                <button onClick={() => onRemoveFile(a)} title="Remove" className="shrink-0 rounded-full p-1 text-muted opacity-0 hover:bg-surface hover:text-danger group-hover:opacity-100"><I.trash className="h-3 w-3" /></button>
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
                <button onClick={() => onDownloadFileAs(previewAtt.path!, previewAtt.name)} className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-[16px] font-medium text-white hover:bg-white/20"><I.download />Download</button>
              )}
              <button onClick={() => setPreviewAtt(null)} className="rounded-md bg-white/10 px-3 py-1.5 text-[16px] font-medium text-white hover:bg-white/20">Close</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
  // The draft email line: shown whenever a draft exists, from Claude, the drafter
  // or the chip below. Sending goes through the same path as the composer.
  const draftEmailBlock = (
    <DraftEmail key={`email-${task.id}`} task={task} onPatch={onPatch} toEmail={messageDest?.email || null} messages={messages}
      onSend={hasMessaging ? (email) => {
        onSendTaskMessage!("email", email.subject, email.body, email.attachments.length ? email.attachments : undefined, email.cc, email.bcc, email.replyTo);
        setPendingNextStep({ kind: "email", body: htmlToText(email.body).trim() });
      } : undefined}
      onSchedule={hasMessaging && onScheduleTaskMessage ? (email, whenIso) =>
        onScheduleTaskMessage("email", email.subject, email.body, whenIso, email.attachments.length ? email.attachments : undefined, email.cc, email.bcc, email.replyTo) : undefined}
      onUpload={onUploadMessageImage} ccContacts={ccContacts}
      openNonce={emailOpenNonce} pushToast={pushToast}
      onAiDraft={onDraftMessage ? (instruction, context) => onDraftMessage("email", instruction || undefined, context) : undefined}
      />
  );
  // The client document was sent for review, or its Email client button was
  // clicked: a draft email to the client with a short intro and the review link,
  // ready to send. It no longer rewrites itself with AI as it opens (Derek,
  // 2026-09-12: "not sure that needs to happen"); Write with AI uses what changed
  // when asked. It replaces any draft already here. False when there is nobody to email.
  // The wording per kind lives in src/lib/reviewEmail.ts, shared with Claude over MCP.
  const startReviewEmail = (review: ReviewEmailInput) => {
    if (!hasMessaging) return false;
    const now = new Date().toISOString();
    onPatch({ draftEmail: { ...buildReviewEmail({ ...review, greetName: messageDest?.name }), createdAt: now, updatedAt: now } });
    setEmailOpenNonce((n) => n + 1);
    return true;
  };
  // Image and web page reviews (Derek, 2026-09-12): the same line and window as the
  // client document. Each has its own key, apart from the lines beside it; below
  // startReviewEmail so they never read it before it exists.
  const reviewBlocks = !canHaveDocument ? null : REVIEW_LINES.map(({ kind }) => (
    <TaskDocument key={`${kind}-${task.id}`} kind={kind} task={task} onPatch={onPatch} pushToast={pushToast} canAdmin={!!canAdmin} meId={meId}
      onEmailClient={startReviewEmail}
      startNonce={reviewStartNonce[kind]}
      onPresence={(exists) => setReviewPresence((p) => {
        const kinds = p.taskId === task.id ? p.kinds : [];
        if (p.taskId === task.id && kinds.includes(kind) === exists) return p;
        return { taskId: task.id, kinds: exists ? [...kinds, kind] : kinds.filter((k) => k !== kind) };
      })} />
  ));
  // Everything a task can gain, in one menu beside Deliverables. It was a row
  // of up to seven dashed buttons, wrapping two by two in the rail.
  const addMenu = (
    <ActionMenu label={<span className="inline-flex items-center gap-1.5"><I.plus /> Add</span>} title="Add to this task" items={[
      !showDescription && { label: "Description", onClick: () => openSection("description") },
      canHaveDocument && !showDocument && { label: "Client document", onClick: () => setDocStartNonce((n) => n + 1) },
      ...(canHaveDocument ? REVIEW_LINES.filter((l) => !hasReview(l.kind)).map((l) => ({ label: l.label, onClick: () => setReviewStartNonce((s) => ({ ...s, [l.kind]: s[l.kind] + 1 })) })) : []),
      hasMessaging && !task.draftEmail && { label: "Draft email", onClick: () => startDraftEmail() },
      !showChecklist && { label: "Checklist", onClick: () => openSection("checklist") },
      { label: "Link", onClick: () => { openSection("attachments"); setLinkOpen(true); } },
      { label: "File", onClick: () => fileRef.current?.click() },
    ]} />
  );
  const hasDeliverables = showDocument || REVIEW_LINES.some((l) => hasReview(l.kind)) || !!task.draftEmail;
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

  const section = (title: string, children: React.ReactNode, right?: React.ReactNode) => (
    <section className="mt-10" id={title === "Deliverables" ? "task-deliverables" : undefined}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[21px] font-bold tracking-[-0.01em]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );

  // The task in reading order: what it is, what happens next, what it says,
  // what has been made for it, then everything said and done about it
  // (2026-09-14 redesign). The description used to sit in the side rail cut
  // off after a few lines, though it is what explains the task.
  const mainColumn = (
    <>
      {titleRow}
      {subMeta}
      {chipRow}
      {delegationRow}
      {nextStepCard}
      {clientResponseBlock}
      {showDescription && section("Description", descriptionBlock,
        !descEditing && htmlToText(task.description).trim()
          ? <button onClick={() => setDescEditing(true)} className="rounded-lg px-3 py-1.5 text-[16px] font-medium text-accent hover:bg-accent-soft">Edit</button>
          : undefined)}
      {section("Deliverables", (
        <>
          {documentBlock}
          {reviewBlocks}
          {draftEmailBlock}
          {/* Links and files live in the client rail, under the contact card
              (Derek, 2026-09-14). A task with no rail keeps them here. */}
          {isLightTask && attachmentsBlock}
          {!hasDeliverables && !(isLightTask && showAttachments) && (
            <p className="rounded-xl border border-dashed px-4 py-3 text-[16px] text-muted">Client reviews and draft emails show here. Drop a file anywhere on the task to attach it.</p>
          )}
        </>
      ), addMenu)}
      {subtasksBlock && <div className="mt-10">{subtasksBlock}</div>}
      <section className="mt-10">
        {/* The composer the floating dock opens for a text, chat or note. */}
        {composerFooter}
        <div className="mt-6">{feedArea}</div>
      </section>
    </>
  );

  // The client's SaaS URL, living in GoHighLevel as the contact's "SaaS"
  // custom field. Editable here because otherwise adding one means leaving
  // for GHL and coming back. Shown open in the rail, beside the contact's own
  // GoHighLevel link: there is room, and both get used (Derek, 2026-09-14).
  const saasRow = (
    <div className="flex items-center gap-2 text-[16px]">
      <span className="w-28 shrink-0 text-muted">SaaS account</span>
      {saasEditing ? (
        <input autoFocus defaultValue={saasUrl} disabled={saasSaving}
          onBlur={(e) => saveSaas(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); saveSaas(e.currentTarget.value); }
            if (e.key === "Escape") { e.stopPropagation(); setSaasEditing(false); }
          }}
          placeholder="app.example.com"
          className="min-w-0 flex-1 rounded-md border bg-surface px-2 py-1 text-[16px] outline-none focus:border-accent disabled:opacity-60" />
      ) : saasUrl ? (
        <>
          <a href={saasUrl} target="_blank" rel="noopener noreferrer" title={saasUrl}
            className="min-w-0 flex-1 truncate font-medium text-accent hover:underline">{prettyLinkName(saasUrl)}</a>
          <button onClick={() => { navigator.clipboard?.writeText(saasUrl).then(() => pushToast("🔗 SaaS link copied"), () => {}); }}
            title="Copy the SaaS link" className="shrink-0 rounded p-1 text-muted hover:text-foreground"><I.copy className="h-4 w-4" /></button>
          {saasEditable && <button onClick={() => setSaasEditing(true)} title="Edit" className="shrink-0 rounded p-1 text-muted hover:text-foreground"><I.pencil className="h-4 w-4" /></button>}
        </>
      ) : saasEditable ? (
        <button onClick={() => setSaasEditing(true)} className="text-accent underline underline-offset-[3px]">Add one</button>
      ) : (
        <span className="text-muted" title="This sub-account has no SaaS field in GoHighLevel yet.">not available here</span>
      )}
      {saasSaving && <span className="shrink-0 text-muted">saving…</span>}
    </div>
  );

  // Client context only: who this is for, the three ways to reach them, and
  // where the task lives (2026-09-14 redesign).
  const railButton = "flex flex-col items-center gap-1 rounded-xl bg-surface px-1 py-3 text-[16px] font-medium shadow-soft transition hover:shadow-soft-md disabled:cursor-not-allowed disabled:opacity-40";
  const clientRail = (
    <aside aria-label="Client" className="w-full border-t bg-surface px-5 py-6 min-[1100px]:sticky min-[1100px]:top-0 min-[1100px]:h-screen min-[1100px]:max-h-screen min-[1100px]:w-[340px] min-[1100px]:flex-none min-[1100px]:self-start min-[1100px]:overflow-y-auto min-[1100px]:border-l min-[1100px]:border-t-0">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[16px] font-bold text-white" style={{ background: client.color }}>{initialsOf(client.name)}</span>
        <div className="min-w-0">
          <div className="truncate text-[18px] font-semibold">{client.name}</div>
          <div className="flex items-center gap-1.5 text-[16px] text-muted">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: clientStatusMeta(client.status).dot }} />{clientStatusMeta(client.status).label}
          </div>
        </div>
      </div>
      {hasMessaging && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {messageDest?.phone && mayContactClient ? (
            <a href={`tel:${messageDest.phone}`} className={railButton}><I.phone className="text-accent" />Call</a>
          ) : (
            <button disabled title="No phone on file" className={railButton}><I.phone />Call</button>
          )}
          <button onClick={() => startDraftEmail()} disabled={!messageDest?.email} title={messageDest?.email ? `Email ${messageDest.email}` : "No email on file"} className={railButton}><I.mail className="text-accent" />Email</button>
          <button onClick={onCopyClientLink} disabled={!onCopyClientLink} title="Copy this client's link" className={railButton}><I.link className="text-accent" />Client link</button>
        </div>
      )}
      {(ghlContactUrl || linkedContactInfo?.ghlContactId) && (
        <div className="mt-5 space-y-2.5">
          {ghlContactUrl && (
            <div className="flex items-center gap-2 text-[16px]">
              <span className="w-28 shrink-0 text-muted">GHL contact</span>
              <a href={ghlContactUrl} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel"
                className="inline-flex min-w-0 items-center gap-1.5 truncate font-medium text-accent hover:underline"><I.bolt /> Open contact</a>
            </div>
          )}
          {linkedContactInfo?.ghlContactId && saasRow}
        </div>
      )}
      {attachmentsBlock}
      <div className="mt-6 rounded-xl bg-surface px-3 py-3 shadow-soft">{detailsBlock}</div>
    </aside>
  );

  const iconButton = "rounded-lg p-2 text-muted transition hover:bg-background hover:text-foreground disabled:opacity-30";
  return (
    <>
      <div className={`fixed inset-0 bg-black/20 ${full ? "z-40" : "z-10"}`} onClick={onClose} />
      {/* Docked mode spans everything from the sidebar's right edge to the
          window's (Derek, 2026-08-26). --drawer-left is set by Cockpit and
          follows the sidebar; below md the sidebar is an overlay, so the
          drawer is full width. */}
      {/* --dock-right keeps the floating dock over the task column, clear of
          the client rail. Zero below 1100px, where the rail stacks under. */}
      <aside onPaste={handlePaste} {...drawerDropProps}
        className={`[--dock-right:0px] ${isLightTask ? "" : "min-[1100px]:[--dock-right:340px]"} ${full ? "fixed inset-0 z-50 flex flex-col bg-surface" : "fixed inset-y-0 right-0 z-20 flex w-full flex-col border-l bg-surface shadow-xl md:left-[var(--drawer-left,16rem)] md:w-auto"}`}>
        {hiddenFileInput}
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5 text-[16px] text-muted">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: client.color }} />
            <button onClick={onOpenClientList} title={`Back to ${client.name}'s list`} className="-mx-1 truncate rounded px-1 font-medium text-foreground hover:bg-background hover:underline">{client.name}</button>
            <span className="shrink-0">/</span>
            <button onClick={onRenameProject} title="Rename list" className="-mx-1 truncate rounded px-1 hover:bg-background hover:text-foreground hover:underline">{project.name}</button>
          </span>
          <div className="ml-auto flex items-center gap-1">
            {navTotal > 1 && (
              <div className="mr-1 flex items-center">
                <button onClick={onPrev} disabled={navIndex <= 0} title="Previous task (k)" aria-label="Previous task" className={iconButton}><I.chevron className="rotate-90" /></button>
                <span className="min-w-[64px] text-center tabular-nums">{navIndex + 1} of {navTotal}</span>
                <button onClick={onNext} disabled={navIndex < 0 || navIndex >= navTotal - 1} title="Next task (j)" aria-label="Next task" className={iconButton}><I.chevron className="-rotate-90" /></button>
              </div>
            )}
            {ghlContactUrl && mayContactClient && (
              <a href={ghlContactUrl} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel"
                className="mr-1 inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 font-medium text-foreground transition hover:bg-background">
                <I.bolt /> <span className="hidden sm:inline">Open in GHL</span>
              </a>
            )}
            {/* Copy for Claude is used on most tasks, so it sits out here, one click
                (Derek, 2026-09-16: "put the little star icon on the outside"). */}
            <button onClick={copyForClaude} title="Copy for Claude" aria-label="Copy for Claude"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border text-[18px] leading-none text-foreground transition hover:bg-background">
              <span aria-hidden>✳</span>
            </button>
            {/* The rarer actions, one click in. Five bare icons sat here with
                Delete right beside Close. */}
            <div className="relative">
              <ActionMenu label={<I.dots />} title="More actions" triggerClassName={iconButton} items={[
                { label: "Copy link to task", onClick: onCopyLink },
                { label: "Duplicate here", onClick: () => onDuplicate() },
                { label: "Duplicate into another list", onClick: () => { setDupClient(task.clientId); setDupOpen(true); } },
                task.priority === "conversation" && { label: "Merge into a task", onClick: onOpenMerge },
                { label: full ? "Back to the side panel" : "Open full page", onClick: onToggleFull },
                { label: "Delete task", onClick: onDelete, danger: true },
              ]} />
              {dupOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setDupOpen(false)} />
                  <div className="absolute right-0 top-full z-40 mt-1 w-80 rounded-lg border bg-surface p-2 text-left text-foreground shadow-lg">
                    <div className="px-2 pb-1.5 text-[16px] font-semibold">Duplicate into</div>
                    <select value={dupClient} onChange={(e) => setDupClient(e.target.value)}
                      className="mb-1 w-full rounded-md border bg-background px-2 py-1.5 text-[16px] outline-none focus:border-accent">
                      {allClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <div className="max-h-52 overflow-y-auto">
                      {projectsFor(dupClient).length === 0 && <div className="px-2 py-2 text-[16px] text-muted">No lists in this client yet.</div>}
                      {projectsFor(dupClient).map((p) => (
                        <button key={p.id} onClick={() => { setDupOpen(false); onDuplicate({ clientId: dupClient, projectId: p.id }); }}
                          disabled={p.id === task.projectId && dupClient === task.clientId}
                          className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[16px] hover:bg-background disabled:opacity-40">
                          {p.name}{p.id === task.projectId && dupClient === task.clientId ? " · current" : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <button onClick={onClose} title="Close" aria-label="Close" className={iconButton}><I.close /></button>
          </div>
        </div>

        {/* One scroll container. The client rail is sticky inside it at
            1100px and up, and stacks under the task below that. A task with
            no contact and no comments has no client context worth a rail, so
            where it lives goes at the end of the page instead. */}
        <div className="flex flex-1 flex-col overflow-y-auto bg-surface min-[1100px]:flex-row min-[1100px]:items-start">
          {/* All white, no boxed in sheet (Derek, 2026-09-16: "I don't like it
              boxed in so just make it all white"). */}
          <div className="min-w-0 flex-1 px-2 pb-32 pt-3 sm:px-5 sm:pt-5">
            <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-10 sm:py-9">
              {mainColumn}
              {isLightTask && section("Client and list", detailsBlock)}
            </div>
          </div>
          {!isLightTask && clientRail}
        </div>
        {/* Shown over the whole drawer while a file is being dragged in, so
            the target is obvious and it is clear the drop will land here
            rather than navigating the browser away to the file. */}
        {fileOverDrawer && (
          <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/70 backdrop-blur-[1px]">
            <span className="rounded-lg bg-surface px-4 py-2 text-[16px] font-semibold shadow-lg">Drop to attach</span>
          </div>
        )}
        {/* Floating at the bottom of the drawer so you can log from anywhere
            in the scroll (Derek, 2026-09-14: inline "it will get lost"). */}
        {(() => {
          const hs = openHandoff ? task.subtasks.find((x) => x.id === openHandoff && !!x.assigneeId) : null;
          return hs ? (
            <HandoffPage task={task} sub={hs} meId={meId} link={handoffLink(taskLink?.() ?? `?task=${task.id}`, hs.id)}
              onPatchSub={onPatchSub} onToggleSub={onToggleSub} onClose={() => setOpenHandoff(null)}
              onOpenFile={(att) => { if (att.url) window.open(att.url, "_blank", "noopener,noreferrer"); else void openPreview(att); }}
              onSendDm={onSendDm} pushToast={pushToast}
              onOpenDeliverables={() => { setOpenHandoff(null); requestAnimationFrame(() => document.getElementById("task-deliverables")?.scrollIntoView({ behavior: "smooth", block: "start" })); }} />
          ) : null;
        })()}
        <ActionDock
          task={task} client={client} contact={linkedContactInfo ?? null} actions={actions} messages={messages ?? undefined}
          me={userById(meId) ?? null} users={users}
          onLog={logAction} onPatch={onPatch} onAddComment={onAddComment}
          onOpenCompose={openCompose}
          // Same gate the composer already uses: onSendTaskMessage is only
          // passed when this person may message this client.
          canMessageClient={mayContactClient}
          onSendDm={onSendDm} onDelegate={onDelegate} clientLinks={clientLinks} taskLink={taskLink}
          askNextStepFor={pendingNextStep}
          onSendMessage={onSendTaskMessage ? (channel, body, replyToId) => {
            onSendTaskMessage(channel, "", body, undefined, undefined, undefined, replyToId);
            setPendingNextStep({ kind: channel, body });
          } : undefined}
          reachable={{ chat: hasMessaging, sms: !!messageDest?.phone, email: !!messageDest?.email }}
          replyTarget={replyTarget}
          onAskNextStepHandled={() => setPendingNextStep(null)}
          pushToast={pushToast}
        />
      </aside>
    </>
  );
}
