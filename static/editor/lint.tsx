// nabic's diagnostics in the editor: CodeMirror lint diagnostics (the
// wavy underline, the tooltip, the panel Ctrl/⌘+Shift+M opens and F8
// steps through, both read by screen readers) and the line numbers of
// the lines they are on. A new compile replaces them, an edit clears
// them.
import { EditorState, RangeSet, StateField } from "@codemirror/state";
import type { Extension, Text } from "@codemirror/state";
import { GutterMarker, gutterLineClass } from "@codemirror/view";
import { lintKeymap, setDiagnostics, setDiagnosticsEffect } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { keymap } from "@codemirror/view";
import { render } from "preact";
import { Tip } from "../ui/tip.tsx";

// One of nabic's diagnostics; line 0 when it points nowhere in
// main.nabi. Columns count characters (code points), from 1.
export interface Diag {
  kind: string;
  warn: boolean;
  head: string;
  notes: [string, string][];
  line: number;
  col: number;
  len: number;
}

/** The UTF-16 length of the first `n` code points of `s`. */
export function units(s: string, n: number): number {
  let i = 0;
  for (let k = 0; k < n && i < s.length; k++) i += s.codePointAt(i)! > 0xffff ? 2 : 1;
  return i;
}

/** The offset of nabic's `line`:`col` in `doc`, clipped to the line. */
export function at(doc: Text, line: number, col: number): number {
  const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
  return l.from + units(l.text, Math.max(col - 1, 0));
}

function toDiagnostic(doc: Text, d: Diag): Diagnostic | null {
  if (!d.line || d.line > doc.lines) return null;
  const l = doc.line(d.line);
  const from = at(doc, d.line, d.col);
  const to = Math.min(from + units(l.text.slice(from - l.from), Math.max(d.len, 1)), l.to);
  return {
    from,
    to,
    severity: d.warn ? "warning" : "error",
    source: d.kind,
    message: d.head ? `${d.kind}: ${d.head}` : d.kind,
    renderMessage: () => {
      const box = document.createElement("div");
      box.className = "tip";
      render(<Tip d={d} />, box);
      return box;
    },
  };
}

const bad = new class extends GutterMarker { elementClass = "bad"; }();
const warn = new class extends GutterMarker { elementClass = "warn"; }();

// The line numbers' marks, set with the diagnostics.
const marked = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    for (const e of tr.effects) {
      if (!e.is(setDiagnosticsEffect)) continue;
      const lines = new Map<number, GutterMarker>();
      for (const d of e.value) {
        const from = tr.state.doc.lineAt(d.from).from;
        if (lines.get(from) !== bad) lines.set(from, d.severity === "error" ? bad : warn);
      }
      return RangeSet.of([...lines].sort((a, b) => a[0] - b[0]).map(([p, m]) => m.range(p)));
    }
    return tr.docChanged ? set.map(tr.changes) : set;
  },
  provide: (f) => gutterLineClass.from(f),
});

/** The diagnostics' place in the editor's state. */
export const diagnostics: Extension = [
  marked,
  keymap.of(lintKeymap),
  // An edit clears them, as the program they were about is gone.
  EditorState.transactionExtender.of((tr) => (tr.docChanged && tr.startState.field(marked).size ? { effects: setDiagnostics(tr.startState, []).effects } : null)),
];

/** A transaction that shows `diags` (in place of any shown). */
export function show(state: EditorState, diags: Diag[]): ReturnType<typeof setDiagnostics> {
  const list = diags.map((d) => toDiagnostic(state.doc, d)).filter((d): d is Diagnostic => d !== null);
  return setDiagnostics(state, list);
}
