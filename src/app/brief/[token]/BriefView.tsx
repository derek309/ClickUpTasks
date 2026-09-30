"use client";

// The page an outside person (a Fiverr designer, say) opens from a task's project
// instructions link: the instructions, the team's files to download, and a drop
// box to send their own files back. No login. It shows no client contact, no
// task, nothing that acts as the client. See src/lib/briefServer.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { RichTextEditor } from "@/components/cockpit/RichTextEditor";
import { uploadSharedFile } from "@/lib/docFileUpload";
import { formatDue } from "@/lib/brief";
import { formatFileSize } from "@/lib/uploadTypes";

type BriefFileView = { id: string; name: string; size: number; kind: string };
type SentFile = { id: string; name: string; size: number; addedBy: string; createdAt: string };
type Data = {
  title: string; business: string | null; body: string; dueOn: string | null; uploadsOpen: boolean;
  files: BriefFileView[]; sent: SentFile[];
};

const NAME_KEY = "brief_sender_name";
const readName = () => { try { return window.localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; } };
const keepName = (v: string) => { try { window.localStorage.setItem(NAME_KEY, v); } catch { /* private mode */ } };
const FILE_ICON: Record<string, string> = { image: "🖼️", pdf: "📄", sheet: "📊", video: "🎬", doc: "📎" };

