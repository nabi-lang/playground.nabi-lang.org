// The output transcript, rendered into #out. Program output is
// untrusted: it only ever goes in as text.
import type { VNode } from "preact";
import { T } from "./text.ts";

// Text, its class, and for a source location its line and column.
export type Chunk = [text: string, cls: string, at?: [number, number]];

// What one frame's flush wrote: a text node, a coloured span, a
// `main.nabi:L:C` button that puts the caret there, or (class "img") a
// picture `display(x)` showed, its text a data: URL. An <img> runs no
// script an SVG may carry.
export function Batch({ chunks }: { chunks: Chunk[] }): VNode {
  return <>{chunks.map(([text, cls, at]) => at
    ? <button type="button" class="loc" title={T.goTo(at[0], at[1])} data-at={at.join(":")}>{text}</button>
    : cls === "img" ? <img class="rich" src={text} alt={T.displayAlt} />
    : cls ? <span class={cls}>{text}</span> : text)}</>;
}

// The batches so far, kept as the same vnodes so a new frame diffs only
// its own; `hint` is the line shown before the first run.
export function Output({ batches, hint }: { batches: VNode[]; hint: boolean }): VNode {
  return <>
    {hint && <span class="dim">{T.hint}</span>}
    {batches}
  </>;
}
