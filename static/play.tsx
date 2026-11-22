// The playground page: an editor with highlighting, the compile request,
// a worker that runs the module, examples, and share links (a short
// /p/<id> link the server stores, else the code deflated in the link's
// #fragment). What the script builds (the editor's layers, the
// transcript, the tooltip, the example list, the Run button's face)
// comes from Preact components in ui/, rendered into the page's own
// elements.
import { render } from "preact";
import type { VNode } from "preact";
import { Code, Gutter, Underlines } from "./ui/editor.tsx";
import type { Diag } from "./ui/editor.tsx";
import type { Highlighter } from "./highlight.ts";
import { Examples } from "./ui/examples.tsx";
import { Batch, Output } from "./ui/output.tsx";
import type { Chunk } from "./ui/output.tsx";
import { RunLabel } from "./ui/run-label.tsx";
import { Tip } from "./ui/tip.tsx";
import { BASE, KO, T } from "./ui/text.ts";

// An element the page always has.
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
// Elements that keep a pending animation or timer on themselves.
type Resizable = HTMLElement & { rz?: Animation };
type Timed = HTMLButtonElement & { reset?: ReturnType<typeof setTimeout> };
const ed = $<HTMLTextAreaElement>("editor");
const hl = document.querySelector<HTMLElement>(".hl")!;
const gutter = document.querySelector<HTMLOListElement>(".gutter")!;
const out = $<HTMLPreElement>("out");
const status = $("status");
const runBtn = $<HTMLButtonElement>("run");
const pick = $<HTMLSelectElement>("example");
const opt = $<HTMLSelectElement>("opt");
const sqs = document.querySelector<HTMLElement>(".sqs")!;
const tip = $<HTMLDivElement>("tip");
const pos = $("pos");
const diagBtn = $<HTMLButtonElement>("diag");

// Motion (nabi.css): what changes size after the visitor's first touch
// eases from the old size to the new; before it (load-time state) and
// with reduced motion it snaps. #diag and #reset fade only once live.
const still = matchMedia("(prefers-reduced-motion: reduce)");
let live = false;
function wake(): void {
  if (live) return;
  live = true;
  diagBtn.classList.add("appear");
  $("reset").classList.add("appear");
}
addEventListener("pointerdown", wake, { capture: true, once: true });
addEventListener("keydown", wake, { capture: true, once: true });
// nabiResize of the kit's copy.js: run change, then ease el's width and
// height to the result. One line, cut not wrapped, while it catches up.
function resize(el: Resizable, change: () => void): void {
  const w0 = el.offsetWidth, h0 = el.offsetHeight;
  if (el.rz) el.rz.cancel();
  change();
  const w1 = el.offsetWidth, h1 = el.offsetHeight;
  if (!live || still.matches || !el.animate || !w0 || !w1 || (w0 === w1 && h0 === h1)) return;
  const from: Keyframe = { overflow: "hidden", whiteSpace: "nowrap", textOverflow: "clip" }, to: Keyframe = { ...from };
  if (w0 !== w1) { from.width = `${w0}px`; to.width = `${w1}px`; }
  if (h0 !== h1) { from.height = `${h0}px`; to.height = `${h1}px`; }
  el.rz = el.animate([from, to], { duration: 200, easing: "cubic-bezier(.2,0,0,1)" });
}

// nabi-syntax's tree-sitter highlighting (highlight.ts), loaded after
// the page; until then, or if it cannot load, the editor's own lexer.
let highlighter: Highlighter | null = null;
addEventListener("load", () => {
  import("/highlight.js")
    .then(() => globalThis.nabiHighlight)
    .then((h) => { if (h) { highlighter = h; paint(); } })
    .catch(() => {});
});

// The last failed compile's diagnostics that point into main.nabi.
// Cleared on the next edit.
let diags: Diag[] = [];

// The layers follow the text on every edit; the gutter only when its
// line count or its marks change.
function paint(): void {
  let cls: Uint8Array | null = null;
  try { cls = highlighter ? highlighter.classes(ed.value) : null; } catch { highlighter = null; }
  render(<Code text={ed.value} cls={cls} />, hl);
  render(diags.length ? <Underlines text={ed.value} diags={diags} /> : null, sqs);
  const n = ed.value.split("\n").length;
  if (gutter.childElementCount !== n || gutter.dataset.marked || diags.length) {
    const bad = new Map(diags.filter((d) => d.line).map((d) => [d.line, d.warn ? "warn" : "bad"]));
    render(<Gutter lines={n} marks={bad} />, gutter);
    if (bad.size) gutter.dataset.marked = "1"; else delete gutter.dataset.marked;
  }
  showDiagCount();
}
function sync(): void {
  for (const el of [hl, sqs]) { el.scrollTop = ed.scrollTop; el.scrollLeft = ed.scrollLeft; }
  gutter.scrollTop = ed.scrollTop;
  hideTip();
}

ed.addEventListener("input", () => { diags = []; hideTip(); paint(); keep(); });
ed.addEventListener("scroll", sync);

// Caret position, diagnostics count, and the diagnostic tooltip.

function caretAt(i: number): { line: number; col: number } {
  const before = ed.value.slice(0, i);
  const line = before.split("\n").length;
  return { line, col: i - before.lastIndexOf("\n") };
}
function showPos(): void {
  const { line, col } = caretAt(ed.selectionStart);
  pos.textContent = T.pos(line, col);
  const d = diags.find((x) => x.line === line);
  if (d && document.activeElement === ed) showTip(d); else if (!hovering) hideTip();
}
document.addEventListener("selectionchange", () => { if (document.activeElement === ed) showPos(); });
ed.addEventListener("blur", () => { if (!hovering) hideTip(); });

