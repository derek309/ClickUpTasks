"use client";

// Project instructions on a task (supabase/task-briefs.sql, src/lib/briefServer.ts):
// what the team writes for an outside person, a Fiverr designer say, shared through
// one read only link that expires. The person can send their files back through
// the same page; they land here, and one button puts the images in the task's image
// review as the version to send next. The client sees none of it.
//
// Derek, 2026-09-30: "a deliverable for project instructions that we can create a
// document and then share it with a Fiverr or a third party to do the design", "it
// needs to be separate from document though". He picked A from the mockup
// (~/Local Sites/CUL Tasks/project-instructions-mockup.html).
//
// In the task it is one line like the client document; Open shows it full screen.
import { useCallback, useEffect, useRef, useState } from "react";
import { timeAgo, type Task } from "@/lib/data";
import { authedFetch } from "@/lib/supabase";
import {
  downloadUrlForFile, fetchTaskBrief, fetchTaskBriefFiles, rowToTaskBrief, type TaskBrief as Brief, type TaskBriefFile,
} from "@/lib/db";
import { addDocFiles } from "@/lib/docFileUpload";
import { formatFileSize, isPreviewableImage } from "@/lib/uploadTypes";
import {
  BRIEF_LINK_DAYS, BRIEF_TEMPLATES, BRIEF_TITLE, DEFAULT_BRIEF_LINK_DAYS, briefToText, formatDue, linkDaysLabel,
} from "@/lib/brief";
import { htmlToText } from "@/lib/data";
import { RichTextEditor } from "./RichTextEditor";
import { useDebouncedCommit } from "./useDebouncedCommit";
import { FileDropLine, WorkItemRow, WorkItemWindow, quietButton as quiet } from "./TaskWorkItem";

type LinkState = { live: boolean; copyable: boolean; expiresAt: string | null };

const ICON = "📘";
const card = "rounded-2xl border bg-surface p-5 shadow-sm";
const until = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

