#!/usr/bin/env bash
# Blender 5.2 for a cloud session, in one command (see "Blender: the author's PC and the cloud" in
# tools/asset-pipeline/AGENTS.md).
#
#   bash tools/asset-pipeline/setup-cloud.sh [env-dir]
#   PY=$(bash tools/asset-pipeline/setup-cloud.sh)    # progress goes to stderr, the Python path to stdout
#
# The cloud has no Blender executable: the `bpy` module from PyPI is Blender 5.2.1 as a Python 3.13
# package. This script
#   1. finds a Python 3.13 (bpy 5.2 ships wheels for that minor release only),
#   2. installs the EGL packages that EEVEE needs to start on Mesa's software OpenGL,
#   3. creates a venv outside the repository (default ~/.cache/terepasztal/bpy-env) with
#      bpy==5.2.1, Pillow and numpy,
#   4. imports bpy once to prove it, and prints the venv's Python on stdout.
# That Python is the one every Blender step runs with: `<python> tools/asset-pipeline/blender_runner.py ...`,
# `<python> tools/asset-pipeline/handbuilt/run.py ...`, with no `--blender`.
#
# Safe to run twice: whatever is already in place is left alone, and nothing is downloaded then.
# Environment: BPY_ENV overrides the venv path (an argument wins over it), BPY_PYTHON the Python
# to build it from. Exit status 1, with the reason on stderr, when a step cannot be done.
set -euo pipefail

BPY_VERSION='5.2.1'
PY_MINOR='3.13'
EGL_PACKAGES=(libegl1 libegl-mesa0)

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo="$(cd "$here/../.." && pwd -P)"

say() { printf 'setup-cloud: %s\n' "$*" >&2; }
die() {
  say "error: $*"
  exit 1
}

case "${1:-}" in
  -h | --help)
    sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed -e '$d' -e 's/^# \{0,1\}//'
    exit 0
    ;;
esac
[ "$#" -le 1 ] || die "usage: setup-cloud.sh [env-dir]"

env_dir="${1:-${BPY_ENV:-$HOME/.cache/terepasztal/bpy-env}}"
case "$env_dir" in
  /*) ;;
  *) env_dir="$PWD/$env_dir" ;;
esac
env_dir="$(realpath -m "$env_dir")"
case "$env_dir/" in
  "$repo"/*) die "$env_dir is inside the repository ($repo); the venv must live outside it" ;;
esac
env_python="$env_dir/bin/python"

# 1. A Python 3.13 to build the venv from.
is_python_313() {
  "$1" -c "import sys; sys.exit(0 if sys.version_info[:2] == (3, 13) else 1)" 2>/dev/null
}
find_python() {
  local candidate path
  for candidate in "python$PY_MINOR" python3 python; do
    path="$(command -v "$candidate" 2>/dev/null)" || continue
    if is_python_313 "$path"; then
      printf '%s\n' "$path"
      return 0
    fi
  done
  return 1
}

# True when the venv already holds exactly what the pipeline needs.
env_ready() {
  [ -x "$env_python" ] || return 1
  "$env_python" - "$BPY_VERSION" 2>/dev/null <<'PY'
import importlib.metadata as md
import sys

if sys.version_info[:2] != (3, 13):
    sys.exit(1)
try:
    if md.version('bpy') != sys.argv[1]:
        sys.exit(1)
    md.version('pillow')
    md.version('numpy')
except md.PackageNotFoundError:
    sys.exit(1)
PY
}

base_python=''
if ! env_ready; then
  if [ -n "${BPY_PYTHON:-}" ]; then
    base_python="$(command -v "$BPY_PYTHON" 2>/dev/null)" || die "BPY_PYTHON=$BPY_PYTHON is not an executable"
    is_python_313 "$base_python" || die "BPY_PYTHON=$BPY_PYTHON is not Python $PY_MINOR, and bpy $BPY_VERSION needs $PY_MINOR"
  else
    base_python="$(find_python)" || die "no Python $PY_MINOR found (looked for python$PY_MINOR, python3 and python on PATH). bpy $BPY_VERSION is built for Python $PY_MINOR only and has no wheel for any other release. Install Python $PY_MINOR (for example 'apt-get install -y python$PY_MINOR python$PY_MINOR-venv', or 'uv python install $PY_MINOR') or set BPY_PYTHON=<path to a python$PY_MINOR>, then run this again."
  fi
fi

# 2. The EGL packages: EEVEE (sample, production, painted/run.py) needs them; Cycles does not.
package_installed() {
  [ "$(dpkg-query -W -f='${Status}' "$1" 2>/dev/null)" = 'install ok installed' ]
}
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$@"
  else
    return 1
  fi
}
missing=()
for package in "${EGL_PACKAGES[@]}"; do
  package_installed "$package" || missing+=("$package")
done
if [ "${#missing[@]}" -gt 0 ]; then
  say "installing ${missing[*]} (EEVEE needs EGL for Mesa's software OpenGL)"
  command -v apt-get >/dev/null 2>&1 || die "apt-get not found; install ${missing[*]} with this system's package manager, then run this again"
  apt_install() { as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}" >&2; }
  if ! apt_install; then
    say "apt-get install failed; refreshing the package lists and trying once more"
    as_root apt-get update >&2 || true
    apt_install || die "could not install ${missing[*]} (needs root or passwordless sudo, and a package mirror)"
  fi
else
  say "EGL packages already installed (${EGL_PACKAGES[*]})"
fi

# 3. The venv and what goes in it.
if [ -n "$base_python" ]; then
  if [ -e "$env_dir" ] && [ -n "$(ls -A "$env_dir" 2>/dev/null)" ] && [ ! -f "$env_dir/pyvenv.cfg" ]; then
    die "$env_dir exists and is not a venv; choose another path (argument or BPY_ENV) or remove it"
  fi
  if [ ! -x "$env_python" ] || ! is_python_313 "$env_python"; then
    say "creating the venv $env_dir from $base_python"
    mkdir -p "$(dirname "$env_dir")"
    # --clear only ever runs on a directory that already holds a venv (checked above).
    "$base_python" -m venv --clear "$env_dir" >&2 ||
      die "could not create a venv with $base_python (Debian and Ubuntu split it out: 'apt-get install -y python$PY_MINOR-venv')"
  fi
  say "installing bpy==$BPY_VERSION, pillow and numpy into $env_dir (bpy is a large download)"
  "$env_python" -m pip install --quiet --disable-pip-version-check --progress-bar off \
    "bpy==$BPY_VERSION" pillow numpy >&2 ||
    die "pip could not install bpy==$BPY_VERSION into $env_dir. PyPI carries bpy $BPY_VERSION wheels for 64-bit Linux, macOS and Windows on Python $PY_MINOR; check the network and the machine, then run this again"
else
  say "venv $env_dir already holds bpy==$BPY_VERSION, pillow and numpy"
fi

# 4. Prove it: the same import blender_runner.resolve does.
version="$("$env_python" -c "
import bpy
print('Blender %s build %s' % (bpy.app.version_string, bpy.app.build_hash.decode()))
assert tuple(bpy.app.version[:2]) == (5, 2), bpy.app.version_string
" 2>&1)" || die "bpy installed in $env_dir but does not import as Blender 5.2.x: $version"
say "$version, ready"
say "run every Blender step with this Python and no --blender, for example:"
say "  $env_python tools/asset-pipeline/blender_runner.py assets/source/c50-handbuilt-2026-10-07/build.py"
printf '%s\n' "$env_python"
