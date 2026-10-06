#!/usr/bin/env bash
# Compila nidada-ext y deja la biblioteca donde la busca examples/godot-demo/nidada_ext.gdextension.
# Uso: ./build-ext.sh [--release]
# Con el editor de Godot abierto en Windows la .dll está bloqueada: ciérralo antes.
set -euo pipefail
cd "$(dirname "$0")"

# WSL compila para Linux: la .so resultante no la carga el Godot de Windows.
if [[ "$(uname -s)" == Linux ]] && grep -qi microsoft /proc/version 2>/dev/null; then
    echo "Estás en WSL: esto compilaría para Linux, y el Godot de Windows necesita la .dll." >&2
    echo "Abre Git Bash (o PowerShell) y lanza el script desde ahí. Ver rust/README.md." >&2
    exit 1
fi

profile=debug
args=()
if [[ "${1:-}" == "--release" ]]; then
    profile=release
    args=(--release)
fi

cargo build -p nidada-ext "${args[@]}"

target_dir="${CARGO_TARGET_DIR:-target}"
bin="../examples/godot-demo/bin"
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) mkdir -p "$bin/windows-x86_64"; cp "$target_dir/$profile/nidada_ext.dll" "$bin/windows-x86_64/" ;;
    Linux)                mkdir -p "$bin/linux-x86_64";   cp "$target_dir/$profile/libnidada_ext.so" "$bin/linux-x86_64/" ;;
    *) echo "Plataforma no soportada todavía: $(uname -s)" >&2; exit 1 ;;
esac
echo "nidada-ext ($profile) copiada a $bin"
