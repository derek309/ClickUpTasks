import { randomUUID } from "node:crypto";
import type { Attachment } from "@/lib/data";

// Server-side hardening for the PUBLIC, token-gated waiting-page write routes
// (respond/route.ts, request/route.ts). Those routes receive an `attachments`
// array straight from an unauthenticated client, so nothing in the payload can
// be trusted:
//
//   - `path` is the dangerous field: the GET route signs it against the shared
//     private task-files bucket, so an attacker echoing back ANOTHER client's
//     path would get a working signed URL to that file. We only keep paths that
//     live under this client's own `waiting/<clientId>/` namespace (exactly what
//     upload/route.ts writes).
//   - `url` is never legitimately sent (real uploads only carry `path`), and a
//     stored `javascript:`/phishing URL renders as a clickable <a href> in the
//     team's task drawer — so we drop it entirely and rely on read-time signing.
//   - `kind` drives the "changes_requested" auto-flip, so we re-derive it from
//     the filename server-side rather than trusting the client's label.
//
// The result is a clean Attachment[] built from scratch — we never spread the
// caller's object, so no unexpected field survives.

const MAX_ATTACHMENTS = 30;

function kindFromName(name: string): Attachment["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  return "doc";
}

export function sanitizeWaitingAttachments(raw: unknown, clientId: string): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const prefix = `waiting/${clientId}/`;
  const clean: Attachment[] = [];
  for (const a of raw) {
    if (clean.length >= MAX_ATTACHMENTS) break;
    if (!a || typeof a !== "object") continue;
    const path = (a as { path?: unknown }).path;
    // A stored file is the only shape a client can legitimately submit, and it
    // must sit inside its own namespace — anything else is dropped, not signed.
    if (typeof path !== "string" || !path.startsWith(prefix)) continue;
    const rawName = (a as { name?: unknown }).name;
    const name = (typeof rawName === "string" ? rawName : "file").slice(0, 200);
    const rawSize = (a as { size?: unknown }).size;
    const size = typeof rawSize === "string" ? rawSize.slice(0, 20) : "";
    clean.push({ id: "a_" + randomUUID(), name, kind: kindFromName(name), size, path });
  }
  return clean;
}
