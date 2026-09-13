"use client";

// Notion-lite description editor: a small always-visible toolbar over a
// contentEditable surface. Stores real HTML in task.description — the
// GHL task sync body, the "Copy for Claude" brief, and the MCP server's
// task brief all can't render markup, so they run htmlToText() first
// (see data.ts) rather than embedding raw tags.
//
// Also the client review document's editor, in the team's drawer and on the
// public /doc page. `variant="doc"` is the reading size (18px body, 16px
// controls so an iPhone never zooms into the toolbar, a sticky toolbar without
// the checklist and code block buttons), and `editable={false}` is the locked
// view of an approved or closed document.
import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { CommentHighlights, commentHighlightsKey, type CommentHighlight } from "./commentHighlights";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { I } from "./ui";

function ToolbarButton({ onClick, active, title, children, large }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode; large?: boolean }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title}
      className={`shrink-0 rounded-md transition ${large ? "p-2.5" : "p-1.5"} ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}>
      {children}
    </button>
  );
}

export function RichTextEditor({ value, onChange, placeholder, autoFocus, editable = true, variant = "task", highlights, activeHighlightId, onHighlightClick, onSelectionComment }: {
  value: string; onChange: (html: string) => void; placeholder?: string; autoFocus?: boolean;
  editable?: boolean; variant?: "task" | "doc";
  /** Document only: the words comments are about, highlighted; clicking one calls onHighlightClick. */
  highlights?: CommentHighlight[]; activeHighlightId?: string | null; onHighlightClick?: (id: string) => void;
  /** Document only: selecting words shows a Comment button that hands them over. */
  onSelectionComment?: (quote: string) => void;
}) {
  const doc = variant === "doc";
  // handleClick is set when the editor is made, so it reads the latest callback here.
  const highlightClickRef = useRef(onHighlightClick);
  useEffect(() => { highlightClickRef.current = onHighlightClick; });
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { title: "⌘-click to open" } }),
      Placeholder.configure({ placeholder: placeholder ?? "Add a description…" }),
      ...(doc ? [CommentHighlights] : []),
    ],
    content: value,
    // Boot-time only — a caller that wants to refocus an already-mounted
    // editor (e.g. clicking "Email" again to jump back to a composer
    // that's already in email mode) should remount via a changing `key`
    // instead, same as any other autofocus-on-mount input.
    autofocus: autoFocus ? "end" : false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      // 16px, not the 15px the surrounding chrome uses: this is body copy
      // people read, and at 15px descriptions were coming back as hard to
      // read. The label/row scale around it is unchanged. A document reads
      // at 18px, since reading it is the whole job.
      attributes: {
        class: doc
          // As tall as the writing plus about five empty lines (pb-36) to click
          // into, so the page scrolls and the editor never holds dead space
          // (Derek, 2026-09-11: "adjust to the content length ... leave 5 lines").
          ? "rte-content min-h-[12rem] pb-36 text-[18px] leading-relaxed text-foreground outline-none"
          : "rte-content min-h-[80px] text-[16px] text-foreground outline-none",
      },
      // Plain click still just positions the cursor while editing — Cmd/Ctrl
      // click follows the link instead, same convention as Notion/most rich
      // editors. In a read-only view a plain click opens it, since there is
      // no cursor to place.
      handleClick: (view, _pos, event) => {
        // A highlighted comment quote opens its comment; the cursor still lands.
        const mark = (event.target as HTMLElement).closest?.("[data-comment-id]") as HTMLElement | null;
        if (mark?.dataset.commentId) highlightClickRef.current?.(mark.dataset.commentId);
        if (view.editable && !(event.metaKey || event.ctrlKey)) return false;
        const link = (event.target as HTMLElement).closest("a");
        if (!link?.href) return false;
        window.open(link.href, "_blank", "noopener,noreferrer");
        return true;
      },
    },
  });

  // `editable` is read once when the editor is created. A document that locks
  // on approval, or reopens, flips it without a remount.
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  // Comment highlights reach the editor as a transaction that changes nothing in
  // the document, so it saves nothing and never counts as an edit. A picked
  // comment's words scroll into view.
  const highlightsKey = doc ? `${JSON.stringify(highlights ?? [])}|${activeHighlightId ?? ""}` : "";
  useEffect(() => {
    if (!doc || !editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr
      .setMeta(commentHighlightsKey, { highlights: highlights ?? [], activeId: activeHighlightId ?? null })
      .setMeta("addToHistory", false));
    if (!activeHighlightId) return;
    requestAnimationFrame(() => {
      editor.view.dom.querySelector(`[data-comment-id="${CSS.escape(activeHighlightId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [editor, highlightsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selecting words in a document shows a Comment button just above them. Read
  // from the page's own selection, so it works in a locked (read only) document too.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<{ quote: string; top: number; left: number } | null>(null);
  const readSelection = () => {
    const wrap = wrapRef.current;
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!wrap || !onSelectionComment || !sel || sel.isCollapsed || !sel.rangeCount) { setPick(null); return; }
    const range = sel.getRangeAt(0);
    const quote = sel.toString().trim();
    if (!quote || !wrap.contains(range.commonAncestorContainer)) { setPick(null); return; }
    const r = range.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const above = r.top - w.top - 52;
    setPick({ quote, top: above >= 0 ? above : r.bottom - w.top + 8, left: Math.max(0, Math.min(r.left - w.left + r.width / 2 - 64, w.width - 128)) });
  };
  useEffect(() => {
    if (!doc || !onSelectionComment) return;
    const onChange = () => { if (window.getSelection()?.isCollapsed) setPick(null); };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [doc, onSelectionComment]);

  // The document's sticky toolbar sits flush against the top of whatever scrolls it.
  // Sticky stops below a scroller's top padding, so writing scrolled through that gap
  // above the bar (Derek, 2026-09-13: "fix it"); a negative top the size of the
  // padding closes it, in the full window and the drawer alike.
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = toolbarRef.current;
    if (!doc || !bar) return;
    let scroller = bar.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const padding = scroller ? parseFloat(getComputedStyle(scroller).paddingTop) || 0 : 0;
    bar.style.top = `${-padding}px`;
  }, [doc, editable, editor]);

  if (!editor) return null;

  const blockValue = editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : "p";
  const setBlock = (v: string) => {
    const chain = editor.chain().focus();
    if (v === "h2") chain.setHeading({ level: 2 }).run();
    else if (v === "h3") chain.setHeading({ level: 3 }).run();
    else chain.setParagraph().run();
  };
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "");
    if (url === null) return;
    if (!url.trim()) { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const toolbar = !editable ? null : (
    <div ref={toolbarRef} className={doc
      ? "sticky top-0 z-10 mb-3 flex items-center gap-1 overflow-x-auto border-b bg-surface pb-2 pt-1"
      : "mb-1 flex flex-wrap items-center gap-0.5 border-b pb-1.5"}>
      <select value={blockValue} onChange={(e) => setBlock(e.target.value)}
        className={doc
          ? "mr-1 min-h-[44px] shrink-0 rounded-md bg-transparent px-2 text-[16px] text-muted outline-none hover:bg-background"
          : "mr-1 rounded-md border-transparent bg-transparent px-1 py-1 text-[13px] text-muted outline-none hover:bg-background"}>
        <option value="p">Normal</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />
      <ToolbarButton large={doc} onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold"><I.bold /></ToolbarButton>
      <ToolbarButton large={doc} onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic"><I.italic /></ToolbarButton>
      <ToolbarButton large={doc} onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline"><I.underline /></ToolbarButton>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />
      <ToolbarButton large={doc} onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list"><I.list /></ToolbarButton>
      {!doc && <ToolbarButton onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")} title="Checklist"><I.check /></ToolbarButton>}
      {!doc && <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} title="Code block"><I.code /></ToolbarButton>}
      <ToolbarButton large={doc} onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote"><I.quote /></ToolbarButton>
      <ToolbarButton large={doc} onClick={setLink} active={editor.isActive("link")} title="Link"><I.link /></ToolbarButton>
    </div>
  );

  if (doc) {
    return (
      <div ref={wrapRef} className="relative" onMouseUp={readSelection} onKeyUp={readSelection} onTouchEnd={() => window.setTimeout(readSelection, 0)}>
        {toolbar}
        <EditorContent editor={editor} />
        {pick && (
          <button type="button" onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onSelectionComment?.(pick.quote); setPick(null); window.getSelection()?.removeAllRanges(); }}
            style={{ top: pick.top, left: pick.left }}
            className="absolute z-20 min-h-[44px] rounded-lg bg-accent px-5 text-[16px] font-semibold text-white shadow-lg">
            Comment
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-transparent transition hover:border-border focus-within:border-border focus-within:bg-background">
      {toolbar}
      <EditorContent editor={editor} className="px-1 py-1" />
    </div>
  );
}
