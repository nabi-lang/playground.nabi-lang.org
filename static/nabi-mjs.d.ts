// The runtime the worker imports from the site root as /nabi.mjs
// (nabi/targets/nabi.mjs). A rooted name cannot be declared as such, so
// the pattern matches it.
declare module "*/nabi.mjs" {
  export interface LoadOptions {
    args?: string[];
    env?: Record<string, string>;
    write?: (fd: number, bytes: Uint8Array) => void;
    // standard input: read through, then at its end
    stdin?: Uint8Array;
  }
  export interface App {
    exports: Record<string, unknown>;
    main(): number;
  }
  export function load(wasm: BufferSource | WebAssembly.Module | Response | Promise<Response>, opts?: LoadOptions): Promise<App>;
}
