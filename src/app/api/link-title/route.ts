import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { requireUser } from "@/lib/serverAuth";

// Reads the <title> off a pasted link so an attachment reads
// "Publishing Local Events via the Ambassador Portal" instead of a 90
// character URL nobody can parse at a glance.
//
// This fetches a URL the browser handed us, from inside our own network, so
// it is a server-side request forgery hole unless it is fenced off. The
// fencing is the interesting part of this file:
//
//   - http/https only. No file:, no gopher:, no data:.
//   - every hostname is resolved and the resulting IP checked against the
//     private, loopback, link-local and carrier-grade-NAT ranges before we
//     connect. A public name pointing at 169.254.169.254 is the classic way
//     to read cloud instance metadata, and it passes any string-based check.
//   - redirects are followed by hand, three at most, re-checking the host
//     each hop. Letting fetch follow them would skip the check on every hop
//     after the first.
//   - 6 second timeout and a 256KB read cap, because <title> is in the first
//     kilobyte of any sane document and a slow or endless response should
//     cost us a connection, not a worker.

const TIMEOUT_MS = 6000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

function isBlockedIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    // loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10)
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
    // ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 hat, checked as IPv4
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isBlockedIp(mapped[1]) : false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||   // carrier-grade NAT
    (a === 169 && b === 254) ||             // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224                                // multicast and reserved
  );
}

async function assertPublic(u: URL): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https links.");
  const hits = await lookup(u.hostname, { all: true });
  if (hits.length === 0) throw new Error("Couldn't resolve that host.");
  if (hits.some((h) => isBlockedIp(h.address))) throw new Error("That host isn't reachable from here.");
}

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

  let current: URL;
  try { current = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); }
  catch { return NextResponse.json({ error: "That isn't a valid link." }, { status: 400 }); }

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(current);
      const res = await fetch(current, {
        redirect: "manual",
        headers: { "User-Agent": "ClickUpTasks link preview", Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        current = new URL(loc, current);
        continue;
      }
      if (!res.ok) return NextResponse.json({ title: "" });
      if (!(res.headers.get("content-type") ?? "").includes("html")) return NextResponse.json({ title: "" });

      // Read only the head of the body. A 4GB "html" response should not be
      // able to sit in this worker's memory.
      const reader = res.body?.getReader();
      if (!reader) return NextResponse.json({ title: "" });
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (size < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
      }
      reader.cancel().catch(() => {});
      const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
      return NextResponse.json({ title: extractTitle(html) });
    }
    return NextResponse.json({ title: "" });
  } catch (e) {
    // A failure here is never fatal: the caller falls back to a tidied URL.
    return NextResponse.json({ title: "", error: e instanceof Error ? e.message : "Couldn't read that link." });
  }
}
