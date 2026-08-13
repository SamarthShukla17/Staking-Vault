#!/usr/bin/env bash
set -euo pipefail

echo "Building pinocchio-vault..."
cargo build-sbf --manifest-path programs/pinocchio-vault/Cargo.toml

SO_PATH="programs/pinocchio-vault/target/deploy/pinocchio_vault.so"
if [ -f "$SO_PATH" ]; then
    SIZE=$(wc -c < "$SO_PATH" | tr -d ' ')
    echo ""
    echo "✓ Built successfully"
    echo "  Path: $SO_PATH"
    echo "  Size: $SIZE bytes"
else
    echo "ERROR: $SO_PATH not found"
    exit 1
fi
