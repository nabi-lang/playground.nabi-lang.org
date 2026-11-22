# A throwaway container for one nabic build, play.rust-lang.org style:
# each compile runs nabic here (and each format `nabi fmt`), with no
# network, a memory cap, a read-only root and a tmpfs. The toolchain is
# baked in read-only; nabic has its own code generator and linker and the
# toolchain ships each target's C library, so nothing else is needed to
# build for wasm32-unknown-unknown. bin/nabils (the language server,
# /api/lsp) comes with the toolchain; warm.sh warms its cache too.
#
# The image is warmed when it is built (scripts/warm.sh): nabic's cache
# holds the standard library's stages, read as is at run time, and the
# official packages the release archive carries (lib/nabi/packages) are
# prebuilt for -O0 and -O2, offline. Run the server with
# PLAY_DEPS=/opt/nabi-play/target/wasm32-unknown-unknown and the
# PLAY_PACKAGES that `docker run --rm --entrypoint cat <image>
# /opt/nabi-play/target/wasm32-unknown-unknown/packages` prints.
#
#   docker build -t nabi-playground:<version> \
#     --build-arg TOOLCHAIN=nabi-<version>-x86_64-unknown-linux-gnu \
#     -f scripts/Dockerfile <context>
#
# <context> holds the unpacked toolchain and scripts/warm.sh as `warm.sh`.
# The multi-arch index digest of debian:bookworm-slim on 2026-11-21. A
# new digest: docker buildx imagetools inspect debian:bookworm-slim.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
ARG TOOLCHAIN
COPY ${TOOLCHAIN}/ /opt/nabi/
COPY warm.sh /opt/nabi-play/warm.sh
ENV PATH=/opt/nabi/bin:$PATH NO_COLOR=1 NABI_INCREMENTAL=0
RUN sh /opt/nabi-play/warm.sh /opt/nabi /opt/nabi-play/target \
 && chmod -R a+rX /opt/nabi /opt/nabi-play
WORKDIR /job
ENTRYPOINT ["nabic"]
