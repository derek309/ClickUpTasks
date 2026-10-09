// Reading an Inbox conversation from a Claude chat (get_email_thread,
// draft_email_reply in core.mjs). Plain functions, no database, so they are
// tested on their own. The text helpers mirror htmlToText / tidyEmailText /
// splitQuotedEmail in src/lib/data.ts, which this .mjs cannot import.

/** A conversation key from what a person pastes: the app's link
 *  (".../?view=mail&thread=gm%3A18f2a..."), the key itself, or either one
 *  URL-encoded. Returns { kind, id, key } or null. */
export function parseThreadInput(input) {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;
  const m = s.match(/[?&#]thread=([^&#\s]+)/);
  if (m) s = m[1];
  // Encoded once by the app's link, sometimes twice by a chat or a mail client.
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(s); i++) {
    try { s = decodeURIComponent(s); } catch { break; }
  }
  s = s.replace(/\+/g, " ").trim();
  const k = s.match(/^(gm|ghl|chat):([\w.:-]{1,200})$/);
  return k ? { kind: k[1], id: k[2], key: `${k[1]}:${k[2]}` } : null;
}

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'", "#039": "'" };

/** An email body, HTML or text, as readable plain text: tags gone, the
 *  common entities decoded, block ends kept as line breaks. */
export function emailBodyText(body) {
  let s = String(body || "");
  if (/^\s*<[a-z!][\s\S]*>/i.test(s) || /<\/(p|div|br|li|table|td)>|<br\s*\/?>/i.test(s)) {
    s = s
      .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|table)>/gi, "\n")
      .replace(/<[^>]+>/g, "");
  }
  s = s.replace(/&(nbsp|amp|lt|gt|quot|apos|#0?39);/gi, (_, e) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/&#(\d{1,6});/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return " "; } });
  return tidyEmailText(s.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n"));
}

/** Same as tidyEmailText in src/lib/data.ts. */
export function tidyEmailText(text) {
  return String(text || "")
    .replace(/[​-‍⁠﻿­͏]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\[image: [^\]\n]{1,200}\]/g, "")
    .split("\n").map((l) => (l.trim() ? l.replace(/\s+$/, "") : "")).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_MARKERS = [
  /^\s*On .{0,120}\bwrote:\s*$/im,
  /^\s*\w+ \d{1,2}(,| at ).{0,120}\bwrote:\s*$/im,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*_{5,}\s*$/m,
  /^\s*From:.{0,200}\r?\n\s*Sent:/im,
  /^\s*>{1,}\s?.+$/m,
];
/** Same as splitQuotedEmail in src/lib/data.ts: what was written, and the
 *  quoted history under it. */
export function splitQuotedEmail(body) {
  const text = String(body || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  let cut = -1;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index >= 0 && (cut === -1 || m.index < cut)) cut = m.index;
  }
  if (cut === -1) return { visible: text, quoted: "" };
  return { visible: text.slice(0, cut).trim(), quoted: text.slice(cut).trim() };
}

/** One message's new words: plain text with the quoted history taken off.
 *  A message that is nothing but a quote keeps its text rather than none. */
export function messageText(body) {
  const text = emailBodyText(body);
  const { visible } = splitQuotedEmail(text);
  return visible || text;
}

/** "Re: <subject>", without stacking a second Re:. */
export const replySubject = (subject) => {
  const s = String(subject || "").trim();
  if (!s) return "";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
};
