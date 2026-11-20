// The editor's layers behind the textarea: the highlighted source, the
// diagnostics' wavy underlines, and the gutter's line numbers.
import type { ComponentChild, VNode } from "preact";

// One of nabic's diagnostics; line 0 when it points nowhere in
// main.nabi.
export interface Diag {
  kind: string;
  warn: boolean;
  head: string;
  notes: [string, string][];
  line: number;
  col: number;
  len: number;
}

// Highlighting with nabi-syntax's classes (k t s n c a). KEYWORDS is a
// hand-kept subset of its grammars/keywords.nabion.

const KEYWORDS = new Set(("fn let mut if else match for in while loop return break continue struct enum trait impl " +
  "pub use mod const static type as is none true false throws try catch async await yield self Self where ref " +
  "unsafe extern defer using move dyn any throw finally rethrows union some pkg sub sup macro gen do").split(" "));
const PRIMS = new Set("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str".split(" "));
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(f?"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)')|(#!?\[[^\]\n]*\]?)|(\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?(?:[iu](?:8|16|32|64|128|size)|f32|f64)?\b|\b0x[\da-fA-F_]+\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

// The highlighted source, rendered into <pre class="hl">. Plain runs
// between tokens are one string each, so the DOM is one text node per
// run. Typing re-renders it on every input: Preact patches the text
// nodes that changed instead of parsing the whole file again.
export function Code({ text }: { text: string }): VNode {
  const kids: ComponentChild[] = [];
  let plain = "";
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    plain += text.slice(last, m.index);
    last = m.index + m[0].length;
    const [w, com, str, attr, num] = m;
    const id = m[5] ?? "";
    const cls = com ? "c" : str ? "s" : attr ? "a" : num ? "n"
      : KEYWORDS.has(id) ? "k" : PRIMS.has(id) || /^[A-Z]/.test(id) ? "t" : "";
    if (!cls) { plain += w; continue; }
    if (plain) { kids.push(plain); plain = ""; }
    kids.push(<span class={cls}>{w}</span>);
  }
  kids.push(plain + text.slice(last) + "\n");
  return <code>{kids}</code>;
}

// The underline layer, rendered into <pre class="sqs">: the source in
// transparent ink, each diagnostic's span wrapped so only its wavy
// underline shows.
export function Underlines({ text, diags }: { text: string; diags: Diag[] }): VNode {
  const byLine = new Map<number, Diag[]>();
  for (const d of diags) if (d.line) (byLine.get(d.line) || byLine.set(d.line, []).get(d.line)!).push(d);
  const kids: ComponentChild[] = [];
  let plain = "";
  text.split("\n").forEach((ln, i) => {
    if (i) plain += "\n";
    const ds = byLine.get(i + 1);
    if (!ds) { plain += ln; return; }
    const d = ds[0]!;
    const a = Math.min(d.col - 1, ln.length), b = Math.min(a + Math.max(d.len, 1), Math.max(ln.length, a + 1));
    plain += ln.slice(0, a);
    if (plain) { kids.push(plain); plain = ""; }
    kids.push(<span class={d.warn ? "sq w" : "sq"}>{ln.slice(a, b) || " "}</span>);
    plain = ln.slice(b);
  });
  kids.push(plain + "\n");
  return <>{kids}</>;
}

// One <li> a line; CSS numbers them. A line with a diagnostic is marked
// "bad", or "warn" for a warning.
export function Gutter({ lines, marks }: { lines: number; marks: Map<number, string> }): VNode {
  return <>{Array.from({ length: lines }, (_, k) => <li class={marks.get(k + 1)} />)}</>;
}
