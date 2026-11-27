// The playground page: the editor (editor/, CodeMirror), the compile
// request, a worker that runs the module, examples, and share links (a
// short /p/<id> link the server stores, else the code deflated in the
// link's #fragment). What the script builds besides the editor (the
// transcript, the example list, the Run button's face) comes from
// Preact components in ui/, rendered into the page's own elements.
import { render } from "preact";
import type { VNode } from "preact";
import { createEditor } from "./editor/view.ts";
import type { Diag } from "./editor/view.ts";
import { httpTransport } from "./editor/transport.ts";
import type { Highlighter } from "./highlight.ts";
import { Examples } from "./ui/examples.tsx";
import { Batch, Output } from "./ui/output.tsx";
import type { Chunk } from "./ui/output.tsx";
import { RunLabel } from "./ui/run-label.tsx";
import { BASE, PREFIX, T } from "./ui/text.ts";

// An element the page always has.
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
// Elements that keep a pending animation or timer on themselves.
type Resizable = HTMLElement & { rz?: Animation };
type Timed = HTMLButtonElement & { reset?: ReturnType<typeof setTimeout> };
const out = $<HTMLPreElement>("out");
const status = $("status");
const runBtn = $<HTMLButtonElement>("run");
const pick = $<HTMLSelectElement>("example");
const opt = $<HTMLSelectElement>("opt");
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

// The last failed compile's diagnostics that point into main.nabi.
// Cleared on the next edit (lint.tsx clears the editor's own).
let diags: Diag[] = [];

const editor = createEditor($("editor"), {
  labelledBy: "ed-label",
  describedBy: "ed-help diag",
  run: () => { void run(); },
  changed: () => {
    if (diags.length) { diags = []; showDiagCount(); }
    keep();
  },
  moved: (line, col) => { pos.textContent = T.pos(line, col); },
  transport: httpTransport(),
});
// Until the start-up below has put the first code in, typing would be
// lost under it.
editor.setReadOnly(true);

// nabi-syntax's tree-sitter highlighting (highlight.ts), loaded after
// the page; until then, or if it cannot load, the editor's own lexer.
addEventListener("load", () => {
  import("/highlight.js")
    .then(() => globalThis.nabiHighlight)
    .then((h) => { if (h) editor.setHighlighter(h); })
    .catch(() => {});
});

