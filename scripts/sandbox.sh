#!/bin/sh
# One nabic build (or nabi fmt) of untrusted source, on Linux:
# PLAY_WRAP=scripts/sandbox.sh.
#
#   sandbox.sh <toolchain>/bin/nabic|nabi <args..>  (run in the job directory)
#   sandbox.sh --kill   (a no-op: --die-with-parent ends the sandbox with it)
#   sandbox.sh --check  (bwrap and prlimit are there and bwrap can run)
#
# nabic can read any file it can reach at compile time (include_bytes!,
# #[path], WIT) and put it in the module it writes, so it sees only the
# job directory (writable), its toolchain, the prebuilt packages
# (PLAY_DEPS, when set) and /usr (read-only), a fresh
# /proc and a /dev with only null: no /etc, no home directories, no
# network, no other processes. Limits: 16 GiB of address space (nabic
# reserves a 1 GiB stack and its codegen threads; cap real memory with a
# cgroup), 60 s of CPU, 64 MiB per file written; the server's
# PLAY_TIMEOUT kills it before that.
# Needs bubblewrap and util-linux's prlimit. PLAY_NABIC must be the
# toolchain's own nabic (not the ~/.nabi/bin proxy), so its lib/ is bound;
# the nabi beside it runs `fmt`. The toolchain is bound read-only, so warm
# its cache once beforehand (scripts/warm.sh <toolchain>): nabic then
# reads the standard library's stages from it instead of building them
# for every compile.
set -eu
# Mounts go in order: /tmp's tmpfs first, then the job directory (often
# under /tmp) on top of it.

[ "${1-}" = --kill ] && exit 0
if [ "${1-}" = --check ]; then
  for t in bwrap prlimit; do
    command -v $t >/dev/null || { echo "no $t" >&2; exit 1; }
  done
  bwrap --unshare-all --ro-bind / / -- /bin/true 2>/dev/null || { echo "bwrap cannot make a sandbox" >&2; exit 1; }
  exit 0
fi
[ $# -ge 1 ] || { echo "usage: sandbox.sh <toolchain>/bin/nabic|nabi <args..>" >&2; exit 2; }
tool=$(basename "$1")
case $tool in
  nabic | nabi) ;;
  *) echo "sandbox.sh: runs nabic or nabi, not $tool" >&2; exit 2 ;;
esac
root=$(cd "$(dirname "$1")/.." && pwd)
shift
job=$(pwd)
deps=${PLAY_DEPS:-}
[ -z "$deps" ] || [ -d "$deps" ] || { echo "sandbox.sh: PLAY_DEPS=$deps is not a directory" >&2; exit 2; }

exec prlimit --as=17179869184 --cpu=60 --fsize=67108864 --core=0 -- \
  bwrap --unshare-all --die-with-parent --new-session --clearenv \
    --setenv PATH /usr/bin:/bin --setenv HOME "$job" --setenv TMPDIR "$job" \
    --setenv NO_COLOR 1 --setenv NABI_INCREMENTAL 0 \
    --ro-bind /usr /usr \
    --ro-bind-try /lib /lib --ro-bind-try /lib64 /lib64 \
    --proc /proc --tmpfs /dev --dev-bind /dev/null /dev/null --tmpfs /tmp \
    --ro-bind "$root" "$root" \
    ${deps:+--ro-bind "$deps" "$deps"} \
    --bind "$job" "$job" --chdir "$job" \
    -- "$root/bin/$tool" "$@"
