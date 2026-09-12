// Highlights the words each client document comment is about (Derek, 2026-09-12:
// comments on a specific sentence). Drawn as ProseMirror decorations over the text,
// never written into the document, so saved versions, the word diff and the HTML
// sanitizer never see them. A comment stores the words it quotes; the highlight
// finds them again, so an edit that changes those words just drops the highlight
// and the comment still shows its quote.
import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export type CommentHighlight = { id: string; quote: string };
type HighlightState = { highlights: CommentHighlight[]; activeId: string | null };

export const commentHighlightsKey = new PluginKey<HighlightState>("commentHighlights");

/** Where a quote sits: its first line, inside one paragraph or heading. Exact
 *  first, then ignoring case. Null when the words are no longer there. */
export function findQuote(doc: PMNode, quote: string): { from: number; to: number } | null {
  const needle = quote.split("\n")[0]?.trim();
  if (!needle) return null;
  let hit: { from: number; to: number } | null = null;
  const search = (caseless: boolean) => doc.descendants((node, pos) => {
    if (hit) return false;
    if (!node.isTextblock) return true;
    // The block's text, with the document position of every character.
    let text = "";
    const at: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) { text += child.text[i]; at.push(start + i); }
      } else {
        text += " ";
        at.push(start);
      }
    });
    const i = caseless ? text.toLowerCase().indexOf(needle.toLowerCase()) : text.indexOf(needle);
    if (i >= 0 && at[i + needle.length - 1] !== undefined) hit = { from: at[i], to: at[i + needle.length - 1] + 1 };
    return false;
  });
  search(false);
  if (!hit) search(true);
  return hit;
}

export const CommentHighlights = Extension.create({
  name: "commentHighlights",
  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: commentHighlightsKey,
        state: {
          init: () => ({ highlights: [], activeId: null }),
          apply: (tr, prev) => (tr.getMeta(commentHighlightsKey) as HighlightState | undefined) ?? prev,
        },
        props: {
          decorations(state) {
            const s = commentHighlightsKey.getState(state);
            if (!s?.highlights.length) return DecorationSet.empty;
            const decos: Decoration[] = [];
            for (const h of s.highlights) {
              const range = findQuote(state.doc, h.quote);
              if (!range) continue;
              decos.push(Decoration.inline(range.from, range.to, {
                class: h.id === s.activeId ? "doc-comment-mark doc-comment-mark-active" : "doc-comment-mark",
                "data-comment-id": h.id,
              }));
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
