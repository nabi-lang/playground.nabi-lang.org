// A diagnostic as the editor's lint tooltip and panel show it: the kind and
// headline, then one line a note.
import type { VNode } from "preact";
import type { Diag } from "../editor/lint.tsx";

export function Tip({ d }: { d: Diag }): VNode {
  return <>
    <span class={d.warn ? "h w" : "h"}><b>{d.kind}</b>{d.head ? `: ${d.head}` : ""}</span>
    {d.notes.map(([k, text]) => <span class="n"><b>{k}</b>{`: ${text}`}</span>)}
  </>;
}