function showDiagCount(): void {
  const errs = diags.filter((d) => !d.warn).length, warns = diags.length - errs;
  const parts: string[] = [];
  if (errs) parts.push(T.errors(errs));
  if (warns) parts.push(T.warnings(warns));
  const text = parts.join(", ");
  // keeps its last count while it fades out
  diagBtn.hidden = !text;
  if (text && text !== diagBtn.textContent) resize(diagBtn, () => { diagBtn.textContent = text; });
  diagBtn.classList.toggle("w", !errs && warns > 0);
  diagBtn.title = diags.some((d) => d.line) ? T.firstDiag : "";
}
// Puts the caret at line:col and scrolls it into view. On stacked
// panes the editor comes back into view too.
function goTo(line: number, col: number): void {
  const lines = ed.value.split("\n");
  let i = 0;
  for (let k = 0; k < line - 1 && k < lines.length; k++) i += lines[k]!.length + 1;
  i += Math.min(col - 1, (lines[line - 1] || "").length);
  ed.focus({ preventScroll: true });
  ed.setSelectionRange(i, i);
  const cs = getComputedStyle(ed);
  const lh = parseFloat(cs.lineHeight);
  ed.scrollTop = Math.max(0, (line - 4) * lh);
  const x = parseFloat(cs.paddingLeft) + (col - 1) * cellWidth();
  if (x < ed.scrollLeft || x > ed.scrollLeft + ed.clientWidth - 24) ed.scrollLeft = Math.max(0, x - ed.clientWidth / 2);
  sync();
  const pane = ed.closest(".ed-pane")!.getBoundingClientRect();
  if (pane.top < 0 || pane.bottom > innerHeight) ed.closest(".ed-pane")!.scrollIntoView({ block: "nearest" });
  showPos();
}
// The count jumps to the first diagnostic with a place in the source.
diagBtn.addEventListener("click", () => {
  const d = diags.find((x) => x.line);
  if (d) goTo(d.line, d.col);
});

// One monospace cell, measured once the fonts are in.
let cell = 0;
function cellWidth(): number {
  if (cell) return cell;
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(40);
  sqs.append(probe);
  cell = probe.getBoundingClientRect().width / 40;
  probe.remove();
  return cell;
}
document.fonts && document.fonts.ready.then(() => { cell = 0; });

function showTip(d: Diag): void {
  render(<Tip d={d} />, tip);
  const cs = getComputedStyle(ed);
  const lh = parseFloat(cs.lineHeight), padT = parseFloat(cs.paddingTop), padL = parseFloat(cs.paddingLeft);
  tip.hidden = false;
  const box = ed.parentElement!.getBoundingClientRect();
  let left = padL + (d.col - 1) * cellWidth() - ed.scrollLeft - 12;
  left = Math.max(8, Math.min(left, box.width - tip.offsetWidth - 8));
  tip.style.left = `${left}px`;
  tip.style.top = `${tipTop(d.line, tip.offsetHeight, box.height, lh, padT)}px`;
}
// Below the line, else above it, else past the run of marked lines it
// sits in: never over another underlined line if there is room.
function tipTop(line: number, h: number, room: number, lh: number, padT: number): number {
  const y = (n: number): number => padT + (n - 1) * lh - ed.scrollTop;
  const marked = new Set(diags.map((x) => x.line));
  let a = line, b = line;
  while (marked.has(a - 1)) a--;
  while (marked.has(b + 1)) b++;
  const fits = (t: number): boolean => t >= 4 && t + h <= room - 4;
  const clear = (t: number): boolean => fits(t) && ![...marked].some((n) => n !== line && y(n) < t + h && y(n) + lh > t);
  const tries = [y(line + 1) + 6, y(line) - h - 6, y(b + 1) + 6, y(a) - h - 6] as const;
  return tries.find(clear) ?? tries.find(fits) ?? tries[0];
}
function hideTip(): void { tip.hidden = true; }

// Hovering the underlined span shows its diagnostic too.
let hovering = false;
ed.addEventListener("mousemove", (ev) => {
  if (!diags.length) return;
  const cs = getComputedStyle(ed);
  const lh = parseFloat(cs.lineHeight);
  const line = Math.floor((ev.offsetY + ed.scrollTop - parseFloat(cs.paddingTop)) / lh) + 1;
  const col = Math.floor((ev.offsetX + ed.scrollLeft - parseFloat(cs.paddingLeft)) / cellWidth()) + 1;
  const d = diags.find((x) => x.line === line && col >= x.col && col < x.col + Math.max(x.len, 1));
  hovering = !!d;
  if (d) showTip(d); else if (!(document.activeElement === ed && diags.some((x) => x.line === caretAt(ed.selectionStart).line))) hideTip();
});
ed.addEventListener("mouseleave", () => { hovering = false; if (document.activeElement !== ed) hideTip(); else showPos(); });
// A code-editor keystroke: what to do (or null to leave it to the
// textarea). The handler applies it with execCommand so undo still works.
type EditAction =
  | { insert: string; caret: number }
  | { replace: [number, number]; text: string; sel: [number, number] }
  | { del: [number, number] }
  | { caret: number };
