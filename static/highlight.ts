// The editor's highlighting with nabi-syntax's tree-sitter grammar and
// highlight queries (static/ts/, scripts/sync-grammar.mjs), loaded after
// the page: play.tsx imports this script, and until it is ready, or if
// it fails, the editor keeps its own lexer. Each edit re-parses only
// what changed (tree.edit, then parse with the old tree).
//
// Captures map to the classes nabi-syntax's own highlighter gives the
// docs (k t s n c a m), so the editor and the docs agree in both themes.
import { Edit, Language, Parser, Query } from "web-tree-sitter";
import type { Point, Tree } from "web-tree-sitter";

export interface Highlighter {
  /** One class index a UTF-16 unit of `text` (CLASSES), or null. */
  classes(text: string): Uint8Array | null;
  /** The last text's classes painted from the whole tree (tests). */
  whole(): Uint8Array;
}

/** Index 0 is plain text. */
export const CLASSES = ["", "k", "t", "s", "n", "c", "a", "m"];

// The class of a capture: its first dotted part, or the whole name.
function classOf(name: string): number {
  if (name === "function.macro") return 7;
  if (name === "variable.builtin" || name === "boolean" || name === "constant.builtin") return 1;
  const head = name.split(".")[0];
  switch (head) {
    case "keyword": return 1;
    case "type": return 2;
    case "string": case "character": return 3;
    case "number": return 4;
    case "comment": return 5;
    case "attribute": return 6;
    default: return 0;
  }
}

// Where `i` (a UTF-16 index of `text`) is, as tree-sitter counts it.
function point(text: string, i: number): Point {
  let row = 0;
  let start = 0;
  for (let k = text.indexOf("\n"); k >= 0 && k < i; k = text.indexOf("\n", k + 1)) {
    row++;
    start = k + 1;
  }
  return { row, column: i - start };
}

// Each file of static/ts/ by its address with its version: the page's
// <meta name="nabi-ts" content="name=version,..."> (main.nabi stamps it),
// so a browser keeps each until it changes.
function at(base: string, name: string): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="nabi-ts"]')?.content ?? "";
  for (const kv of meta.split(",")) {
    const [n, v] = kv.split("=");
    if (n === name && v) return `${base}${name}?v=${v}`;
  }
  return base + name;
}

async function load(base: string): Promise<Highlighter> {
  await Parser.init({ locateFile: (name: string) => at(base, name) });
  const lang = await Language.load(at(base, "tree-sitter-nabi.wasm"));
  const query = new Query(lang, await (await fetch(at(base, "highlights.scm"))).text());
  const parser = new Parser();
  parser.setLanguage(lang);
  const byName = new Map(query.captureNames.map((n) => [n, classOf(n)] as [string, number]));

  let old = "";
  let tree: Tree | null = null;
  let painted = new Uint8Array(0);

  // Paint the captures that meet [from, to) into `out`, which is clear
  // there: larger nodes first, so a node inside one (an escape in a
  // string) paints over it; on the same node the later pattern wins, as
  // in tree-sitter-highlight and Neovim. Outside the span the classes
  // stand: a capture reaching past it paints only its part inside.
  const paint = (t: Tree, out: Uint8Array, from: number, to: number): void => {
    // The query's range is in bytes of the UTF-16 text the parser was
    // given (two a unit); nodes and edits count units.
    const caps = query.captures(t.rootNode, { startIndex: from * 2, endIndex: to * 2 })
      .map((c) => ({ s: c.node.startIndex, e: c.node.endIndex, p: c.patternIndex, k: byName.get(c.name) ?? 0 }))
      .sort((x, y) => (y.e - y.s) - (x.e - x.s) || x.p - y.p);
    // A plain capture (a variable, a bracket) leaves what is under it:
    // an interpolation stays in its string's colour, as in the docs.
    for (const c of caps) if (c.k) out.fill(c.k, Math.max(c.s, from), Math.min(c.e, to));
  };

  return {
    whole(): Uint8Array {
      const out = new Uint8Array(old.length);
      if (tree) paint(tree, out, 0, old.length);
      return out;
    },
    classes(text: string): Uint8Array | null {
      if (tree && text === old) return painted;
      if (!tree) {
        tree = parser.parse(text);
        if (!tree) return null;
        old = text;
        painted = new Uint8Array(text.length);
        paint(tree, painted, 0, text.length);
        return painted;
      }
      // The one changed span: the common prefix and suffix stay.
      let a = 0;
      const n = Math.min(old.length, text.length);
      while (a < n && old.charCodeAt(a) === text.charCodeAt(a)) a++;
      let b = 0;
      while (b < n - a && old.charCodeAt(old.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
      const oldEnd = old.length - b;
      const newEnd = text.length - b;
      tree.edit(new Edit({
        startIndex: a,
        oldEndIndex: oldEnd,
        newEndIndex: newEnd,
        startPosition: point(old, a),
        oldEndPosition: point(old, oldEnd),
        newEndPosition: point(text, newEnd),
      }));
      const next = parser.parse(text, tree);
      if (!next) return null;
      // The classes move with the text around the edit; what the edit
      // touched, and what the parse says changed shape, are painted anew.
      const out = new Uint8Array(text.length);
      const clean = !(tree.rootNode.hasError || next.rootNode.hasError);
      if (clean) {
        out.set(painted.subarray(0, a), 0);
        out.set(painted.subarray(oldEnd), newEnd);
      }
      // Error recovery can reshape the tree far from the edit without
      // getChangedRanges saying so: with an error on either side, all
      // of it is painted again.
      if (tree.rootNode.hasError || next.rootNode.hasError) {
        paint(next, out, 0, text.length);
        tree.delete();
        tree = next;
        old = text;
        painted = out;
        return out;
      }
      const spans: [number, number][] = [[a, newEnd]];
      for (const r of tree.getChangedRanges(next)) spans.push([r.startIndex, r.endIndex]);
      // Whole lines: a capture that starts before the span but on its
      // line is caught too.
      let lo = text.length, hi = 0;
      for (const [s, e] of spans) { lo = Math.min(lo, s); hi = Math.max(hi, e); }
      lo = text.lastIndexOf("\n", Math.max(lo - 1, 0)) + 1;
      const nl = text.indexOf("\n", hi);
      hi = nl < 0 ? text.length : nl + 1;
      out.fill(0, lo, hi);
      paint(next, out, lo, hi);
      tree.delete();
      tree = next;
      old = text;
      painted = out;
      return out;
    },
  };
}

declare global {
  // eslint-disable-next-line no-var
  var nabiHighlight: Promise<Highlighter> | undefined;
}

globalThis.nabiHighlight = load("/ts/");
