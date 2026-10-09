// A Content-Disposition header for a file name from anywhere: an email, a
// phone, a Mac. A header can only carry plain characters, and a Mac screenshot
// is named "Screenshot 2026-10-08 at 11.37.32 AM.png" with a narrow no-break
// space before the AM, so putting the name in as it was threw and the Inbox
// showed an empty box for every screenshot (Derek, 2026-10-09). The plain name
// is the fallback; filename* carries the real one for every current browser.
export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const real = name.replace(/[\r\n"]/g, "").trim() || "file";
  const plain = real.normalize("NFKD").replace(/[^\x20-\x7e]/g, (c) => (/\s/.test(c) ? " " : "")).replace(/[\\%]/g, "_") || "file";
  return `${kind}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(real)}`;
}