export default function BriefView({ token }: { token: string }) {
  const [state, setState] = useState<"loading" | "ready" | "closed" | "error">("loading");
  const [data, setData] = useState<Data | null>(null);
  const [name, setName] = useState("");
  const [sending, setSending] = useState<{ name: string; share: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const base = `/api/brief/${encodeURIComponent(token)}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (res.status === 404) { setState("closed"); return; }
      if (!res.ok) { setState("error"); return; }
      setData(await res.json());
      setState("ready");
    } catch { setState("error"); }
  }, [base]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); setName(readName()); }, [load]);

  // "Viewed" for the team, once, after a few seconds on screen: never the GET, which scanners make.
  const viewed = useRef(false);
  useEffect(() => {
    if (state !== "ready" || viewed.current) return;
    const id = window.setTimeout(() => {
      if (viewed.current || document.visibilityState !== "visible") return;
      viewed.current = true;
      void fetch(`${base}/viewed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", keepalive: true }).catch(() => {});
    }, 4000);
    return () => window.clearTimeout(id);
  }, [state, base]);

  const send = async (list: FileList | File[]) => {
    const who = name.trim();
    if (!who) { setError("Type your name first, so the team knows who sent them."); return; }
    if (sending) return;
    keepName(who);
    setError(null);
    setThanks(false);
    let sent = 0;
    for (const file of Array.from(list)) {
      setSending({ name: file.name, share: 0 });
      const r = await uploadSharedFile(file, (payload) => fetch(`${base}/files`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, from: who }),
      }), "design", (share) => setSending({ name: file.name, share }));
      if (!r.ok) { setError(r.error); break; }
      sent++;
    }
    setSending(null);
    if (sent) setThanks(true);
    await load();
  };

  if (state === "loading") return <Shell><p className="py-24 text-center text-[18px] text-[#5b6474]">Opening…</p></Shell>;
  if (state === "closed" || state === "error" || !data) {
    return (
      <Shell>
        <div className="mx-auto max-w-[520px] px-4 py-24 text-center">
          <div aria-hidden className="mx-auto mb-5 grid h-24 w-24 place-items-center rounded-3xl bg-[#e1eaf4] text-[48px]">🔒</div>
          <h1 className="mb-2 text-[28px] font-black text-[#1b3a5c]">{state === "error" ? "This did not open" : "These instructions are closed"}</h1>
          <p className="text-[18px] text-[#5b6474]">{state === "error" ? "Check your connection and try again." : "Ask the person who sent the link for a new one."}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="bg-[#1b3a5c] text-white">
        <div className="mx-auto max-w-[900px] px-4 pb-8 pt-8 sm:px-8">
          <p className="text-[16px] text-[#c9d7e6]">Project instructions from ClickUpLocal{data.business ? ` for ${data.business}` : ""}</p>
          <h1 className="mt-1 text-[32px] font-black leading-tight sm:text-[40px]">{data.title}</h1>
          {data.dueOn && <span className="mt-4 inline-block rounded-lg bg-[#e87722] px-3 py-1 text-[18px] font-extrabold">Due {formatDue(data.dueOn)}</span>}
        </div>
        <div aria-hidden className="h-2.5" style={{ background: "repeating-linear-gradient(135deg, #e87722 0 18px, #f39a55 18px 36px)" }} />
      </header>

      <main className="mx-auto grid max-w-[900px] gap-6 px-4 py-8 sm:px-8">
        <article className="rounded-2xl bg-white p-5 [&_h2]:!mt-6 [&_h2]:!text-[16px] [&_h2]:!font-extrabold [&_h2]:uppercase [&_h2]:tracking-[0.06em] [&_h2]:!text-[#e87722] [&_h2:first-child]:!mt-0 [&_.rte-content]:!min-h-0 [&_.rte-content]:!pb-0 shadow-[0_12px_30px_rgba(27,58,92,0.08)] sm:p-8">
          <RichTextEditor value={data.body} onChange={() => {}} editable={false} variant="doc" placeholder="" />
        </article>

        {data.files.length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_30px_rgba(27,58,92,0.08)] sm:p-8">
            <h2 className="mb-3 text-[16px] font-extrabold uppercase tracking-[0.06em] text-[#e87722]">Files for you</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.files.map((f) => (
                <li key={f.id}>
                  <a href={`${base}/files/${f.id}?download=1`} className="flex items-center gap-3 rounded-xl bg-[#eef4fb] px-3 py-3 hover:bg-[#e1eaf4]">
                    <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white text-[22px]">{FILE_ICON[f.kind] ?? "📎"}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-[#1b3a5c]">{f.name}</span><span className="block text-[#5b6474]">{formatFileSize(f.size)}</span></span>
                    <span className="shrink-0 font-bold text-[#1b3a5c]">Download</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.uploadsOpen && (
          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_30px_rgba(27,58,92,0.08)] sm:p-8">
            <h2 className="mb-3 text-[16px] font-extrabold uppercase tracking-[0.06em] text-[#e87722]">Send your files</h2>
            <label className="mb-3 block">
              <span className="mb-1 block font-semibold text-[#1b3a5c]">Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name"
                className="w-full rounded-xl border-2 !border-[#d0dce8] bg-white px-3 py-2.5 text-[16px] outline-none focus:border-[#1b3a5c]" />
            </label>
            <div
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void send(e.dataTransfer.files); }}
              onClick={() => input.current?.click()}
              role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
              className={`cursor-pointer rounded-2xl border-[3px] border-dashed p-6 text-center transition ${over ? "!border-[#e87722] bg-[#fdece1]" : "!border-[#f3b27f] bg-[#fff7f0]"}`}>
              <input ref={input} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) void send(e.target.files); e.target.value = ""; }} />
              {sending ? (
                <>
                  <b className="block text-[18px] text-[#9a4a0c]">Sending {sending.name}</b>
                  <span className="mx-auto mt-3 block h-3 max-w-[320px] overflow-hidden rounded-full bg-white">
                    <span className="block h-full bg-[#e87722] transition-all" style={{ width: `${Math.round(sending.share * 100)}%` }} />
                  </span>
                </>
              ) : (
                <>
                  <b className="block text-[18px] text-[#9a4a0c]">Drop files here</b>
                  <span className="text-[#5b6474]">or tap to pick them. PDF, images, ZIP or design files, up to 200 MB each.</span>
                </>
              )}
            </div>
            {error && <p role="alert" className="mt-3 rounded-xl bg-[#fff1ea] px-4 py-3 text-[#7c2d12]">{error}</p>}
            {thanks && !error && <p className="mt-3 rounded-xl bg-[#e8f7ee] px-4 py-3 text-[#14532d]"><b>Sent. Thank you{name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}.</b> The team will look at them and get back to you.</p>}
            {data.sent.length > 0 && (
              <>
                <h3 className="mb-1 mt-5 font-bold text-[#1b3a5c]">Sent so far</h3>
                <ul className="divide-y divide-[#d0dce8]">
                  {data.sent.map((f) => (
                    <li key={f.id} className="flex flex-wrap gap-x-3 py-2"><span className="min-w-0 flex-1 break-words font-medium">{f.name}</span><span className="text-[#5b6474]">{formatFileSize(f.size)}{f.addedBy ? ` · ${f.addedBy}` : ""}</span></li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </main>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  // Always light, whatever the device prefers: this is a printed brief, not the app.
  // The editor reads the app's colour variables, so they are set to the light ones here.
  const light = {
    "--background": "#eef4fb", "--surface": "#ffffff", "--foreground": "#1c2030", "--muted": "#5b6474", "--border": "#d0dce8",
    "--accent": "#1b3a5c", "--accent-soft": "#e1eaf4", "--highlight": "#e87722", "--highlight-soft": "#fdece1",
  } as React.CSSProperties;
  return <div style={light} className="min-h-dvh bg-[#eef4fb] text-[16px] text-[#1c2030] [color-scheme:light]">{children}</div>;
}
