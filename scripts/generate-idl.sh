#!/usr/bin/env bash
set -euo pipefail

# Generates idl/pinocchio_vault.json from the shank annotations in
# programs/pinocchio-vault/src/shank.rs (gated behind the "idl" Cargo
# feature; the on-chain build via scripts/build-pinocchio.sh never enables
# it, so the deployed program never depends on `shank`).
#
# `shank idl` statically parses the crate's Rust source with `syn` — it does
# not invoke `rustc` — so it discovers the annotations in src/shank.rs
# regardless of the `#[cfg(feature = "idl")]` gate on its `mod` declaration
# in lib.rs. Real annotation-derived generation (not a hand-written
# fallback) was achievable in one attempt; no fallback was needed.

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CRATE_ROOT="programs/pinocchio-vault"
OUT_DIR="idl"

if ! command -v shank >/dev/null 2>&1; then
    echo "shank-cli not found; installing..."
    cargo install shank-cli --locked
fi

echo "Generating IDL for pinocchio_vault..."
shank idl --crate-root "$CRATE_ROOT" --out-dir "$OUT_DIR"

OUT_FILE="$OUT_DIR/pinocchio_vault.json"
if [ ! -f "$OUT_FILE" ]; then
    echo "ERROR: $OUT_FILE not found" >&2
    exit 1
fi

echo ""
echo "✓ IDL written to $OUT_FILE"
echo ""
cat "$OUT_FILE"
