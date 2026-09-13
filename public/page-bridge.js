// The bridge inside a web page review's sandboxed frame (served first in the page's
// head by src/app/page-frame/[ticket]/route.ts). It runs with the page, in an
// opaque origin, and only talks to the window around it by postMessage. The other
// side, which checks everything this sends, is src/lib/pageFrameProtocol.ts.
//
// It draws the numbered pins, keeps links from leaving the page, and has three
// modes: Comment (a click drops a pin), Edit text (a click lets that text be
// changed; only the words go back, never the page) and Try the page. Elements
// carry data-cul-n numbers from the server, which is what pins and edits name.
(() => {
  "use strict";
  if (window.__culBridge || window.parent === window) return;
  window.__culBridge = true;

  const ATTR = "data-cul-n";
  const parentWindow = window.parent;
  // Taken now, before the page's own scripts run, so a page that replaces it cannot stop pins drawing.
  const nextFrame = window.requestAnimationFrame.bind(window);
  const post = (message) => parentWindow.postMessage({ cul: 1, ...message }, "*");
  const share = (v) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
  const blank = (s) => !s || !s.replace(/\s+/g, "");
  const normal = (s) => s.replace(/\s+/g, " ").trim();

  let mode = "comment";
  let pins = [];
  let pending = null;
  let activeId = null;
  let layer = null;
  let editing = null;

  // Pins -------------------------------------------------------------------

  const pageSize = () => {
    const d = document.documentElement;
    const b = document.body;
    return { w: Math.max(d.scrollWidth, b ? b.scrollWidth : 0) || 1, h: Math.max(d.scrollHeight, b ? b.scrollHeight : 0) || 1 };
  };

  const spot = (pin) => {
    const a = pin.anchor;
    const el = a ? document.querySelector(`[${ATTR}="${a.node}"]`) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) return { x: r.left + window.scrollX + a.nx * r.width, y: r.top + window.scrollY + a.ny * r.height };
    }
    const size = pageSize();
    return { x: pin.x * size.w, y: pin.y * size.h };
  };

  const marker = (number, color, ring) => {
    const m = document.createElement("cul-pin");
    m.textContent = String(number);
    m.setAttribute("style", [
      "all:initial", "position:absolute", "box-sizing:border-box", "min-width:36px", "height:36px", "padding:0 7px",
      "border-radius:18px", "border:2px solid #fff", `background:${color}`, "color:#fff",
      "font:700 16px/32px system-ui,-apple-system,sans-serif", "text-align:center", "transform:translate(-50%,-50%)",
      "box-shadow:0 2px 8px rgba(0,0,0,.35)", "cursor:pointer", "pointer-events:auto",
      ring ? "outline:4px solid #f5b942" : "",
    ].join(";"));
    return m;
  };

  const ensureLayer = () => {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement("cul-pins");
    layer.setAttribute("style", "all:initial;position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none");
    document.documentElement.appendChild(layer);
    return layer;
  };

  let scheduled = false;
  const draw = () => {
    scheduled = false;
    const l = ensureLayer();
    l.replaceChildren();
    for (const pin of pins) {
      const s = spot(pin);
      const m = marker(pin.number, pin.done ? "#6b7280" : "#1b3a5c", pin.id === activeId);
      m.style.left = `${s.x}px`;
      m.style.top = `${s.y}px`;
      if (pin.done) m.style.opacity = "0.6";
      m.dataset.id = pin.id;
      l.appendChild(m);
    }
    if (pending) {
      const s = spot(pending);
      const m = marker(pending.number, "#1b3a5c", true);
      m.style.left = `${s.x}px`;
      m.style.top = `${s.y}px`;
      l.appendChild(m);
    }
  };
  const redraw = () => {
    if (scheduled) return;
    scheduled = true;
    nextFrame(draw);
  };

  // Editing text ------------------------------------------------------------

  const textNodeAt = (x, y) => {
    if (document.caretPositionFromPoint) return document.caretPositionFromPoint(x, y)?.offsetNode ?? null;
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y)?.startContainer ?? null;
    return null;
  };

  // Which of its element's own non blank text runs this is, the way the server counts.
  const runIndex = (node) => {
    let i = 0;
    for (let c = node.parentNode.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== Node.TEXT_NODE || blank(c.nodeValue)) continue;
      if (c === node) return i;
      i++;
    }
    return -1;
  };

  const finishEdit = (save) => {
    if (!editing) return;
    const ed = editing;
    editing = null;
    const after = normal(ed.box.textContent || "");
    const lead = /^\s*/.exec(ed.before)[0];
    const trail = /\s*$/.exec(ed.before)[0];
    const changed = save && after && after !== normal(ed.before);
    const text = document.createTextNode(changed ? lead + after + trail : ed.before);
    if (ed.box.parentNode) ed.box.parentNode.replaceChild(text, ed.box);
    if (changed) post({ type: "edit", edit: { node: ed.node, i: ed.i, before: ed.before, after } });
    redraw();
  };

  const startEdit = (textNode) => {
    const parent = textNode.parentNode;
    const i = parent && parent.nodeType === Node.ELEMENT_NODE && parent.hasAttribute(ATTR) ? runIndex(textNode) : -1;
    if (i < 0) { post({ type: "not-editable" }); return; }
    const box = document.createElement("cul-edit");
    box.setAttribute("style", "all:unset;outline:2px dashed #f5b942;outline-offset:2px;cursor:text;white-space:pre-wrap");
    // Older browsers throw on plaintext-only; paste is plain text either way (below).
    try { box.contentEditable = "plaintext-only"; } catch { /* not supported */ }
    if (box.contentEditable !== "plaintext-only") box.contentEditable = "true";
    box.textContent = textNode.nodeValue;
    parent.replaceChild(box, textNode);
    editing = { box, node: Number(parent.getAttribute(ATTR)), i, before: textNode.nodeValue };
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finishEdit(true); }
      else if (e.key === "Escape") { e.preventDefault(); finishEdit(false); }
      e.stopPropagation();
    });
    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
      document.execCommand("insertText", false, text.replace(/\s+/g, " "));
    });
    box.addEventListener("blur", () => finishEdit(true));
    box.focus();
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };

  // Rewording already made, shown again after the frame reloads.
  const replay = (edits) => {
    for (const edit of edits) {
      const el = document.querySelector(`[${ATTR}="${edit.node}"]`);
      if (!el) continue;
      let i = 0;
      for (let c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== Node.TEXT_NODE || blank(c.nodeValue)) continue;
        if (i++ !== edit.i) continue;
        if (normal(c.nodeValue) === normal(edit.before)) c.nodeValue = /^\s*/.exec(c.nodeValue)[0] + edit.after + /\s*$/.exec(c.nodeValue)[0];
        break;
      }
    }
    redraw();
  };

  // Clicks -------------------------------------------------------------------

  const onClick = (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const pinEl = target && target.closest("cul-pin");
    if (pinEl) {
      e.preventDefault();
      e.stopPropagation();
      if (pinEl.dataset.id) post({ type: "pin-click", id: pinEl.dataset.id });
      return;
    }
    if (mode === "edit" && target && target.closest("cul-edit")) return;
    const link = target && target.closest("a[href]");
    const leaves = link && !link.getAttribute("href").startsWith("#");
    if (mode === "browse") {
      if (leaves) e.preventDefault();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (mode === "comment") {
      const size = pageSize();
      const message = { type: "place", x: share(e.pageX / size.w), y: share(e.pageY / size.h), anchor: null };
      const el = target && target.closest(`[${ATTR}]`);
      const r = el && el.getBoundingClientRect();
      if (el && r.width > 0 && r.height > 0) {
        message.anchor = {
          node: Number(el.getAttribute(ATTR)), nx: share((e.clientX - r.left) / r.width), ny: share((e.clientY - r.top) / r.height),
          width: Math.max(200, Math.min(4000, Math.round(window.innerWidth))),
        };
      }
      post(message);
    } else if (mode === "edit") {
      finishEdit(true);
      const node = textNodeAt(e.clientX, e.clientY);
      if (node && node.nodeType === Node.TEXT_NODE && !blank(node.nodeValue)) startEdit(node);
      else post({ type: "not-editable" });
    }
  };

  // Keep a press from starting a drag, a focus or a page's own handler while commenting or editing.
  const onPress = (e) => {
    if (mode === "browse") return;
    const target = e.target instanceof Element ? e.target : null;
    if (target && (target.closest("cul-pin") || target.closest("cul-edit"))) return;
    e.preventDefault();
    e.stopPropagation();
  };

  window.addEventListener("click", onClick, true);
  window.addEventListener("pointerdown", onPress, true);
  window.addEventListener("mousedown", onPress, true);
  window.addEventListener("submit", (e) => e.preventDefault(), true);

  // Messages from the window around the frame -------------------------------

  const cursor = document.createElement("style");
  const setMode = (next) => {
    if (next !== "comment" && next !== "edit" && next !== "browse") return;
    if (mode === "edit" && next !== "edit") finishEdit(true);
    mode = next;
    cursor.textContent = mode === "comment" ? "html, html * { cursor: crosshair !important; }" : mode === "edit" ? "html, html * { cursor: text !important; }" : "";
    if (!cursor.isConnected) document.documentElement.appendChild(cursor);
  };

  window.addEventListener("message", (e) => {
    if (e.source !== parentWindow) return;
    const d = e.data;
    if (!d || d.cul !== 1) return;
    if (d.type === "mode") setMode(d.mode);
    else if (d.type === "pins") {
      pins = Array.isArray(d.pins) ? d.pins : [];
      pending = d.pending || null;
      activeId = (pins.find((p) => p.active) || {}).id || null;
      redraw();
    } else if (d.type === "focus") {
      const pin = pins.find((p) => p.id === d.id);
      if (!pin) return;
      activeId = pin.id;
      const s = spot(pin);
      window.scrollTo({ left: Math.max(0, s.x - window.innerWidth / 2), top: Math.max(0, s.y - window.innerHeight / 2), behavior: "smooth" });
      redraw();
    } else if (d.type === "edits" && Array.isArray(d.edits)) replay(d.edits);
  });

  // Keep pins on their elements as the page loads, reflows and scrolls.
  const observe = () => {
    redraw();
    new MutationObserver((records) => {
      if (records.some((r) => !layer || !layer.contains(r.target))) redraw();
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    if (window.ResizeObserver && document.body) new ResizeObserver(redraw).observe(document.body);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
    post({ type: "ready" });
  };
  window.addEventListener("resize", redraw);
  window.addEventListener("load", redraw);
  window.addEventListener("scroll", redraw, true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe);
  else observe();
})();