export function TaskBrief({ task, clientName, pushToast, startNonce, onPresence }: {
  task: Task;
  /** The business the switch would name on the outside page. */
  clientName: string;
  pushToast: (text: string) => void;
  /** Bumped by the Add menu: make them if there are none, then show them. */
  startNonce: number;
  /** Tells the drawer whether there are instructions, so the Add menu can hide its item. */
  onPresence: (exists: boolean) => void;
}) {
  const api = (path: string, init?: RequestInit) =>
    authedFetch(`/api/tasks/${encodeURIComponent(task.id)}/brief${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [files, setFiles] = useState<TaskBriefFile[]>([]);
  const [link, setLink] = useState<LinkState | null>(null);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [days, setDays] = useState<number>(DEFAULT_BRIEF_LINK_DAYS);
  const [aiPrompt, setAiPrompt] = useState("");
  const [template, setTemplate] = useState<string>("design");
  const [picked, setPicked] = useState<string[]>([]);
  // The editor remounts with new content after a template or the AI replaces it.
  const [nonce, setNonce] = useState(0);
  const [seed, setSeed] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saving" | "saved">("idle");
  const latestHtml = useRef<string | null>(null);
  const commit = useDebouncedCommit();
  const titleCommit = useDebouncedCommit(800);

  const readJson = async (res: Response) => res.json().catch(() => ({} as Record<string, unknown>));

  const load = useCallback(async () => {
    const fresh = await fetchTaskBrief(task.id);
    setBrief(fresh);
    setLoaded(true);
    if (!fresh) return;
    void fetchTaskBriefFiles(fresh.id).then(setFiles);
    const res = await authedFetch(`/api/tasks/${encodeURIComponent(task.id)}/brief/link`);
    if (res.ok) setLink(await res.json());
  }, [task.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  // A file sent back logs a line on the task, which arrives live: the cue to look again.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { if (loaded) void load(); }, [task.comments.length]);

  const exists = !!brief;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onPresence(exists); }, [exists]);

  // Typing is never left waiting: the pending save lands when the tab hides or closes.
  useEffect(() => {
    const flushAll = () => { commit.flush(); titleCommit.flush(); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flushAll(); };
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("pagehide", flushAll); document.removeEventListener("visibilitychange", onVisibility); };
  }, [commit.flush, titleCommit.flush]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (fields: Record<string, unknown>, keepalive = false): Promise<boolean> => {
    const payload = JSON.stringify(fields);
    const res = await api("", { method: "PATCH", body: payload, keepalive: keepalive && payload.length < 60_000 });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not save the instructions."); return false; }
    setBrief(rowToTaskBrief(j.brief));
    return true;
  };

  const saveBody = async (html: string) => {
    setSaveState("saving");
    setSaveState(await patch({ body: html }, true) ? "saved" : "unsaved");
  };

  const open = (b: Brief) => {
    setTitleDraft(b.title);
    setSeed(null);
    latestHtml.current = null;
    setFull(true);
  };
  const close = () => { commit.flush(); titleCommit.flush(); setFull(false); };

  const create = async (): Promise<Brief | null> => {
    setBusy("create");
    const res = await api("", { method: "POST", body: JSON.stringify({ template: "blank" }) });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not start the project instructions."); return null; }
    const made = rowToTaskBrief(j.brief);
    setBrief(made);
    setLoaded(true);
    return made;
  };

  const startSeen = useRef(startNonce);
  useEffect(() => {
    if (startNonce === startSeen.current) return;
    startSeen.current = startNonce;
    void (async () => {
      const b = brief ?? await create();
      if (b) open(b);
    })();
  }, [startNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Puts new writing in the editor (a template or the AI's) and saves it.
  const replaceBody = (html: string) => {
    commit.flush();
    latestHtml.current = html;
    setSeed(html);
    setNonce((n) => n + 1);
    void saveBody(html);
  };
  const currentHtml = () => latestHtml.current ?? brief?.body ?? "";
  const hasWriting = () => !!htmlToText(currentHtml()).trim();

  const writeWithAi = async () => {
    if (hasWriting() && !window.confirm("Replace what is written here with a new draft from AI?")) return;
    setBusy("ai");
    const res = await api("/ai", { method: "POST", body: JSON.stringify({ template, prompt: aiPrompt }) });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "The AI could not write it. Try again."); return; }
    replaceBody(j.html as string);
    pushToast("Written. Read it through before you share it.");
  };

  const teamFiles = files.filter((f) => !f.fromOutside);
  const sentBack = files.filter((f) => f.fromOutside);
  const waiting = sentBack.filter((f) => !f.movedAt);

  const copyText = async () => {
    const text = briefToText({ title: titleDraft || brief?.title || "", due: brief?.dueOn ?? null, html: currentHtml(), files: teamFiles.map((f) => f.name) });
    try { await navigator.clipboard.writeText(text); pushToast("Copied as text. Paste it into your message."); }
    catch { pushToast("Could not copy."); }
  };

  const copyLink = async () => {
    const res = await api("/link", { method: "POST", body: JSON.stringify({ action: "copy" }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not copy the link."); return; }
    try { await navigator.clipboard.writeText(j.url as string); pushToast("Link copied."); } catch { pushToast(j.url as string); }
  };
  const makeLink = async () => {
    setBusy("link");
    const res = await api("/link", { method: "POST", body: JSON.stringify({ action: "new", days }) });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not make the link."); return; }
    setLink({ live: true, copyable: !!j.url, expiresAt: (j.expiresAt as string) ?? null });
    try { await navigator.clipboard.writeText(j.url as string); pushToast("Link made and copied."); } catch { pushToast(j.url as string); }
  };
  const extendLink = async (d: number) => {
    const res = await api("/link", { method: "POST", body: JSON.stringify({ action: "extend", days: d }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not change the link."); return; }
    setLink(j as LinkState);
    pushToast(`The link works until ${until(j.expiresAt as string)}.`);
  };
  const turnOff = async () => {
    if (!window.confirm("Turn the link off? It stops working for good. You can make a new one any time.")) return;
    const res = await api("/link", { method: "DELETE" });
    if (!res.ok) { pushToast("Could not turn the link off."); return; }
    setLink({ live: false, copyable: false, expiresAt: null });
    pushToast("Link turned off.");
  };

  const addFiles = async (list: FileList) => {
    if (!brief || adding) return;
    setAdding(true);
    const error = await addDocFiles(Array.from(list), (payload) => api("/files", { method: "POST", body: JSON.stringify(payload) }),
      () => { void fetchTaskBriefFiles(brief.id).then(setFiles); });
    setAdding(false);
    if (error) pushToast(error);
    void fetchTaskBriefFiles(brief.id).then(setFiles);
  };
  const removeFile = async (f: TaskBriefFile) => {
    if (!brief || !window.confirm(`Remove ${f.name}? It is deleted for good.`)) return;
    const res = await api("/files", { method: "DELETE", body: JSON.stringify({ fileId: f.id }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not remove the file."); return; }
    setPicked((p) => p.filter((id) => id !== f.id));
    void fetchTaskBriefFiles(brief.id).then(setFiles);
  };
  const download = async (f: TaskBriefFile) => {
    const url = await downloadUrlForFile(f.path, f.name);
    if (url) window.location.assign(url);
    else pushToast("Could not open the file.");
  };

  const moveToReview = async () => {
    if (!brief || !picked.length) return;
    setBusy("move");
    const res = await api("/review", { method: "POST", body: JSON.stringify({ fileIds: picked }) });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not put them in the image review."); return; }
    setPicked([]);
    void fetchTaskBriefFiles(brief.id).then(setFiles);
    pushToast(`${j.moved === 1 ? "The image is" : `${j.moved} images are`} in the image review, not sent. Open it to check and send.`);
  };

  const deleteBrief = async () => {
    if (!window.confirm("Delete these project instructions for good? The link stops working and every file here is deleted, including files sent back.")) return;
    commit.flush();
    titleCommit.flush();
    setBusy("delete");
    const res = await api("", { method: "DELETE" });
    setBusy(null);
    if (!res.ok) { pushToast("Could not delete the instructions."); return; }
    setFull(false);
    setBrief(null);
    setFiles([]);
    setLink(null);
  };

  if (!loaded || !brief) return null;

  const linkLine = link?.live ? `Link on until ${link.expiresAt ? until(link.expiresAt) : "turned off"}` : link ? "Not shared" : null;
  const meta = [
    linkLine,
    link?.live ? (brief.viewedAt ? `Viewed ${timeAgo(brief.viewedAt)}` : "Not viewed yet") : null,
    waiting.length ? `${waiting.length} new ${waiting.length === 1 ? "file" : "files"} sent back` : sentBack.length ? `${sentBack.length} sent back` : null,
    `Edited ${timeAgo(brief.updatedAt)}`,
  ].filter(Boolean).join(" · ");
  const copyLinkButton = link?.live && link.copyable ? <button onClick={() => void copyLink()} className={quiet}>Copy link</button> : null;
  const row = (
    <WorkItemRow tone="brief" icon={ICON} title={brief.title.trim() || BRIEF_TITLE} meta={meta}
      badge={waiting.length ? <span className="shrink-0 rounded-full bg-highlight px-2.5 py-0.5 text-[16px] font-semibold text-white">{waiting.length} new</span> : undefined}
      actions={copyLinkButton} onOpen={() => open(brief)} />
  );
  if (!full) return row;

  const empty = !htmlToText(brief.body).trim();
  const saveLabel = saveState === "unsaved" ? "Unsaved changes" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : `Edited ${timeAgo(brief.updatedAt)}`;

  const titleInput = (
    <input value={titleDraft}
      onChange={(e) => { const value = e.target.value; setTitleDraft(value); titleCommit.schedule(() => { if (value.trim() !== brief.title.trim()) void patch({ title: value }, true); }); }}
      onBlur={() => titleCommit.flush()}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      placeholder={BRIEF_TITLE} aria-label="Project instructions name" maxLength={200}
      className="w-full rounded-md bg-transparent px-1 py-0.5 text-[22px] font-bold outline-none placeholder:text-foreground hover:bg-background focus:bg-background" />
  );

  const toggle = (label: string, help: string, on: boolean, onChange: (next: boolean) => void) => (
    <label className="flex cursor-pointer items-start gap-3 border-t py-3 first:border-t-0">
      <span className="min-w-0 flex-1"><span className="block font-semibold">{label}</span><span className="block text-muted">{help}</span></span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--success)]" />
    </label>
  );

  const sees = (yes: boolean, text: string) => (
    <li className="flex gap-2"><span aria-hidden className={`font-black ${yes ? "text-success" : "text-danger"}`}>{yes ? "✓" : "✕"}</span>{text}</li>
  );

  const shareCard = (
    <section className={card}>
      <h3 className="mb-3 text-[18px] font-bold">Share with an outside person</h3>
      {link?.live ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {copyLinkButton ?? <span className="text-muted">This link was made without a way to copy it again. Make a new one.</span>}
            <button onClick={() => void makeLink()} disabled={busy !== null} className={quiet}>New link</button>
            <button onClick={() => void turnOff()} className="ml-auto rounded-lg border px-3 py-1.5 text-[16px] font-medium text-danger hover:bg-danger-soft">Turn off</button>
          </div>
          <label className="mt-3 flex flex-wrap items-center gap-2 text-muted">
            Works until {link.expiresAt ? until(link.expiresAt) : "turned off"}. Keep it on for
            <select defaultValue="" onChange={(e) => { if (e.target.value) void extendLink(Number(e.target.value)); e.target.value = ""; }}
              className="rounded-lg border bg-surface px-2 py-1 text-[16px] text-foreground">
              <option value="" disabled>pick</option>
              {BRIEF_LINK_DAYS.map((d) => <option key={d} value={d}>{linkDaysLabel(d)} more</option>)}
            </select>
          </label>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="How long the link works"
            className="rounded-lg border bg-surface px-2 py-2 text-[16px]">
            {BRIEF_LINK_DAYS.map((d) => <option key={d} value={d}>Works for {linkDaysLabel(d)}</option>)}
          </select>
          <button onClick={() => void makeLink()} disabled={busy !== null}
            className="rounded-lg bg-highlight px-5 py-2 text-[16px] font-semibold text-white disabled:opacity-50">{busy === "link" ? "Making…" : "Make link"}</button>
        </div>
      )}
      <div className="mt-3">
        {toggle("They can send files back", "Up to 200 MB a file. They land here for you to check.", brief.uploadsOpen, (v) => void patch({ uploadsOpen: v }))}
        {toggle("Show the business name", brief.showBusiness ? `They see "${clientName}".` : "Off: they see no business name.", brief.showBusiness, (v) => void patch({ showBusiness: v }))}
      </div>
      <ul className="mt-2 grid gap-1 rounded-xl bg-background p-3 sm:grid-cols-2">
        {sees(true, "These instructions")}
        {sees(false, "The client's phone or email")}
        {sees(true, teamFiles.length ? `The ${teamFiles.length} ${teamFiles.length === 1 ? "file" : "files"} below` : "Any files you add below")}
        {sees(false, "Other tasks, comments, Approve")}
      </ul>
      <button onClick={() => void copyText()} className={`mt-3 w-full ${quiet}`}>Copy as text for Fiverr</button>
    </section>
  );

  const sentCard = (
    <section className={card}>
      <h3 className="mb-1 text-[18px] font-bold">Sent back{sentBack.length ? ` · ${sentBack.length}` : ""}</h3>
      {!sentBack.length ? (
        <p className="text-muted">{brief.uploadsOpen ? "Files they send through the link show here." : "Sending files back is switched off."}</p>
      ) : (
        <>
          <ul className="divide-y">
            {sentBack.map((f) => {
              const image = isPreviewableImage(f.name);
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  {image && !f.movedAt
                    ? <input type="checkbox" aria-label={`Pick ${f.name}`} checked={picked.includes(f.id)} className="h-5 w-5 accent-[var(--highlight)]"
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f.id] : p.filter((id) => id !== f.id)))} />
                    : <span aria-hidden className="w-5" />}
                  <span className="min-w-0 flex-1">
                    <button onClick={() => void download(f)} className="break-words text-left font-medium text-accent hover:underline">{f.name}</button>
                    <span className="block text-muted">{formatFileSize(f.sizeBytes)} · {f.addedByLabel ?? "Someone outside"} · {timeAgo(f.createdAt)}{f.movedAt ? " · in the image review" : ""}</span>
                  </span>
                  <button onClick={() => void removeFile(f)} className="text-muted hover:text-danger hover:underline">Remove</button>
                </li>
              );
            })}
          </ul>
          {sentBack.some((f) => isPreviewableImage(f.name) && !f.movedAt) ? (
            <>
              <button onClick={() => void moveToReview()} disabled={!picked.length || busy !== null}
                className="mt-3 w-full rounded-lg bg-highlight px-4 py-2.5 text-[16px] font-semibold text-white disabled:opacity-50">
                {busy === "move" ? "Adding…" : picked.length ? `Put ${picked.length === 1 ? "1 image" : `${picked.length} images`} in the image review` : "Tick images to put in the image review"}
              </button>
              <p className="mt-2 text-muted">They go in as the next version, not sent. The client sees nothing until you press Send there.</p>
            </>
          ) : (
            <p className="mt-2 text-muted">An image review takes JPG, PNG, WebP or GIF. Download anything else.</p>
          )}
        </>
      )}
    </section>
  );

  return (
    <>
      {row}
      <WorkItemWindow icon={ICON} title={titleInput} status={saveLabel} onClose={close}
        actions={<button onClick={() => void copyText()} className={quiet}>Copy as text</button>}>
        <p className="mb-5 rounded-xl bg-accent-soft px-4 py-3 text-[16px]">
          For a designer or anyone outside the team. The client never sees these, and nothing here acts as the client.
        </p>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0">
            {empty && (
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                {BRIEF_TEMPLATES.map((t) => (
                  <button key={t.id} onClick={() => { setTemplate(t.id === "blank" ? "design" : t.id); if (t.html) replaceBody(t.html); }}
                    className={`rounded-xl border-2 bg-surface p-3 text-left hover:!border-highlight ${template === t.id ? "!border-highlight bg-highlight-soft/40" : ""}`}>
                    <span className="block font-bold text-accent">{t.name}</span>
                    <span className="block text-muted">{t.hint}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-[#f1ebff] p-4 text-[#3f1a86] dark:bg-[#2a2140] dark:text-[#d9ccff]">
              <div className="min-w-[220px] flex-1">
                <span className="block font-bold">Write it with AI</span>
                <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} maxLength={1000}
                  onKeyDown={(e) => { if (e.key === "Enter") void writeWithAi(); }}
                  placeholder="Anything to add? Like: keep it playful, no stock photos"
                  className="mt-2 w-full rounded-lg border bg-surface px-3 py-2 text-[16px] text-foreground outline-none focus:border-accent" />
                <span className="mt-1 block text-[16px] opacity-80">Uses the task, its approved client document and the client notes. Never phone numbers or emails.</span>
              </div>
              <button onClick={() => void writeWithAi()} disabled={busy !== null}
                className="rounded-lg bg-[#6d28d9] px-5 py-2.5 text-[16px] font-semibold text-white disabled:opacity-50">{busy === "ai" ? "Writing…" : "✨ Write it"}</button>
            </div>
            <label className="mb-4 flex flex-wrap items-center gap-3 text-[16px]">
              <span className="font-semibold">Due back</span>
              <input type="date" value={brief.dueOn ?? ""} onChange={(e) => void patch({ due: e.target.value || null })}
                className="rounded-lg border bg-surface px-3 py-1.5 text-[16px]" />
              {brief.dueOn && <span className="text-muted">They see {formatDue(brief.dueOn)}</span>}
            </label>
            <article className="rounded-2xl border bg-surface p-5 shadow-sm sm:p-8">
              <RichTextEditor key={`brief-${brief.id}-${nonce}`} value={seed ?? brief.body} variant="doc"
                placeholder="Write what they need to know: the job, sizes, what must be on it, the look, what to send back…"
                onChange={(html) => { latestHtml.current = html; setSaveState("unsaved"); commit.schedule(() => { void saveBody(html); }); }} />
            </article>
          </div>
          <div className="space-y-4 lg:sticky lg:top-0">
            {shareCard}
            <FileDropLine label="Files for them" count={teamFiles.length} busy={adding} onFiles={(list) => void addFiles(list)}>
              {teamFiles.length > 0 && (
                <ul className="mt-1.5 divide-y">
                  {teamFiles.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[16px]">
                      <button onClick={() => void download(f)} className="min-w-0 break-words text-left font-medium text-accent hover:underline">{f.name}</button>
                      <span className="text-muted">{formatFileSize(f.sizeBytes)}</span>
                      <button onClick={() => void removeFile(f)} className="ml-auto text-muted hover:text-danger hover:underline">Remove</button>
                    </li>
                  ))}
                </ul>
              )}
            </FileDropLine>
            {sentCard}
          </div>
        </div>
        <div className="mt-12 flex justify-end border-t pt-4">
          <button onClick={() => void deleteBrief()} disabled={busy !== null} className="text-[16px] text-muted hover:text-danger hover:underline disabled:opacity-50">
            {busy === "delete" ? "Deleting…" : "Delete project instructions"}
          </button>
        </div>
      </WorkItemWindow>
    </>
  );
}