const PAIRS: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
function editAction(v: string, s: number, e: number, key: string, shift: boolean): EditAction | null {
  const lineStart = v.lastIndexOf("\n", s - 1) + 1;
  const indent = (v.slice(lineStart, s).match(/^[ \t]*/) || [""])[0];
  const before = v[s - 1], after = v[s];

  if (key === "Enter" && !shift && s === e) {
    if (before === "{" && after === "}") {
      return { insert: "\n" + indent + "    \n" + indent, caret: 1 + indent.length + 4 };
    }
    const add = before !== undefined && "{([".includes(before) ? "    " : "";
    return { insert: "\n" + indent + add, caret: 1 + indent.length + add.length };
  }

  if (key === "Tab") {
    if (s === e && !shift) return { insert: "    ", caret: 4 };
    const ls = lineStart;
    let le = v.indexOf("\n", e > s ? e - 1 : e);
    if (le === -1) le = v.length;
    const out = v.slice(ls, le).split("\n").map((ln) => {
      if (shift) {
        if (ln.startsWith("    ")) return ln.slice(4);
        if (ln.startsWith("\t")) return ln.slice(1);
        return ln.replace(/^ {1,3}/, "");
      }
      return ln === "" ? ln : "    " + ln;
    }).join("\n");
    return { replace: [ls, le], text: out, sel: [ls, ls + out.length] };
  }

  if (s === e) {
    if (PAIRS[key]) {
      if (!after || /[\s)\]},;]/.test(after)) return { insert: key + PAIRS[key], caret: 1 };
      return null;
    }
    if (key === '"') {
      if (after === '"') return { caret: s + 1 };
      if (!after || /[\s)\]},;]/.test(after)) return { insert: '""', caret: 1 };
      return null;
    }
    if ((key === "}" || key === ")" || key === "]") && after === key) return { caret: s + 1 };
    if (key === "Backspace" && (PAIRS[before ?? ""] === after || (before === '"' && after === '"'))) {
      return { del: [s - 1, s + 1] };
    }
  }
  return null;
}

// Tab indents, so Escape first hands the next Tab back to the browser
// and keyboard users can leave the editor (no keyboard trap).
let escaped = false;
ed.addEventListener("blur", () => { escaped = false; });
ed.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); run(); return; }
  if (ev.key === "Escape") { escaped = true; hideTip(); return; }
  if (ev.key === "Shift") return;
  if (ev.key === "Tab" && escaped) { escaped = false; return; }
  escaped = false;
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const a = editAction(ed.value, ed.selectionStart, ed.selectionEnd, ev.key, ev.shiftKey);
  if (!a) return;
  ev.preventDefault();
  const s = ed.selectionStart;
  if ("insert" in a) {
    document.execCommand("insertText", false, a.insert);
    ed.setSelectionRange(s + a.caret, s + a.caret);
  } else if ("replace" in a) {
    ed.setSelectionRange(a.replace[0], a.replace[1]);
    document.execCommand("insertText", false, a.text);
    ed.setSelectionRange(a.sel[0], a.sel[1]);
  } else if ("del" in a) {
    ed.setSelectionRange(a.del[0], a.del[1]);
    document.execCommand("delete");
  } else if ("caret" in a) {
    ed.setSelectionRange(a.caret, a.caret);
  }
});


// What the editor shows: the visitor's own code ("mine", kept in
// localStorage "play.mine"), code from a share link ("link", kept in
// "play.link"), or an example. Picking an example never touches "mine";
// edits to an example are kept per example ("play.ex.<name>") until
// Reset example puts it back.

// An example that uses a package the server does not have is left out:
// main.nabi names them in <meta name="nabi-examples-off">.
const OFF = new Set((document.querySelector<HTMLMetaElement>('meta[name="nabi-examples-off"]')?.content ?? "").split(","));
const EXAMPLES: [file: string, label: string][] = [
  "hello", "sums", "none", "errors", "iter", "structs", "input",
  "json", "stats", "linalg", "plot", "error", "try",
].filter((f) => !OFF.has(f)).map((f) => [f, T.examples[f] ?? f]);
// "Code from the link" joins the list once there is such code.
let hasLink = false;
const drawExamples = (): void => render(<Examples list={EXAMPLES} link={hasLink} />, pick);
drawExamples();
const NAMES = new Set(EXAMPLES.map(([file]) => file));

