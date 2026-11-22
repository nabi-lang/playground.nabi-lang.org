// How the editor reaches nabils. Today it is the server's POST /api/lsp
// (one nabils run a request, in the build sandbox); a wasm nabils in a
// Worker can take its place later behind the same Transport, and
// nothing in lsp.ts changes.

/** What the editor asks nabils. */
export type Request = "completion" | "hover" | "definition";

/** An LSP position: 0-based line, UTF-16 character. */
export interface Position {
  line: number;
  character: number;
}

export interface Transport {
  /**
   * nabils' `result` for `request` at `at` in `code`, or null when there
   * is none, or no answer came in time: the editor carries on without.
   */
  ask(request: Request, code: string, at: Position, signal: AbortSignal): Promise<unknown>;
}

// The most a request waits for its answer, in ms.
const TIMEOUT = 3000;
// After this many slow answers in a row, a pause.
const SLOW_RUN = 3;
// How long a pause lasts when the server says nothing of it, in ms.
const PAUSE = 60_000;

/**
 * The server's /api/lsp. A missing endpoint (an older server, a static
 * copy of the page) turns it off for the page's life; a busy or rate
 * limited one, or answers that keep timing out, pause it a while.
 */
export function httpTransport(url = "/api/lsp"): Transport {
  let pausedUntil = 0;
  let slow = 0;
  return {
    async ask(request, code, at, signal): Promise<unknown> {
      if (Date.now() < pausedUntil || signal.aborted) return null;
      const ctl = new AbortController();
      const stop = (): void => ctl.abort();
      signal.addEventListener("abort", stop, { once: true });
      let late = false;
      const timer = setTimeout(() => { late = true; ctl.abort(); }, TIMEOUT);
      try {
        const res = await fetch(url, {
          method: "POST",
          body: JSON.stringify({ code, request, line: at.line, character: at.character }),
          headers: { "Content-Type": "application/json" },
          signal: ctl.signal,
        });
        slow = 0;
        if (res.status === 404 || res.status === 405 || res.status === 501) { pausedUntil = Infinity; return null; }
        if (res.status === 429 || res.status === 503) {
          const s = parseInt(res.headers.get("Retry-After") ?? "", 10);
          pausedUntil = Date.now() + (s > 0 ? s * 1000 : PAUSE / 2);
          return null;
        }
        if (!res.ok || !(res.headers.get("Content-Type") ?? "").startsWith("application/json")) return null;
        const body = (await res.json()) as { result?: unknown } | null;
        return body?.result ?? null;
      } catch {
        if (late && ++slow >= SLOW_RUN) { slow = 0; pausedUntil = Date.now() + PAUSE; }
        return null;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
      }
    },
  };
}
