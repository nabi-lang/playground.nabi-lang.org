// Runs one compiled program, off the page's thread so a loop cannot
// freeze it: output goes back line by line, then the exit code. Past
// what the page shows, output is dropped here, so a program that
// prints forever cannot flood the page with messages.
import { load } from "/nabi.mjs";

// What the page sends: the module, and how much output it still shows.
interface RunRequest {
  wasm: ArrayBuffer;
  lines: number;
  chars: number;
  // What the program reads as its standard input.
  stdin: string;
}
// What goes back: a slice of output, a rich value (`display(x)`: MIME
// type to content), the exit code, or the failure.
type RunReply =
  | { fd: number; text: string }
  | { rich: Record<string, string> }
  | { code: number }
  | { error: string; old: boolean };

// `display(x)` writes its renderings to stdout as a frame when
// NABI_JUPYTER is set: this mark, the payload's length in 8 hex digits,
// then the payload, a JSON object of MIME type to content.
const MARK = new TextEncoder().encode("\x00@@nabi-kernel-show@@\x00");
// A frame larger than this is dropped (a plot's SVG is a few hundred KiB).
const MAX_FRAME = 8 << 20;

function find(hay: Uint8Array, from: number): number {
  outer: for (let i = from; i + MARK.length <= hay.length; i++) {
    for (let j = 0; j < MARK.length; j++) if (hay[i + j] !== MARK[j]) continue outer;
    return i;
  }
  return -1;
}

// Splits stdout into text and display frames; `text` and `rich` get each.
function frames(text: (b: Uint8Array) => void, rich: (r: Record<string, string>) => void): { push(b: Uint8Array): void; end(): void } {
  let buf = new Uint8Array(0);
  const dec = new TextDecoder();
  return {
    push(b: Uint8Array): void {
      const all = new Uint8Array(buf.length + b.length);
      all.set(buf);
      all.set(b, buf.length);
      buf = all;
      for (;;) {
        const at = find(buf, 0);
        if (at === -1) {
          // Keep what could be the start of a mark (it starts with a 0).
          const z = buf.lastIndexOf(0, buf.length - 1);
          const keep = z !== -1 && buf.length - z < MARK.length ? buf.length - z : 0;
          if (buf.length > keep) text(buf.subarray(0, buf.length - keep));
          buf = buf.slice(buf.length - keep);
          return;
        }
        if (at > 0) text(buf.subarray(0, at));
        const head = at + MARK.length;
        if (buf.length < head + 8) { buf = buf.slice(at); return; }
        const n = parseInt(dec.decode(buf.subarray(head, head + 8)), 16);
        if (!(n >= 0) || n > MAX_FRAME) { buf = buf.slice(head + 8); continue; }
        if (buf.length < head + 8 + n) { buf = buf.slice(at); return; }
        try { rich(JSON.parse(dec.decode(buf.subarray(head + 8, head + 8 + n)))); } catch { /* a broken frame shows nothing */ }
        buf = buf.slice(head + 8 + n);
      }
    },
    end(): void { if (buf.length) text(buf); buf = new Uint8Array(0); },
  };
}

// The worker's own scope; the page's lib (DOM) types `self` as a window.
interface WorkerScope {
  onmessage: ((ev: MessageEvent<RunRequest>) => void) | null;
  postMessage(msg: RunReply): void;
}
declare const self: WorkerScope;

self.onmessage = async ({ data: { wasm, lines, chars, stdin } }) => {
  const dec = [new TextDecoder(), new TextDecoder()] as const;
  const send = (fd: number, bytes: Uint8Array): void => {
    if (lines < 0 || chars < 0) return;
    const text = dec[fd === 2 ? 1 : 0].decode(bytes, { stream: true });
    chars -= text.length;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lines--;
    self.postMessage({ fd, text });
  };
  const out = frames((b) => send(1, b), (rich) => {
    if (chars < 0) return;
    chars -= 2000;
    self.postMessage({ rich });
  });
  const write = (fd: number, bytes: Uint8Array): void => { if (fd === 2) send(2, bytes); else out.push(bytes); };
  try {
    const app = await load(wasm, { args: ["main"], env: { NABI_JUPYTER: "1" }, write, stdin: new TextEncoder().encode(stdin) });
    const code = app.main();
    out.end();
    self.postMessage({ code });
  } catch (e) {
    self.postMessage({ error: String((typeof e === "object" && e !== null && "message" in e && e.message) || e), old: !canWasm() });
  }
};

// Can this engine compile wasm under the page's CSP at all? Engines
// without 'wasm-unsafe-eval' (Safari < 16, Chrome < 97) refuse even the
// empty module.
function canWasm(): boolean {
  try { new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); return true; } catch { return false; }
}

// a module to the type checker; the bundle (tools/build.ts) drops it
export {};
