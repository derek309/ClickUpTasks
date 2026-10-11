"use client";

// The task detail window (sidebar or full-page "document" view).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  users, labels, userById, labelById, timeAgo, htmlToText, plainTextToHtml, PERSONAL_CLIENT_ID,
  TaskAction, TaskActionKind, prettyLinkName, effectiveStatus, openNextStep, followUpAfterStepDone, initialsOf,
  STATUS_META, pickableStatuses, stepDateLabel, addBusinessDaysIso, TODAY, dateQuickPicks, 
  parseStepWatch, stepWatchState, suggestNextSteps, handoffOf, handoffProgress, handoffLink, type DelegateSpec, type ClientLink, type ClientNote, PRIORITY_META, manualPriorityOptions, parseDaysOfMonth, WEEKDAY_LABEL, daysUntilDue, formatDue, dueCountdown,
  assignableUsers, carryForward, addClientReviewStep, addApprovalStep, addEmailSentRecord, addTellClientStep, addCheckInStep, changesTelling, addedReason, changesStepFor, stepWindow, inWindow, todoProgress, planFromSteps, needMet, templatesFor, holdOnStep, releaseFromSteps, stepHolding, attachmentKey, type DeliverableKey, STEP_STAGES, stepStage, planSteps, currentStep, stepAfter, stepProgress, statusForStep, addChangesRound, isHandoffStep,
  type Task, type Client, type Project, type Contact, type Attachment, type Priority, type RecurrenceUnit, type Subtask, type TaskTemplate, type MessageChannel, type Message, type TaskStatus,
} from "@/lib/data";
import { I, Avatar, Row, CollapsibleText, SearchableSelect, newId, LinkFavicon } from "./ui";
import { authedFetch } from "@/lib/supabase";
import { ActionDock } from "./ActionDock";
import { ActionMenu } from "./ActionMenu";
import { fetchTaskDocumentComments, fetchTaskActions, insertTaskAction, setNextStepDoneDb, deleteTaskActionDb, editTaskActionDb, patchNextStepDb, fetchTaskDocument, saveContactSaasUrl, type TaskDocumentKind } from "@/lib/db";
import { normalizeSaasUrl } from "@/lib/saasUrl";
import { AttachmentTile } from "./AttachmentTile";
import { ImageLightbox } from "./TaskWorkItem";
import { ClientGhlKey } from "./ClientGhlKey";
import { SizePicker } from "./SizePicker";
import { InlineAssignee, InlineDate, InlineDue } from "./GroupedList";
import { RichTextEditor } from "./RichTextEditor";
import { useTaskMessaging } from "./TaskMessaging";
import { useDebouncedCommit } from "./useDebouncedCommit";
import { useEscapeToClose } from "./useEscapeToClose";
import { TaskDocument, docApi, type ReviewReminders } from "./TaskDocument";
import { HandoffPage } from "./HandoffPage";
import { StepPage } from "./StepPage";

// A handoff link (?task=…&handoff=…) names the delegation to open. Read once
// when the app loads, because the app rewrites the address as you move around,
// and handed to the first drawer that holds that delegation.
let handoffFromUrl: string | null = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("handoff");
import { DraftEmail } from "./DraftEmail";
import { TaskBrief } from "./TaskBrief";
import { buildReviewEmail, greetingHtml, type ReviewEmailInput } from "@/lib/reviewEmail";
import { type FileKind } from "@/lib/reviewKinds";
import { QuickLinksBar } from "./ClientLinks";
import { reviewFollowUpDays } from "@/lib/reviewReminders";
import { BookAppointment } from "./BookAppointment";

// The review lines a task can add beside its client document, in order.
const REVIEW_LINES: { kind: FileKind; label: string }[] = [
  { kind: "image", label: "Image review" },
  { kind: "page", label: "HTML review" },
  { kind: "video", label: "Video review" },
];

const ATT_KIND_ORDER: Record<Attachment["kind"], number> = { image: 0, pdf: 1, doc: 2, sheet: 3, link: 4 };

/** Contacts whose SaaS link was checked against GoHighLevel this session,
 *  and whether their sub-account has the field to edit. */
const saasChecked = new Map<string, boolean>();