const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch {} },
  del(k: string): void { try { localStorage.removeItem(k); } catch {} },
};
const texts = new Map<string, string>();
async function exampleText(file: string): Promise<string> {
  if (!texts.has(file)) {
    // a proxy's error page is not an example
    const res = await fetch(`/examples/${file}.nabi`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    texts.set(file, await res.text());
  }
  return texts.get(file)!;
}

let view = "mine";
let mine = "";
let linked: string | null = null;
const resetBtn = $<HTMLButtonElement>("reset");

// The example a #example=<name> address names, or null.
function exampleIn(hash: string): string | null {
  const m = hash.match(/^#example=([\w-]+)(?:&|$)/);
  return m && NAMES.has(m[1]!) ? m[1]! : null;
}
// The address of a view: an example by name, else the bare page. A
// share's or a link's address stays until the first edit.
function addressFor(v: string): string { return NAMES.has(v) ? `${BASE}#example=${v}` : BASE; }
function syncAddress(): void {
  const to = addressFor(view);
  if (location.pathname + location.search + location.hash !== to) history.replaceState(null, "", to);
}

// Untouched Hello world is still Hello world, not "Your code".
function syncPick(): void {
  pick.value = view === "mine" && ed.value === texts.get("hello") ? "hello" : view;
  resetBtn.hidden = !(NAMES.has(view) && texts.has(view) && ed.value !== texts.get(view));
}
function show(text: string, v: string): void {
  view = v;
  if (v === "mine" || v === "link") store.set("play.view", v);
  ed.value = text;
  diags = [];
  hideTip();
  paint();
  ed.setSelectionRange(0, 0);
  ed.scrollTop = ed.scrollLeft = 0;
  sync();
  syncPick();
  showPos();
}
function keep(): void {
  if (view === "mine") { mine = ed.value; store.set("play.mine", mine); }
  else if (view === "link") { linked = ed.value; store.set("play.link", linked); }
  else if (ed.value === texts.get(view)) store.del(`play.ex.${view}`);
  else store.set(`play.ex.${view}`, ed.value);
  syncPick();
  syncAddress();
}
function addLinkOption(): void {
  if (!hasLink) { hasLink = true; drawExamples(); }
}
// An example as last edited here, and what it prints.
async function showExample(name: string): Promise<void> {
  let orig: string;
  try { orig = await exampleText(name); } catch { say(T.down, "bad"); return; }
  show(store.get(`play.ex.${name}`) ?? orig, name);
  if (name === "input" && !stdinEd.value.trim()) { setStdin(SAMPLE_INPUT); stdinOpen(true); }
  run(true);
}
pick.addEventListener("change", async () => {
  const v = pick.value;
  if (v === "mine") show(mine, "mine");
  else if (v === "link") show(linked!, "link");
  else await showExample(v);
  syncAddress();
});
// Reset example goes in as one edit, so Undo brings the edits back.
resetBtn.addEventListener("click", () => {
  const orig = texts.get(view);
  if (orig === undefined) return;
  ed.focus({ preventScroll: true });
  ed.select();
  if (!document.execCommand("insertText", false, orig)) { ed.value = orig; ed.dispatchEvent(new Event("input")); }
  ed.setSelectionRange(0, 0);
  ed.scrollTop = ed.scrollLeft = 0;
  sync();
  showPos();
});
// An address typed or pasted over this page's: an example opens here, a
// link's code goes through the start-up below.
addEventListener("hashchange", () => {
  const ex = exampleIn(location.hash);
  if (ex) showExample(ex);
  else if (/^#(code|src)=/.test(location.hash)) location.reload();
  else if (/^#example=/.test(location.hash)) syncAddress();
});

// The code in the link: #code= is the deflated source; #src= the plain
// UTF-8, for browsers without deflate-raw (Chrome < 103, Safari < 16.4,
// Samsung Internet < 20). Both are base64url.

const LINK_LIMIT = 262144;
function can(stream: "CompressionStream" | "DecompressionStream"): boolean {
  try { new globalThis[stream]("deflate-raw"); return true; } catch { return false; }
}
const canDeflate = can("CompressionStream");
// In slices: JavaScriptCore caps a call at 64Ki arguments.
function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function pack(text: string): Promise<string> {
  if (!canDeflate) return "src=" + b64(new TextEncoder().encode(text));
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return "code=" + b64(new Uint8Array(await new Response(s).arrayBuffer()));
}
async function unpack(kind: string, data: string): Promise<string> {
  if (kind === "src") {
    if (data.length > LINK_LIMIT * 4 / 3 + 4) throw new Error("too large");
    return new TextDecoder().decode(unb64(data));
  }
  // Read the decompressed bytes with a cap, so a crafted link cannot
  // decompression-bomb the editor. The real source limit is 64 KiB.
  const r = new Blob([unb64(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    total += value.length;
    if (total > LINK_LIMIT) { await r.cancel(); throw new Error("too large"); }
    parts.push(value);
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { buf.set(p, at); at += p.length; }
  return new TextDecoder().decode(buf);
}

// Safari only lets a click write the clipboard if the write starts in
// the click itself, so the link goes in as a promise; then writeText;
// then false, and the caller shows the link to copy by hand.
async function copyText(text: Promise<string>): Promise<boolean> {
  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    try {
      const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return true;
    } catch {}
  }
  try { await navigator.clipboard.writeText(await text); return true; } catch { return false; }
}

const shareBtn = $<Timed>("share");
const shareBar = $<HTMLDivElement>("sharebar");
const shareUrl = $<HTMLInputElement>("share-url");
// The bar slides open (nabi.css .reveal); shut, it is inert.
function shareBarOpen(on: boolean): void {
  shareBar.classList.toggle("open", on);
  (shareBar.firstElementChild as HTMLElement).inert = !on;
}
function label(btn: HTMLElement, text: string): void { resize(btn, () => { btn.textContent = text; }); }
function flash(text: string): void {
  label(shareBtn, text);
  clearTimeout(shareBtn.reset);
  shareBtn.reset = setTimeout(() => label(shareBtn, T.share), 2000);
}
// A short /p/<id> link the server stores; without one (offline, rate
// limited, no store), the code in the link itself.
async function shortLink(src: string, q: string): Promise<string> {
  const res = await fetch("/api/share", { method: "POST", body: src, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const id = res.ok ? (await res.text()).trim() : "";
  if (!/^[a-z2-7]{10}$/.test(id)) throw new Error(`HTTP ${res.status}`);
  return `${location.origin}${KO ? "/ko" : ""}/p/${id}${q ? `#${q}` : ""}`;
}
shareBtn.addEventListener("click", async () => {
  const q = opt.value !== "0" ? `opt=${opt.value}` : "";
  const src = ed.value;
  const link = shortLink(src, q).catch(() => pack(src).then((frag) => `${location.origin}${BASE}#${frag}${q ? `&${q}` : ""}`));
  const copied = await copyText(link);
  let url: string;
  try { url = await link; } catch { flash(T.shareFailed); return; }
  history.replaceState(null, "", url);
  if (copied) { shareBarOpen(false); flash(T.copied); return; }
  shareUrl.value = url;
  shareBarOpen(true);
  shareUrl.focus({ preventScroll: true });
  shareUrl.select();
});
$("share-close").addEventListener("click", () => { shareBarOpen(false); shareBtn.focus(); });
shareUrl.addEventListener("keydown", (ev) => { if (ev.key === "Escape") $("share-close").click(); });


function say(text: string, kind?: string): void {
  if (text !== status.textContent) resize(status, () => { status.textContent = text; });
  status.dataset.kind = kind || "";
}

// Output is queued and written once a frame, as few nodes as there are
// colour changes, and capped: a program printing 200,000 lines must not
// cost a node and a layout per line.
const MAX_LINES = 10_000;
const MAX_CHARS = 1 << 20;
const copyBtn = $<Timed>("copy-out");
let queue: Chunk[] = [];
let frame = 0;
let shown = { lines: 0, chars: 0, cut: false };
// What #out shows: a batch a flush, or the hint before the first run.
let batches: VNode[] = [];
let hint = false;
const drawOut = (): void => render(<Output batches={batches} hint={hint} />, out);

function put(text: string, cls: string, at?: [number, number]): void {
  const last = queue[queue.length - 1];
  if (last && last[1] === cls && cls !== "img" && !at && !last[2]) last[0] += text;
  else queue.push([text, cls, at]);
  if (!frame) frame = requestAnimationFrame(flush);
}
// `always` is for the run's own notes, which still show after a cut.
function print(text: string, cls = "", always = false): void {
  if (!text) return;
  if (always) { put(text, cls); return; }
  if (shown.cut) return;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    if (++shown.lines === MAX_LINES) { text = text.slice(0, i + 1); shown.cut = true; break; }
  }
  shown.chars += text.length;
  if (shown.chars > MAX_CHARS) {
    text = text.slice(0, text.length - (shown.chars - MAX_CHARS)) + "\n";
    shown.cut = true;
  }
  put(text, cls);
  if (shown.cut) put(`\n${T.truncated(shown.lines)}\n`, "warn");
}
// A `display(x)` value: its picture (SVG, else PNG), else its text.
function showRich(b: Record<string, string>): void {
  if (shown.cut) return;
  const svg = b["image/svg+xml"];
  const png = b["image/png"];
  if (svg) put(`data:image/svg+xml;base64,${b64std(new TextEncoder().encode(svg))}`, "img");
  else if (png && /^[A-Za-z0-9+/=]+$/.test(png)) put(`data:image/png;base64,${png}`, "img");
  else if (b["text/plain"]) print(b["text/plain"].replace(/\n*$/, "\n"));
}
function b64std(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function flush(): void {
  frame = 0;
  const atEnd = out.scrollHeight - out.scrollTop - out.clientHeight < 32;
  batches.push(<Batch chunks={queue} />);
  queue = [];
  drawOut();
  if (atEnd) out.scrollTop = out.scrollHeight;
  copyBtn.disabled = false;
}
function clearOut(): void {
  cancelAnimationFrame(frame);
  frame = 0;
  queue = [];
  shown = { lines: 0, chars: 0, cut: false };
  batches = [];
  hint = false;
  drawOut();
}
// A cargo-style progress line: a right-aligned verb, then the rest.
function step(verb: string, rest: string): void {
  print(verb.padStart(12) + " ", "v");
  print(rest + "\n");
}
// `--> main.nabi:L:C` in the output puts the caret there.
out.addEventListener("click", (ev) => {
  const b = (ev.target as Element).closest<HTMLElement>(".loc");
  if (!b) return;
  const [line, col] = b.dataset.at!.split(":").map(Number) as [number, number];
  goTo(line, col);
});
$("clear").addEventListener("click", () => { clearOut(); copyBtn.disabled = true; say(""); });

copyBtn.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(out.innerText); label(copyBtn, T.copyDone); }
  catch { label(copyBtn, T.copyFailed); }
  clearTimeout(copyBtn.reset);
  copyBtn.reset = setTimeout(() => label(copyBtn, T.copy), 2000);
});

// nabic's diagnostics: each `error[..]: msg` / `warning: msg` block, its
// `--> main.nabi:<line>:<col>`, the caret run under the code, and its
// `= note:` / `= help:` lines.
function parseDiags(text: string): Diag[] {
  const found: Diag[] = [];
  let d: Diag | null = null;
  for (const line of text.split("\n")) {
    let m;
    // nabic's closing tally (`could not build main (1 error, ..)`) is no
    // diagnostic of its own
    if (/^error: could not (build|compile) /.test(line)) {
      d = null;
    } else if ((m = line.match(/^(error|warning)(\[\w+\])?: (.*)$/))) {
      d = { kind: m[1]! + (m[2] || ""), warn: m[1] === "warning", head: m[3]!, notes: [], line: 0, col: 0, len: 1 };
      found.push(d);
    } else if (!d) {
      continue;
    } else if ((m = line.match(/^\s*--> main\.nabi:(\d+):(\d+)/)) && !d.line) {
      d.line = +m[1]!;
      d.col = +m[2]!;
    } else if ((m = line.match(/^\s*\|\s*(\^+)\s*(.*)$/)) && d.len === 1) {
      d.len = m[1]!.length;
      if (m[2]) d.notes.push(["label", m[2]]);
    } else if ((m = line.match(/^\s*= (note|help): (.*)$/))) {
      d.notes.push([m[1]!, m[2]!]);
    }
  }
  // A caret label reads as part of the headline, not as a note.
  for (const x of found) x.notes = x.notes.map(([k, t]): [string, string] => (k === "label" ? ["here", t] : [k, t]));
  return found;
}

// Diagnostics in the output, coloured as nabic colours them in a terminal.
function showErrors(text: string): void {
  diags = parseDiags(text);
  paint();
  for (const line of text.replace(/\n+$/, "").split("\n")) {
    let m;
    if ((m = line.match(/^(error|warning)(\[\w+\])?(:.*)$/))) {
      print(m[1]! + (m[2] || ""), m[1] === "error" ? "e" : "w");
      print(m[3] + "\n");
    } else if ((m = line.match(/^(\s*)(-->|=|\d* ?\|)(.*)$/))) {
      print(m[1]!);
      print(m[2]!, "g");
      const loc = m[2] === "-->" && m[3]!.match(/^(\s*)(main\.nabi:(\d+):(\d+))(.*)$/);
      if (loc) { print(loc[1]!); put(loc[2]!, "loc", [+loc[3]!, +loc[4]!]); print(loc[5] + "\n"); continue; }
      const caret = m[3]!.match(/^(\s*)(\^+)(.*)$/);
      if (caret) { print(caret[1]!); print(caret[2]!, diags.some((d) => !d.warn) ? "e" : "w"); print(caret[3] + "\n"); }
      else print(m[3] + "\n");
    } else {
      print(line + "\n");
    }
  }
}


// One run at a time: `gen` tells a stale await it was stopped or
// replaced. While a run is in flight the Run button is Stop.
const LIMIT = 10_000;
const secs = (ms: number): string => `${(ms / 1000).toFixed(2)} s`;
const RUN_TITLE = T.runTitle(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘Enter" : "Ctrl+Enter");
let gen = 0;
let worker: Worker | null = null;
let aborter: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | 0 = 0;

const RETRIES = 3;
// Seconds to wait before asking a busy server again: its Retry-After
// (else 5), doubled each time, at most 30.
function retryAfter(res: Response, tries: number): number {
  return Math.min(30, (waitOf(res) || 5) * 2 ** tries);
}
// A Retry-After in seconds, or 0.
function waitOf(res: Response): number {
  const s = parseInt(res.headers.get("Retry-After") ?? "", 10);
  return s > 0 ? s : 0;
}
// What a failed answer tells the reader: a busy server's wait, the
// server's own text/plain message, else (a proxy's HTML error page when
// the server is down) a fixed line, never the markup.
function failure(res: Response, body: string): string {
  const wait = res.status === 503 ? waitOf(res) : 0;
  if (wait) return T.busyTryIn(wait);
  const plain = (res.headers.get("Content-Type") ?? "").startsWith("text/plain");
  return plain && body.trim() ? body.trim() : T.down;
}
// The status for a request that got no answer at all.
const noAnswer = (): string => navigator.onLine === false ? T.offline : T.noAnswer;

function busy(on: boolean): void {
  if (on && !runBtn.dataset.running) runBtn.style.minWidth = `${runBtn.offsetWidth}px`;
  if (!on) runBtn.style.minWidth = "";
  render(<RunLabel stop={on} />, runBtn);
  runBtn.title = on ? T.stop : RUN_TITLE;
  if (on) { runBtn.dataset.running = "1"; runBtn.removeAttribute("aria-keyshortcuts"); }
  else { delete runBtn.dataset.running; runBtn.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter"); }
}
function finish(): void {
  gen++;
  if (worker) { worker.terminate(); worker = null; }
  if (aborter) { aborter.abort(); aborter = null; }
  clearTimeout(timer);
  busy(false);
}
function stop(): void {
  if (!runBtn.dataset.running) return;
  const compiling = !worker;
  finish();
  print(`\n${compiling ? T.stoppedCompiling : T.stopped}\n`, "warn", true);
  say(T.stopped, "bad");
}

// Stacked panes: bring the output up so the result (or the errors) is
// in view without scrolling for it.
function reveal(): void {
  if (!matchMedia("(max-width: 860px)").matches) return;
  const pane = out.closest(".out-pane")!;
  const hdr = document.querySelector<HTMLElement>(".hdr")!;
  const cover = getComputedStyle(hdr).position === "sticky" ? hdr.offsetHeight : 0;
  const top = pane.getBoundingClientRect().top - cover;
  if (top < innerHeight * 0.35) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  scrollTo({ top: scrollY + top, behavior: still ? "auto" : "smooth" });
}

// What the runner (run.ts) posts back: a slice of output, then the
// exit code or the failure.
interface RunReply {
  fd?: number;
  text?: string;
  rich?: Record<string, string>;
  code?: number;
  error?: string;
  old?: boolean;
}

async function run(auto = false): Promise<void> {
  finish();
  const me = gen;
  clearOut();
  diags = [];
  hideTip();
  paint();
  busy(true);
  say(T.compiling);
  step("Compiling", `main.nabi (wasm32, -O${opt.value})`);
  if (!auto) reveal();
  const src = ed.value;
  let t0 = performance.now();
  let res: Response, body: ArrayBuffer | string;
  // A busy server (503) is asked again after its Retry-After, doubling,
  // up to RETRIES times; Stop ends the wait.
  for (let tries = 0; ; tries++) {
    aborter = new AbortController();
    try {
      res = await fetch(`/api/compile?opt=${opt.value}`, { method: "POST", body: src, headers: { "Content-Type": "text/plain; charset=utf-8" }, signal: aborter.signal });
      body = res.ok && !res.headers.has("X-Nabi-Diagnostics") ? await res.arrayBuffer() : await res.text();
    } catch {
      if (me !== gen) return;
      finish();
      say(noAnswer(), "bad");
      print(`${T.down}\n`, "err");
      return;
    }
    if (me !== gen) return;
    if (res.status !== 503 || tries === RETRIES) break;
    const wait = retryAfter(res, tries);
    if (tries === 0) print(`${T.busyNote(wait)}\n`, "warn");
    for (let s = wait; s > 0; s--) {
      say(T.busy(s), "bad");
      await new Promise((ok) => setTimeout(ok, 1000));
      if (me !== gen) return;
    }
    say(T.compiling);
    t0 = performance.now();
  }
  aborter = null;
  const cached = res.headers.get("X-Nabi-Cache") === "hit";
  const took = performance.now() - t0;
  if (!res.ok) {
    finish();
    say(`HTTP ${res.status}`, "bad");
    print(`${failure(res, body as string)}\n`, "err");
    return;
  }
  if (typeof body === "string") {
    finish();
    showErrors(body);
    const n = diags.filter((d) => !d.warn).length;
    say(n ? T.errors(n) : T.failed, "bad");
    return;
  }
  step("Finished", cached ? "cached build" : `in ${secs(took)}`);
  step("Running", "main.wasm");
  print("\n");
  say(T.running);
  const t1 = performance.now();
  worker = new Worker("/run.js", { type: "module" });
  timer = setTimeout(() => {
    finish();
    print(`\n${T.stoppedAfter(LIMIT / 1000)}\n`, "warn", true);
    say(T.stoppedLimit(LIMIT / 1000), "bad");
  }, LIMIT);
  worker.onmessage = ({ data }: MessageEvent<RunReply>) => {
    if (data.text !== undefined) { print(data.text, data.fd === 2 ? "err" : ""); return; }
    if (data.rich) { showRich(data.rich); return; }
    finish();
    const ms = performance.now() - t1;
    if (data.old) { print(`${T.tooOld}\n`, "err", true); say(T.cannotRun, "bad"); return; }
    if (data.error) { print(`\n${data.error}\n`, "err", true); say(T.crashed, "bad"); return; }
    if (data.code !== 0) print(`\n${T.exitCode(data.code ?? 0)}\n`, "warn", true);
    say(T.exit(data.code ?? 0, secs(ms)), data.code === 0 ? "" : "bad");
  };
  // A worker that never starts (no module workers: Firefox < 114) would
  // otherwise sit silent until the time limit.
  worker.onerror = (ev) => {
    ev.preventDefault();
    finish();
    print(`\n${T.runnerFailed}${ev.message ? `: ${ev.message}` : ""}\n`, "err", true);
    say(T.crashed, "bad");
  };
  worker.postMessage({ wasm: body, lines: MAX_LINES, chars: MAX_CHARS, stdin: stdinEd.value }, [body]);
}
runBtn.addEventListener("click", () => { if (runBtn.dataset.running) stop(); else run(); });
document.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter" && ev.target !== ed) { ev.preventDefault(); run(); }
});
busy(false);

// Format: nabi fmt on the server, through the same sandbox as a build.
// The new text goes in as one edit, so Undo brings the old back.
const fmtBtn = $<HTMLButtonElement>("fmt");
fmtBtn.addEventListener("click", async () => {
  const src = ed.value;
  if (!src.trim()) return;
  fmtBtn.disabled = true;
  let res: Response, body: string;
  try {
    res = await fetch("/api/fmt", { method: "POST", body: src, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    body = await res.text();
  } catch {
    say(noAnswer(), "bad");
    fmtBtn.disabled = false;
    return;
  }
  fmtBtn.disabled = false;
  if (ed.value !== src) return;
  if (!res.ok) { say(failure(res, body), "bad"); return; }
  if (res.headers.has("X-Nabi-Diagnostics")) {
    finish();
    clearOut();
    showErrors(body);
    say(T.cannotFormat, "bad");
    return;
  }
  if (body === src) { say(T.alreadyFormatted); return; }
  const { line, col } = caretAt(ed.selectionStart);
  const top = ed.scrollTop;
  ed.focus({ preventScroll: true });
  ed.select();
  if (!document.execCommand("insertText", false, body)) { ed.value = body; ed.dispatchEvent(new Event("input")); }
  const lines = body.split("\n");
  let i = 0;
  for (let k = 0; k < line - 1 && k < lines.length; k++) i += lines[k]!.length + 1;
  i += Math.min(col - 1, (lines[line - 1] || "").length);
  ed.setSelectionRange(i, i);
  ed.scrollTop = top;
  sync();
  say(T.formatted);
});

// The menu closes on Escape, on a click outside it, and on a pick.
const more = $<HTMLDetailsElement>("more");
document.addEventListener("click", (ev) => { if (more.open && !more.contains(ev.target as Node | null)) more.open = false; });
more.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && more.open) { more.open = false; more.querySelector("summary")!.focus(); }
});

// On a phone the optimisation picker says only -O0 / -O2, so the
// example picker keeps room for its name.
const narrow = matchMedia("(max-width: 480px)");
function optLabels(): void {
  const [o0, o2] = opt.options;
  o0!.text = narrow.matches ? "-O0" : T.optDebug;
  o2!.text = narrow.matches ? "-O2" : T.optRelease;
}
narrow.addEventListener("change", optLabels);
optLabels();

// Standard input: the Input button opens a box whose text the program
// reads as stdin (kept in localStorage "play.stdin"). Shut, the button
// shows a dot while the box holds text.
const stdinBtn = $<HTMLButtonElement>("stdin-btn");
const stdinBox = $("stdin-box");
const stdinEd = $<HTMLTextAreaElement>("stdin");
const SAMPLE_INPUT = "3\n4.5\n10\n";
function stdinOpen(on: boolean): void {
  stdinBox.classList.toggle("open", on);
  (stdinBox.firstElementChild as HTMLElement).inert = !on;
  stdinBtn.setAttribute("aria-expanded", String(on));
  stdinBtn.classList.toggle("has", !on && !!stdinEd.value);
  store.set("play.stdin.open", on ? "1" : "");
}
function setStdin(text: string): void {
  stdinEd.value = text;
  store.set("play.stdin", text);
}
stdinEd.value = store.get("play.stdin") ?? "";
stdinOpen(store.get("play.stdin.open") === "1");
stdinBtn.addEventListener("click", () => {
  const on = !stdinBox.classList.contains("open");
  stdinOpen(on);
  if (on) stdinEd.focus({ preventScroll: true });
});
stdinEd.addEventListener("input", () => store.set("play.stdin", stdinEd.value));
stdinEd.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") { stdinOpen(false); stdinBtn.focus(); }
});

// The language switch takes the address's #fragment (an example, a
// link's code) along to the other language's page.
for (const a of document.querySelectorAll<HTMLAnchorElement>("a[data-lang], .lang-menu a[hreflang]")) {
  a.addEventListener("click", () => { a.href = a.pathname + location.hash; });
}

// The skip link puts the caret in the editor, not just the scroll.
document.querySelector(".skip")!.addEventListener("click", (ev) => { ev.preventDefault(); ed.focus(); });

// Start: the visitor's code (or Hello world), then a link's code (a
// /p/<id> page carries it in #shared) or a #example=<name>. A link
// replaces "mine" only while mine is empty or untouched Hello world.

(async () => {
  const om = location.hash.match(/[#&]opt=([02])/);
  if (om) opt.value = om[1]!;
  const was = store.get("play.view");
  mine = store.get("play.mine") ?? store.get("play.code") ?? "";
  store.del("play.code");
  if (mine) { store.set("play.mine", mine); show(mine, "mine"); }
  linked = store.get("play.link");
  if (linked !== null) addLinkOption();
  const hello = await exampleText("hello").catch(() => "");
  // only on a /p/<id> page
  const pre = document.getElementById("shared");
  const m = location.hash.match(/^#(code|src)=([\w-]+)/);
  const ex = exampleIn(location.hash);
  let text: string | null = null, open = was === "link" && linked !== null ? "link" : "mine";
  if (pre) text = pre.textContent;
  else if (m) {
    if (m[1] === "code" && !can("DecompressionStream")) say(T.linkTooNew, "bad");
    else try { text = await unpack(m[1]!, m[2]!); } catch { say(T.linkDamaged, "bad"); }
  }
  if (text !== null) {
    open = "mine";
    if (text !== mine) {
      if (!mine || mine === hello) { mine = text; store.set("play.mine", mine); }
      else { linked = text; store.set("play.link", linked); addLinkOption(); open = "link"; }
    }
  }
  if (!mine) mine = hello;
  // An unknown example opens what a bare address would, quietly.
  if (/^#example=/.test(location.hash) && !ex) history.replaceState(null, "", BASE);
  if (text === null && ex) { await showExample(ex); return; }
  if (open === "link") show(linked!, "link");
  else if (ed.value !== mine || view !== "mine") show(mine, "mine");
  else syncPick();
  // An example shows what it prints straight away; the visitor's own
  // code and a link's wait for Run.
  if (pick.value !== "mine" && pick.value !== "link") run(true);
  else if (!out.childNodes.length) { hint = true; drawOut(); }
})();

// A draggable divider resizes the editor vs the output (desktop only).
const divider = document.querySelector<HTMLElement>(".divider");
const panes = document.querySelector<HTMLElement>(".ws");
if (divider && panes) {
  const SPLIT_KEY = "play.split";
  const apply = (pct: number): void => {
    const v = Math.max(25, Math.min(75, pct));
    panes.style.setProperty("--split", v + "%");
    divider.setAttribute("aria-valuenow", String(Math.round(v)));
  };
  apply(parseFloat(store.get(SPLIT_KEY) ?? "") || 60);
  const pctAt = (clientX: number): number => {
    const r = panes.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * 100;
  };
  const save = (): void => {
    const cur = panes.style.getPropertyValue("--split");
    if (cur) store.set(SPLIT_KEY, String(parseFloat(cur)));
  };
  divider.addEventListener("pointerdown", (ev) => {
    if (matchMedia("(max-width: 860px)").matches) return;
    ev.preventDefault();
    divider.setPointerCapture(ev.pointerId);
    panes.classList.add("dragging");
    const move = (e: PointerEvent): void => apply(pctAt(e.clientX));
    const up = (): void => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
      panes.classList.remove("dragging");
      hideTip();
      save();
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
  divider.addEventListener("keydown", (ev) => {
    const cur = parseFloat(panes.style.getPropertyValue("--split")) || 60;
    const keys: Record<string, number> = { ArrowLeft: cur - 3, ArrowRight: cur + 3, Home: 25, End: 75 };
    const to = keys[ev.key];
    if (to === undefined) return;
    ev.preventDefault();
    apply(to);
    save();
  });
}
