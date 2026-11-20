// The example picker's options, rendered into #example: the examples,
// the code from a share link once there is one, then the visitor's own.
import type { VNode } from "preact";
import { T } from "./text.ts";

export function Examples({ list, link }: { list: readonly (readonly [file: string, label: string])[]; link: boolean }): VNode {
  return <>
    {list.map(([file, label]) => <option key={file} value={file}>{label}</option>)}
    {link && <option key="link" value="link">{T.fromLink}</option>}
    <option key="mine" value="mine">{T.mine}</option>
  </>;
}
