// Scrapes the currently-open Gmail email's subject/sender/permalink when the
// popup asks for it. Gmail's DOM structure isn't a public API and can change
// without notice on a redesign — this must fail soft (return whatever
// partial data is found, or null) so the popup falls back to a blank,
// manually-fillable form rather than erroring.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "CLICKUPTASKS_GET_EMAIL") return;
  try {
    sendResponse(scrapeOpenEmail());
  } catch {
    sendResponse(null);
  }
  return true;
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

function scrapeSnippet() {
  const known = document.querySelectorAll(".a3s.aiL");
  const lastKnown = known[known.length - 1];
  if (lastKnown?.textContent?.trim()) return lastKnown.textContent.trim().slice(0, 300);
  return null;
}

function scrapeOpenEmail() {
  const subject = scrapeSubject();
  const { name: senderName, email: senderEmail } = scrapeSender();
  const snippet = scrapeSnippet();
  const permalink = location.hash ? `https://mail.google.com/mail/u/0/${location.hash}` : null;

  if (!subject && !senderEmail) return null;
  return { subject, senderName, senderEmail, snippet, permalink };
}
