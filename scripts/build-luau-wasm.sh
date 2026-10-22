#!/usr/bin/env bash
# Builds the official Luau VM + compiler to a single-file WebAssembly ES module
# (src/luau/wasm/luau.mjs). The output is committed, so this only needs to run
# when bumping LUAU_COMMIT or changing native/.
#
# Requirements: an activated Emscripten SDK (emcc on PATH) and git.
set -euo pipefail

LUAU_REPO="https://github.com/luau-lang/luau"
LUAU_COMMIT="${LUAU_COMMIT:-6d36d483cb88973276af611198169f76f3ce05b0}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LUAU_DIR="${LUAU_SRC:-$ROOT/.cache/luau}"
OUT_DIR="$ROOT/src/luau/wasm"
OBJ_DIR="$ROOT/.cache/luau-obj"

if [ ! -d "$LUAU_DIR/.git" ]; then
  git clone --filter=blob:none "$LUAU_REPO" "$LUAU_DIR"
fi
if [ -z "${LUAU_SRC:-}" ]; then
  git -C "$LUAU_DIR" fetch --depth 1 origin "$LUAU_COMMIT" 2>/dev/null || true
  git -C "$LUAU_DIR" checkout -q "$LUAU_COMMIT"
fi

mkdir -p "$OUT_DIR" "$OBJ_DIR"

CXXFLAGS=(-O2 -std=c++17 -fwasm-exceptions -DNDEBUG "-DLUA_API=extern \"C\"" "-DLUACODE_API=extern \"C\""
  -I"$LUAU_DIR/Common/include" -I"$LUAU_DIR/Ast/include" -I"$LUAU_DIR/Bytecode/include"
  -I"$LUAU_DIR/Compiler/include" -I"$LUAU_DIR/VM/include" -I"$LUAU_DIR/VM/src")

SOURCES=()
for dir in Common/src Ast/src Bytecode/src Compiler/src VM/src; do
  if [ -d "$LUAU_DIR/$dir" ]; then
    while IFS= read -r f; do SOURCES+=("$f"); done < <(find "$LUAU_DIR/$dir" -maxdepth 1 -name '*.cpp' | sort)
  fi
done
SOURCES+=("$ROOT/native/luau_glue.cpp")

OBJECTS=()
pids=()
for src in "${SOURCES[@]}"; do
  rel="${src#$LUAU_DIR/}"
  rel="${rel#$ROOT/}"
  obj="$OBJ_DIR/${rel//\//_}.o"
  OBJECTS+=("$obj")
  if [ ! -f "$obj" ] || [ "$src" -nt "$obj" ]; then
    em++ "${CXXFLAGS[@]}" -c "$src" -o "$obj" &
    pids+=($!)
    if [ "${#pids[@]}" -ge "$(nproc)" ]; then wait "${pids[0]}"; pids=("${pids[@]:1}"); fi
  fi
done
for p in "${pids[@]}"; do wait "$p"; done

EXPORTS=$(node -e '
const fns = require(process.argv[1]);
console.log(JSON.stringify(fns.map(f => "_" + f)));
' "$ROOT/native/exports.json")

em++ -O2 -fwasm-exceptions "${OBJECTS[@]}" -o "$OUT_DIR/luau.mjs" \
  --js-library "$ROOT/native/luau_glue.js" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createLuauModule \
  -sENVIRONMENT=node,web -sSINGLE_FILE=1 -sWASM_ASYNC_COMPILATION=1 \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=2147483648 \
  -sSTACK_SIZE=8388608 -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8","HEAP32","HEAPF32","HEAPF64","UTF8ToString","stringToUTF8","lengthBytesUTF8"]'

echo "Built $OUT_DIR/luau.mjs ($(wc -c < "$OUT_DIR/luau.mjs") bytes) from Luau $LUAU_COMMIT"
