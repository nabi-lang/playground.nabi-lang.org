# playground.nabi-lang.org

[![CI](https://github.com/nabi-lang/playground.nabi-lang.org/actions/workflows/ci.yml/badge.svg)](https://github.com/nabi-lang/playground.nabi-lang.org/actions/workflows/ci.yml) [![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](LICENSE-MIT)

*Clear rules, free as a butterfly.*

Source for https://playground.nabi-lang.org, the browser playground for Nabi. The page sends source to this server, which compiles it with `nabic --target=wasm32-unknown-unknown` and returns the module; the page runs it in a Web Worker. The server is written in Nabi.

- Programs are one file, with no files, network, or threads (those calls fail with `Unsupported`), and stop after 10 seconds. Standard input is the text in the Input box above the output. They may use the official packages the server has prebuilt (`json::parse(s)`, `stats::mean(xs)`, `plot::line(x, y)`; see `PLAY_PACKAGES`), and `display(x)` shows a value by its picture: a plot's SVG (or a PNG) is drawn in the output, as in a notebook.
- The page is in English at `/` and in Korean at `/ko` (`/ko/p/<id>`, `/ko#example=<name>`): `src/lang.nabi` translates the markup, `static/ui/text.ts` holds the script's words, and the menu switches between them, keeping the address's `#fragment`. The docs' Korean pages link their Run buttons to `/ko`.
- The page keeps the visitor's code in the browser's `localStorage` (edits to each example too, until Reset example). The server keeps source only when Share asks it to: `POST /api/share` stores it under `PLAY_SHARES` as `<id>.nabi`, the id being the first 50 bits of its SHA-256 in base32, and `/p/<id>` opens the page with it. A stored file is never rewritten, compiled or run by the server. When the server cannot store it, Share puts the deflated source in the link's `#code=` fragment instead (`#src=`, plain base64url, in browsers without deflate-raw).
- An example has its own address, `/#example=<name>` (its file name in `static/examples/`, without `.nabi`). A link's or a share's address lasts until the first edit; then the address goes back to `/`.
- Compiled modules are cached by SHA-256 of toolchain, packages, level and source.

## Run it locally

Needs a Nabi toolchain with the `wasm32-unknown-unknown` runtime (release archives ship it; from source, `targets/build.sh wasm32-unknown-unknown`), and the [web kit](https://github.com/nabi-lang/web) submodule at `web/`:

```bash
git clone --recurse-submodules https://github.com/nabi-lang/playground.nabi-lang.org.git
cd playground.nabi-lang.org      # or, in a clone made without it: git submodule update --init
nabi build
PLAY_NABIC=~/.nabi/toolchains/<version>-aarch64-apple-darwin/bin/nabic ./target/debug/nabi_playground
# http://127.0.0.1:8405
```

Without `PLAY_WRAP` the server only listens on loopback: an unsandboxed nabic could be made to read the machine's files.

## Scripts

The page scripts are TypeScript and TSX: each file directly in `static/` is a page script, `static/ui/*.tsx` are the Preact components they render into the server's markup, and the kit's `web/js/*.ts` come along. `npm ci`, then `npm run build` bundles each page script to the `.js` beside it with esbuild (`web/tools/build.ts`: types erased, JSX for Preact, imports bundled, minified), and `npm run check` type-checks everything with `tsc`. Run the build before `nabi build`: the kit's scripts are built into the program and the site serves the rest. The `.js` files are build output and not checked in.

## Highlighting

The editor highlights with nabi-syntax's tree-sitter grammar and highlight queries, as the editors do: `static/ts/` holds the grammar built to wasm, `highlights.scm` and web-tree-sitter's own wasm (its version pinned in package.json), all served from this site. `static/highlight.ts` loads them after the page and re-parses only what each edit changed; captures map to nabi-syntax's classes (`k t s n c a m`), so the editor and the docs agree. Until it loads, or if it cannot, the editor keeps its small lexer (`static/ui/editor.tsx`).

The grammar is pinned to the nabi-syntax commit in `nabi-syntax.rev`. Change it in nabi-syntax, then sync (needs the tree-sitter CLI):

```bash
node scripts/sync-grammar.mjs                # build at the pinned commit
node scripts/sync-grammar.mjs --from ../nabi-syntax   # from a checkout, pinning its HEAD
node scripts/sync-grammar.mjs --check        # fail if static/ts/ differs
```

## Web kit

`web/` is [nabi-lang/web](https://github.com/nabi-lang/web), pinned to a commit. The server builds its `web` library in (`Dep::path("web/nabi")`): HTTP, the canonical-address 301s, and the kit's files, served at `/nabi.css`, `/theme.js`, `/logo.svg`, the icons and `/site.webmanifest`. The webfonts are files, not built in: `/fonts/...` comes from `web/assets/fonts` relative to the working directory (a day, with an ETag), so a deploy ships that directory beside `static/`. `static/index.html` and `static/404.html` hold `<!--web:fonts-->` (the font preloads), `<!--web:icons-->`, `<!--web:wordmark-->`, `<!--web:theme-button-->`, `<!--web:header-sites-->`, `<!--web:credits-->`, `<!--web:social-->`, `<!--web:theme-seg-->` and `<!--web:not-found-->`, which the server fills from the kit's markup (the sites, licence and credit, social links and theme switch go in the header and its menu; the 404 body is the one every Nabi site shares). Move to a newer kit with:

```bash
git submodule update --remote web
nabi build && nabi test
git commit -am "chore: bump the web kit"
```

## Link previews

`static/index.html` points og:image and twitter:image at `og.png?v=dev`; the server puts the first 10 hex digits of og.png's SHA-256 (hashed at start) in place of `dev`, so a new image is a new URL. Pages name their stylesheets and scripts the same way (`/play.js?v=<first 10 hex digits of its SHA-256>`, filled in per request). A file asked for by its current `?v=` is cached for a year (`immutable`); a page for five minutes; anything else is revalidated each time. Every file answer carries an ETag of its content and answers `If-None-Match` with 304. When only a page's text changes, the cached card stays: re-scrape it with the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/), the [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) or Kakao's [sharing debugger](https://developers.kakao.com/tool/debugger/sharing) (clear the cache); X has no tool and refreshes in about 7 days.

## Settings

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PLAY_ADDR` | `127.0.0.1:8405` | Where to listen |
| `PLAY_NABIC` | `nabic` | The compiler (the toolchain's own `bin/nabic`, not the proxy) |
| `PLAY_NABI` | the `nabi` beside `PLAY_NABIC` | Runs `fmt` for `/api/fmt` |
| `PLAY_MJS` | `<nabic dir>/../lib/nabi/targets/wasm32-unknown-unknown/nabi.mjs` | JS host served at `/nabi.mjs` |
| `PLAY_SITE` | `../nabi-lang.org/static` | Fallback for static files in neither `static/` nor the kit |
| `PLAY_WRAP` | (none) | Sandbox command nabic and nabi run under (see Deploy) |
| `PLAY_WORK` | `<temp>/nabi-playground` | Job directories and module cache |
| `PLAY_JOBS` | the CPU count | Compiles at a time |
| `PLAY_QUEUE` | `10` | Seconds a compile waits for a turn when all are busy (at most four times `PLAY_JOBS` wait); then 503 with `Retry-After` |
| `PLAY_TIMEOUT` | `20` | Seconds a compile may take; then the tool is killed and `PLAY_WRAP --kill` runs in its job directory |
| `PLAY_DEPS` | (none) | The prebuilt packages, as nabic sees the path: `<PLAY_DEPS>/debug/deps/<name>.nabihir` for -O0, `release/` for -O2 (`scripts/warm.sh`); unset, programs use no packages |
| `PLAY_PACKAGES` | `<PLAY_DEPS>/packages` (warm.sh writes it), else `json,linalg,autodiff,special,specfun=special,signal,units,stats,csv,csvio=csv,table,plot,ode,optimize,interpolate,spatial` | The packages under `PLAY_DEPS`, each after the ones it depends on; `alias=name` is `name` under another name (`stats` imports `special` as `specfun`, `table` imports `csv` as `csvio`). A program that names one gets them all as `--extern`; the page's note lists them, linked to the registry |
| `PLAY_RATE` | `30` | Compiles a minute per client |
| `PLAY_SHARES` | `<PLAY_WORK>/shares` | Stored share links; must be writable and should outlive restarts |
| `PLAY_SHARE_RATE` | `10` | Share links a minute per client |
| `PLAY_SHARE_MAX` | `100000` | Share links kept; past it new ones are refused (Share falls back to `#code=`) |
| `PLAY_CLIENT_HEADER` | (none) | The header a trusted proxy puts the client address in (`cf-connecting-ip`, `x-forwarded-for`); unset, the TCP peer is the client |

The compile API is `POST /api/compile?opt=0` (or `opt=2`) (body: UTF-8 source, max 64 KiB) returning `application/wasm`, or nabic's diagnostics as text with an `X-Nabi-Diagnostics: 1` header (both 200; 4xx/5xx only for the request itself). `POST /api/fmt` takes the same body and returns it as `nabi fmt` lays it out (run in a job directory under `PLAY_WRAP`, like a build, stopped after 5 s), or its diagnostics the same way. `POST /api/share` takes the same body and returns the short link's id (`GET /api/share/<id>` gives the source back, `/p/<id>` the page); see `src/main.nabi`. `GET /api/health` answers `ok` and the server's state (see Operations). Other paths answer 404 with `static/404.html`.

## Deploy (Linux)

nabic can read any file it reaches at compile time, so a sandbox is what keeps the machine's files out of reach. Pick one for `PLAY_WRAP`.

The toolchain is read-only inside either sandbox, so warm it first: `scripts/warm.sh <toolchain> [<out> [<package sources>]]` builds the standard library's stages, and the function cache's code a hello reaches, for wasm32 at -O0 and -O2 into the toolchain's own nabic cache (`lib/nabi-cache`), which nabic then reads as is. With `<out>` it prebuilds the packages programs may use into `<out>/wasm32-unknown-unknown` and writes their `--extern` list to its `packages` file: the official packages a release toolchain carries (`lib/nabi/packages`), offline, as many as `PLAY_ALLOW` names (default json, toml, regex, linalg, autodiff, special, signal, units, stats, csv, table, plot, ode, optimize, interpolate, sparse, spatial), or every package in `<package sources>` (one directory each, for a toolchain built from source). A cold hello world costs nabic about 6.7 G instructions; with the warm cache about 1.3 G.

- Docker (recommended): `scripts/docker-sandbox.sh` runs each compile in a throwaway container (`play-<job>`) with the job directory as the only writable mount, no network, read-only root, cgroup memory/CPU/process caps, a CPU-time ulimit, and the tool under `timeout` inside. After a timeout the server runs `docker-sandbox.sh --kill`, which removes the container: killing the docker client alone leaves it running. Build the image from an unpacked Linux release archive, which carries the official packages; `scripts/Dockerfile` runs `warm.sh` while it builds, without the network:

```sh
mkdir ctx && cp scripts/warm.sh ctx/
tar -xJf nabi-<version>-x86_64-unknown-linux-gnu.tar.xz -C ctx
docker build -t nabi-playground:current \
  --build-arg TOOLCHAIN=nabi-<version>-x86_64-unknown-linux-gnu \
  -f scripts/Dockerfile ctx
docker run --rm --entrypoint cat nabi-playground:current /opt/nabi-play/target/wasm32-unknown-unknown/packages
```

Run the server with `PLAY_DEPS=/opt/nabi-play/target/wasm32-unknown-unknown` and `PLAY_PACKAGES` set to the list the last command prints (the server cannot read the image's file). Tune with `PLAY_IMAGE`, `PLAY_MEM` (default `4g`), `PLAY_CPUS` (default `2`); the service user must run `docker`. Put a TLS reverse proxy in front and set `PLAY_CLIENT_HEADER` to the header it adds, or every client shares the proxy's rate limit.

- bubblewrap (lighter, no daemon): `scripts/sandbox.sh` runs each compile under bwrap with only the job directory writable, no network, and prlimit caps. Real memory still needs a cgroup cap, so run the service with `MemoryMax=6G`. Run `scripts/warm.sh <toolchain> <out>` before the service starts, and point `PLAY_DEPS` at `<out>/wasm32-unknown-unknown`, which `sandbox.sh` binds read-only beside the toolchain.

## Operations

- Health: `GET /api/health` answers 200 and `ok`, then one `key value` a line: `nabic` (the release), `run true`, `sandbox` (`ok`, or `none` without `PLAY_WRAP`) and `packages`. It answers 503 and one line saying why when pages cannot run programs (no nabi.mjs) or the sandbox fails `PLAY_WRAP --check` (`docker-sandbox.sh`: Docker answers and `PLAY_IMAGE` is there; `sandbox.sh`: bwrap can make a sandbox). The check is cached for 30 s and stopped after 5 s, so frequent probes cost little. It runs no compile and shows no counters.
- Uptime: `scripts/probe.sh [<base url>]` checks the page, `/api/health` and a real compile of hello world (a wasm module must come back), prints one line, and exits 1 with what failed on stderr. Run it every minute from outside the host (cron, or any monitor that runs a command or checks an HTTP answer), and alert on two failures in a row; the same program each time comes from the module cache, so a probe costs no nabic run after the first. Probe the other sites beside it: `/` of nabi-lang.org, a docs page, and a registry API GET.
- Logs: one line a request on stderr, `<method> <path> <status> <bytes>B <ms>ms`, plus CSP reports (`csp: ...`) and notes at start; run under systemd, they go to the journal (`journalctl -u <service>`). Ship them with whatever the host already uses; 503s (`busy`) and 504s (timeouts) in a row mean `PLAY_JOBS` is too low for the traffic.
- Capacity: with the warm cache a hello compiles in about 0.3 s on an idle machine (1.5 s on a busy 8-core one under bwrap), a program using packages in 2-4 s; each compile holds one of `PLAY_JOBS` slots, and a request waits up to `PLAY_QUEUE` seconds for one before a 503 with `Retry-After`, which the page honours: it says the server is busy and asks again after the delay, doubling, three times.
- Cache: compiled modules live in `<PLAY_WORK>/cache`, at most 256; past that the least recently used quarter goes. Share links in `PLAY_SHARES` are never evicted; back that directory up.

## Layout

| File | Contents |
|---|---|
| `src/main.nabi` | Settings, compile and format API (job dir, sandbox, time limit, cache, rate limit), health, static files, the kit's files and markup, the 404 page |
| `src/lang.nabi` | The Korean pages: `/ko` addresses and the markup's Korean words |
| `static/` | `index.html`, `404.html`, `play.tsx` and its `ui/*.tsx` components (`ui/text.ts`: the script's words in English and Korean), `run.ts` (the worker), `play.css`, `examples/*.nabi`, `og.png` |
| `web/` | the web kit (submodule): `nabi.css`, `theme.js`, the marks and icons, and the `web` library (HTTP, addresses) |
| `scripts/og.html` | Source of `static/og.png` |
| `scripts/` | `Dockerfile` + `docker-sandbox.sh` (recommended), `sandbox.sh` (bubblewrap), `warm.sh` (the toolchain's cache and the prebuilt packages), `probe.sh` (an uptime probe) |
