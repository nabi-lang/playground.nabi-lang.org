#!/bin/sh
# An uptime probe for a playground: the page, /api/health, and a real
# compile of hello world, which must come back as a wasm module. One
# line out; exit 0 when all three answer, 1 (and what failed on stderr)
# otherwise. Run it from cron or a monitor every minute or so:
#
#   probe.sh [<base url>]     (default https://playground.nabi-lang.org)
#
# A compile that is in the module cache costs the server no nabic run, so
# the probe asks for the same program each time. Needs curl and od.
set -eu

base=${1:-https://playground.nabi-lang.org}
w=$(mktemp -d "${TMPDIR:-/tmp}/play-probe.XXXXXX")
trap 'rm -rf "$w"' EXIT
fail() { echo "probe $base: $*" >&2; exit 1; }

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$base/") || fail "page: no answer"
[ "$code" = 200 ] || fail "page: HTTP $code"
code=$(curl -s -o "$w/health" -w '%{http_code}' --max-time 10 "$base/api/health") || fail "health: no answer"
[ "$code" = 200 ] && [ "$(head -n 1 "$w/health")" = ok ] || fail "health: HTTP $code: $(tr '\n' ' ' < "$w/health")"
t0=$(date +%s)
code=$(printf 'fn main() {\n    println("probe");\n}\n' | curl -s -o "$w/out" -w '%{http_code}' --max-time 40 \
  -H 'Content-Type: text/plain; charset=utf-8' --data-binary @- "$base/api/compile?opt=0") || fail "compile: no answer"
[ "$code" = 200 ] || fail "compile: HTTP $code: $(head -c 200 "$w/out")"
[ "$(od -An -tx1 -N4 "$w/out" | tr -d ' \n')" = 0061736d ] || fail "compile: not a module: $(head -c 200 "$w/out")"
echo "probe $base: ok, compile $(($(date +%s) - t0)) s, $(sed -n 's/^jobs //p' "$w/health") jobs"
