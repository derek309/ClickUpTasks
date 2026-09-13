import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { isUselessTitle } from "@/lib/data";
import { fetchPublic, readCapped } from "@/lib/safeFetch";

// Reads the <title> off a pasted link so an attachment reads
// "Publishing Local Events via the Ambassador Portal" instead of a 90
// character URL nobody can parse at a glance.
//
// This fetches a URL the browser handed us, from inside our own network, so it
// goes through src/lib/safeFetch.ts (public hosts only, every redirect checked).
// 6 second timeout and a 256KB read cap, because <title> is in the first
// kilobyte of any sane document.

const TIMEOUT_MS = 6000;
const MAX_BYTES = 256 * 1024;

// Deliberately not a full HTML parse: og:title or <title>, first match wins,
// entities decoded for the handful that actually show up in titles.
function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const raw = og?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return raw
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const input = typeof b.url === "string" ? b.url.trim() : "";
  if (!input) return NextResponse.json({ error: "No link." }, { status: 400 });

  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); }
  catch { return NextResponse.json({ error: "That isn't a valid link." }, { status: 400 }); }

  try {
    const res = await fetchPublic(url, { accept: "text/html,application/xhtml+xml", userAgent: "ClickUpTasks link preview", timeoutMs: TIMEOUT_MS });
    if (!res || !res.ok) return NextResponse.json({ title: "" });
    if (!(res.headers.get("content-type") ?? "").includes("html")) return NextResponse.json({ title: "" });
    // Read only the head of the body. A 4GB "html" response should not be
    // able to sit in this worker's memory.
    const { bytes } = await readCapped(res, MAX_BYTES);
    // A page behind a login returns its interstitial, not its content, so
    // a Drive folder titles itself "Open". Returning that renames the
    // attachment to something worse than the URL, and worse still it looks
    // deliberate. Empty means "keep the name you derived from the URL".
    const title = extractTitle(bytes.toString("utf8"));
    return NextResponse.json({ title: isUselessTitle(title) ? "" : title });
  } catch (e) {
    // A failure here is never fatal: the caller falls back to a tidied URL.
    return NextResponse.json({ title: "", error: e instanceof Error ? e.message : "Couldn't read that link." });
  }
}