export function TaskDrawer({ task, clientById, projectById, contactById, full, onToggleFull, navIndex, navTotal, onPrev, onNext, onClose, onPatch, onDelete, onAddComment, onAddFiles, onDownloadFile, onDownloadFileAs, onDownloadAll, zippingIds, onRemoveFile, uploadProgress, allClients, onMoveClient, clientProjects, onSetProject, onNewProject, onRenameProject, onToggleSub, onAddSub, onRenameSub, onDeleteSub, onPatchSub, onToggleLabel, onCopyLink, onDuplicate, projectsFor, onOpenMerge, onOpenClientList, templates, onApplyTemplate, onUploadCommentImage, onCopyAttachmentLink, onGetSignedUrl, messages, onMarkChannelRead, linkedContactInfo, onSaasSaved, ccContacts, onUploadMessageImage, onSendTaskMessage, onScheduleTaskMessage, sendingMessage, onDraftMessage, draftingMessage, canAdmin, onDeleteMessage, onEditMessage, onCopyClientLink, onDraftDescription, draftingDescription, pushToast, meId, onSendDm, onDelegate, clientLinks, clientMeetings, taskLink, onDeleteComment, slideOver, slideBackLabel, openEmail, onSaveTemplate }: {
  task: Task;
  /** Opened from the Inbox: a panel sliding in from the right over the
   *  conversation, not the docked view that covers the whole page. */
  slideOver?: boolean;
  /** Slid over the Inbox: what "← back" returns to (the conversation's subject). */
  slideBackLabel?: string | null;
  /** Opened from a draft on the client's page: its email window opens with it. */
  openEmail?: boolean;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => Contact | null;
  full: boolean; onToggleFull: () => void; navIndex: number; navTotal: number; onPrev: () => void; onNext: () => void;
  onClose: () => void; onPatch: (patch: Partial<Task>) => void; onDelete: () => void; onAddComment: (body: string, attachments?: Attachment[]) => void; onAddFiles: (files: FileList) => void; onDownloadFile: (path: string) => void; onDownloadFileAs: (path: string, filename: string) => void; onDownloadAll: (items: Attachment[], zipName: string, batchId: string) => void; zippingIds: Set<string>; onRemoveFile: (att: Attachment) => void; uploadProgress: { done: number; total: number } | null; allClients: Client[]; onMoveClient: (clientId: string) => void; clientProjects: Project[]; onSetProject: (pid: string) => void; onNewProject: () => void; onRenameProject: () => void; onToggleSub: (sid: string) => void; onAddSub: (title: string) => void; onRenameSub: (sid: string, title: string) => void; onDeleteSub: (sid: string) => void; onPatchSub: (sid: string, patch: Partial<Subtask>) => void; onToggleLabel: (lid: string) => void; onCopyLink: () => void; onDuplicate: (target?: { clientId: string; projectId: string }) => void; projectsFor: (clientId: string) => Project[]; onOpenMerge: () => void; onOpenClientList: () => void;
  templates: TaskTemplate[]; onApplyTemplate: (templateId: string) => void;
  /** Saves this task's steps as a plan (admins: templates are admin-written). */
  onSaveTemplate?: (spec: { name: string; checklistItems: TaskTemplate["checklistItems"]; clientId?: string | null }) => void;
  onUploadCommentImage: (file: File) => Promise<Attachment | null>;
  onCopyAttachmentLink: (path: string) => void;
  onGetSignedUrl: (path: string) => Promise<string | null>;
  messages?: Message[] | null; // this task's own email/SMS (composed from here, or an inbound reply matched to this Conversation task), merged into the Activity feed
  // Clears the unread dot on a Chat/Email/SMS tab — called the moment that
  // tab is opened. Optional so a caller that doesn't track read state (none
  // today) just never shows the dot.
  onMarkChannelRead?: (channel: MessageChannel) => void;
  linkedContactInfo?: Contact | null; // authoritative send target (matches what onSendTaskMessage actually resolves) — shown as "Sending to" in the SMS/Email composer
  /** The SaaS link is the contact's, not the task's, so a save here has to
   *  reach the app's own copy of the contact or every other task keeps showing
   *  "Add one" until a reload (Derek, 2026-09-29: "we only want to enter it
   *  once"). */
  onSaasSaved?: (contactId: string, url: string) => void;
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
  /** Returns the new handoff's id, so its page can be opened to finish the brief. */
  onDelegate?: (spec: DelegateSpec) => string | null;
  clientLinks?: ClientLink[];
  clientMeetings?: ClientNote[];
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
  /** The client's first name, as the steps and their emails say it. */
  const firstName = client.name.split(" ")[0];
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
  // A reply goes to whoever wrote the email it answers, not the client's main
  // contact (Russell's email on Matthew Whitman's task, Justin, 2026-10-07).
  // Same rule as the server's replyRecipientFor.
  const replyPeerOf = (id?: string | null): { email: string; name: string | null } | null => {
    const m = id ? (messages ?? []).find((x) => x.id === id) : null;
    const e = (m?.peerAddress ?? "").trim().toLowerCase();
    return m && m.channel === "email" && m.clientId === task.clientId && e.includes("@") && !e.endsWith("@clickuplocal.com") ? { email: e, name: m.peerName ?? null } : null;
  };
  const ghlSub = linkedContact ? clientById(linkedContact.clientId) : null;
  const ghlContactUrl = linkedContact && ghlSub?.ghlLocationId ? `https://app.gohighlevel.com/v2/location/${ghlSub.ghlLocationId}/contacts/detail/${linkedContact.ghlContactId}` : null;
  const [subDraft, setSubDraft] = useState("");
  const [dragSub, setDragSub] = useState<string | null>(null);
  const [dropSub, setDropSub] = useState<string | null>(null);
  // Team-chat draft — lives here (not lifted to Cockpit.tsx) so typing it
  // only re-renders this drawer, not the whole app; see useDebouncedCommit's
  // comment above for the sibling title/description fix to the same root
  // cause. Reset per task (this drawer isn't
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
  // The step a link being added goes on, when its + menu asked for it.
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
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
    // Asked for from a step's + menu: it goes on that step too (phase 4).
    if (linkTarget) { onPatch({ subtasks: holdOnStep(taskRef.current.subtasks, linkTarget, attachmentKey(id)) }); setLinkTarget(null); }
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
  // The client reminders on each review that is with the client, as the
  // reviews themselves report them (TaskDocument onReminders). Keyed by task,
  // like the other state here, because the drawer is not remounted per task.
  const [reminderState, setReminderState] = useState<{ taskId: string; byKind: Partial<Record<TaskDocumentKind, ReviewReminders>> }>({ taskId: "", byKind: {} });
  const reportReminders = (kind: TaskDocumentKind) => (r: ReviewReminders | null) =>
    setReminderState((p) => {
      const byKind = { ...(p.taskId === task.id ? p.byKind : {}) };
      if (r) byKind[kind] = r; else delete byKind[kind];
      return { taskId: task.id, byKind };
    });
  const reminders = reminderState.taskId === task.id ? Object.values(reminderState.byKind).filter((r): r is ReviewReminders => !!r) : [];
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
  const [saasEditable, setSaasEditable] = useState(() => saasChecked.get(linkedContactInfo?.id ?? "") ?? true);
  useEffect(() => {
    const ghlId = linkedContactInfo?.ghlContactId;
    const contactRowId = linkedContactInfo?.id ?? "";
    // Once per contact per session: every open of every task for a client
    // used to ask GoHighLevel again. A save keeps the app's copy current.
    if (!ghlId || saasChecked.has(contactRowId)) return;
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
      .then((j) => {
        if (!live || typeof j?.url !== "string") return;
        saasChecked.set(contactRowId, j.editable !== false);
        setSaasFor({ id: contactRowId, url: j.url });
        setSaasEditable(j.editable !== false);
        // GoHighLevel is the source of truth here, so a value it hands back
        // that the app has not caught up with is worth keeping.
        if (contactRowId && j.url !== (linkedContactInfo?.saasUrl ?? "")) onSaasSaved?.(contactRowId, j.url);
      })
      .catch(() => { /* keep the mirrored value */ });
    return () => { live = false; };
  }, [linkedContactInfo?.ghlContactId, linkedContactInfo?.id, linkedContactInfo?.saasUrl, onSaasSaved]);

  const saveSaas = async (value: string) => {
    const ghlId = linkedContactInfo?.ghlContactId;
    const contactRowId = linkedContactInfo?.id;
    if (!contactRowId) return;
    // A contact that is not in GoHighLevel has nowhere else to keep it, so it
    // is kept on the contact here and says so (it used to be unsaveable).
    if (!ghlId) {
      const url = normalizeSaasUrl(value);
      setSaasSaving(true);
      const res = await saveContactSaasUrl(contactRowId, url);
      setSaasSaving(false);
      if (!res || res.error) { pushToast("Couldn't save the SaaS link."); return; }
      setSaasUrl(url);
      onSaasSaved?.(contactRowId, url);
      setSaasEditing(false);
      pushToast(url ? "Saved here only, this contact is not in GoHighLevel" : "SaaS link cleared");
      return;
    }
    setSaasSaving(true);
    try {
      const res = await authedFetch("/api/ghl/saas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ghlContactId: ghlId, contactId: linkedContactInfo?.id, url: value }),
      });
      const j = await res.json();
      if (!res.ok) { pushToast(j?.error ?? "Couldn't save to GoHighLevel."); return; }
      setSaasUrl(j.url ?? "");
      // Tell the app, not just this drawer: the link lives on the contact, so
      // every other task for this client should show it straight away rather
      // than saying "Add one" until a reload (Derek, 2026-09-29).
      if (linkedContactInfo?.id) onSaasSaved?.(linkedContactInfo.id, j.url ?? "");
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
      // Dropped on a step's page: the files go onto that step too.
      if (pageStepId) setFileTarget({ stepId: pageStepId, before: task.attachments.map((a) => a.id) });
      onAddFiles(e.dataTransfer.files);
    },
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
  // Files that came in the conversation (a flyer the client sent in chat, a
  // screenshot on a note) and aren't on the task itself: shown with the
  // task's own in the side column (Derek, 2026-10-09).
  const conversationFiles = useMemo(() => {
    const own = new Set(task.attachments.map((a) => a.path).filter(Boolean));
    const seen = new Set<string>();
    return [...(messages ?? []).flatMap((m) => m.attachments ?? []), ...task.comments.flatMap((c) => c.attachments ?? [])]
      .filter((a) => !!a.path && !own.has(a.path) && !seen.has(a.path) && !!seen.add(a.path));
  }, [task.attachments, messages, task.comments]);
  // Every picture on the task and in its conversation, for the lightbox:
  // a click on any of them opens it there, the rest an arrow away. It used
  // to live inside the files card, so a picture from chat on a task with no
  // files of its own opened nothing (Derek, 2026-10-09).
  const galleryImages = useMemo(() => [...task.attachments, ...conversationFiles]
    .filter((a) => a.kind === "image" && a.path && attImageUrls[a.path])
    .map((a) => ({ id: a.path!, name: a.name, url: attImageUrls[a.path!] })), [task.attachments, conversationFiles, attImageUrls]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // A picture opens in the lightbox; anything else opens in its own tab,
  // where the browser previews a PDF. The tab opens on the click so no popup
  // blocker stops it, then goes to the file.
  const openPreview = async (att: Attachment) => {
    if (!att.path) { if (att.url) window.open(att.url, "_blank", "noopener,noreferrer"); return; }
    const i = att.kind === "image" ? galleryImages.findIndex((g) => g.id === att.path) : -1;
    if (i >= 0) { setLightbox(i); return; }
    const tab = window.open("about:blank", "_blank");
    const url = await onGetSignedUrl(att.path);
    if (tab && url) { tab.opener = null; tab.location.href = url; } else tab?.close();
  };
  const fileRef = useRef<HTMLInputElement>(null);

  // Packages the task as a ready-to-paste brief for a Claude Code session.
  const copyForClaude = async () => {
    const ct = contactById(task.contactId) || contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId);
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
      // Pasted on a step's page: the files go onto that step too.
      if (pageStepId) setFileTarget({ stepId: pageStepId, before: task.attachments.map((a) => a.id) });
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
    // Pasted on a step's page: the link goes onto that step too.
    if (pageStepId) onPatch({ subtasks: holdOnStep(taskRef.current.subtasks, pageStepId, attachmentKey(pastedId)) });
    void fetchLinkTitle(pastedId, text);
    pushToast?.(pageStepId ? "Link added to this step" : "Link attached");
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
  // Keyed by task like the other drafts here, since this drawer is not
  // remounted when the task changes.
  // The task whose next step was just ticked and is asking what happens next.
  const [askNext, setAskNext] = useState<string | null>(null);
  const [nextDraft, setNextDraft] = useState("");
  // What finished the step by itself, shown on the "what happens next" panel.
  const [autoDone, setAutoDone] = useState<{ taskId: string; text: string } | null>(null);
  // The task's reviews and where they stand, for steps that wait on an
  // approval and for suggesting what comes next.
  const [reviewStates, setReviewStates] = useState<{ taskId: string; reviews: Partial<Record<"doc" | "image" | "page" | "video", { id: string; title: string; status: string; approvedAt: string | null; version: number }>> }>({ taskId: "", reviews: {} });
  // Also when the task changes or logs something: approving or sending a
  // document does both, so its new status is read back at once.
  // A document reports its stage as it changes (TaskDocument onStage), so the
  // steps see a change made inside its window at once.
  const reportStage = (k: "doc" | "image" | "page" | "video") => (d: { id: string; title: string; status: string; version: number; approvedAt: string | null }) =>
    setReviewStates((p) => {
      if (p.taskId !== task.id) return p;
      const cur = p.reviews[k];
      if (cur && cur.status === d.status && cur.version === d.version && cur.id === d.id) return p;
      return { taskId: p.taskId, reviews: { ...p.reviews, [k]: d } };
    });
  const reviewsKey = `${task.id}:${askNext === task.id}:${openNextStep(actions)?.nextStepWatch ?? ""}:${task.status}:${task.comments.length}`;
  useEffect(() => {
    let live = true;
    void Promise.all((["doc", "image", "page", "video"] as const).map(async (k) => [k, await fetchTaskDocument(task.id, k)] as const)).then((pairs) => {
      if (!live) return;
      setReviewStates({ taskId: task.id, reviews: Object.fromEntries(pairs.filter((p) => !!p[1]).map(([k, d]) => [k, { id: d!.id, title: d!.title, status: d!.status, approvedAt: d!.approvedAt, version: d!.version }])) });
    });
    return () => { live = false; };
  }, [reviewsKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Handoffs are steps again, in their place in the list (task detail
  // redesign, 2026-10-11). The checklist is the task's plan: its steps in
  // order, each with a stage; the client's own change requests sit under the
  // current step instead of in the plan.
  const steps = planSteps(task.subtasks);
  const clientChanges = task.subtasks.filter((s) => s.fromClient);
  const activeStep = currentStep(task.subtasks);
  const progress = stepProgress(task.subtasks);
  /** The step a deliverable or a link or file is on, by its title (phase 4). */
  // A review sent before 2026-10-11 is held by the client's waiting step; it
  // lives on the step that sent it.
  const homeOf = (x: Subtask | null | undefined) => (x?.onClient && x.addedFor?.startsWith("sent:") ? steps.find((y) => y.id === x.addedFor!.slice(5)) ?? x : x ?? null);
  const stepTitleHolding = (key: string) => homeOf(stepHolding(steps, key))?.title ?? null;

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
  // Who made it and when sits at the start of the activity feed now, and
  // Labels moved into the ⋯ menu (task detail redesign, 2026-10-11). Only the
  // labels already on the task show here, each one a click to take off.
  const createdDay = task.createdAt.slice(0, 10);
  const createdLine = `Created ${formatDue(createdDay)}${creatorName ? ` by ${creatorName}` : ""}`;
  const subMeta = task.labelIds.length === 0 ? null : (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[16px] text-muted">
      {task.labelIds.map((id) => {
        const l = labelById(id);
        return l ? (
          <button key={id} onClick={() => onToggleLabel(id)} title="Remove this label"
            className="group inline-flex items-center gap-1 rounded-[5px] px-2.5 py-0.5 text-[16px] font-medium" style={{ background: l.color + "1a", color: l.color }}>
            {l.name} <span className="opacity-50 group-hover:opacity-100">×</span>
          </button>
        ) : null;
      })}
    </div>
  );
  // The label picker, opened from Labels in the ⋯ menu.
  const labelPicker = labelOpen && (<>
    <div className="fixed inset-0 z-30" onClick={() => setLabelOpen(false)} />
    <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border bg-surface p-1.5 text-left shadow-lg">
      {labels.map((l) => {
        const on = task.labelIds.includes(l.id);
        return (
          <button key={l.id} onClick={() => onToggleLabel(l.id)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[16px] text-foreground hover:bg-background">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} /> {l.name}{on && <I.check className="ml-auto text-accent" />}
          </button>
        );
      })}
    </div>
  </>);

  // Five fields with one look. Status, owner, priority, due and time were five
  // different kinds of control with their own borders and colours, and the
  // status and priority text was painted in its own colour on top of that.
  // Tinted blocks with 5px corners, no outlines, and colour only where it
  // means something (Derek, 2026-09-16: the page read "very flat"; "I don't
  // like pills so make them 5px").
  const chip = "inline-flex min-h-10 items-center gap-2 rounded-[5px] bg-background px-3 text-[16px]";
  const dueDays = task.due && task.status !== "done" ? daysUntilDue(task.due) : null;
  // Colour only when it means something: amber inside three days, red once late.
  const dueTone = dueDays === null ? "" : dueDays < 0 ? "late" : dueDays <= 3 ? "soon" : "";
  const recurrenceInput = "rounded-md border bg-background px-2 py-0.5 text-[16px] outline-none focus:border-accent";
  // The five fields read as one sentence you click to change (Derek,
  // 2026-10-10, mockup 2, then "clean up desktop too"): the chips wrapped
  // onto three rows on a phone and were a wall of boxes on a desktop.
  const ownerName = task.assigneeId ? userById(task.assigneeId)?.name?.split(/\s+/)[0] ?? "someone" : "nobody";
  // Each word is its own control, edited where it sits (Derek, 2026-10-11:
  // "should be able to just click and edit in line"): status, owner and
  // priority open their list on the word (a phone's own picker on a phone),
  // the date opens the date picker. More shows time and repeat.
  const word = "font-semibold underline decoration-dotted underline-offset-4 group-hover/w:decoration-solid";
  const wordPick = (label: React.ReactNode, aria: string, value: string, options: { value: string; label: string }[], onPick: (v: string) => void, tone = "") => (
    <label className={`group/w relative inline-block cursor-pointer ${tone}`} title={`Change ${aria.toLowerCase()}`}>
      <span className={word}>{label}</span>
      <select value={value} onChange={(e) => onPick(e.target.value)} aria-label={aria}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  const detailsSentence = (
    <div className="mt-2.5 text-[16px] leading-relaxed sm:text-[18px]">
      {wordPick(<><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: STATUS_META[effectiveStatus(task)].dot }} />{STATUS_META[effectiveStatus(task)].label}</>,
        "Status", effectiveStatus(task), pickableStatuses(effectiveStatus(task)).map((st) => ({ value: st, label: STATUS_META[st].label })), (v) => onPatch({ status: v as TaskStatus }))}
      , on {wordPick(ownerName, "Owner", task.assigneeId ?? "", [{ value: "", label: "Nobody" }, ...assignableUsers().map((u) => ({ value: u.id, label: u.name }))], (v) => onPatch({ assigneeId: v || null }))}
      , {wordPick(PRIORITY_META[task.priority].label, "Priority", task.priority, manualPriorityOptions(task.priority).map((pr) => ({ value: pr, label: PRIORITY_META[pr].label })), (v) => onPatch({ priority: v as Priority }), task.priority === "urgent" ? "text-danger" : "")}
      , {task.due ? "due " : ""}
      <span className="inline-block">
        <InlineDue value={task.due} overdue={false} recurrence={task.recurrence} recurrenceInterval={task.recurrenceInterval} recurrenceUnit={task.recurrenceUnit} recurrenceDaysOfMonth={task.recurrenceDaysOfMonth} recurrenceNth={task.recurrenceNth} recurrenceWeekday={task.recurrenceWeekday}
          showRecurrenceLabel={false} showCountdown={false} showSnooze={false} formatValue={(d) => `${formatDue(d)}${task.status !== "done" ? `, ${dueCountdown(d)}` : ""}`}
          textClass={`-mx-1 text-[16px] font-semibold underline decoration-dotted underline-offset-4 sm:text-[18px]`}
          toneClass={dueTone === "late" ? "text-danger" : dueTone === "soon" ? "text-highlight" : "text-foreground"}
          onChange={(d) => onPatch({ due: d })} onRecurrenceChange={(r) => onPatch({ recurrence: r })} emptyLabel={<span className="text-accent underline decoration-dotted underline-offset-4">no due date</span>} />
      </span>
      {/* What chases the client while it waits, a word to change like the
          rest (Derek, 2026-10-11: "why can't we edit the reminders"). */}
      {reminders.length > 0 ? (
        <span>. Reminders:{" "}
          {/* Inline, so the sentence runs on after it instead of breaking. */}
          <span className="inline-block">
          <ActionMenu title="Reminder emails to the client" triggerClassName={`${word} rounded hover:bg-background`}
            label={reminders.length === 1 ? reminders[0].summary : `${reminders.length} reviews`}
            items={reminders.flatMap((r) => {
              const pre = reminders.length > 1 ? `${r.name}: ` : "";
              return [
                { label: `${r.name}: ${r.summary}`, onClick: r.open },
                r.everyDays !== 1 && { label: `${pre}Remind every business day`, onClick: () => r.setEvery(1) },
                r.everyDays !== 2 && { label: `${pre}Remind every 2 business days`, onClick: () => r.setEvery(2) },
                r.everyDays !== 0 && { label: `${pre}Turn reminders off`, onClick: () => r.setEvery(0) },
                r.canRestart && { label: `${pre}Restart reminders`, onClick: r.restart },
              ];
            })} />
          </span>
        </span>
      ) : null}
      {/* The follow up is a date in the sentence (Derek, 2026-10-11: "we only
          need a follow up date"); what it is for lives in the steps. */}
      {(() => {
        const fu = task.followUpAt ?? openStep?.nextStepDue ?? null;
        const tone = stepDateLabel(fu).tone;
        return (
          <span title={openStep?.nextStep ?? undefined}>, follow up{" "}
            <span className="inline-block">
              <InlineDate value={fu ? fu.slice(0, 10) : null} onChange={(d) => moveStepDate(d)} onClear={() => moveStepDate(null)}
                emptyLabel={<span className="text-accent underline decoration-dotted underline-offset-4">set a date</span>}
                formatValue={(d) => { const l = stepDateLabel(d); return l.tone === "late" ? l.label.split(",")[0] : l.tone === "soon" ? l.label.split(",")[0].toLowerCase() : formatDue(d); }}
                className={`-mx-1 ${word} text-[16px] sm:text-[18px] ${tone === "late" ? "text-danger" : tone === "soon" ? "text-highlight" : ""}`} />
            </span>
          </span>
        );
      })()}
      {/* How long it takes: a small clock at the end, a click to set it. */}
      <span className="ml-2 inline-flex align-middle"><SizePicker compact size={task.size} sizeHours={task.sizeHours} onChange={onPatch} /></span>
    </div>
  );
  // Only a custom repeat needs more room than a word: its own line below.
  const chipRow = (
    <div className="mt-2 flex flex-wrap items-center gap-2">
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
  // The next step as one item you tick (Derek, 2026-09-16, option A): a round
  // tick to finish it, the words to click and edit, the date to click for the
  // quick dates, who it's for, where it came from, and how often it has slid.
  // Ticking asks what happens next right in the card.
  const stepDate = stepDateLabel(followUp);
  const reviews = reviewStates.taskId === task.id ? reviewStates.reviews : {};
  const nameOf = (id: string) => userById(id)?.name ?? "Someone";
  const watch = parseStepWatch(openStep?.nextStepWatch);
  const watchState = watch && openStep ? stepWatchState(watch, { since: openStep.at, clientName: client.name, messages: messages ?? [], subtasks: task.subtasks, reviews, nameOf }) : null;
  const suggestions = suggestNextSteps({ clientName: client.name, canMessage: mayContactClient, subtasks: task.subtasks, taskOwnerId: task.assigneeId, reviews, nameOf });
  const patchStep = (patch: Partial<Pick<TaskAction, "nextStepOwner" | "nextStepTime" | "nextStepWatch">>) => {
    if (!openStep) return;
    updateActionRow(openStep.id, patch);
    patchNextStepDb(openStep.id, patch);
  };
  // Late and still waiting on the client: offer a reminder on the channel they
  // last wrote on, for a person to read and send.
  const lastInbound = [...(messages ?? [])].filter((m) => m.direction === "inbound" && m.channel !== "call").sort((a, b) => b.at.localeCompare(a.at))[0];
  const nudgeDays = followUp && stepDate.tone === "late" ? Math.max(1, Math.round((Date.now() - Date.parse(openStep?.at ?? followUp)) / 86_400_000)) : 0;
  const canNudge = !!openStep && !!watch && watch.kind !== "handoff" && !watchState?.met && nudgeDays > 0 && mayContactClient;
  const nudge = () => {
    const first = client.name.split(" ")[0];
    const text = `Hi ${first}, just checking in on this. ${watch?.kind === "approved" ? "Let me know if it's good to go or if you'd like any changes." : "Let me know when you have a minute."}`;
    if (lastInbound && (lastInbound.channel === "chat" || lastInbound.channel === "sms")) {
      setReplyTarget((r) => ({ id: lastInbound.id, channel: lastInbound.channel as "chat" | "sms", preview: htmlToText(lastInbound.body).slice(0, 120), text, n: (r?.n ?? 0) + 1 }));
    } else if (hasMessaging) {
      startDraftEmail();
    }
  };
  // Only while no step is left: a current step already says what happens next.
  const asking = askNext === task.id && !activeStep;
  // A step waiting on something ticks itself off once it has happened, and
  // asks what happens next.
  const metText = watchState?.met ?? null;
  const metKey = openStep && metText ? `${openStep.id}:${metText}` : "";
  useEffect(() => {
    if (!metKey || !openStep) return;
    setNextStepDone(openStep.id, true);
    setAutoDone({ taskId: task.id, text: metText! });
    // With steps, what finished the follow up moves the plan on: the
    // teammate's handoff is done, or the client approved the review (Derek,
    // 2026-10-11: tick on approval). A reply only finishes the follow up.
    if (steps.length > 0) {
      // Approval moves the plan on in its own effect below (approvedKey).
      if (watch?.kind === "handoff") advanceFrom(watch.subId);
      return;
    }
    setAskNext(task.id);
    setNextDraft("");
  }, [metKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new next step on its own, logged as a quiet entry so the conversation
  // keeps the story of what was planned.
  const setNewStep = (text: string, date: string | null, watchRaw: string | null = null) => {
    const step = text.trim();
    if (!step) { pushToast("Write the follow up first."); return; }
    logAction({ id: newId("ta_"), taskId: task.id, kind: "note", authorId: meId ?? null, toId: null, parentId: null,
      body: "", at: new Date().toISOString(), nextStep: step, nextStepDue: date, nextStepDoneAt: null, nextStepWatch: watchRaw });
    if (date !== (task.followUpAt ?? null)) onPatch({ followUpAt: date });
    setAskNext(null);
    setAutoDone(null);
    setNextDraft("");
  };
  // ── Moving through the steps ──
  // The next step starts: the status follows its stage, and it becomes the
  // follow up when it has a date or is a teammate's handoff. With no step
  // left, "Done. What happens next?" asks.
  const advanceFrom = (doneId: string) => {
    const next = stepAfter(task.subtasks, doneId);
    if (!next) { setAskNext(task.id); setNextDraft(""); return; }
    // When it started, so its page shows what is said from here on.
    if (!next.startedAt) onPatchSub(next.id, { startedAt: new Date().toISOString() });
    // Client work still under way moves on to the next step; links, files
    // and finished work stay where they were used (Derek, 2026-10-11).
    const done = task.subtasks.find((x) => x.id === doneId);
    const moving = carryForward(done?.holds, (k) => {
      const r = k === "doc" || k === "image" || k === "page" || k === "video" ? reviews[k] : null;
      return !!r && (r.status === "approved" || r.status === "completed");
    }).filter((k) => !next.holds?.includes(k));
    if (done && moving.length) {
      const rest = (done.holds ?? []).filter((k) => !moving.includes(k as DeliverableKey));
      onPatchSub(doneId, { holds: rest.length ? rest : undefined });
      onPatchSub(next.id, { holds: [...(next.holds ?? []), ...moving] });
    }
    const status = statusForStep(task.status, stepStage(next, task.assigneeId));
    if (status) onPatch({ status });
  };
  // Mark done on the current step, or its tick: one action, not two.
  const completeStep = (sid: string) => {
    // A step from a plan says what it needs; missing any, it asks first but
    // never blocks (Derek, 2026-10-11: "warn only").
    const sub = task.subtasks.find((x) => x.id === sid);
    const missing = sub ? missingNeeds(sub) : [];
    const openTodos = (sub?.todos ?? []).filter((t) => !t.done).length;
    const ask = [missing.length ? `still needs: ${missing.join(", ")}` : null, openTodos ? `has ${openTodos} ${openTodos === 1 ? "to do" : "to dos"} open` : null].filter(Boolean).join(", and ");
    if (ask && !window.confirm(`"${sub!.title}" ${ask}. Mark it done anyway?`)) return;
    // Changes done and no client review next: the next step is telling the
    // client, with the email drafted for us to read and send. Nothing goes to
    // the client by itself (Derek, 2026-10-11).
    const telling = sub && !isHandoffStep(sub, task.assigneeId) ? changesTelling(task.subtasks, sid, task.assigneeId) : null;
    // The plan's next step already makes the email: it gets the draft and
    // starts as usual (advanceFrom), no extra step.
    if (telling === "use" && sub) {
      if (!task.draftEmail) onPatch({ draftEmail: changesDoneEmail(sub) });
      const next = stepAfter(task.subtasks, sid);
      // Only when no step holds an email yet: each sits on one step.
      if (next && !stepHolding(task.subtasks, "email")) onPatchSub(next.id, { holds: [...(next.holds ?? []), "email"] });
    }
    if (sub && telling === "add") {
      const list = addTellClientStep(task.subtasks, sid, firstName, () => newId("s_"));
      if (list) {
        const status = statusForStep(task.status, "in_progress");
        onPatch({ subtasks: list, ...(status ? { status } : {}), ...(task.draftEmail ? {} : { draftEmail: changesDoneEmail(sub) }) });
        setAutoDone(null);
        pushToast(`Next: let ${firstName} know. The email is drafted for you to read.`);
        return;
      }
    }
    onToggleSub(sid);
    onPatchSub(sid, { doneAt: new Date().toISOString(), outcome: "Done" });
    setAutoDone(null);
    advanceFrom(sid);
  };
  // The current step's date is the follow up's: one date, written to both.
  // The task's follow up date, managed by the task (Derek, 2026-10-11), apart
  // from the steps' own due dates.
  const moveStepDate = (d: string | null) => {
    if (openStep) moveFollowUp(d);
    else onPatch({ followUpAt: d });
  };
  // A new step, just as typed: no date of its own until one is set (Derek,
  // 2026-10-11: "when creating a step we don't need an auto follow up date").
  const addStep = (title: string) => {
    const t = title.trim();
    if (!t) return;
    // A new step answers "what happens next?".
    if (asking) setAskNext(null);
    onAddSub(t);
  };
  // A client sent changes on a review while its review step is current: that
  // step is done, and "Make the changes" and a new client review follow it
  // (Derek, 2026-10-11: add steps on changes). Only for a step given the
  // Review stage on purpose, never one read from its words, so opening an
  // older task never rewrites its list. Runs while the task is open, like the
  // follow up's own finish line; the server does neither yet (phase 4).
  // The review a step is working on: the one it holds, else (a step given
  // the Review stage on purpose) whichever is out with the client.
  const reviewOnStep = (st: Subtask): "page" | "image" | "video" | "doc" | null => {
    for (const k of ["page", "image", "video", "doc"] as const) if (st.holds?.includes(k) && reviews[k]) return k;
    if (st.stage !== "review") return null;
    for (const k of ["page", "image", "video", "doc"] as const) if (reviews[k]) return k;
    return null;
  };
  // ── The document's stage drives the steps (Derek, 2026-10-11: "for each
  // step it's just keeping track of where we're at"). Whatever moved it, a
  // button, its stage menu, the client: sent for review starts the client's
  // waiting step, changes start "Make the changes" with the comments as its
  // checklist, approval records itself and the next planned step starts.
  // Each is added once (addedFor), so reading the same stage again adds
  // nothing.
  // Only something done to the document moves the steps: its stage changing
  // while this task is open, or, on the client's own step, whatever the
  // client did. Putting a document on a step, or saving a draft, does not
  // (Derek, 2026-10-11: "it created the next step a little too fast").
  const seenStage = useRef<Record<string, string>>({});
  const [movedTo, setMovedTo] = useState<Record<string, string>>({});
  useEffect(() => {
    const moved: Record<string, string> = {};
    for (const k of ["page", "image", "video", "doc"] as const) {
      const r = reviews[k];
      if (!r) continue;
      const id = `${task.id}:${k}`;
      const prev = seenStage.current[id];
      if (prev && prev !== r.status) moved[k] = r.status;
      seenStage.current[id] = r.status;
    }
    if (Object.keys(moved).length) setMovedTo((m) => ({ ...m, ...moved }));
  }, [reviewStates]); // eslint-disable-line react-hooks/exhaustive-deps
  // A change belongs to the step it happened on, never a later one.
  const currentStepId = activeStep?.id ?? "";
  useEffect(() => { setMovedTo({}); }, [currentStepId]);
  const stageKey = (() => {
    if (!activeStep || isHandoffStep(activeStep, task.assigneeId)) return "";
    const k = reviewOnStep(activeStep);
    const r = k ? reviews[k] : null;
    if (!k || !r) return "";
    const working = activeStep.onClient || activeStep.holds?.includes(k) || stepStage(activeStep, task.assigneeId) === "review";
    if (!working) return "";
    // Our own step moves only when the stage just changed, not on how it stood.
    if (!activeStep.onClient && movedTo[k] !== r.status) return "";
    if (r.status === "with_client" && !activeStep.onClient) return `${activeStep.id}|${k}|sent|${r.id}|sent:${activeStep.id}`;
    if (r.status === "client_submitted") return `${activeStep.id}|${k}|changes|${r.id}|${k}:${r.version}`;
    if (r.status === "approved" || r.status === "completed") return `${activeStep.id}|${k}|ok|${r.id}|ok:${k}:${r.version}`;
    return "";
  })();
  useEffect(() => {
    if (!stageKey) return;
    const [stepId, kind, what, docId, key] = stageKey.split("|");
    const k = kind as "page" | "image" | "video" | "doc";
    setMovedTo((m) => { const n = { ...m }; delete n[k]; return n; });
    const name = reviews[k]?.title?.trim() || (k === "doc" ? "the document" : "the review");
    const from = task.subtasks.find((x) => x.id === stepId);
    if (what === "sent") {
      const due = addBusinessDaysIso(TODAY, reviewFollowUpDays(1));
      const list = addClientReviewStep(taskRef.current.subtasks, stepId, firstName, name, k, due, () => newId("s_"));
      if (list) onPatch({ subtasks: list, ...(statusForStep(task.status, "waiting") ? { status: "waiting" as TaskStatus } : {}) });
      return;
    }
    if (what === "ok") {
      const byClient = !!from?.onClient;
      const title = byClient ? `${firstName} approved ${name}` : `${name.charAt(0).toUpperCase()}${name.slice(1)} approved`;
      const made = addApprovalStep(taskRef.current.subtasks, stepId, title, key, () => newId("s_"), undefined, byClient ? `${firstName} approved` : "Approved");
      if (!made) return;
      if (openStep) setNextStepDone(openStep.id, true);
      const next = made.hasNext ? stepAfter(made.list, made.approvalId) : null;
      const list = next && !next.startedAt ? made.list.map((x) => (x.id === next.id ? { ...x, startedAt: new Date().toISOString() } : x)) : made.list;
      const status = statusForStep(task.status, next ? stepStage(next, task.assigneeId) : "approved");
      onPatch({ subtasks: list, ...(status ? { status } : {}) });
      return;
    }
    let live = true;
    void fetchTaskDocumentComments(docId).then((comments) => {
      if (!live) return;
      const todos = comments.filter((c) => c.fromClient && !c.completedAt && c.body.trim())
        .map((c) => ({ id: newId("td_"), title: c.body.trim().slice(0, 300), done: false, fromClient: true, commentId: c.id }));
      const list = addChangesRound(taskRef.current.subtasks, stepId, firstName, key, () => newId("s_"), { review: k, todos });
      if (!list) return;
      if (openStep) setNextStepDone(openStep.id, true);
      const status = statusForStep(task.status, "changes_requested");
      onPatch({ subtasks: list, ...(status ? { status } : {}) });
      pushToast(`Changes on ${name}: added "Make ${firstName}'s changes"${todos.length ? ` with ${todos.length} to ${todos.length === 1 ? "do" : "dos"}` : ""}`);
    });
    return () => { live = false; };
  }, [stageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // What the client sends from their portal lands on the open changes step,
  // made in front of the current step when there is none (Derek, 2026-10-11:
  // "what counts as a change is when the client submits something").
  const looseClientIds = steps.length > 0 ? clientChanges.filter((c) => !c.stepId && !c.done).map((c) => c.id).join(",") : "";
  useEffect(() => {
    if (!looseClientIds) return;
    const ids = looseClientIds.split(",");
    const { list, stepId, made } = changesStepFor(taskRef.current.subtasks, firstName, () => newId("s_"));
    const next = list.map((x) => (ids.includes(x.id) ? { ...x, stepId } : x));
    const status = made ? statusForStep(task.status, "changes_requested") : null;
    if (made && openStep) setNextStepDone(openStep.id, true);
    onPatch({ subtasks: next, ...(status ? { status } : {}) });
    if (made) pushToast(`${firstName} sent changes: added "Changes from ${firstName}"`);
  }, [looseClientIds]); // eslint-disable-line react-hooks/exhaustive-deps
  // A message we choose to count as changes: a to-do on the changes step.
  const addToChanges = (text: string) => {
    const title = text.replace(/\s+/g, " ").trim().slice(0, 300);
    if (!title) return;
    const { list, stepId, made } = changesStepFor(taskRef.current.subtasks, firstName, () => newId("s_"));
    const next = list.map((x) => (x.id === stepId ? { ...x, todos: [...(x.todos ?? []), { id: newId("td_"), title, done: false, fromClient: true }] } : x));
    const status = made ? statusForStep(task.status, "changes_requested") : null;
    onPatch({ subtasks: next, ...(status ? { status } : {}) });
    pushToast(made ? `Added "Changes from ${firstName}" with this as its first to do` : "Added to the changes");
  };
  // The email telling the client their changes are done, for us to read: the
  // step's to-dos and the client's own requests, ticked off.
  const changesDoneEmail = (st: Subtask) => {
    const items = [...(st.todos ?? []).filter((t) => t.done).map((t) => t.title), ...clientChanges.filter((c) => c.stepId === st.id && c.done).map((c) => c.title)];
    const now = new Date().toISOString();
    const list = items.length ? `<ul>${items.map((t) => `<li>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`).join("")}</ul>` : "";
    return { subject: `${task.title}: your changes are done`, body: `${greetingHtml(messageDest?.name)}<p>All the changes you asked for are done:</p>${list}<p>Take a look and let me know if anything else needs a tweak.</p>`, replyTo: null, createdAt: now, updatedAt: now };
  };
  // A review has just gone to the client. Until now that set nothing, so the
  // task sat in Waiting with no date on it. The client is emailed on each of
  // the next three business days; the owner comes back the day after, and the
  // follow up finishes itself if the client approves first. An open follow up
  // keeps its own words and date and only gains the finish line.
  const followUpOnReview = (kind: TaskDocumentKind, name: string, reminderEveryDays = 1) => {
    const watch = `approved:${kind}`;
    // With steps, our step is done and the client's own step starts: on
    // them, waiting, holding the review (Derek, 2026-10-11).
    if (activeStep && !isHandoffStep(activeStep, task.assigneeId)) {
      const due = addBusinessDaysIso(TODAY, reviewFollowUpDays(reminderEveryDays));
      const list = addClientReviewStep(taskRef.current.subtasks, activeStep.id, firstName, name, kind as DeliverableKey, due, () => newId("s_"));
      if (list) onPatch({ subtasks: list });
    }
    if (openStep) {
      if (task.status !== "waiting") onPatch({ status: "waiting" });
      if (!openStep.nextStepWatch) patchStep({ nextStepWatch: watch });
      return;
    }
    // The day after the review's last reminder (reviewFollowUpDays).
    const date = addBusinessDaysIso(TODAY, reviewFollowUpDays(reminderEveryDays));
    onPatch({ status: "waiting", followUpAt: date });
    setNewStep(`Get ${client.name.split(" ")[0]}'s approval on ${name}`, date, watch);
  };
  const quickChip = "rounded-[5px] bg-surface px-3 py-1.5 text-[16px] font-semibold ring-1 ring-border hover:ring-accent";
  // Done, and no step after it: what happens next.
  const askingPanel = (
          <div className="mt-2 rounded-xl bg-background p-3">
            {autoDone?.taskId === task.id && (
              <div className="mb-2 rounded-lg bg-success-soft px-3 py-2 text-[16px] font-semibold text-success">✓ {autoDone.text}, so this step is done.</div>
            )}
            <div className="font-semibold">Done. What happens next?</div>
            {suggestions.length > 0 && (
              <div className="mt-2 grid gap-1.5">
                {suggestions.map((sg) => (
                  <button key={sg.text} onClick={() => setNewStep(sg.text, sg.due, sg.watch)}
                    className="flex w-full items-center gap-3 rounded-lg bg-surface px-3 py-2.5 text-left ring-1 ring-border hover:ring-accent">
                    <span className="min-w-0 flex-1"><span className="block font-semibold [overflow-wrap:anywhere]">{sg.text}</span><span className="block text-[16px] text-muted">{sg.hint}</span></span>
                    {sg.due && <span className="shrink-0 font-semibold text-accent">{stepDateLabel(sg.due).label.split(",")[0]} ›</span>}
                  </button>
                ))}
                <div className="mt-1 text-[16px] text-muted">or write your own</div>
              </div>
            )}
            <input autoFocus value={nextDraft} onChange={(e) => setNextDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setNewStep(nextDraft, dateQuickPicks()[1].date); if (e.key === "Escape") { e.stopPropagation(); setAskNext(null); } }}
              placeholder="Like: send the approved emails to Michaella" aria-label="Follow up"
              className="mt-2 w-full rounded-lg bg-surface px-3 py-2 text-[16px] outline-none ring-1 ring-border focus:ring-2 focus:ring-accent" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {dateQuickPicks().slice(1, 4).map((q) => (
                <button key={q.label} onClick={() => setNewStep(nextDraft, q.date)} className={quickChip}>{q.label}</button>
              ))}
              <InlineDate value={null} onChange={(d) => setNewStep(nextDraft, d)} emptyLabel="📅 Pick a date" className={quickChip} />
              <button onClick={() => setAskNext(null)} className="ml-auto rounded-lg px-3 py-1.5 text-[16px] font-medium text-muted hover:text-foreground">Nothing for now</button>
            </div>
          </div>
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

  const hasDescription = htmlToText(task.description).trim().length > 0;
  // A client document is for sharing, so a private task and the Personal client
  // never get one. Whether one exists is only known once TaskDocument loads it,
  // so it reports back; keyed by task id, because this drawer
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
  // Project instructions for an outside person (TaskBrief.tsx), reported the same way.
  const [briefStartNonce, setBriefStartNonce] = useState(0);
  const [briefPresence, setBriefPresence] = useState<{ taskId: string; exists: boolean }>({ taskId: task.id, exists: false });
  const showBrief = canHaveDocument && briefPresence.taskId === task.id && briefPresence.exists;
  const [reviewStartNonce, setReviewStartNonce] = useState<Record<FileKind, number>>({ image: 0, page: 0, video: 0 });
  const [emailOpenNonce, setEmailOpenNonce] = useState(0);
  // Email on this task, from the dock, the "+ Draft email" chip or Reply on a
  // message, opens the draft email window. A draft already here opens as it is;
  // a reply replaces it, after a confirm when it has writing in it.
  const startDraftEmail = (reply?: { subject?: string; replyTo?: string }) => {
    const current = task.draftEmail;
    const keepCurrent = !!current && (!reply || (!!htmlToText(current.body).trim() && !window.confirm("Replace the draft email on this task with this reply?")));
    if (!keepCurrent) {
      const now = new Date().toISOString();
      onPatch({ draftEmail: { subject: reply?.subject ?? task.title, body: greetingHtml(replyPeerOf(reply?.replyTo)?.name ?? messageDest?.name), replyTo: reply?.replyTo ?? null, createdAt: now, updatedAt: now } });
    }
    setEmailOpenNonce((n) => n + 1);
  };
  // The hidden file input lives in whichever of the two is actually mounted
  // (never both, since they're mutually exclusive) so fileRef always resolves.
  const hiddenFileInput = (
    <input ref={fileRef} type="file" multiple className="hidden"
      onChange={(e) => { if (e.target.files) onAddFiles(e.target.files); e.target.value = ""; }} />
  );

  const documentBlock = (onCurrentStep = false) => !canHaveDocument ? null : (
    // Keyed apart from the draft email line beside it: two siblings sharing a
    // key made React mount a new document line on every render and never drop
    // the old ones (Derek, 2026-09-11: "there's like 100 on there").
    <TaskDocument key={`doc-${task.id}`} task={task} onPatch={onPatch} pushToast={pushToast} canAdmin={!!canAdmin} meId={meId}
      onEmailClient={(review) => startReviewEmail(review)} onSent={followUpOnReview} onReminders={reportReminders("doc")}
      startNonce={docStartNonce} showOpenComments={onCurrentStep} onStage={reportStage("doc")}
      onPresence={(exists) => setDocPresence((p) => (p.taskId === task.id && p.exists === exists ? p : { taskId: task.id, exists }))} />
  );
  // Separate from the client document (Derek, 2026-09-30): its own line, link and files.
  const briefBlock = !canHaveDocument ? null : (
    <TaskBrief key={`brief-${task.id}`} task={task} clientName={client.name} pushToast={pushToast} startNonce={briefStartNonce}
      onPresence={(exists) => setBriefPresence((p) => (p.taskId === task.id && p.exists === exists ? p : { taskId: task.id, exists }))} />
  );
  const descriptionBlock = (
    <div>
      {/* Reads as text until you click it. A permanently-live editor put a
          formatting toolbar and an AI prompt box in the rail on every task,
          which is most of why this column looked twice the weight of the
          mockup it came from. */}
      {/* One line under the details until it is clicked, then the editor
          (task detail redesign, 2026-10-11: no Description tab, no post at
          the top of the feed). */}
      {descEditing ? (
        <RichTextEditor key={`task-desc-${task.id}-${descFocusNonce}`} value={task.description} onChange={(html) => descriptionCommit.schedule(() => onPatch({ description: html }))} placeholder="Add a description…" />
      ) : (
        <button onClick={() => setDescEditing(true)} title={hasDescription ? "Show all and edit" : "Add a description"} aria-label={hasDescription ? "Description, show all or edit" : "Add a description"}
          className="-mx-1 flex min-h-8 w-full max-w-[760px] items-center gap-2 rounded-[5px] px-1 text-left text-[16px] text-muted hover:bg-background hover:text-foreground">
          <span className="min-w-0 flex-1 truncate">{hasDescription ? htmlToText(task.description).replace(/\s+/g, " ").trim() : <span className="text-accent underline decoration-dotted underline-offset-4">Add a description</span>}</span>
          {hasDescription && <I.chevron className="h-4 w-4 shrink-0 -rotate-90" />}
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
  const [replyTarget, setReplyTarget] = useState<{ id: string; channel: "chat" | "sms"; preview: string; text?: string; n: number } | null>(null);
  const { feedArea, composerFooter, openCompose } = useTaskMessaging({
    createdLine,
    meetings: clientMeetings,
    actions, onDeleteAction: deleteAction, onEditAction: editAction, onLogAction: logAction, meId, onSendDm, onDeleteComment,
    onMessageSent: (channel, body) => setPendingNextStep({ kind: channel, body }),
    onComposeEmail: hasMessaging ? startDraftEmail : undefined,
    onReplyInDock: (id, channel, preview) => setReplyTarget((r) => ({ id, channel, preview, n: (r?.n ?? 0) + 1 })),
    onNoteInDock: (text) => askDock("note", text),
    onAddToChanges: (text) => addToChanges(text),
    onWrite: () => askDock("note"),
    task, client, comment, setComment, onAddComment, onUploadCommentImage, onDownloadFile, onDownloadFileAs, onDownloadAll, zippingIds,
    attImageUrls, openPreview, attachToTask, messages, onMarkChannelRead, messageDest, onUploadMessageImage,
    onSendTaskMessage, onScheduleTaskMessage, sendingMessage, onDraftMessage, draftingMessage, canAdmin,
    onDeleteMessage, onEditMessage, hasMessaging,
    // Over the Inbox you just read the conversation, so the feed opens on Everything.
    initialView: slideOver ? "all" : undefined,
  });
  // Reads like the task row it effectively is: a tick box, their face, what
  // they were asked for, and when they owe it. Sits directly under the stage
  // chips, because "Delegated" in that row and the person holding it are one
  // fact and were two screens apart.
  // A teammate's step: how far along their handoff is and what is on it,
  // one click from its page (Derek, 2026-09-16). Its Mark done is the step's.
  const handoffDetails = (s: Subtask) => (
    (() => {
            const h = handoffOf(s);
            const { done, total } = handoffProgress(h);
            const facts = [
              h.deliverables.length ? `${h.deliverables.length} ${h.deliverables.length === 1 ? "piece" : "pieces"} of client work` : null,
              h.links.length ? `${h.links.length} ${h.links.length === 1 ? "link" : "links"}` : null,
              h.fileIds.length ? `${h.fileIds.length} ${h.fileIds.length === 1 ? "file" : "files"}` : null,
              h.thread.length ? `${h.thread.length} ${h.thread.length === 1 ? "message" : "messages"}` : null,
            ].filter(Boolean);
            return (
              <div className="space-y-2">
                {total > 0 && (
                  <div className="flex items-center gap-2.5 text-[16px] text-muted">
                    <span className="shrink-0">{done} of {total} steps</span>
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
                      <span className="block h-full rounded-full" style={{ width: `${Math.round((done / total) * 100)}%`, background: STATUS_META.delegated.dot }} />
                    </span>
                  </div>
                )}
                {total > 0 && done === total && !s.done && (
                  <div className="text-[16px] font-medium text-accent">All steps done. Mark it finished.</div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {facts.map((f) => <span key={f} className="rounded-[5px] bg-background px-2 py-0.5 text-[16px] text-muted">{f}</span>)}
                  <span className="ml-auto flex flex-wrap gap-2">
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
    })()
  );
  // Reorder: the dragged item goes where the one it was dropped on is,
  // everything else (handoffs included) keeps its place.
  const moveSub = (fromId: string, toId: string) => {
    const list = [...task.subtasks];
    const from = list.findIndex((x) => x.id === fromId);
    const to = list.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    onPatch({ subtasks: list });
  };
  // ── Steps (task detail redesign, 2026-10-11, Derek picked option B):
  // the task's own steps in order, each with a foundation stage. Done steps
  // are one line, the current one is open with its follow up, upcoming ones
  // are muted and wait their turn.
  const stageTag = (st: TaskStatus) => (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] bg-background px-2 text-[16px] font-semibold">
      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_META[st].dot }} />{STATUS_META[st].label}
    </span>
  );
  const stagePicker = (sub: Subtask, isActive: boolean) => {
    const st = stepStage(sub, task.assigneeId);
    // A teammate's step is Delegated because it is theirs, as with the task.
    if (isHandoffStep(sub, task.assigneeId)) return stageTag("delegated");
    return (
      <label className="relative inline-flex shrink-0 cursor-pointer" title="Change this step's stage">
        {stageTag(st)}
        <select value={st} aria-label={`Stage for ${sub.title}`}
          onChange={(e) => {
            const next = e.target.value as TaskStatus;
            onPatchSub(sub.id, { stage: next });
            // The current step's stage is the task's status.
            const status = isActive ? statusForStep(task.status, next) : null;
            if (status) onPatch({ status });
          }}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
          {STEP_STAGES.map((x) => <option key={x} value={x}>{STATUS_META[x].label}</option>)}
        </select>
      </label>
    );
  };
  // What the client sent from their portal, under the step it belongs to.
  const clientItemsOf = (stepId: string | null) => clientChanges.filter((c) => (stepId ? c.stepId === stepId : !c.stepId));
  const clientChangesList = (items: Subtask[]) => items.length === 0 ? null : (
    <div className="rounded-[5px] border px-3 py-2">
      <div className="font-semibold">From {firstName}&apos;s portal <span className="font-normal text-muted">· {items.filter((c) => c.done).length} of {items.length} done</span></div>
      <ul className="mt-1 space-y-1">
        {items.map((c) => (
          <li key={c.id} className="group/cc flex items-start gap-2.5">
            <button onClick={() => onToggleSub(c.id)} aria-pressed={c.done} aria-label={c.done ? `Reopen ${c.title}` : `Mark ${c.title} done`}
              className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border-2 ${c.done ? "border-accent bg-accent text-white" : "border-border hover:border-accent"}`}>{c.done && <I.check className="h-3.5 w-3.5" />}</button>
            <span className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${c.done ? "text-muted line-through" : ""}`}>{c.title}</span>
            <span className="shrink-0 rounded-[5px] bg-sky-50 px-2 text-[16px] font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">From client</span>
            <button onClick={() => onDeleteSub(c.id)} title="Delete" aria-label={`Delete ${c.title}`} className="mt-1 shrink-0 text-muted opacity-0 hover:text-danger group-hover/cc:opacity-100 focus:opacity-100"><I.trash className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
  // A step's controls, on its page (Derek, 2026-10-11: "move all the actions
  // into the step"): its date, who has it, its stage, attach, delete.
  const stepControls = (sub: Subtask, isActive: boolean) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[16px]">
      {/* A step has its own due date (Derek, 2026-10-11: "now there is just a
          due date"); the follow up date is the task's, in its sentence. */}
      {(() => {
        const d = sub.due ?? null;
        const t = d && !sub.done ? stepDateLabel(d).tone : "later";
        return (
          <span className="inline-flex items-center gap-1">
            <span className="text-muted">Due</span>
            <InlineDate value={d} onChange={(v) => onPatchSub(sub.id, { due: v })} onClear={() => onPatchSub(sub.id, { due: null })}
              emptyLabel={<span className="text-accent underline decoration-dotted underline-offset-4">set a date</span>} formatValue={formatDue}
              className={`font-semibold underline decoration-dotted underline-offset-4 ${t === "late" ? "text-danger" : t === "soon" ? "text-highlight" : ""}`} />
          </span>
        );
      })()}
      {sub.onClient ? (
        <span className="inline-flex items-center gap-1.5 font-medium"><span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: client.color }}>{initialsOf(client.name)}</span>On {client.name}</span>
      ) : <InlineAssignee value={sub.assigneeId ?? null} size={24}
        onChange={(a) => {
          onPatchSub(sub.id, { assigneeId: a });
          // Giving the current step to a teammate: the follow up finishes
          // when they mark it done (brief, section 6).
          if (isActive && openStep && a && a !== task.assigneeId && !openStep.nextStepWatch) patchStep({ nextStepWatch: `handoff:${sub.id}` });
        }} />}
      {stagePicker(sub, isActive)}
    </div>
  );
  // A step on the task: one line that says what is happening inside it, the
  // whole of it a click to open the step (Derek, 2026-10-11: "make the bar
  // clickable", "this is all informational").
  // A review sent before 2026-10-11's change sits on the client's waiting
  // step: show it on the step that made it, where it now lives.
  const withSentHolds = (sub: Subtask): Subtask => {
    const moved = task.subtasks.filter((x) => x.onClient && x.addedFor === `sent:${sub.id}`).flatMap((x) => x.holds ?? []);
    return moved.length ? { ...sub, holds: [...new Set([...(sub.holds ?? []), ...moved])] } : sub;
  };
  const stepRow = (sub: Subtask, i: number) => {
    const isActive = activeStep?.id === sub.id;
    const upcoming = !sub.done && !isActive;
    const st = stepStage(sub, task.assigneeId);
    const own = todoProgress(sub.todos);
    const fromPortal = clientItemsOf(sub.id);
    const tp = { done: own.done + fromPortal.filter((c) => c.done).length, total: own.total + fromPortal.length };
    const w = stepWindow(task.subtasks, sub.id, task.createdAt);
    const fresh = (messages ?? []).filter((m) => m.direction === "inbound" && !m.read && inWindow(m.at, w)).length;
    // The client's waiting step keeps its document and email in the task's
    // Client work, not on the step (Derek, 2026-10-11: "just what needs to be
    // completed").
    const holds = sub.onClient ? [] : withSentHolds(sub).holds ?? [];
    const heldNames = [
      ...holds.filter((k): k is DeliverableKey => (DELIVERABLE_KEYS as string[]).includes(k)).filter(deliverablePresent).map(deliverableName),
      ...(() => { const n = holds.filter((k) => k.startsWith("att:")).length; return n ? [`${n} ${n === 1 ? "link or file" : "links and files"}`] : []; })(),
    ];
    const missing = !sub.done ? missingNeeds(sub) : [];
    const reason = !sub.done ? addedReason(sub.addedFor, firstName) : null;
    return (
      <li key={sub.id} draggable={dragSub === sub.id}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", sub.id); }}
        onDragEnd={() => { setDragSub(null); setDropSub(null); }}
        onDragOver={(e) => { if (dragSub && dragSub !== sub.id) { e.preventDefault(); setDropSub(sub.id); } }}
        onDrop={(e) => { e.preventDefault(); if (dragSub && dragSub !== sub.id) moveSub(dragSub, sub.id); setDragSub(null); setDropSub(null); }}
        aria-current={isActive ? "step" : undefined}
        className={`group/sub relative flex items-stretch ${i > 0 ? "border-t" : ""} ${isActive ? "bg-[color-mix(in_srgb,var(--accent)_5%,var(--surface))]" : ""} ${dropSub === sub.id ? "ring-2 ring-inset ring-accent/50" : ""} ${dragSub === sub.id ? "opacity-50" : ""}`}>
        {/* Drag the grip to reorder (Derek, 2026-10-06). */}
        <span onMouseDown={() => setDragSub(sub.id)} onMouseUp={() => setDragSub(null)} title="Drag to reorder" aria-hidden
          className="hidden w-6 shrink-0 cursor-grab select-none items-center justify-center text-[16px] text-muted opacity-0 group-hover/sub:opacity-100 active:cursor-grabbing sm:flex">⋮⋮</span>
        <button onClick={() => setOpenStepPage({ taskId: task.id, id: sub.id, full: false })} aria-label={`Open ${sub.title}`}
          className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-3 pr-3 text-left hover:bg-background sm:pl-1 sm:pr-4">
          {sub.done ? (
            <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-white"><I.check className="h-3.5 w-3.5" /></span>
          ) : isActive ? (
            <span aria-hidden className="mt-0.5 h-6 w-6 shrink-0 rounded-full border-[7px] bg-surface" style={{ borderColor: STATUS_META[st].dot }} />
          ) : (
            <span aria-hidden className="mt-0.5 h-6 w-6 shrink-0 rounded-full border-2" />
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={`text-[17px] leading-snug [overflow-wrap:anywhere] ${isActive ? "font-bold" : "font-semibold"} ${upcoming || sub.done ? "text-muted" : ""}`}>{sub.title}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[16px]">
              {sub.done && <span className="text-muted">{sub.outcome ?? "Done"}{sub.doneAt ? ` · ${formatDue(sub.doneAt.slice(0, 10))}` : ""}</span>}
              {/* Each step's own due date (Derek, 2026-10-11). */}
              {(() => {
                const d = !sub.done ? sub.due ?? null : null;
                if (!d) return null;
                const t = stepDateLabel(d).tone;
                return <span className={t === "late" ? "font-semibold text-danger" : t === "soon" ? "font-semibold text-highlight" : "text-muted"}>Due {t === "late" || t === "soon" ? stepDateLabel(d).label.split(",")[0].toLowerCase() : formatDue(d)}</span>;
              })()}
              {sub.emailedAt && !sub.done && <span className="text-muted">Email sent {formatDue(sub.emailedAt.slice(0, 10))}</span>}
              {tp.total > 0 && <span className="text-muted">{tp.done} of {tp.total} to do</span>}
              {heldNames.length > 0 && <span className="min-w-0 truncate text-muted">{heldNames.join(" · ")}</span>}
              {fresh > 0 && <span className="font-semibold text-sky-700 dark:text-sky-300">{fresh} new from {firstName}</span>}
              {missing.length > 0 && isActive && <span className="text-muted">Needs {missing.join(", ")}</span>}
              {sub.onClient && !sub.done && <span className="font-semibold text-sky-700 dark:text-sky-300">Waiting on {firstName}</span>}
              {reason && !sub.onClient && <span className="text-muted">{reason}</span>}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {sub.onClient && <span title={`On ${client.name}`} className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: client.color }}>{initialsOf(client.name)}</span>}
            {sub.assigneeId && <Avatar id={sub.assigneeId} size={22} />}
            <span className="hidden sm:inline-flex">{stageTag(st)}</span>
            <I.chevron className="h-4 w-4 -rotate-180 text-muted" />
          </span>
        </button>
      </li>
    );
  };
  const offeredTemplates = templatesFor(templates, task.clientId);
  const [savePlan, setSavePlan] = useState<string | null>(null);
  const savePlanAs = (clientId: string | null) => {
    if (!onSaveTemplate || !savePlan?.trim()) return;
    const nameOf = (k: string) => (k.startsWith("att:") ? task.attachments.find((a) => attachmentKey(a.id) === k)?.name ?? null : KIND_LABEL[k as DeliverableKey] ?? null);
    onSaveTemplate({ name: savePlan.trim(), checklistItems: planFromSteps(task.subtasks, task.assigneeId, nameOf), ...(clientId ? { clientId } : {}) });
    setSavePlan(null);
    pushToast(`Saved "${savePlan.trim()}" as a template${clientId ? ` for ${client.name}` : " for everyone"}`);
  };
  const renderPlan = () => (
    <section className="mt-8" aria-labelledby="task-steps">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="task-steps" className="flex items-center gap-2 text-[16px] font-bold text-foreground">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"><I.list className="h-4 w-4" /></span>
          Steps{progress.total > 0 && <span className="font-normal text-muted">· {progress.done} of {progress.total} done</span>}
        </h2>
        <span className="flex flex-wrap items-center gap-2">
        {/* Save these steps as a plan for this client or everyone (phase 5). */}
        {onSaveTemplate && progress.total > 0 && (
          <div className="relative">
            <button onClick={() => { setSavePlan((o) => (o === null ? task.title : null)); }} className="inline-flex h-10 items-center gap-1.5 rounded-lg border bg-surface px-3 text-[16px] font-medium hover:bg-background">Save as template</button>
            {savePlan !== null && (<>
              <div className="fixed inset-0 z-30" onClick={() => setSavePlan(null)} />
              <div className="absolute right-0 z-40 mt-1 w-[min(320px,calc(100vw-32px))] space-y-2 rounded-lg border bg-surface p-3 shadow-lg">
                <label htmlFor="save-plan-name" className="block text-[16px] font-semibold">Template name</label>
                <input id="save-plan-name" autoFocus value={savePlan} onChange={(e) => setSavePlan(e.target.value)}
                  className="w-full rounded-md border bg-background px-2.5 py-1.5 text-[16px] outline-none focus:border-accent" />
                <p className="text-[16px] text-muted">Saves each step with its stage, what it makes and what it holds as what it needs. Rounds of changes are left out.</p>
                <div className="flex flex-wrap gap-2">
                  {!isPersonal && <button onClick={() => savePlanAs(task.clientId)} disabled={!savePlan.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">For {firstName}</button>}
                  <button onClick={() => savePlanAs(null)} disabled={!savePlan.trim()} className="rounded-md border px-3 py-1.5 text-[16px] font-medium hover:bg-background disabled:opacity-40">For everyone</button>
                </div>
              </div>
            </>)}
          </div>
        )}
        {offeredTemplates.length > 0 && (
          <div className="relative">
            <button onClick={() => setTemplateOpen((o) => !o)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border bg-surface px-3 text-[16px] font-medium hover:bg-background"><I.clipboard /> From template</button>
            {templateOpen && (<>
              <div className="fixed inset-0 z-30" onClick={() => setTemplateOpen(false)} />
              <div className="absolute right-0 z-40 mt-1 max-h-[60vh] w-72 overflow-y-auto rounded-lg border bg-surface p-1 shadow-lg">
                {offeredTemplates.map((t) => (
                  <button key={t.id} onClick={() => { onApplyTemplate(t.id); setTemplateOpen(false); }} className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-background">
                    <span className="truncate text-[16px] font-medium">{t.name}</span>
                    <span className="text-[16px] text-muted">{t.checklistItems.length} {t.checklistItems.length === 1 ? "step" : "steps"}{t.clientId ? ` · for ${firstName}` : ""}</span>
                  </button>
                ))}
              </div>
            </>)}
          </div>
        )}
        </span>
      </div>
      {progress.total > 0 && (
        <div className="mb-2 h-2 overflow-hidden rounded-[5px] bg-background"><div className="h-full rounded-[5px] bg-accent transition-all" style={{ width: `${progress.pct}%` }} /></div>
      )}
      <ol className="list-none rounded-[5px] border bg-surface shadow-soft">
        {steps.map(stepRow)}
        {asking && <li className={`px-4 py-3 ${steps.length ? "border-t" : ""}`}>{askingPanel}</li>}
        {clientItemsOf(null).length > 0 && <li className={`px-4 py-3 ${steps.length || asking ? "border-t" : ""}`}>{clientChangesList(clientItemsOf(null))}</li>}
        <li className={`px-3 py-2 ${steps.length || asking || (openStep || followUp) || clientChanges.length ? "border-t" : ""}`}>
          <input value={subDraft} onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { addStep(subDraft); setSubDraft(""); } }}
            placeholder="+ Add step" aria-label="Add a step"
            className="w-full rounded-md border border-transparent px-2 py-1.5 text-[16px] outline-none transition placeholder:text-accent hover:bg-background focus:border-accent focus:bg-background focus:placeholder:text-muted" />
        </li>
      </ol>
    </section>
  );
  const sortedAttachments = useMemo(() => [...task.attachments].sort((a, b) => {
    if (attSort === "name") return a.name.localeCompare(b.name);
    if (attSort === "type") return ATT_KIND_ORDER[a.kind] - ATT_KIND_ORDER[b.kind];
    return 0; // "added" — keep stored order (oldest first, matches how they were attached)
  }), [task.attachments, attSort]);
  const galleryTiles = [
    ...sortedAttachments.filter((a) => a.kind === "image").map((a) => ({ a, own: true })),
    ...conversationFiles.filter((a) => a.kind === "image").map((a) => ({ a, own: false })),
  ];
  // Each heading gets a small coloured icon tile, so the sections tell apart
  // at a glance without boxing the page in (Derek, 2026-10-11: "it's very
  // flat", mockup A).
  const HEAD_ICONS: Record<string, [React.ReactNode, string]> = {
    "Client work": [<I.clipboard key="i" className="h-4 w-4" />, "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"],
    List: [<I.list key="i" className="h-4 w-4" />, "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"],
    "In GoHighLevel": [<I.bolt key="i" className="h-4 w-4" />, "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"],
    "Links and files": [<I.clip key="i" className="h-4 w-4" />, "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"],
    "Where it lives": [<I.folder key="i" className="h-4 w-4" />, "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"],
  };
  const heading = (title: string, extra?: React.ReactNode) => (
    <h2 className="flex items-center gap-2 text-[16px] font-bold text-foreground">
      {HEAD_ICONS[title] && <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] ${HEAD_ICONS[title][1]}`}>{HEAD_ICONS[title][0]}</span>}
      {title}{extra}
    </h2>
  );
  const attachmentsBlock = (
    <div id="task-files" className="mt-8 rounded-[5px] border bg-surface p-4 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {heading("Links and files", task.attachments.length + conversationFiles.length > 0 && <span className="font-normal text-muted">· {task.attachments.length + conversationFiles.length}</span>)}
        <span className="flex items-center gap-3">
          {/* Sorting two things is not a job. It earns its place at five. */}
          {task.attachments.length >= 5 && (
            <select value={attSort} onChange={(e) => setAttSort(e.target.value as typeof attSort)} className="rounded-md border bg-background px-1.5 py-1 text-[16px] outline-none" title="Sort attachments">
              <option value="added">Sort: Added</option>
              <option value="name">Sort: Name</option>
              <option value="type">Sort: Type</option>
            </select>
          )}
          <button onClick={() => { setLinkOpen((o) => !o); setLinkTarget(null); }} className="inline-flex items-center gap-1 text-[16px] font-medium text-accent"><I.link /> Link</button>
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
        {task.attachments.length === 0 && conversationFiles.length === 0 && !uploadProgress && (<div className="col-span-full rounded-lg border border-dashed px-3 py-2 text-[16px] text-muted">Drop, paste, or click Attach · max 25MB each</div>)}
      </div>
      {/* Pictures as a gallery with no names, the task's own then the ones
          from the conversation (Derek, 2026-10-09: "same as in mail"). A
          click opens the lightbox; the name is on hover. */}
      {galleryTiles.length > 0 && (
        // Small tiles now the files sit in the wide column, not a 340px rail.
        <div className="mt-2 flex flex-wrap gap-2">
          {galleryTiles.map(({ a, own }) => (
            <div key={a.id} draggable={own && attSort === "added"} onDragStart={own ? () => setDragAttId(a.id) : undefined}
              onDragOver={own ? (e) => { if (!e.dataTransfer.types.includes("Files")) e.preventDefault(); } : undefined}
              onDrop={own ? (e) => { if (e.dataTransfer.types.includes("Files")) return; e.preventDefault(); reorderAttachments(a.id); } : undefined}
              className={`group relative h-28 overflow-hidden rounded-lg bg-background ring-1 ring-[var(--border)] hover:ring-2 hover:ring-accent ${dragAttId === a.id ? "opacity-40" : ""}`}>
              <button onClick={() => openPreview(a)} title={stepTitleHolding(attachmentKey(a.id)) ? `${a.name}, on ${stepTitleHolding(attachmentKey(a.id))}` : a.name} aria-label={`Preview ${a.name}`} className="block w-full">
                {a.path && attImageUrls[a.path]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={attImageUrls[a.path]} alt={a.name} className="block h-28 w-auto max-w-[240px] object-cover" />
                  : <span className="grid h-28 w-40 place-items-center text-muted">🖼️</span>}
              </button>
              <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                {a.path && <button onClick={() => onDownloadFileAs(a.path!, a.name)} title="Download" className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.download className="h-3.5 w-3.5" /></button>}
                {own
                  ? <button onClick={() => onRemoveFile(a)} title="Remove" className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-red-500"><I.trash className="h-3.5 w-3.5" /></button>
                  : <button onClick={() => attachToTask(a)} title="Keep it with the task's files" className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.plus className="h-3.5 w-3.5" /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Non-image attachments (docs, sheets, links) used to render as
          empty-looking AttachmentTile boxes with no real thumbnail to show
          — a compact link chip carries the same info (name, type, size)
          without pretending there's a preview. */}
      {/* One per row, not wrapped chips: a 90 character URL in an inline-flex
          chip either burst the card or wrapped into an unreadable block, and
          a full-width row can truncate cleanly with room for the buttons. */}
      {conversationFiles.some((a) => a.kind !== "image") && (
        <div className="mt-2 flex flex-col gap-1.5">
          {conversationFiles.filter((a) => a.kind !== "image").map((a) => (
            <button key={a.id} onClick={() => openPreview(a)} title={`Open ${a.name}`}
              className="flex min-w-0 items-center gap-1.5 rounded-[5px] border bg-background py-1 pl-2.5 pr-2 text-left text-[16px] font-medium text-accent hover:underline">
              <I.link className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 truncate">{a.name}</span><span className="shrink-0 font-normal text-muted">· from the conversation</span>
            </button>
          ))}
        </div>
      )}
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
                  {isLink ? <LinkFavicon url={a.url!} /> : <I.link className="h-3.5 w-3.5 shrink-0" />} <span className="min-w-0 [overflow-wrap:anywhere]">{a.name}</span>{a.size && <span className="shrink-0 font-normal text-muted"> · {a.size}</span>}{stepTitleHolding(attachmentKey(a.id)) && <span className="shrink-0 font-normal text-muted"> · on {stepTitleHolding(attachmentKey(a.id))}</span>}
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
    </div>
  );
  // The draft email line: shown whenever a draft exists, from Claude, the drafter
  // or the chip below. Sending goes through the same path as the composer.
  const draftEmailBlock = (
    <DraftEmail key={`email-${task.id}`} task={task} onPatch={onPatch} toEmail={replyPeerOf(task.draftEmail?.replyTo)?.email ?? (messageDest?.email || null)} messages={messages}
      onSend={hasMessaging ? (email) => {
        onSendTaskMessage!("email", email.subject, email.body, email.attachments.length ? email.attachments : undefined, email.cc, email.bcc, email.replyTo);
        // Sent from the step that holds it: that step is done, and checking in
        // waits three business days, finished by the client's reply.
        // The email to the client finishes the step working on the document:
        // the client's waiting step starts with the document and this email
        // on it (Derek, 2026-10-11: "the email and the document can live in
        // here").
        const reviewKind = activeStep && !activeStep.onClient && !isHandoffStep(activeStep, task.assigneeId)
          ? (["page", "image", "video", "doc"] as const).find((k) => activeStep.holds?.includes(k)) ?? null : null;
        if (activeStep && reviewKind) {
          const name = reviews[reviewKind]?.title?.trim() || (reviewKind === "doc" ? "the document" : "the review");
          const due = addBusinessDaysIso(TODAY, reviewFollowUpDays(1));
          const made = addClientReviewStep(task.subtasks, activeStep.id, firstName, name, reviewKind, due, () => newId("s_"));
          // The email that started it shows on the waiting step itself.
          const sentAt = new Date().toISOString();
          const list = made?.map((x) => (x.addedFor === `sent:${activeStep.id}` ? { ...x, emailedAt: sentAt } : x));
          if (list) {
            onPatch({ subtasks: list, status: "waiting", followUpAt: due });
            return;
          }
        }
        // The client's step is current: the email went to them for it.
        if (activeStep?.onClient) {
          const list = addEmailSentRecord(task.subtasks, activeStep.id, firstName, () => newId("s_"));
          if (list) onPatch({ subtasks: list });
          return;
        }
        const sentFrom = activeStep && activeStep.holds?.includes("email") ? activeStep : null;
        if (sentFrom) {
          const due = addBusinessDaysIso(TODAY, 3);
          const list = addCheckInStep(task.subtasks, sentFrom.id, firstName, due, () => newId("s_"));
          if (list) {
            if (openStep) setNextStepDone(openStep.id, true);
            const status = statusForStep(task.status, "waiting");
            onPatch({ subtasks: list, ...(status ? { status } : {}) });
            setNewStep(`Check in if ${firstName} hasn't replied`, due, "reply");
            return;
          }
        }
        // Sent and waiting on them: the follow up date is when they get a
        // reminder (Derek, 2026-10-07: "send and move the follow up, seamless").
        // A due date inside that window already brings it back: no follow up then.
        if (email.followUpDays && task.status !== "done") {
          const checkBack = addBusinessDaysIso(TODAY, email.followUpDays);
          onPatch({ status: "waiting", followUpAt: task.due && task.due <= checkBack ? null : checkBack });
        }
        setPendingNextStep({ kind: "email", body: htmlToText(email.body).trim() });
      } : undefined}
      onSchedule={hasMessaging && onScheduleTaskMessage ? (email, whenIso) =>
        onScheduleTaskMessage("email", email.subject, email.body, whenIso, email.attachments.length ? email.attachments : undefined, email.cc, email.bcc, email.replyTo) : undefined}
      onUpload={onUploadMessageImage} ccContacts={ccContacts}
      openNonce={emailOpenNonce} startOpen={openEmail} pushToast={pushToast}
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
    // Its email sits on the step that made the review (addClientReviewStep
    // puts it there when the client's step starts): no second write of the list
    // here, which could carry an older copy over the new step.
    setEmailOpenNonce((n) => n + 1);
    return true;
  };
  // Image and web page reviews (Derek, 2026-09-12): the same line and window as the
  // client document. Each has its own key, apart from the lines beside it; below
  // startReviewEmail so they never read it before it exists.
  const reviewBlock = (kind: FileKind, onCurrentStep = false) => !canHaveDocument ? null : (
    <TaskDocument key={`${kind}-${task.id}`} kind={kind} task={task} onPatch={onPatch} pushToast={pushToast} canAdmin={!!canAdmin} meId={meId} onSent={followUpOnReview} onReminders={reportReminders(kind)}
      onEmailClient={startReviewEmail}
      startNonce={reviewStartNonce[kind]} showOpenComments={onCurrentStep} onStage={reportStage(kind)}
      onPresence={(exists) => setReviewPresence((p) => {
        const kinds = p.taskId === task.id ? p.kinds : [];
        if (p.taskId === task.id && kinds.includes(kind) === exists) return p;
        return { taskId: task.id, kinds: exists ? [...kinds, kind] : kinds.filter((k) => k !== kind) };
      })} />
  );
  // Everything a task can gain, in one menu beside Deliverables. It was a row
  // of up to seven dashed buttons, wrapping two by two in the rail.
  const addMenu = (
    <ActionMenu label={<span className="inline-flex items-center gap-1.5"><I.plus /> Add</span>} title="Add to this task" items={[
      !hasDescription && { label: "Description", onClick: () => setDescEditing(true) },
      canHaveDocument && !showDocument && { label: "Client document", onClick: () => setDocStartNonce((n) => n + 1) },
      canHaveDocument && !showBrief && { label: "Project instructions", onClick: () => setBriefStartNonce((n) => n + 1) },
      ...(canHaveDocument ? REVIEW_LINES.filter((l) => !hasReview(l.kind)).map((l) => ({ label: l.label, onClick: () => setReviewStartNonce((s) => ({ ...s, [l.kind]: s[l.kind] + 1 })) })) : []),
      hasMessaging && !task.draftEmail && { label: "Draft email", onClick: () => startDraftEmail() },
      { label: "Link", onClick: () => { setLinkOpen(true); document.getElementById("task-files")?.scrollIntoView({ behavior: "smooth", block: "center" }); } },
      { label: "File", onClick: () => fileRef.current?.click() },
    ]} />
  );
  // ── What a step holds (phase 4, Derek: "steps with deliverables and
  // assets"). A deliverable or a link or file sits on one step at most; each
  // deliverable block is drawn once, on its step or under Deliverables.
  const DELIVERABLE_KEYS: DeliverableKey[] = ["doc", "brief", "image", "page", "video", "email"];
  const KIND_LABEL: Record<DeliverableKey, string> = { doc: "Client document", image: "Image review", page: "HTML review", video: "Video review", brief: "Project instructions", email: "Draft email" };
  const deliverableBlock = (key: DeliverableKey, onCurrentStep: boolean) =>
    key === "doc" ? documentBlock(onCurrentStep) : key === "brief" ? briefBlock : key === "email" ? draftEmailBlock : reviewBlock(key, onCurrentStep);
  const deliverablePresent = (key: DeliverableKey) =>
    key === "doc" ? showDocument : key === "brief" ? showBrief : key === "email" ? !!task.draftEmail : hasReview(key);
  const deliverableName = (key: DeliverableKey) =>
    key === "brief" ? "Project instructions"
    : key === "email" ? (task.draftEmail?.subject?.trim() || "Draft email")
    : reviews[key]?.title?.trim() || (key === "doc" ? "Client document" : REVIEW_LINES.find((l) => l.kind === key)?.label ?? key);
  // Client work lives here, all of it, wherever its step is (Derek,
  // 2026-10-11: "bring it down below so we can get to it easily"). Each block
  // is drawn once, here; a step's page lists what is on it with Open.
  const anyWork = DELIVERABLE_KEYS.some(deliverablePresent);
  const workBlocks = DELIVERABLE_KEYS.map((k) => {
    const on = deliverablePresent(k) ? homeOf(stepHolding(steps, k)) : null;
    return (
      <div key={k}>
        {on && <div className="mt-3 -mb-2 text-[16px] text-muted">On <span className="font-medium text-foreground">{on.title}</span></div>}
        {deliverableBlock(k, !!on && on.id === activeStep?.id)}
      </div>
    );
  });
  // Opens a piece of client work's own window from anywhere (a step's page).
  const openWork = (k: DeliverableKey) => {
    if (k === "doc") setDocStartNonce((n) => n + 1);
    else if (k === "brief") setBriefStartNonce((n) => n + 1);
    else if (k === "email") setEmailOpenNonce((n) => n + 1);
    else setReviewStartNonce((r) => ({ ...r, [k]: r[k] + 1 }));
  };
  const holdKey = (stepId: string, key: string) => onPatch({ subtasks: holdOnStep(taskRef.current.subtasks, stepId, key) });
  const releaseKey = (key: string) => onPatch({ subtasks: releaseFromSteps(taskRef.current.subtasks, key) });
  // A deliverable made from a step's menu goes on the step first; it is told
  // to start once it has moved there (a block that mounts ignores a start it
  // was already holding).
  const [pendingStart, setPendingStart] = useState<DeliverableKey | null>(null);
  useEffect(() => {
    if (!pendingStart || !stepHolding(task.subtasks, pendingStart)) return;
    const k = pendingStart;
    setPendingStart(null);
    if (k === "doc") setDocStartNonce((n) => n + 1);
    else if (k === "brief") setBriefStartNonce((n) => n + 1);
    else if (k === "email") startDraftEmail();
    else setReviewStartNonce((r) => ({ ...r, [k]: r[k] + 1 }));
  }, [pendingStart, task.subtasks]); // eslint-disable-line react-hooks/exhaustive-deps
  // Files uploaded from a step's menu land on that step once they arrive.
  const [fileTarget, setFileTarget] = useState<{ stepId: string; before: string[] } | null>(null);
  useEffect(() => {
    if (!fileTarget || uploadProgress) return;
    const fresh = task.attachments.filter((a) => !fileTarget.before.includes(a.id));
    if (!fresh.length) return;
    let list = task.subtasks;
    for (const a of fresh) list = holdOnStep(list, fileTarget.stepId, attachmentKey(a.id));
    setFileTarget(null);
    onPatch({ subtasks: list });
  }, [task.attachments, uploadProgress]); // eslint-disable-line react-hooks/exhaustive-deps
  // The step whose own page is open, and whether full page (Derek: a slide
  // out to look quickly, full page to work in, like a handoff).
  const [openStepPage, setOpenStepPage] = useState<{ taskId: string; id: string; full: boolean } | null>(null);
  const pageStepId = openStepPage?.taskId === task.id ? openStepPage.id : null;
  // What "Add client work" offers on a step's page (Derek, 2026-10-11):
  // a document or review, made or moved here, and an email drafted on it.
  const stepAddOptions = (sub: Subtask) => {
    const holds = sub.holds ?? [];
    const pick = (key: DeliverableKey) => {
      if (deliverablePresent(key)) { holdKey(sub.id, key); return; }
      holdKey(sub.id, key);
      setPendingStart(key);
    };
    const kinds: { key: DeliverableKey; label: string }[] = [
      ...(canHaveDocument ? [{ key: "doc" as const, label: "Document" }, { key: "image" as const, label: "Image" }, { key: "page" as const, label: "HTML" }, { key: "video" as const, label: "Video" }] : []),
      ...(hasMessaging ? [{ key: "email" as const, label: "Send email" }] : []),
    ];
    return kinds.map((x) => {
      const here = holds.includes(x.key);
      const on = !here && deliverablePresent(x.key) ? stepTitleHolding(x.key) : null;
      return { key: x.key, label: x.label, disabled: here, onPick: () => pick(x.key),
        note: here ? "on this step" : deliverablePresent(x.key) ? (on ? `move from ${on.length > 14 ? `${on.slice(0, 14)}…` : on}` : "move here") : undefined };
    });
  };
  // What a step holds, drawn on it: its deliverables as their own rows (the
  // current step's reviews with their open comments), then its links and files.
  // A step's needs, and which of them what it holds already meets.
  const heldLabels = (sub: Subtask) => (sub.holds ?? []).flatMap((k) => {
    if (k.startsWith("att:")) { const a = task.attachments.find((x) => attachmentKey(x.id) === k); return a ? [a.name] : []; }
    const d = k as DeliverableKey;
    return [KIND_LABEL[d], deliverableName(d)];
  });
  const missingNeeds = (sub: Subtask) => (sub.needs ?? []).filter((n) => !needMet(n, heldLabels(sub)));
  // What a plan's step makes, one click away on it, and what it needs.
  const stepPlanBits = (sub: Subtask, isActive: boolean) => {
    const makes = sub.makes && !(sub.holds ?? []).includes(sub.makes) && (sub.makes === "email" ? hasMessaging : canHaveDocument) ? sub.makes : null;
    const needs = sub.needs ?? [];
    // "Send to Brian again": the review is back on this step; open it to send.
    const sendAgain = isActive && sub.makes && (sub.holds ?? []).includes(sub.makes) && sub.makes !== "email" && sub.makes !== "brief" ? sub.makes : null;
    if ((!makes || !isActive) && !needs.length && !sendAgain) return null;
    const held = heldLabels(sub);
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[16px]">
        {sendAgain && (
          <button onClick={() => (sendAgain === "doc" ? setDocStartNonce((n) => n + 1) : setReviewStartNonce((r) => ({ ...r, [sendAgain]: r[sendAgain as FileKind] + 1 })))}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 font-semibold text-white hover:opacity-90">Send to {firstName} again</button>
        )}
        {makes && isActive && (deliverablePresent(makes)
          ? <button onClick={() => holdKey(sub.id, makes)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-surface px-3 font-medium text-accent hover:bg-background"><I.plus className="h-4 w-4" /> Put {deliverableName(makes)} here</button>
          : <button onClick={() => { holdKey(sub.id, makes); setPendingStart(makes); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-surface px-3 font-medium text-accent hover:bg-background"><I.plus className="h-4 w-4" /> Make the {KIND_LABEL[makes].toLowerCase()}</button>)}
        {needs.length > 0 && (
          <span className={isActive ? "" : "text-muted"}>
            Needs:{" "}
            {needs.map((n, i) => {
              const ok = needMet(n, held);
              return <span key={n}>{i > 0 && ", "}<span className={ok ? "text-success" : isActive ? "font-medium" : ""}>{ok ? "✓ " : ""}{n}</span></span>;
            })}
          </span>
        )}
      </div>
    );
  };
  // Client work on a step sorts by dragging its grip (Derek, 2026-10-11):
  // the order is the step's own list, documents, reviews, links and files.
  const [dragHeld, setDragHeld] = useState<{ stepId: string; key: string; grabbed: boolean } | null>(null);
  const [dropHeld, setDropHeld] = useState<string | null>(null);
  const moveHeld = (sub: Subtask, from: string, to: string) => {
    const list = [...(sub.holds ?? [])];
    const i = list.indexOf(from), j = list.indexOf(to);
    if (i < 0 || j < 0 || i === j) return;
    list.splice(i, 1);
    list.splice(j, 0, from);
    onPatchSub(sub.id, { holds: list });
  };
  const stepHeld = (sub: Subtask) => {
    const keys = (sub.holds ?? []).filter((k) =>
      (DELIVERABLE_KEYS as string[]).includes(k) || (k.startsWith("att:") && task.attachments.some((a) => attachmentKey(a.id) === k)));
    if (!keys.length) return null;
    const sortable = keys.length > 1;
    return (
      <div className="flex flex-col gap-2">
        {keys.map((k) => {
          const a = k.startsWith("att:") ? task.attachments.find((x) => attachmentKey(x.id) === k)! : null;
          const dragging = dragHeld?.stepId === sub.id && dragHeld.key === k;
          return (
            <div key={k} draggable={dragging && dragHeld?.grabbed}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); }}
              onDragEnd={() => { setDragHeld(null); setDropHeld(null); }}
              onDragOver={(e) => { if (dragHeld?.stepId === sub.id && dragHeld.key !== k) { e.preventDefault(); setDropHeld(k); } }}
              onDrop={(e) => { if (dragHeld?.stepId !== sub.id) return; e.preventDefault(); moveHeld(sub, dragHeld.key, k); setDragHeld(null); setDropHeld(null); }}
              className={`group/held flex items-center gap-1.5 rounded-[5px] ${dropHeld === k ? "ring-2 ring-accent/50" : ""} ${dragging && dragHeld?.grabbed ? "opacity-50" : ""}`}>
              {sortable && (
                <span onMouseDown={() => setDragHeld({ stepId: sub.id, key: k, grabbed: true })} onMouseUp={() => setDragHeld(null)} title="Drag to sort" aria-hidden
                  className="hidden w-5 shrink-0 cursor-grab select-none text-center text-[16px] text-muted opacity-40 group-hover/held:opacity-100 active:cursor-grabbing sm:block">⋮⋮</span>
              )}
              <div className="min-w-0 flex-1">
                {a ? (
                  <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[5px] border bg-background py-1 pl-2.5 pr-1 text-[16px]">
                    {a.url
                      ? <a href={a.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 font-medium text-accent hover:underline"><LinkFavicon url={a.url} /><span className="truncate">{a.name}</span></a>
                      : <button onClick={() => (a.kind === "image" ? openPreview(a) : a.path && onDownloadFile(a.path))} className="flex min-w-0 items-center gap-1.5 font-medium text-accent hover:underline"><I.clip className="h-4 w-4 shrink-0" /><span className="truncate">{a.name}</span></button>}
                    <button onClick={() => releaseKey(k)} title="Take off this step (it stays on the task)" aria-label={`Take ${a.name} off this step`}
                      className="shrink-0 rounded px-1 text-muted hover:text-danger">×</button>
                  </span>
                ) : (() => {
                  const d = k as DeliverableKey;
                  if (!deliverablePresent(d)) return null;
                  const r = d === "doc" || d === "image" || d === "page" || d === "video" ? reviews[d] : null;
                  return (
                    <span className="flex min-w-0 items-center gap-3 rounded-[5px] border bg-surface px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-semibold">{deliverableName(d)}</span>
                        <span className="block text-[16px] text-muted">{KIND_LABEL[d]}{r ? ` · ${r.status === "with_client" ? "With the client" : r.status === "client_submitted" ? "Changes sent" : r.status === "approved" ? "Approved" : r.status === "completed" ? "Completed" : "Draft"}` : ""}</span>
                      </span>
                      <button onClick={() => openWork(d)} className="h-9 shrink-0 rounded-lg border px-4 text-[16px] font-semibold hover:bg-background">Open</button>
                      <button onClick={() => releaseKey(d)} title="Take off this step (it stays under Client work)" aria-label={`Take ${deliverableName(d)} off this step`}
                        className="shrink-0 rounded px-1 text-muted hover:text-danger">×</button>
                    </span>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    );
  };
  // The embedded sibling-task list used to live here — deleted (item 4):
  // the "N of M" pager (onPrev/onNext below) already does the same job of
  // moving between tasks in this list, without duplicating a whole list
  // view inside the drawer.
  // Every task a client owns has the same two columns. There used to be a
  // "light" layout for a task with no linked contact and no comments, which is
  // what made a task in a project look unlike a client's (Derek, 2026-09-20).
  // The rail is not only messaging, so hiding all of it was wrong: it carries
  // the client, Links and files, and the client, project and contact selects,
  // and the parts that do need a contact already hide themselves. Worse, the
  // test read task.comments.length, so writing the first note flipped the task
  // into the other layout underneath you.
  //
  // A personal to do is the one case that genuinely has no rail to show: there
  // is no client behind it, so the rail came out empty (Derek, 2026-09-20: "the
  // rail is empty on personal tasks"). It keeps the single column, and unlike
  // the old rule this one cannot change while you work: a task is personal or
  // it is not, and nothing you do in here moves it between the two.
  const isPersonal = task.clientId === PERSONAL_CLIENT_ID;

  const section = (title: string, children: React.ReactNode, right?: React.ReactNode) => (
    <section className="mt-8" id={title === "Client work" ? "task-deliverables" : undefined}>
      <div className="mb-3 flex items-center justify-between gap-3">
        {heading(title)}
        {right}
      </div>
      {children}
    </section>
  );

  // The task in reading order: what it is, when we follow up, what has been
  // made for it, then everything said and done about it. The description is
  // the last tab of that feed rather than a section above the deliverables
  // (Derek, 2026-09-30: "it's kind of getting in the way there. We can move
  // the deliverables up").
  // ── Slid over the Inbox (Derek, 2026-10-01, mockup
  // https://claude.ai/artifact/1TH5ReGvyZ6r4TvadyTrEG): one column. The client
  // rail folds into a row of chips, and the header is back, full page, more, close.
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

  // ── Top bar (task detail redesign, 2026-10-11). Left: the client, which
  // opens the client panel; the list; a small arrow to move the task or
  // rename the list; then the client actions as icons. It replaces the client
  // column, the quick link chips and "Where it lives".
  const [topPanel, setTopPanel] = useState<"client" | "move" | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  // The dock opens in Chat, Text or Call from here; n changes to ask again.
  const [dockRequest, setDockRequest] = useState<{ mode: "note" | "chat" | "sms" | "call"; text?: string; n: number } | null>(null);
  const askDock = (mode: "note" | "chat" | "sms" | "call", text?: string) => setDockRequest((r) => ({ mode, text, n: (r?.n ?? 0) + 1 }));
  const topIcon = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-accent transition hover:bg-background disabled:cursor-not-allowed disabled:text-muted disabled:opacity-50";
  const popover = (children: React.ReactNode, wide = false) => (<>
    <div className="fixed inset-0 z-30" onClick={() => setTopPanel(null)} />
    <div className={`absolute left-0 top-full z-40 mt-1 ${wide ? "w-[min(380px,calc(100vw-32px))]" : "w-[min(320px,calc(100vw-32px))]"} rounded-lg border bg-surface text-left text-[16px] text-foreground shadow-lg`}>{children}</div>
  </>);
  const panelContact = (() => {
    const ct = contactById(task.contactId) || linkedContactInfo || contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId);
    // Hidden when it only repeats the client's name (Derek, 2026-10-11).
    return ct && ct.name.trim().toLowerCase() !== client.name.trim().toLowerCase() ? ct : null;
  })();
  // The client panel: All tasks first, then what the client column held.
  // "Contact: Open" is gone, it went to the same page as Open in GHL.
  const clientPanel = popover(
    <>
      <div className="flex items-center gap-3 px-4 py-3">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white" style={{ background: client.color }}>{initialsOf(client.name)}</span>
        <span className="min-w-0 flex-1 truncate text-[19px] font-bold">{client.name}</span>
        <button onClick={() => { setTopPanel(null); onOpenClientList(); }} className="min-h-11 shrink-0 font-semibold text-accent hover:underline">All tasks</button>
      </div>
      {panelContact && (
        <div className="flex items-center gap-2 border-t px-4 py-3"><span className="w-28 shrink-0 text-muted">Contact</span><span className="min-w-0 truncate font-medium">{panelContact.name}</span></div>
      )}
      {!!clientLinks?.length && (
        <div className="border-t px-4 py-3">
          <div className="mb-1 font-bold">Saved links</div>
          <QuickLinksBar inline links={clientLinks} canEdit={false} onEdit={() => {}} onDelete={() => {}} onReorder={() => {}} />
        </div>
      )}
      {linkedContactInfo?.ghlContactId && (
        <div className="space-y-2.5 border-t px-4 py-3">
          <div className="font-bold">In GoHighLevel</div>
          {saasRow}
          {canAdmin && client.id.startsWith("cl_") && saasUrl && <ClientGhlKey clientId={client.id} saasUrl={saasUrl} pushToast={pushToast} />}
        </div>
      )}
    </>, true);
  // Move to another client or list, and rename the list ("Where it lives").
  const movePanel = popover(
    <div className="space-y-3 p-3">
      <dl className="space-y-3">
        {/* Type-to-filter rather than a plain select: this list is every client
            on the account, far past where scrolling a native dropdown is fast. */}
        <Row label="Client" icon={<I.folder />}><SearchableSelect value={task.clientId} onChange={onMoveClient} options={clientSelectOptions} searchPlaceholder="Search clients…" className="w-full rounded-md border border-transparent px-2 py-1 text-[16px] transition hover:border-border hover:bg-background" /></Row>
        <Row label="List" icon={<I.list />}>
          <select value={task.projectId} onChange={(e) => { if (e.target.value === "__new") onNewProject(); else onSetProject(e.target.value); }} aria-label="List"
            className="w-full rounded-md border border-transparent px-2 py-1 text-[16px] outline-none transition hover:border-border hover:bg-background focus:border-accent focus:bg-background">
            {[...clientProjects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            {clientProjects.every((p) => p.id !== task.projectId) && <option value={task.projectId}>{project?.name ?? "List"}</option>}
            <option value="__new">+ New list…</option>
          </select>
        </Row>
      </dl>
      <button onClick={() => { setTopPanel(null); onRenameProject(); }} className="min-h-10 w-full rounded-md px-2 text-left font-medium text-accent hover:bg-background">Rename this list</button>
    </div>);
  const phone = messageDest?.phone && mayContactClient ? messageDest.phone : null;
  const canBook = mayContactClient && !!messageDest?.ghlContactId;
  // GHL and Client link, then the ways to reach the client. Chat and Email
  // always stand beside the phone menu, never behind it: the team wants chat
  // and email used more than calls and texts (Derek, 2026-10-11).
  const clientActions = isPersonal ? null : (
    <div role="group" aria-label="Client actions" className="flex flex-wrap items-center gap-0.5 sm:border-l sm:pl-2.5">
      {ghlContactUrl && mayContactClient && (
        <a href={ghlContactUrl} target="_blank" rel="noopener noreferrer" title="Open in GHL" aria-label="Open in GHL" className={topIcon}><I.bolt className="h-[18px] w-[18px]" /></a>
      )}
      {onCopyClientLink && <button onClick={onCopyClientLink} title="Copy the client link" aria-label="Copy the client link" className={topIcon}><I.link className="h-5 w-5" /></button>}
      {hasMessaging && (<>
        <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
        <button onClick={() => askDock("chat")} title="Chat" aria-label="Chat" className={topIcon}><I.chatBubbles className="h-5 w-5" /></button>
        <button onClick={() => startDraftEmail()} disabled={!messageDest?.email} title={messageDest?.email ? `Email ${messageDest.email}` : "No email on file"} aria-label="Email" className={topIcon}><I.mail className="h-5 w-5" /></button>
        <ActionMenu title={phone ? "Call or text" : "No phone on file"} triggerClassName="inline-flex h-10 shrink-0 items-center gap-0.5 rounded-lg pl-2.5 pr-1 text-accent transition hover:bg-background"
          label={<><I.phone className="h-[18px] w-[18px]" /><I.chevron className="h-3.5 w-3.5 -rotate-90" /></>}
          items={[
            { label: "Call", onClick: () => askDock("call"), disabled: !phone },
            { label: "Text", onClick: () => askDock("sms"), disabled: !phone },
          ]} />
        {canBook && <button onClick={() => setBookOpen(true)} title="Book" aria-label="Book" className={topIcon}><I.calendar className="h-5 w-5" /></button>}
      </>)}
    </div>
  );
  const topLeft = (<>
    <nav aria-label="Where this task lives" className="flex min-w-0 max-w-full items-center gap-1.5">
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: client.color }} />
      <span className="relative min-w-0">
        <button onClick={() => setTopPanel((t) => (t === "client" ? null : "client"))} aria-expanded={topPanel === "client"} title={`About ${client.name}`}
          className="block max-w-[24rem] truncate rounded px-1 font-semibold text-foreground hover:bg-background hover:underline">{client.name}</button>
        {topPanel === "client" && clientPanel}
      </span>
      <span className="shrink-0">/</span>
      <span className="min-w-0 truncate">{project.name}</span>
      <span className="relative shrink-0">
        <button onClick={() => setTopPanel((t) => (t === "move" ? null : "move"))} aria-expanded={topPanel === "move"} title="Move to another client or list" aria-label="Move to another client or list"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-background hover:text-foreground"><I.chevron className="h-4 w-4 -rotate-90" /></button>
        {topPanel === "move" && movePanel}
      </span>
    </nav>
    {clientActions}
  </>);
  // Over the Inbox the header is narrow, so the client, list and client
  // actions sit on their own row under it (2026-10-11, the move arrow there too).
  const slideContext = <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[16px] text-muted">{topLeft}</div>;
  const slideHeader = (
    <div className="flex items-center gap-1 border-b px-3 py-2 text-[16px] text-muted">
      <button onClick={onClose} title="Back (Esc)" className="min-w-0 truncate rounded-lg px-2 py-1.5 font-semibold hover:bg-background hover:text-foreground">← {slideBackLabel || "Inbox"}</button>
      <span className="flex-1" />
      <button onClick={onToggleFull} title="Open the task on its own page" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 font-semibold hover:bg-background hover:text-foreground">⤢<span className="hidden sm:inline"> Open full page</span></button>
      <button onClick={copyForClaude} title="Copy for Claude" aria-label="Copy for Claude" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[18px] hover:bg-background hover:text-foreground"><span aria-hidden>✳</span></button>
      <div className="relative">
      <ActionMenu label={<I.dots />} title="More actions" triggerClassName="rounded-lg p-2 text-muted transition hover:bg-background hover:text-foreground" items={[
        { label: "Labels", onClick: () => setLabelOpen(true) },
        { label: "Copy link to task", onClick: onCopyLink },
        { label: "Duplicate here", onClick: () => onDuplicate() },
        task.priority === "conversation" && { label: "Merge into a task", onClick: onOpenMerge },
        { label: "Delete task", onClick: onDelete, danger: true },
      ]} />
      {labelPicker}
      </div>
      <button onClick={onClose} title="Close" aria-label="Close" className="rounded-lg p-2 text-muted transition hover:bg-background hover:text-foreground"><I.close /></button>
    </div>
  );

  const mainColumn = (
    <>
      {slideOver && !full && slideContext}
      {/* A plain title area, as in the mockup (Derek, 2026-10-11: remove the
          client colour tint; the dot in the top bar says whose task it is). */}
      <div>
        {titleRow}
        {subMeta}
        {detailsSentence}
        {chipRow}
        <div className="mt-1.5">{descriptionBlock}</div>
      </div>
      {renderPlan()}
      {clientResponseBlock}
      {/* Deliverables on no step (Derek: they may sit outside a step). With
          steps and nothing loose, there is no section, but the blocks stay
          mounted so they can say whether they exist. */}
      {section("Client work", (
        <>
          {workBlocks}
          {!anyWork && (
            <p className="rounded-[5px] border border-dashed px-4 py-3 text-[16px] text-muted">{steps.length ? "Client documents, reviews and draft emails show here. Add them from a step's page." : "Client documents, reviews and draft emails show here."}</p>
          )}
        </>
      ), addMenu)}
      {/* Links and files under the checklist, for every task: the client
          column that held them is gone (task detail redesign, 2026-10-11). */}
      {attachmentsBlock}
      <section className="mt-7">
        {/* The composer the floating dock opens for a text, chat or note. */}
        {composerFooter}
        <div className="mt-6">{feedArea}</div>
      </section>
    </>
  );

  const iconButton = "rounded-lg p-2 text-muted transition hover:bg-background hover:text-foreground disabled:opacity-30";
  const headerBar = (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-2 text-[16px] text-muted">
          {topLeft}
          <div className="ml-auto flex items-center gap-1">
            {navTotal > 1 && (
              <div className="mr-1 flex items-center">
                <button onClick={onPrev} disabled={navIndex <= 0} title="Previous task (k)" aria-label="Previous task" className={iconButton}><I.chevron className="rotate-90" /></button>
                <span className="min-w-[64px] text-center tabular-nums">{navIndex + 1} of {navTotal}</span>
                <button onClick={onNext} disabled={navIndex < 0 || navIndex >= navTotal - 1} title="Next task (j)" aria-label="Next task" className={iconButton}><I.chevron className="-rotate-90" /></button>
              </div>
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
                { label: "Labels", onClick: () => setLabelOpen(true) },
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
              {labelPicker}
            </div>
            <button onClick={onClose} title="Close" aria-label="Close" className={iconButton}><I.close /></button>
          </div>
        </div>
  );
  return (
    <>
      <div className={`fixed inset-0 ${full ? "z-40 bg-black/20" : slideOver ? "z-40 bg-black/30 backdrop-blur-[1.5px]" : "z-10 bg-black/20"}`} onClick={onClose} />
      {/* Docked mode spans everything from the sidebar's right edge to the
          window's (Derek, 2026-08-26). --drawer-left is set by Cockpit and
          follows the sidebar; below md the sidebar is an overlay, so the
          drawer is full width. */}
      <aside onPaste={handlePaste} {...drawerDropProps}
        className={`${full ? "fixed inset-0 z-50 flex flex-col bg-surface" : slideOver ? "inbox-slide fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden bg-surface shadow-[-24px_0_48px_rgba(15,23,42,.18)] md:w-[clamp(560px,52vw,820px)] md:rounded-l-2xl" : "fixed inset-y-0 right-0 z-20 flex w-full flex-col border-l bg-surface shadow-xl md:left-[var(--drawer-left,16rem)] md:w-auto"}`}>
        {hiddenFileInput}
        <div className="hidden sm:block">{slideOver && !full ? slideHeader : headerBar}</div>

        {/* One scroll container and one column, 1280px at most, in every mode
            (task detail redesign, 2026-10-11: the client column is gone). */}
        <div className="flex flex-1 flex-col overflow-y-auto bg-surface">
          {/* All white, no boxed in sheet (Derek, 2026-09-16: "I don't like it
              boxed in so just make it all white"). */}
          <div className="min-w-0 flex-1 pb-32 sm:px-5 sm:pt-5">
            <div className="sm:hidden">{slideOver && !full ? slideHeader : headerBar}</div>
            <div className="px-2 pt-3 sm:px-0 sm:pt-0">
            <div className="mx-auto w-full max-w-[1280px] px-4 py-4 sm:px-10 sm:py-5">
              {mainColumn}
            </div>
            </div>
          </div>
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
          const ps = pageStepId ? task.subtasks.find((x) => x.id === pageStepId) : null;
          if (!ps || !openStepPage) return null;
          const isCur = activeStep?.id === ps.id;
          const at = steps.findIndex((x) => x.id === ps.id);
          const go = (x?: Subtask) => x ? () => setOpenStepPage((o) => (o ? { ...o, id: x.id } : o)) : undefined;
          return (
            <StepPage task={task} sub={ps} key={ps.id}
              stepNo={at >= 0 ? { at: at + 1, total: steps.length } : undefined}
              onPrev={at > 0 ? go(steps[at - 1]) : undefined} onNext={at >= 0 && at < steps.length - 1 ? go(steps[at + 1]) : undefined} client={client} stage={stepStage(ps, task.assigneeId)} isCurrent={isCur} full={openStepPage.full}
              onToggleFull={() => setOpenStepPage((o) => (o ? { ...o, full: !o.full } : o))} onClose={() => setOpenStepPage(null)}
              onRename={(t) => onRenameSub(ps.id, t)} onPatchSub={(patch) => onPatchSub(ps.id, patch)}
              onMarkDone={() => completeStep(ps.id)} onReopen={() => onToggleSub(ps.id)}
              onDelete={() => { setOpenStepPage(null); onDeleteSub(ps.id); }}
              controls={stepControls(ps, isCur)}
              addOptions={stepAddOptions(ps)}
              canText={!!messageDest?.phone && !!onSendTaskMessage}
              onSendText={onSendTaskMessage ? (body) => onSendTaskMessage("sms", "", body) : undefined}
              followBox={isCur && canNudge ? (
                <div className="flex flex-wrap items-center gap-2.5 rounded-[5px] bg-danger-soft px-3 py-2 text-[16px] font-medium text-danger">
                  <span className="min-w-0 flex-1">{watch?.kind === "approved" ? `${firstName} hasn't approved yet` : `${firstName} hasn't replied`} · {nudgeDays} {nudgeDays === 1 ? "day" : "days"}</span>
                  <button onClick={nudge} className="rounded-[5px] bg-surface px-3 py-1.5 font-semibold text-foreground ring-1 ring-border hover:ring-accent">Nudge {firstName}</button>
                </div>
              ) : undefined}
              planBits={!ps.done ? stepPlanBits(ps, isCur) : undefined}
              held={ps.onClient ? undefined : stepHeld(withSentHolds(ps)) ?? undefined}
              handoff={isHandoffStep(ps, task.assigneeId) && !ps.done ? handoffDetails(ps) : undefined}
              messages={messages ?? []} actions={actions}
              canChat={hasMessaging && !!onSendTaskMessage}
              onSendChat={onSendTaskMessage ? (body) => onSendTaskMessage("chat", "", body) : undefined}
              onAddNote={(body) => logAction({ id: newId("ta_"), taskId: task.id, kind: "note", authorId: meId ?? null, toId: null, parentId: null,
                body, at: new Date().toISOString(), nextStep: null, nextStepDue: null, nextStepDoneAt: null })}
              clientItems={clientItemsOf(ps.id)} onToggleClientItem={onToggleSub}
              // A to-do that was the client's comment: the comment is done on the review too.
              onTodoDone={(t) => { const k = reviewOnStep(ps); if (k && t.commentId) void docApi(task.id, k, "/comments", { method: "PATCH", body: JSON.stringify({ commentId: t.commentId, done: true }) }); }} />
          );
        })()}
        {(() => {
          const hs = openHandoff ? task.subtasks.find((x) => x.id === openHandoff && !!x.assigneeId) : null;
          return hs ? (
            <HandoffPage task={task} sub={hs} meId={meId} clientLinks={clientLinks} link={handoffLink(taskLink?.() ?? `?task=${task.id}`, hs.id)}
              onPatchSub={onPatchSub} onToggleSub={onToggleSub} onClose={() => setOpenHandoff(null)}
              onOpenFile={(att) => { if (att.url) window.open(att.url, "_blank", "noopener,noreferrer"); else void openPreview(att); }}
              onSendDm={onSendDm} pushToast={pushToast} onPatchTask={onPatch} canAdmin={!!canAdmin} />
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
          onSendDm={onSendDm}
          // The delegate box takes only who, what to call it and when it is
          // due; everything else about the handoff is written on its own page,
          // so delegating opens it rather than asking for it all up front.
          onDelegate={onDelegate ? (spec) => { const id = onDelegate(spec); if (id) setOpenHandoff(id); return id; } : undefined}
          taskLink={taskLink}
          askNextStepFor={pendingNextStep}
          onSendMessage={onSendTaskMessage ? (channel, body, replyToId) => {
            onSendTaskMessage(channel, "", body, undefined, undefined, undefined, replyToId);
            setPendingNextStep({ kind: channel, body });
          } : undefined}
          reachable={{ chat: hasMessaging, sms: !!messageDest?.phone, email: !!messageDest?.email }}
          replyTarget={replyTarget}
          openRequest={dockRequest}
          onBook={canBook ? () => setBookOpen(true) : undefined}
          onAskNextStepHandled={() => setPendingNextStep(null)}
          pushToast={pushToast}
          bar={!!slideOver && !full}
        />
      {bookOpen && messageDest?.ghlContactId && (
        <BookAppointment target={{ kind: "book", ghlContactId: messageDest.ghlContactId, name: messageDest.name || client.name }}
          meId={meId} onClose={() => setBookOpen(false)} onDone={() => {}} pushToast={(m) => pushToast(m)} />
      )}
      {lightbox !== null && galleryImages[lightbox] && (
        <ImageLightbox images={galleryImages} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)}
          onDownload={(img) => onDownloadFileAs(img.id, img.name)} />
      )}
      </aside>
    </>
  );
}