function setDiags(list: Diag[]): void {
  diags = list;
  editor.setDiagnostics(list);
  showDiagCount();
}

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
  editor.goTo(line, col);
  const pane = editor.view.dom.closest(".ed-pane")!.getBoundingClientRect();
  if (pane.top < 0 || pane.bottom > innerHeight) editor.view.dom.closest(".ed-pane")!.scrollIntoView({ block: "nearest" });
}
// The count jumps to the first diagnostic with a place in the source.
diagBtn.addEventListener("click", () => {
  const d = diags.find((x) => x.line);
  if (d) goTo(d.line, d.col);
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
  "json", "stats", "linalg", "plot", "units", "literals", "error", "try",
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
  const text = editor.text();
  pick.value = view === "mine" && text === texts.get("hello") ? "hello" : view;
  resetBtn.hidden = !(NAMES.has(view) && texts.has(view) && text !== texts.get(view));
}
function show(text: string, v: string): void {
  view = v;
  if (v === "mine" || v === "link") store.set("play.view", v);
  editor.load(text);
  diags = [];
  showDiagCount();
  syncPick();
}
function keep(): void {
  const text = editor.text();
  if (view === "mine") { mine = text; store.set("play.mine", mine); }
  else if (view === "link") { linked = text; store.set("play.link", linked); }
  else if (text === texts.get(view)) store.del(`play.ex.${view}`);
  else store.set(`play.ex.${view}`, text);
  syncPick();
  syncAddress();
}
function addLinkOption(): void {
  if (!hasLink) { hasLink = true; drawExamples(); }
}
// An example as last edited here, and what it prints.
async function showExample(name: string): Promise<void> {
  let orig: string;
  editor.setReadOnly(true);
  try { orig = await exampleText(name); } catch { say(T.down, "bad"); return; } finally { editor.setReadOnly(false); }
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
  editor.replace(orig);
  editor.goTo(1, 1);
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
  return `${location.origin}${PREFIX}/p/${id}${q ? `#${q}` : ""}`;
}
shareBtn.addEventListener("click", async () => {
  const q = opt.value !== "0" ? `opt=${opt.value}` : "";
  const src = editor.text();
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
  setDiags(parseDiags(text));
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

// Modules the server has compiled, by level and source: the key it
// answered in X-Nabi-Module (or a /p/<id> page named). A known one is
// fetched by GET /api/wasm/<key>, which the browser and the CDN keep,
// instead of a compile request.
const modules = new Map<string, string>();
const moduleOf = (o: string, src: string): string => `${o}\n${src}`;
// The module at `key` when the server still has it, else null.
async function knownModule(key: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`/api/wasm/${key}`, { signal });
    return res.ok && res.headers.get("Content-Type") === "application/wasm" ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function run(auto = false): Promise<void> {
  finish();
  const me = gen;
  clearOut();
  setDiags([]);
  busy(true);
  say(T.compiling);
  step("Compiling", `main.nabi (wasm32, -O${opt.value})`);
  if (!auto) reveal();
  const src = editor.text();
  let t0 = performance.now();
  const key = modules.get(moduleOf(opt.value, src));
  if (key) {
    aborter = new AbortController();
    const wasm = await knownModule(key, aborter.signal);
    if (me !== gen) return;
    aborter = null;
    if (wasm) { start(me, wasm, true, performance.now() - t0); return; }
    modules.delete(moduleOf(opt.value, src));
  }
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
  const made = res.headers.get("X-Nabi-Module");
  if (made && /^[0-9a-f]{64}$/.test(made)) modules.set(moduleOf(opt.value, src), made);
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
  start(me, body, cached, took);
}

// Runs the module: the rest of a run once it is here.
function start(me: number, body: ArrayBuffer, cached: boolean, took: number): void {
  if (me !== gen) return;
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
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter" && !editor.view.dom.contains(ev.target as Node | null)) { ev.preventDefault(); run(); }
});
busy(false);

// Format: nabi fmt on the server, through the same sandbox as a build.
// The new text goes in as one edit, so Undo brings the old back.
const fmtBtn = $<HTMLButtonElement>("fmt");
fmtBtn.addEventListener("click", async () => {
  const src = editor.text();
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
  if (editor.text() !== src) return;
  if (!res.ok) { say(failure(res, body), "bad"); return; }
  if (res.headers.has("X-Nabi-Diagnostics")) {
    finish();
    clearOut();
    showErrors(body);
    say(T.cannotFormat, "bad");
    return;
  }
  if (body === src) { say(T.alreadyFormatted); return; }
  editor.replace(body);
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
document.querySelector(".skip")!.addEventListener("click", (ev) => { ev.preventDefault(); editor.focus(); });

// Start: the visitor's code (or Hello world), then a link's code (a
// /p/<id> page carries it in #shared) or a #example=<name>. A link
// replaces "mine" only while mine is empty or untouched Hello world.

(async () => {
  try { await startUp(); } finally { editor.setReadOnly(false); }
})();
async function startUp(): Promise<void> {
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
  if (pre) {
    text = pre.textContent;
    // the modules the server already has for it
    for (const o of ["0", "2"]) {
      const k = pre.dataset[`wasm${o}`];
      if (k && /^[0-9a-f]{64}$/.test(k)) modules.set(moduleOf(o, text ?? ""), k);
    }
  }
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
  else if (editor.text() !== mine || view !== "mine") show(mine, "mine");
  else syncPick();
  // An example shows what it prints straight away; the visitor's own
  // code and a link's wait for Run.
  if (pick.value !== "mine" && pick.value !== "link") run(true);
  else if (!out.childNodes.length) { hint = true; drawOut(); }
}

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
