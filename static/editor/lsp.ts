// Completion, hover and go-to-definition from nabils, through a
// Transport (transport.ts). Each degrades to nothing: no answer, a slow
// one or an empty one leaves the editor as it was.
import type { EditorState, Extension } from "@codemirror/state";
import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap } from "@codemirror/view";
import type { Tooltip } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { CLASSES, COMMENT, STRING, classAt, lex } from "./syntax.ts";
import type { Position, Request, Transport } from "./transport.ts";
import { T } from "../ui/text.ts";

/** The LSP position of `pos`. */
export function position(state: EditorState, pos: number): Position {
  const line = state.doc.lineAt(pos);
  return { line: line.number - 1, character: pos - line.from };
}

/** The offset of LSP position `p`, clipped to the document. */
export function offset(state: EditorState, p: Position): number {
  const n = Math.min(Math.max(p.line + 1, 1), state.doc.lines);
  const line = state.doc.line(n);
  return Math.min(line.from + Math.max(p.character, 0), line.to);
}

// Answers kept until the next edit: hovering off a name and back asks
// nothing again.
function remembered(transport: Transport): (r: Request, state: EditorState, pos: number, signal: AbortSignal) => Promise<unknown> {
  let doc: unknown = null;
  let seen = new Map<string, unknown>();
  return async (r, state, pos, signal) => {
    if (doc !== state.doc) { doc = state.doc; seen = new Map(); }
    const at = position(state, pos);
    const key = `${r}:${at.line}:${at.character}`;
    if (seen.has(key)) return seen.get(key);
    const v = await transport.ask(r, state.doc.toString(), at, signal);
    if (!signal.aborted && doc === state.doc) seen.set(key, v);
    return v;
  };
}

// Nothing is asked inside a comment or a string.
function inProse(view: EditorView | undefined, pos: number): boolean {
  if (!view || pos === 0) return false;
  const k = classAt(view, pos - 1);
  return k === COMMENT || k === STRING;
}

// LSP CompletionItemKind to CodeMirror's completion types.
const KINDS: Record<number, string> = {
  2: "method", 3: "function", 4: "function", 5: "property", 6: "variable", 7: "class", 8: "interface",
  9: "namespace", 10: "property", 13: "enum", 14: "keyword", 20: "constant", 21: "constant", 22: "class",
  23: "keyword", 25: "type",
};

interface LspItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value: string };
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: { newText: string };
  sortText?: string;
}

// A snippet's text without its tab stops (`${1:x}` is x, `$0` nothing).
const plain = (s: string): string => s.replace(/\$\{\d+:([^}]*)\}/g, "$1").replace(/\$\d+/g, "");

function option(it: LspItem, boost: number): Completion {
  const text = it.textEdit?.newText ?? it.insertText ?? it.label;
  const docs = typeof it.documentation === "string" ? it.documentation : it.documentation?.value;
  return {
    label: it.label,
    apply: it.insertTextFormat === 2 ? plain(text) : text,
    detail: it.detail || undefined,
    type: KINDS[it.kind ?? 0],
    info: docs ? () => markdown(docs) : undefined,
    boost,
  };
}

/**
 * Completion as the visitor types a name, or after `.` and `::`, and
 * on Ctrl+Space. One answer serves the rest of the name: further
 * letters only filter it.
 */
function completion(ask: ReturnType<typeof remembered>): Extension {
  const source = async (cx: CompletionContext): Promise<CompletionResult | null> => {
    const word = cx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
    const from = word ? word.from : cx.pos;
    const before = cx.state.sliceDoc(Math.max(0, from - 2), from);
    const member = before.endsWith(".") || before.endsWith("::");
    if (!cx.explicit && !member && !word) return null;
    if (inProse(cx.view, from)) return null;
    const ctl = new AbortController();
    cx.addEventListener("abort", () => ctl.abort());
    const r = (await ask("completion", cx.state, cx.pos, ctl.signal)) as LspItem[] | { items?: LspItem[] } | null;
    const items = Array.isArray(r) ? r : r?.items ?? [];
    if (cx.aborted || !items.length) return null;
    // nabils' order, kept where the typed letters match equally
    const options = items.map((it, i) => option(it, -i / items.length));
    return { from, options, validFor: /^[A-Za-z0-9_]*$/ };
  };
  return autocompletion({ override: [source], activateOnTypingDelay: 250, icons: true });
}

/**
 * The few pieces of Markdown nabils writes: ```nabi blocks, highlighted
 * as the editor highlights, `code` and paragraphs. Built as DOM, never
 * parsed as HTML.
 */
