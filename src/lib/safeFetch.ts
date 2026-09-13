// SERVER ONLY. Fetching a URL someone handed us, from inside our own network, is a
// server side request forgery hole unless it is fenced off. Used for a pasted
// link's title (/api/link-title) and for an image Claude adds to a review from a
// link (MCP). The fencing:
//
//   - http/https only (https only where asked). No file:, no gopher:, no data:.
//   - every hostname is resolved and the resulting IP checked against the
//     private, loopback, link-local and carrier-grade-NAT ranges before we
//     connect. A public name pointing at 169.254.169.254 is the classic way
//     to read cloud instance metadata, and it passes any string-based check.
//   - redirects are followed by hand, a few at most, re-checking the host each
//     hop. Letting fetch follow them would skip the check on every hop after
//     the first.
//   - a timeout and a read cap, so a slow or endless response costs us a
//     connection, not a worker.
import { lookup } from "node:dns/promises";

export function isBlockedIp(ip: string): boolean {
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

async function assertPublic(u: URL, httpsOnly: boolean): Promise<void> {
  if (httpsOnly ? u.protocol !== "https:" : u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(httpsOnly ? "Only https links." : "Only http and https links.");
  }
  const hits = await lookup(u.hostname, { all: true });
  if (hits.length === 0) throw new Error("Couldn't resolve that host.");
  if (hits.some((h) => isBlockedIp(h.address))) throw new Error("That host isn't reachable from here.");
}

export type PublicFetchOptions = { accept: string; userAgent: string; timeoutMs: number; maxRedirects?: number; httpsOnly?: boolean };

/** The first response that isn't a redirect, every hop checked first. Null when a
 *  redirect has no Location or they run out. Throws on a blocked or bad address. */
export async function fetchPublic(url: URL, o: PublicFetchOptions): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= (o.maxRedirects ?? 3); hop++) {
    await assertPublic(current, !!o.httpsOnly);
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": o.userAgent, Accept: o.accept },
      signal: AbortSignal.timeout(o.timeoutMs),
    });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    if (!loc) return null;
    current = new URL(loc, current);
  }
  return null;
}

/** The body, reading no more than just past maxBytes; over says there was more. */
export async function readCapped(res: Response, maxBytes: number): Promise<{ bytes: Buffer; over: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { bytes: Buffer.alloc(0), over: false };
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    size += value.length;
    if (size > maxBytes) { over = true; break; }
  }
  reader.cancel().catch(() => {});
  return { bytes: Buffer.concat(chunks), over };
}

export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
const EXTENSION: Record<ImageType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** What the file's first bytes say it is, whatever it claims to be. */
export function imageTypeOf(b: Uint8Array): ImageType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export type FetchedImage = { ok: true; bytes: Buffer; contentType: ImageType; extension: string } | { ok: false; error: string };

/** A PNG, JPEG, GIF or WebP from a public https link. The first bytes decide the
 *  type, so an SVG, a web page or a script named .png is refused. */
export async function fetchImage(raw: string, maxBytes: number): Promise<FetchedImage> {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { ok: false, error: "That isn't a valid link." }; }
  try {
    const res = await fetchPublic(url, { accept: "image/png,image/jpeg,image/gif,image/webp", userAgent: "ClickUpTasks image review", timeoutMs: 15_000, httpsOnly: true });
    if (!res) return { ok: false, error: "That link redirects too many times." };
    if (!res.ok) return { ok: false, error: `That link answered ${res.status}.` };
    const { bytes, over } = await readCapped(res, maxBytes);
    if (over) return { ok: false, error: `That image is over ${Math.round(maxBytes / (1024 * 1024))} MB.` };
    const contentType = imageTypeOf(bytes);
    if (!contentType) return { ok: false, error: "That link isn't a PNG, JPEG, GIF or WebP image." };
    return { ok: true, bytes, contentType, extension: EXTENSION[contentType] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't fetch that image." };
  }
}
