// Reads what an email signature says about its sender, to fill in the Add
// form in the Inbox (Derek, 2026-10-02: "fill from the signature"). Only a
// best guess: everything it finds is shown in the form to check before saving.

export type SignatureGuess = { firstName: string; lastName: string; title: string; companyName: string; phone: string; website: string };

const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|icloud|aol|me|msn|live|proton(mail)?)\./i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const DOMAIN = /\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/\S*)?/i;
const COMPANY = /\b(LLC|L\.L\.C\.?|Inc\.?|Group|Company|Co\.|Ltd\.?|Corp\.?|Realty|Partners|Agency|Associates)\b/i;

/** The part of an email before the quoted earlier message. */
function ownPart(body: string): string {
  const cut = body.search(/^\s*(On .{4,120} wrote:|-{2,}\s*Original Message|From: .+@.+)$/im);
  return (cut > 0 ? body.slice(0, cut) : body).split("\n").filter((l) => !l.trim().startsWith(">")).join("\n");
}

export function guessFromSignature(body: string, who: { name?: string | null; email: string }): SignatureGuess {
  const name = (who.name ?? "").trim();
  const [first = "", ...rest] = name.split(/\s+/);
  const out: SignatureGuess = { firstName: first, lastName: rest.join(" "), title: "", companyName: "", phone: "", website: "" };
  const lines = ownPart(body).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const sig = lines.slice(-15);
  const emailDomain = who.email.split("@")[1]?.toLowerCase() ?? "";

  // Job title: on the name's own line after a separator, or the line under it.
  const last = out.lastName.toLowerCase();
  const i = last ? sig.findIndex((l) => l.toLowerCase().includes(last) && !l.includes("@")) : -1;
  if (i >= 0) {
    const after = sig[i].slice(sig[i].toLowerCase().indexOf(last) + last.length).replace(/^[\s/,|–—-]+/, "").trim();
    const next = sig[i + 1] ?? "";
    if (after && after.length <= 60) out.title = after;
    else if (next && next.length <= 60 && !/[@\d]|https?:|www\./i.test(next) && !COMPANY.test(next)) out.title = next;
  }
  out.phone = sig.join("\n").match(PHONE)?.[0]?.trim() ?? "";
  const companyLine = sig.find((l) => COMPANY.test(l) && !l.includes("@") && l.length <= 70);
  if (companyLine) out.companyName = companyLine.replace(/[\s,.;]+$/, "");
  // Website: their own domain if the signature names one, else the email's.
  const domains = sig.flatMap((l) => (l.includes("@") ? [] : [...l.matchAll(new RegExp(DOMAIN, "gi"))].map((m) => m[1].toLowerCase())));
  out.website = domains.find((d) => d === emailDomain || d.endsWith(`.${emailDomain}`)) ?? domains[0] ?? (emailDomain && !FREE_MAIL.test(emailDomain) ? emailDomain : "");
  return out;
}
