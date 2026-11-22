#!/bin/sh
# One nabic build (or nabi fmt, or one nabils request) of untrusted
# source in a throwaway container, the way play.rust-lang.org runs rustc:
# PLAY_WRAP=scripts/docker-sandbox.sh.
#
#   docker-sandbox.sh <nabic|nabi|nabils> <args..>  (run in the job directory)
#   docker-sandbox.sh --kill                 (the same directory: stop it)
#   docker-sandbox.sh --check                (Docker answers, the image is there)
#
# Only the host tool's name is used; the image's own tool runs (nabils
# reads its LSP session on stdin, so the container keeps stdin open). The job
# directory is the only writable mount, there is no network, the root is
# read-only, and Docker's cgroup caps memory (so the container, not the
# host, is OOM-killed), CPUs and processes. No IPC namespace, a capped
# open-file count, CPU time and file size, and a small no-exec /tmp.
# Killing this script's docker client does not stop the container, so
# the server runs `--kill` after a timeout, and the tool runs under
# `timeout` inside as well, in case the container started after that.
# Build the image first (scripts/Dockerfile). PLAY_IMAGE, PLAY_MEM,
# PLAY_CPUS, PLAY_PIDS (default 128) override; PLAY_LIMIT is the
# server's time limit in seconds.
set -eu

job=$(pwd)
name="play-$(basename "$job")"
image=${PLAY_IMAGE:-nabi-playground:current}
if [ "${1-}" = --check ]; then
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1 || { echo "docker does not answer" >&2; exit 1; }
  docker image inspect --format '{{.Id}}' "$image" >/dev/null 2>&1 || { echo "no image $image" >&2; exit 1; }
  exit 0
fi
if [ "${1-}" = --kill ]; then
  docker rm -f "$name" >/dev/null 2>&1 || true
  exit 0
fi
[ $# -ge 1 ] || { echo "usage: docker-sandbox.sh <nabic|nabi|nabils> <args..> | --kill | --check" >&2; exit 2; }
tool=$(basename "$1")
stdin=
case $tool in
  nabic | nabi) ;;
  nabils) stdin=--interactive ;;
  *) echo "docker-sandbox.sh: runs nabic, nabi or nabils, not $tool" >&2; exit 2 ;;
esac
shift   # the image carries its own toolchain
limit=${PLAY_LIMIT:-20}
cpus=${PLAY_CPUS:-2}

exec docker run --rm --name "$name" --init --stop-timeout 1 $stdin \
  --network none \
  --ipc none \
  --memory "${PLAY_MEM:-4g}" --memory-swap "${PLAY_MEM:-4g}" \
  --cpus "$cpus" --pids-limit "${PLAY_PIDS:-128}" \
  --ulimit nofile=512:512 --ulimit fsize=67108864 \
  --ulimit cpu=$((limit * ${cpus%.*} + 10)) \
  --read-only --tmpfs /tmp:size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --env HOME=/job --env TMPDIR=/job \
  --volume "$job":/job --workdir /job \
  --entrypoint timeout \
  "$image" -s KILL "$((limit + 5))" "$tool" "$@"
