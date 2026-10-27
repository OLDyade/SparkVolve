#!/usr/bin/env bash
# Run on a dedicated Linux Docker host. Leaves existing runtimes/default unchanged.
set -euo pipefail
if (( $# > 1 )); then
  printf 'Usage: %s [verified-release-archive.tar.bz2]\n' "$0" >&2
  exit 1
fi
for dependency in tar bzip2 sha256sum sudo systemctl docker; do
  command -v "$dependency" >/dev/null
done
if (( $# == 0 )); then command -v curl >/dev/null; fi

version=20261019.0
runtime=he-runsc-20261019
arch=$(uname -m)
case "$arch" in
  x86_64) checksum=1298e8ed9c3fee900f00d2ea96ec2d79d80ed93f2175812f29b7e7da718041a3 ;;
  aarch64) checksum=5790f89dc94b091b5aa0f0b6596aa4391606b3fe5f069e68f440576f3388abd8 ;;
  *) printf 'Unsupported architecture: %s\n' "$arch" >&2; exit 1 ;;
esac
test "$(uname -s)" = Linux
target="/opt/harness-evolution/runsc-$version"
test ! -e "$target"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
archive=${1:-"$scratch/gvisor-$arch.tar.bz2"}
if (( $# == 0 )); then
  curl --fail --location --show-error --silent \
    "https://github.com/google/gvisor/releases/download/release-$version/gvisor-$arch.tar.bz2" \
    --output "$archive"
fi
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check -
sudo install -d -m 0755 "$target"
sudo tar -xjf "$archive" -C "$target"
sudo "$target/runsc" install --runtime="$runtime" --clobber=false \
  --download-sidecars=NEVER --require-sidecars=ALWAYS -- --platform=systrap
sudo systemctl reload docker
"$target/runsc" --version
docker info --format '{{range $name, $runtime := .Runtimes}}{{$name}}{{"\n"}}{{end}}'
