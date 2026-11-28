// Highlighting, folding and indentation for the editor. Colours come
// from nabi-syntax's tree-sitter grammar once highlight.js has loaded
// (play.tsx hands the Highlighter over), else from the small lexer
// below; either way one class index a UTF-16 unit (k t s n c a m f, as
// the docs colour them), which CodeMirror's positions count too, painted
// as mark decorations over the visible lines.
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { foldService, indentService, indentUnit, getIndentUnit } from "@codemirror/language";
import type { Highlighter } from "../highlight.ts";

/** Index 0 is plain text (highlight.ts's CLASSES). */
export const CLASSES = ["", "k", "t", "s", "n", "c", "a", "m", "f"];
export const COMMENT = 5;
export const STRING = 3;

// A hand-kept subset of nabi-syntax's grammars/keywords.nabion.
const KEYWORDS = new Set(("fn let mut if else match for in while loop return break continue struct enum trait impl " +
  "pub use mod const static type as is none true false throws try catch async await yield self Self where ref " +
  "unsafe extern defer using move dyn any throw finally rethrows union some pkg sub sup macro gen do").split(" "));
const PRIMS = new Set("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str".split(" "));
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(f?"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)')|(#!?\[[^\]\n]*\]?)|(\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?(?:[iu](?:8|16|32|64|128|size)|f32|f64)?\b|\b0x[\da-fA-F_]+\b)|([A-Za-z_][A-Za-z0-9_]*)(!?)(?=([ \t]*\()?)/g;

/** The lexer's classes of `text`, until tree-sitter is there. */
export function lex(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let fnEnd = -1;
  for (const m of text.matchAll(TOKEN)) {
    const [w, com, str, attr, num, id, bang, call] = m;
    // A name after `fn`, or before `(`: a function, as the editors read it.
    const k = com ? COMMENT : str ? STRING : attr ? 6 : num ? 4
      : id && bang ? 7 : id && KEYWORDS.has(id) ? 1 : id && (PRIMS.has(id) || /^[A-Z]/.test(id)) ? 2
      : id && (call !== undefined || (fnEnd >= 0 && /^[ \t]+$/.test(text.slice(fnEnd, m.index)))) ? 8 : 0;
    if (k) out.fill(k, m.index, m.index + w.length);
    fnEnd = id === "fn" ? m.index + w.length : -1;
  }
  return out;
}

/** Repaint with the current highlighter (after it loads, or fails). */
export const repaint = StateEffect.define<null>();

const marks = CLASSES.map((c) => (c ? Decoration.mark({ class: c }) : null));

/** Every edit's classes, from `source()` when it gives them, else lex. */
export function highlighting(source: () => Highlighter | null, failed: () => void): Extension {
  const classify = (text: string): Uint8Array => {
    const h = source();
    if (h) {
      try {
        const c = h.classes(text);
        if (c && c.length === text.length) return c;
      } catch {
        failed();
      }
    }
    return lex(text);
  };
  painter = ViewPlugin.fromClass(class {
    cls: Uint8Array;
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.cls = classify(view.state.doc.toString());
      this.decorations = this.paint(view);
    }
    update(u: ViewUpdate): void {
      const again = u.transactions.some((t) => t.effects.some((e) => e.is(repaint)));
      if (u.docChanged || again) this.cls = classify(u.state.doc.toString());
      if (u.docChanged || again || u.viewportChanged) this.decorations = this.paint(u.view);
    }
    // One mark a run of one class, on the lines in view only.
    paint(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      const cls = this.cls;
      for (const { from, to } of view.visibleRanges) {
        let i = from;
        while (i < to) {
          const k = cls[i] ?? 0;
          let j = i + 1;
          while (j < to && cls[j] === k) j++;
          const m = marks[k];
          if (m) b.add(i, j, m);
          i = j;
        }
      }
      return b.finish();
    }
  }, { decorations: (p) => p.decorations });
  return painter;
}

let painter: ViewPlugin<{ cls: Uint8Array }> | null = null;

/** The class index at `pos` (CLASSES), as last painted. */
export function classAt(view: EditorView, pos: number): number {
  const p = painter && view.plugin(painter);
  return p ? p.cls[pos] ?? 0 : 0;
}

// Columns of leading blanks (a tab to the next stop of `unit`), or -1
// for a blank line.
function indentOf(text: string, unit: number): number {
  let n = 0;
  for (const c of text) {
    if (c === " ") n++;
    else if (c === "\t") n += unit - (n % unit);
    else return n;
  }
  return -1;
}

// The longest a fold looks ahead for its end, in lines.
const FOLD_SCAN = 4000;

/**
 * Folding by indentation: a line folds over the lines after it that are
 * indented deeper (blank lines between them included), so a block's
 * closing brace stays in view.
 */
export const folding: Extension = foldService.of((state: EditorState, from: number) => {
  const unit = getIndentUnit(state);
  const line = state.doc.lineAt(from);
  const ind = indentOf(line.text, unit);
  if (ind < 0) return null;
  let last = line.number;
  const end = Math.min(state.doc.lines, line.number + FOLD_SCAN);
  for (let n = line.number + 1; n <= end; n++) {
    const i = indentOf(state.doc.line(n).text, unit);
    if (i < 0) continue;
    if (i <= ind) break;
    last = n;
  }
  return last === line.number ? null : { from: line.to, to: state.doc.line(last).to };
});

/**
 * Indentation: a line one unit deeper than the last non-blank line when
 * that one opens a bracket, one unit shallower when it closes one
 * itself; four spaces a unit, as nabi fmt lays code out.
 */
export const indentation: Extension = [
  indentUnit.of("    "),
  indentService.of((cx, pos) => {
    const unit = getIndentUnit(cx.state);
    const here = cx.lineAt(pos, -1);
    let n = here.from;
    let prev: { text: string } | null = null;
    while (n > 0) {
      const l = cx.lineAt(n - 1, -1);
      if (l.text.trim()) { prev = l; break; }
      n = l.from;
    }
    if (!prev) return 0;
    const base = Math.max(indentOf(prev.text, unit), 0);
    const code = prev.text.replace(/\/\/.*$/, "").trimEnd();
    const opens = /[{([]$/.test(code) ? unit : 0;
    const after = cx.textAfterPos(pos, 1).trimStart();
    const closes = /^[})\]]/.test(after) ? unit : 0;
    return Math.max(0, base + opens - closes);
  }),
];
