#!/bin/sh
# Warm a toolchain for the playground, before it is mounted read-only:
# its nabic cache (lib/nabi-cache) gets the standard library's stages and
# the function cache's code a hello reaches, for wasm32 at -O0 and -O2,
# and nabils' stages for the host (its language requests check there).
# With <out>, the packages a program may use are built for both levels
# into <out>/wasm32-unknown-unknown/{debug,release}/deps (PLAY_DEPS is
# that wasm32-unknown-unknown directory), and their names, in build
# order, go to its `packages` file, which the server reads when
# PLAY_PACKAGES is unset. scripts/Dockerfile runs it.
#
#   warm.sh <toolchain> [<out> [<package sources>]]
#
# The packages are the official ones the toolchain carries
# (lib/nabi/packages, the `packages` component a release ships), built
# offline; PLAY_ALLOW names which (default below; one the toolchain
# lacks is left out). Or, from <package sources>, one directory per
# package (json, linalg, stats, plot, ...), each with its nabi.nabion;
# their path dependencies on each other (`../linalg`) resolve there.
set -eu

[ $# -ge 1 ] && [ $# -le 3 ] || { echo "usage: warm.sh <toolchain> [<out> [<package sources>]]" >&2; exit 2; }
nabi=$(cd "$1" && pwd)/bin
w=$(mktemp -d "${TMPDIR:-/tmp}/play-warm.XXXXXX")
trap 'rm -rf "$w"' EXIT
printf 'fn main() {\n    println("hi");\n}\n' > "$w/main.nabi"
for o in 0 2; do
  (cd "$w" && HOME="$w" NABI_HOME="$w/.nabi" "$nabi/nabic" build -q --target=wasm32-unknown-unknown "-O$o" --target-dir t main.nabi -o main.wasm)
done
# The language server (/api/lsp) checks for the host: one hover on a
# hello leaves the standard library's stages for that in the cache too,
# or each request would build them again (about 1 s instead of 0.1 s).
lsp() { printf 'Content-Length: %d\r\n\r\n%s' $(($(printf %s "$1" | wc -c))) "$1"; }
if [ -x "$nabi/nabils" ]; then
  {
    lsp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":null,"capabilities":{}}}'
    lsp '{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///play/main.nabi","languageId":"nabi","version":1,"text":"fn main() {\n    println(\"hi\");\n}\n"}}}'
    lsp '{"jsonrpc":"2.0","id":2,"method":"textDocument/hover","params":{"textDocument":{"uri":"file:///play/main.nabi"},"position":{"line":1,"character":5}}}'
    lsp '{"jsonrpc":"2.0","id":3,"method":"shutdown"}'
    lsp '{"jsonrpc":"2.0","method":"exit"}'
  } | (cd "$w" && HOME="$w" NABI_HOME="$w/.nabi" "$nabi/nabils" > "$w/lsp.out")
  grep -q '"id":2,"result":{' "$w/lsp.out" || echo "warm.sh: nabils gave no hover; /api/lsp will be slow" >&2
fi
[ $# -ge 2 ] || exit 0

mkdir -p "$2"
out=$(cd "$2" && pwd)
mkdir -p "$w/play/src"
printf 'fn main() {}\n' > "$w/play/src/main.nabi"
allow=${PLAY_ALLOW:-json toml regex linalg autodiff special signal units stats csv table plot ode optimize interpolate sparse spatial}
{
  printf 'Package {\n    name: "play",\n    version: "0.1.0",\n    deps: {\n'
  if [ $# -eq 3 ]; then
    src=$(cd "$3" && pwd)
    for d in "$src"/*/; do
      [ -f "$d/nabi.nabion" ] || continue
      n=$(basename "$d")
      printf '        "%s": Dep::path("%s"),\n' "$n" "$src/$n"
    done
  else
    index=$(cd "$1" && pwd)/lib/nabi/packages/index
    [ -f "$index" ] || { echo "warm.sh: $1 carries no official packages (lib/nabi/packages); give <package sources>" >&2; exit 1; }
    for n in $allow; do
      v=$(sed -n "s/^Package { name: \"$n\", version: \"\([^\"]*\)\".*/\1/p" "$index" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
      if [ -n "$v" ]; then printf '        "%s": "%s",\n' "$n" "$v"; else echo "warm.sh: no $n among the toolchain's packages" >&2; fi
    done
  fi
  printf '    },\n}\n'
} > "$w/play/nabi.nabion"
off=""
[ $# -eq 3 ] || off=--offline
for p in "" --release; do
  (cd "$w/play" && HOME="$w" NABI_HOME="$w/.nabi" "$nabi/nabi" build -q $off --target wasm32-unknown-unknown --target-dir "$out" $p)
done
rm -rf "$out"/wasm32-unknown-unknown/*/incremental

# The --extern names in build order: `nabi deps` prints `name=<lib.nabi>`
# for each; a name that shares another's lib.nabi without a .nabihir of
# its own is that package under another name (stats imports special as
# `specfun`): `alias=name`.
deps=$out/wasm32-unknown-unknown/debug/deps
(cd "$w/play" && HOME="$w" NABI_HOME="$w/.nabi" "$nabi/nabi" deps -q $off) > "$w/deps.txt"
awk -v d="$deps" '
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    n = substr($0, 1, index($0, "=") - 1); p = substr($0, index($0, "=") + 1)
    names[++k] = n; path[k] = p
    f = d "/" n ".nabihir"
    if ((getline x < f) >= 0) { own[p] = n; close(f) }
  }
  END {
    for (i = 1; i <= k; i++) {
      n = names[i]; p = path[i]
      if (own[p] == n) s = n; else if (p in own) s = n "=" own[p]; else continue
      out = out (out == "" ? "" : ",") s
    }
    print out
  }' "$w/deps.txt" > "$out/wasm32-unknown-unknown/packages"
echo "warm.sh: packages $(cat "$out/wasm32-unknown-unknown/packages")"