export function markdown(md: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "cm-lsp-doc";
  const parts = md.split(/^```[\w-]*\n?/m);
  parts.forEach((part, i) => {
    const text = part.replace(/\n$/, "");
    if (!text.trim()) return;
    if (i % 2 === 1) {
      const pre = document.createElement("pre");
      const cls = lex(text);
      let a = 0;
      while (a < text.length) {
        const k = cls[a] ?? 0;
        let b = a + 1;
        while (b < text.length && cls[b] === k) b++;
        const run = text.slice(a, b);
        if (k) {
          const s = document.createElement("span");
          s.className = CLASSES[k]!;
          s.textContent = run;
          pre.append(s);
        } else pre.append(run);
        a = b;
      }
      box.append(pre);
      return;
    }
    for (const para of text.split(/\n{2,}/)) {
      if (!para.trim()) continue;
      const p = document.createElement("p");
      para.split(/(`[^`\n]+`)/).forEach((bit) => {
        if (bit.startsWith("`") && bit.endsWith("`") && bit.length > 1) {
          const c = document.createElement("code");
          c.textContent = bit.slice(1, -1);
          p.append(c);
        } else if (bit) p.append(bit.replace(/\n/g, " "));
      });
      box.append(p);
    }
  });
  return box;
}

type Markup = string | { value: string; language?: string };
const markupText = (c: Markup): string => (typeof c === "string" ? c : c.language ? "```" + c.language + "\n" + c.value + "\n```" : c.value);

/** Hover: a name's signature and docs, after the pointer rests 400 ms. */
function hover(ask: ReturnType<typeof remembered>): Extension {
  return hoverTooltip(async (view, pos, side): Promise<Tooltip | null> => {
    const word = view.state.wordAt(pos);
    if (!word || (pos === word.from && side < 0) || (pos === word.to && side > 0)) return null;
    if (inProse(view, word.from + 1)) return null;
    const ctl = new AbortController();
    const r = (await ask("hover", view.state, word.from, ctl.signal)) as { contents?: Markup | Markup[] } | null;
    const c = r?.contents;
    const text = Array.isArray(c) ? c.map(markupText).join("\n\n") : c ? markupText(c) : "";
    if (!text.trim()) return null;
    return {
      pos: word.from,
      end: word.to,
      above: true,
      create: () => ({ dom: markdown(text) }),
    };
  }, { hoverTime: 400 });
}

interface Location { uri?: string; targetUri?: string; range?: Range; targetSelectionRange?: Range }
interface Range { start: Position; end: Position }

/** Jumps to the definition of the name at `pos`, when it is in main.nabi. */
async function define(view: EditorView, pos: number, ask: ReturnType<typeof remembered>): Promise<boolean> {
  const state = view.state;
  const r = (await ask("definition", state, pos, new AbortController().signal)) as Location | Location[] | null;
  const loc = Array.isArray(r) ? r[0] : r;
  const range = loc?.targetSelectionRange ?? loc?.range;
  if (!loc || !range || (loc.uri ?? loc.targetUri) !== "main.nabi" || view.state.doc !== state.doc) return false;
  const from = offset(state, range.start), to = offset(state, range.end);
  const line = state.doc.lineAt(from);
  view.dispatch({
    selection: EditorSelection.single(from, to),
    effects: [EditorView.scrollIntoView(from, { y: "center" }), EditorView.announce.of(T.definedAt(line.number, line.text.trim()))],
    userEvent: "select.definition",
  });
  view.focus();
  return true;
}

/**
 * The language features on `transport`: completion, hover, and the
 * definition on F12 or a Ctrl/⌘-click on a name (elsewhere such a
 * click adds a cursor, as CodeMirror does).
 */
export function language(transport: Transport): Extension {
  const ask = remembered(transport);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return [
    completion(ask),
    hover(ask),
    Prec.high(keymap.of([{ key: "F12", run: (v) => { void define(v, v.state.selection.main.head, ask); return true; } }])),
    Prec.high(EditorView.domEventHandlers({
      mousedown(ev, view) {
        if (ev.button !== 0 || !(mac ? ev.metaKey : ev.ctrlKey) || ev.altKey || ev.shiftKey) return false;
        const pos = view.posAtCoords(ev);
        const word = pos === null ? null : view.state.wordAt(pos);
        if (pos === null || !word) return false;
        ev.preventDefault();
        void define(view, pos, ask);
        return true;
      },
    })),
  ];
}
