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

function scrapeOpenEmail() {
  const subjectEl = document.querySelector("h2.hP");
  const subject = subjectEl?.textContent?.trim() || null;

  // Gmail marks the sender name/email on the last expanded message with a
  // `.gD` span carrying `name`/`email` attributes.
  const senderEls = document.querySelectorAll(".gD");
  const lastSender = senderEls[senderEls.length - 1];
  const senderName = lastSender?.getAttribute("name") || lastSender?.textContent?.trim() || null;
  const senderEmail = lastSender?.getAttribute("email") || null;

  const bodyEls = document.querySelectorAll(".a3s.aiL");
  const lastBody = bodyEls[bodyEls.length - 1];
  const snippet = lastBody?.textContent?.trim().slice(0, 300) || null;

  const permalink = location.hash ? `https://mail.google.com/mail/u/0/${location.hash}` : null;

  if (!subject && !senderEmail) return null;
  return { subject, senderName, senderEmail, snippet, permalink };
}
