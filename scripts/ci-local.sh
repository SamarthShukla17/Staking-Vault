#!/usr/bin/env bash
# Replays the .github/workflows/ci.yml pipeline locally, same commands and same order, so it can
# be validated before pushing. Mutates global toolchain state (rustup default, global yarn) the
# same way the CI runner does — that's the point: catch what CI would hit. The one deliberate
# difference is anchor-cli: installed to a scratch dir + PATH prepend instead of system-wide, so
# it never clobbers a locally-managed install (see below).
set -euo pipefail

# Pinned to the versions in the README toolchain table — never "latest".
RUST_VERSION="1.89.0"
SOLANA_VERSION="3.1.10"
ANCHOR_VERSION="1.1.2"
YARN_VERSION="1.22.22"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

# --- job: lint-rust ---

step "Install pinned Rust toolchain"
rustup toolchain install "$RUST_VERSION" --profile minimal --component rustfmt --component clippy
rustup default "$RUST_VERSION"

step "cargo fmt --all --check"
cargo fmt --all --check

step "cargo clippy -D warnings"
cargo clippy --manifest-path programs/staking-vault/Cargo.toml -- -D warnings

step "cargo test"
cargo test --manifest-path programs/staking-vault/Cargo.toml

# --- job: build-test ---

step "Install Solana CLI (pinned, official Anza installer)"
if [ ! -x "$HOME/.local/share/solana/install/active_release/bin/solana" ]; then
  sh -c "$(curl -sSfL "https://release.anza.xyz/v${SOLANA_VERSION}/install")"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

step "Install anchor-cli (pinned, official release binary)"
# Downloaded to a scratch dir and prepended to PATH rather than installed system-wide (as CI
# does with `sudo mv .../usr/local/bin`) so this never clobbers a locally-managed anchor-cli
# install (e.g. one managed by avm) sitting at ~/.cargo/bin/anchor.
ANCHOR_BIN_DIR="$HOME/.cache/ci-local/bin"
mkdir -p "$ANCHOR_BIN_DIR"
if [ ! -x "$ANCHOR_BIN_DIR/anchor" ] || ! "$ANCHOR_BIN_DIR/anchor" --version | grep -q "$ANCHOR_VERSION"; then
  curl -sSfL -o "$ANCHOR_BIN_DIR/anchor" \
    "https://github.com/otter-sec/anchor/releases/download/v${ANCHOR_VERSION}/anchor-${ANCHOR_VERSION}-x86_64-unknown-linux-gnu"
  chmod +x "$ANCHOR_BIN_DIR/anchor"
fi
export PATH="$ANCHOR_BIN_DIR:$PATH"

step "Install pinned yarn"
npm install -g "yarn@$YARN_VERSION"

step "anchor build"
anchor build

step "yarn install --frozen-lockfile"
yarn install --frozen-lockfile

step "yarn test:program"
yarn test:program

step "ci-local: all checks passed"
