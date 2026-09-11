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
import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
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

export function RichTextEditor({ value, onChange, placeholder, autoFocus, editable = true, variant = "task", tall = false }: {
  value: string; onChange: (html: string) => void; placeholder?: string; autoFocus?: boolean;
  editable?: boolean; variant?: "task" | "doc";
  /** A document in the full window: the writing surface fills most of the screen. */
  tall?: boolean;
}) {
  const doc = variant === "doc";
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
          ? `rte-content ${tall ? "min-h-[65vh]" : "min-h-[320px]"} text-[18px] leading-relaxed text-foreground outline-none`
          : "rte-content min-h-[80px] text-[16px] text-foreground outline-none",
      },
      // Plain click still just positions the cursor while editing — Cmd/Ctrl
      // click follows the link instead, same convention as Notion/most rich
      // editors. In a read-only view a plain click opens it, since there is
      // no cursor to place.
      handleClick: (view, _pos, event) => {
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
    <div className={doc
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
      <div>
        {toolbar}
        <EditorContent editor={editor} />
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
