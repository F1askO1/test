#!/usr/bin/env bash
# Run explicitly on the chosen Ubuntu/Debian x64 server, not on Windows.
set -euo pipefail
version="${1:-24.22.2}"
[[ "$version" =~ ^24\.[0-9]+\.[0-9]+$ ]] || { echo 'Expected an explicit Node 24.x.y version'; exit 1; }
[[ "$(uname -m)" == x86_64 ]] || { echo 'This installer is for Linux x64 only'; exit 1; }
[[ "$EUID" == 0 ]] || { echo 'Run with sudo on your chosen server'; exit 1; }
if [[ -e /opt/node24 && ! -L /opt/node24 ]]; then echo '/opt/node24 is not a symlink; inspect it manually. Nothing changed.'; exit 1; fi
if [[ -L /opt/node24 ]]; then
  target="$(readlink /opt/node24)"
  [[ "$target" == /opt/node-v24.*-linux-x64 ]] || { echo 'Unknown /opt/node24 target; inspect manually'; exit 1; }
fi
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
cd "$workdir"
archive="node-v${version}-linux-x64.tar.xz"
curl --proto '=https' --tlsv1.2 -fSLO "https://nodejs.org/dist/v${version}/${archive}"
curl --proto '=https' --tlsv1.2 -fSLO "https://nodejs.org/dist/v${version}/SHASUMS256.txt"
awk -v file="$archive" '$2 == file { print }' SHASUMS256.txt > selected.sha256
[[ -s selected.sha256 ]] || { echo 'Official checksum not found'; exit 1; }
sha256sum --check selected.sha256
if [[ -e "/opt/node-v${version}-linux-x64" ]]; then echo 'Version directory already exists; no files replaced. Verify it manually.'; exit 1; fi
tar --no-same-owner -xJf "$archive" -C /opt
ln -sfn "/opt/node-v${version}-linux-x64" /opt/node24
/opt/node24/bin/node --version
