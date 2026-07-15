"use client";

// Notion-lite description editor: a small always-visible toolbar over a
// contentEditable surface. Stores real HTML in task.description — the
// GHL task sync body, the "Copy for Claude" brief, and the MCP server's
// task brief all can't render markup, so they run htmlToText() first
// (see data.ts) rather than embedding raw tags.
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { I } from "./ui";

function ToolbarButton({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title}
      className={`rounded-md p-1.5 transition ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}>
      {children}
    </button>
  );
}

export function RichTextEditor({ value, onChange, placeholder }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder ?? "Add a description…" }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { class: "rte-content min-h-[80px] text-[15px] outline-none" } },
  });

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

  return (
    <div className="rounded-lg border border-transparent transition hover:border-border focus-within:border-border focus-within:bg-background">
      <div className="mb-1 flex flex-wrap items-center gap-0.5 border-b pb-1.5">
        <select value={blockValue} onChange={(e) => setBlock(e.target.value)} className="mr-1 rounded-md border-transparent bg-transparent px-1 py-1 text-[13px] text-muted outline-none hover:bg-background">
          <option value="p">Normal</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
        </select>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold"><I.bold /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic"><I.italic /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline"><I.underline /></ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list"><I.list /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")} title="Checklist"><I.check /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} title="Code block"><I.code /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote"><I.quote /></ToolbarButton>
        <ToolbarButton onClick={setLink} active={editor.isActive("link")} title="Link"><I.link /></ToolbarButton>
      </div>
      <EditorContent editor={editor} className="px-1 py-1" />
    </div>
  );
}
