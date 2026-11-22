// The playground's editor: CodeMirror 6 with Nabi's highlighting,
// folding and indentation (syntax.ts), nabic's diagnostics (lint.tsx)
// and nabils' completion, hover and definitions (lsp.ts). play.tsx
// drives it through the Editor below.
import "./style.ts";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers, rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import type { Highlighter } from "../highlight.ts";
import { diagnostics, show, at } from "./lint.tsx";
import type { Diag } from "./lint.tsx";
import { folding, highlighting, indentation, repaint } from "./syntax.ts";
import { language } from "./lsp.ts";
import { T } from "../ui/text.ts";
import type { Transport } from "./transport.ts";

export type { Diag };

export interface Options {
  /** What the content is called and described by (element ids). */
  labelledBy: string;
  describedBy: string;
  /** Ctrl/⌘+Enter. */
  run: () => void;
  /** After every change of the text. */
  changed: () => void;
  /** After the caret moves: its 1-based line and character column. */
  moved: (line: number, col: number) => void;
  /** nabils; none, and the editor has no completion, hover or definitions. */
  transport?: Transport;
}

export interface Editor {
  readonly view: EditorView;
  text(): string;
  /** A new text with no undo history: another example, a link's code. */
  load(text: string): void;
  /** The whole text replaced as one edit, so Undo brings the old back. */
  replace(text: string): void;
  /** The caret at nabic's line:col (characters, from 1), in view. */
  goTo(line: number, col: number): void;
  /** The caret's 1-based line and character column. */
  caret(): { line: number; col: number };
  setDiagnostics(diags: Diag[]): void;
  setHighlighter(h: Highlighter | null): void;
  /** While on, the text cannot be changed (it is loading). */
  setReadOnly(on: boolean): void;
  focus(): void;
}

// Comments, brackets and when to re-indent, for CodeMirror's commands.
const nabiData = EditorState.languageData.of(() => [{
  commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  closeBrackets: { brackets: ["(", "[", "{", '"'], stringPrefixes: ["f", "r"] },
  indentOnInput: /^\s*[}\])]$/,
  wordChars: "_",
}]);

export function createEditor(parent: HTMLElement, o: Options): Editor {
  let highlighter: Highlighter | null = null;
  let locked = false;
  const readOnly = new Compartment();
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter({ markerDOM: (open) => marker(open) }),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    codeFolding(),
    EditorState.phrases.of(T.phrases),
    nabiData,
    indentation,
    folding,
    highlighting(() => highlighter, () => { highlighter = null; }),
    diagnostics,
    o.transport ? language(o.transport) : [],
    Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => { o.run(); return true; } }])),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      // Tab indents; Escape, then Tab, leaves the editor (CodeMirror's
      // tab focus mode), so the keyboard is never trapped.
      indentWithTab,
    ]),
    EditorView.contentAttributes.of({
      "aria-labelledby": o.labelledBy,
      "aria-describedby": o.describedBy,
      spellcheck: "false",
      autocapitalize: "off",
      autocorrect: "off",
      translate: "no",
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) o.changed();
      if (u.docChanged || u.selectionSet) {
        const c = caretOf(u.state);
        o.moved(c.line, c.col);
      }
    }),
  ];
  const state = (doc: string): EditorState => EditorState.create({ doc, extensions: [extensions, readOnly.of(EditorState.readOnly.of(locked))] });
  const view = new EditorView({ state: state(""), parent });

  return {
    view,
    text: () => view.state.doc.toString(),
    load(text) {
      view.setState(state(text));
      view.scrollDOM.scrollTop = view.scrollDOM.scrollLeft = 0;
      const c = caretOf(view.state);
      o.moved(c.line, c.col);
    },
    replace(text) {
      const { line, col } = caretOf(view.state);
      const top = view.scrollDOM.scrollTop;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input.replace" });
      const doc = view.state.doc;
      view.dispatch({ selection: EditorSelection.cursor(at(doc, Math.min(line, doc.lines), col)) });
      view.scrollDOM.scrollTop = top;
    },
    goTo(line, col) {
      const pos = at(view.state.doc, line, col);
      view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      view.focus();
    },
    caret: () => caretOf(view.state),
    setDiagnostics(diags) {
      view.dispatch(show(view.state, diags));
    },
    setHighlighter(h) {
      highlighter = h;
      view.dispatch({ effects: repaint.of(null) });
    },
    setReadOnly(on) {
      locked = on;
      view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(on)) });
    },
    focus: () => view.focus(),
  };
}

// The caret's line and its column in characters, as nabic counts them.
function caretOf(state: EditorState): { line: number; col: number } {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, col: [...line.text.slice(0, head - line.from)].length + 1 };
}

// The fold gutter's chevron.
function marker(open: boolean): HTMLElement {
  const span = document.createElement("span");
  span.className = open ? "fold open" : "fold";
  span.setAttribute("aria-hidden", "true");
  span.textContent = open ? "⌄" : "›";
  return span;
}
