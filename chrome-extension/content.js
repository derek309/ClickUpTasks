// Scrapes the currently-open Gmail email's subject/sender/permalink when the
// popup asks for it. Gmail's DOM structure isn't a public API and can change
// without notice on a redesign — this must fail soft (return whatever
// partial data is found, or null) so the popup falls back to a blank,
// manually-fillable form rather than erroring.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CLICKUPTASKS_GET_EMAIL") {
    try {
      sendResponse(scrapeOpenEmail());
    } catch {
      sendResponse(null);
    }
    return true;
  }
  // Downloading an attachment has to happen HERE rather than in the side
  // panel: this script runs on mail.google.com, so Gmail's session cookies
  // are sent with the request as a matter of course. The panel is a different
  // origin and would get a login page back instead of the file.
  if (msg?.type === "CLICKUPTASKS_FETCH_ATTACHMENT" && typeof msg.url === "string") {
    (async () => {
      try {
        const res = await fetch(msg.url, { credentials: "include" });
        if (!res.ok) { sendResponse({ error: `Gmail returned ${res.status}` }); return; }
        const blob = await res.blob();
        // Handed back as a data URL because a Blob can't cross the extension
        // messaging boundary.
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
        sendResponse({ dataUrl, size: blob.size, type: blob.type });
      } catch (e) {
        sendResponse({ error: e instanceof Error ? e.message : "Download failed" });
      }
    })();
    return true;
  }
});

// Gmail's internal class names (h2.hP, .gD, .a3s.aiL, …) are unofficial and
// have been observed to drift across Gmail builds/locales — each field below
// tries the known-good selector first, then a looser ARIA/attribute-based
// fallback, so a partial DOM change degrades instead of breaking outright.
function scrapeSubject() {
  const known = document.querySelector("h2.hP")?.textContent?.trim();
  if (known) return known;
  const aria = document.querySelector('[role="main"] h2')?.textContent?.trim();
  if (aria) return aria;
  // Last resort: Gmail's tab title is usually "Subject - name@x.com - Gmail"
  // (sometimes just "Subject - Gmail") — strip the Gmail/account suffix.
  const title = document.title.replace(/\s*-\s*Gmail\s*$/i, "").replace(/\s*-\s*\S+@\S+\.\S+\s*$/, "");
  return title && title !== document.title ? title.trim() : null;
}

function scrapeSender() {
  // `.gD`'s `name`/`email` attributes are set directly by Gmail (not
  // derived from the volatile class name itself), so this stays reasonably
  // stable even if the class churns — but fall back to any element in the
  // thread carrying an `email` attribute if `.gD` itself stops matching.
  const known = document.querySelectorAll(".gD");
  const lastKnown = known[known.length - 1];
  if (lastKnown) return { name: lastKnown.getAttribute("name") || lastKnown.textContent?.trim() || null, email: lastKnown.getAttribute("email") || null };
  const fallback = document.querySelectorAll("[email]");
  const lastFallback = fallback[fallback.length - 1];
  if (lastFallback) return { name: lastFallback.getAttribute("name") || null, email: lastFallback.getAttribute("email") };
  return { name: null, email: null };
}

// Capped at 2000 chars, not a short preview snippet — this doubles as the
// input for the "Enrich with AI" button, which needs real content to work
// with, not just a couple hundred characters.
function scrapeSnippet() {
  const known = document.querySelectorAll(".a3s.aiL");
  const lastKnown = known[known.length - 1];
  if (lastKnown?.textContent?.trim()) return lastKnown.textContent.trim().slice(0, 2000);
  return null;
}

// Gmail's own attachments on the open message. `download_url` is an
// attribute Gmail puts on each attachment tile, shaped
// "mime/type:filename.pdf:https://mail.google.com/mail/u/0/?ui=2&..." — it
// has outlived many redesigns because Gmail's own download handler reads it,
// unlike the class names around it. Anything we can't parse is skipped
// rather than guessed at.
function scrapeAttachments() {
  const out = [];
  for (const el of document.querySelectorAll("[download_url]")) {
    const raw = el.getAttribute("download_url") || "";
    // Anchor on the URL rather than counting colons. Splitting on the first
    // two colons looks right and quietly loses any file whose NAME contains
    // one ("screenshot 2026-08-28 at 10:31:12.png" is a real filename), and a
    // dropped attachment is invisible — you'd never know it had been skipped.
    // The URL is always last, so the greedy prefix takes us to its start.
    const firstColon = raw.indexOf(":");
    const urlStart = raw.search(/https?:\/\/(?![\s\S]*https?:\/\/)/i);
    if (firstColon < 0 || urlStart <= firstColon) continue;
    const mime = raw.slice(0, firstColon);
    const name = raw.slice(firstColon + 1, urlStart - 1);
    const url = raw.slice(urlStart);
    if (!name) continue;
    if (out.some((a) => a.url === url)) continue; // Gmail renders some tiles twice
    out.push({ name, mime, url });
  }
  return out;
}

function scrapeOpenEmail() {
  const subject = scrapeSubject();
  const { name: senderName, email: senderEmail } = scrapeSender();
  const snippet = scrapeSnippet();
  // The account index has to come from the page, not be assumed to be 0:
  // on a second signed-in Google account the URL is /mail/u/1/ and a link
  // built with /u/0/ opens the wrong mailbox and fails to find the thread
  // (Derek: "I want the link to be easy to get back to so I can reply
  // quickly" — a link to the wrong account is worse than none).
  const acct = location.pathname.match(/\/mail\/u\/(\d+)\//)?.[1] ?? "0";
  const permalink = location.hash ? `https://mail.google.com/mail/u/${acct}/${location.hash}` : null;

  if (!subject && !senderEmail) return null;
  return { subject, senderName, senderEmail, snippet, permalink, attachments: scrapeAttachments() };
}
