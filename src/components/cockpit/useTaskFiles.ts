"use client";

// A task's files: adding and removing them, downloading one, several as a zip,
// or under another name, copying a link, and the one-image uploads that
// comments and messages paste in. Lifted out of Cockpit.tsx unchanged (audit
// 2026-09-29, 3.4).

import * as React from "react";
import { type ChecklistChange } from "./checklistChange";
import { type ConfirmSpec } from "./modals";
import { MAX_ATTACHMENT_BYTES, formatBytes, kindFromName, newId } from "./ui";
import { type Attachment, type Task } from "@/lib/data";
import { deleteTaskFile, downloadUrlForFile, signedUrlForFile, uploadTaskFile } from "@/lib/db";
import JSZip from "jszip";
import { useState } from "react";

export type UseTaskFilesDeps = {
  tasks: Task[];
  pushToast: (text: string, action?: { label: string; run: () => void; }, secondaryAction?: { label: string; run: () => void; }) => void;
  setUploadProgress: React.Dispatch<React.SetStateAction<{ done: number; total: number; } | null>>;
  update: (id: string, patch: Partial<Task>, item?: ChecklistChange) => void;
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmSpec | null>>;
};

export function useTaskFiles({ tasks, pushToast, setUploadProgress, update, setConfirmDialog }: UseTaskFilesDeps) {
  const addFiles = async (id: string, fileList: FileList | File[]) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || fileList.length === 0) return;
    const all = Array.from(fileList);
    const files = all.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    const oversized = all.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (oversized.length) pushToast(`Skipped ${oversized.length} file${oversized.length > 1 ? "s" : ""} over ${formatBytes(MAX_ATTACHMENT_BYTES)}: ${oversized.map((f) => f.name).join(", ")}`);
    if (files.length === 0) return;

    setUploadProgress({ done: 0, total: files.length });
    const items: Attachment[] = [];
    let failed = 0;
    for (const f of files) {
      const safe = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `${id}/${newId("f_")}-${safe}`;
      const res = await uploadTaskFile(path, f);
      items.push({ id: newId("a_"), name: f.name, size: formatBytes(f.size), kind: kindFromName(f.name), path: res.ok ? path : undefined });
      if (!res.ok) failed++;
      setUploadProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
    }
    setUploadProgress(null);
    // Re-read current task in case it changed while awaiting.
    const cur = tasks.find((x) => x.id === id) ?? t;
    update(id, { attachments: [...cur.attachments, ...items] });
    if (failed) pushToast(`Attached ${items.length}, but ${failed} didn't upload — create the "task-files" storage bucket in Supabase.`);
    else pushToast(`Uploaded ${items.length} file${items.length > 1 ? "s" : ""}`);
  };
  const downloadFile = async (path: string) => {
    const url = await signedUrlForFile(path);
    if (url) window.open(url, "_blank", "noopener");
    else pushToast("Couldn't open the file — is the storage bucket set up?");
  };
  // "Download all" for a batch of attachments (a client dropping a dozen
  // logo variations into one chat message, say) — zips them client-side
  // into a single file instead of one `window.open` per attachment, which
  // browsers throttle/pop-up-block past the first couple and which would
  // otherwise leave the user saving 20 files one at a time.
  const [zippingIds, setZippingIds] = useState<Set<string>>(new Set());
  const downloadAllAsZip = async (items: Attachment[], zipName: string, batchId: string) => {
    const withPath = items.filter((a) => a.path);
    if (!withPath.length) { pushToast("Nothing to download."); return; }
    setZippingIds((s) => new Set(s).add(batchId));
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      let failed = 0;
      await Promise.all(withPath.map(async (a) => {
        try {
          const url = await signedUrlForFile(a.path!);
          if (!url) { failed++; return; }
          const blob = await fetch(url).then((r) => r.blob());
          let name = a.name || a.path!.split("/").pop() || "file";
          if (usedNames.has(name)) {
            const dot = name.lastIndexOf(".");
            name = dot > 0 ? `${name.slice(0, dot)}-${a.id.slice(0, 6)}${name.slice(dot)}` : `${name}-${a.id.slice(0, 6)}`;
          }
          usedNames.add(name);
          zip.file(name, blob);
        } catch { failed++; }
      }));
      const blob = await zip.generateAsync({ type: "blob" });
      // A blob: URL is same-origin, so (unlike the cross-origin Supabase
      // signed URLs downloadFileAs deals with) the `download` attribute
      // actually triggers a save instead of a navigation.
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl; a.download = zipName.endsWith(".zip") ? zipName : `${zipName}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      if (failed) pushToast(`Downloaded ${withPath.length - failed} of ${withPath.length} files — ${failed} couldn't be fetched.`);
    } finally {
      setZippingIds((s) => { const n = new Set(s); n.delete(batchId); return n; });
    }
  };
  // Forces an actual save instead of opening the file in a new tab — the
  // gap that mattered most for images, which browsers always render inline
  // rather than downloading. See downloadUrlForFile's comment for why this
  // needs its own signed-URL request rather than an HTML download attribute.
  const downloadFileAs = async (path: string, filename: string) => {
    const url = await downloadUrlForFile(path, filename);
    if (url) window.open(url, "_blank", "noopener");
    else pushToast("Couldn't download the file — is the storage bucket set up?");
  };
  // A "direct link" people can paste elsewhere (Slack, a doc) needs to
  // outlive the 10-minute expiry used for click-to-open — 30 days is long
  // enough to be practically permanent without making the bucket public.
  const copyAttachmentLink = async (path: string) => {
    const url = await signedUrlForFile(path, 60 * 60 * 24 * 30);
    if (!url) { pushToast("Couldn't get a link — is the storage bucket set up?"); return; }
    try { await navigator.clipboard.writeText(url); pushToast("Link copied (valid for 30 days)"); }
    catch { pushToast("Couldn't copy to clipboard"); }
  };
  // Shared single-image upload for paste-to-attach in Chat messages and task
  // comments — same storage bucket/pattern as addFiles above, but returns the
  // Attachment directly instead of patching a task, since a chat message or
  // comment doesn't exist as a row yet when the paste happens.
  const uploadOneImage = async (pathPrefix: string, file: File): Promise<Attachment | null> => {
    if (file.size > MAX_ATTACHMENT_BYTES) { pushToast(`Skipped ${file.name} — over ${formatBytes(MAX_ATTACHMENT_BYTES)}`); return null; }
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${pathPrefix}/${newId("f_")}-${safe}`;
    const res = await uploadTaskFile(path, file);
    if (!res.ok) { pushToast(`Couldn't upload ${file.name} — is the "task-files" storage bucket set up?`); return null; }
    return { id: newId("a_"), name: file.name, size: formatBytes(file.size), kind: kindFromName(file.name), path };
  };
  // Confirmed, not immediate: this permanently deletes the stored file, and
  // unlike a task it has no Trash to fall back on (Derek: "include a
  // confirmation step when deleting an upload on a task").
  const removeFile = (id: string, att: Attachment) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    setConfirmDialog({
      title: `Delete “${att.name}”?`,
      message: "This permanently deletes the file. It can't be undone.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        if (att.path) deleteTaskFile(att.path);
        update(id, { attachments: t.attachments.filter((a) => a.id !== att.id) });
        pushToast("Attachment removed");
      },
    });
  };
  return { addFiles, uploadOneImage, downloadFile, downloadFileAs, downloadAllAsZip, zippingIds, removeFile, copyAttachmentLink };
}
