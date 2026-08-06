#!/usr/bin/env bash
# Replays the .github/workflows/ci.yml pipeline locally, same commands and same order, so it can
# be validated before pushing. Mutates global toolchain state (rustup default, global yarn) the
# same way the CI runner does — that's the point: catch what CI would hit. The one deliberate
# difference is anchor-cli: installed to a scratch dir + PATH prepend instead of system-wide, so
# it never clobbers a locally-managed install (e.g. one managed by avm) sitting at
# ~/.cargo/bin/anchor.
set -euo pipefail

# Pinned to the versions in the README toolchain table — never "latest".
RUST_VERSION="1.89.0"
SOLANA_VERSION="3.1.10"
ANCHOR_VERSION="1.1.2"
YARN_VERSION="1.22.22"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

step "Install Rust (pinned)"
rustup toolchain install "$RUST_VERSION" --profile minimal
rustup default "$RUST_VERSION"

step "Install Solana CLI (pinned, official Anza installer)"
if [ ! -x "$HOME/.local/share/solana/install/active_release/bin/solana" ]; then
  sh -c "$(curl -sSfL "https://release.anza.xyz/v${SOLANA_VERSION}/install")"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

step "Install Anchor CLI (pinned, official release binary)"
ANCHOR_BIN_DIR="$HOME/.cache/ci-local/bin"
mkdir -p "$ANCHOR_BIN_DIR"
if [ ! -x "$ANCHOR_BIN_DIR/anchor" ] || ! "$ANCHOR_BIN_DIR/anchor" --version | grep -q "$ANCHOR_VERSION"; then
  curl -sSfL -o "$ANCHOR_BIN_DIR/anchor" \
    "https://github.com/otter-sec/anchor/releases/download/v${ANCHOR_VERSION}/anchor-${ANCHOR_VERSION}-x86_64-unknown-linux-gnu"
  chmod +x "$ANCHOR_BIN_DIR/anchor"
fi
export PATH="$ANCHOR_BIN_DIR:$PATH"

step "anchor build"
anchor build

step "cargo test (program unit tests)"
cargo test --manifest-path programs/staking-vault/Cargo.toml

step "Install pinned yarn"
npm install -g "yarn@$YARN_VERSION"

step "yarn install --frozen-lockfile"
yarn install --frozen-lockfile

step "yarn test:program (LiteSVM integration + security suite)"
yarn test:program

step "yarn workspace @staking-vault/sdk build"
yarn workspace @staking-vault/sdk build

step "ci-local: all checks passed"
