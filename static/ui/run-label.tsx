// The Run button's icon and word, rendered into #run; Stop while a run
// is in flight.
import type { VNode } from "preact";
import { T } from "./text.ts";

export function RunLabel({ stop }: { stop: boolean }): VNode {
  return stop
    ? <><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="currentColor" /></svg>{T.stop}</>
    : <><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1v8l7-4z" fill="currentColor" /></svg>{T.run}</>;
}
