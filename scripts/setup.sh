#!/usr/bin/env bash
# Pneuma Protocol — first-time bootstrap script
# Run once after cloning: bash scripts/setup.sh

set -euo pipefail

echo "Pneuma Protocol bootstrap"
echo "========================="

# Check prereqs
command -v forge >/dev/null 2>&1 || { echo "ERROR: foundry not installed. See https://book.getfoundry.sh/getting-started/installation"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "ERROR: pnpm not installed. Run: npm i -g pnpm"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: node not installed (need 22+)"; exit 1; }

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "WARNING: Node $NODE_MAJOR detected, recommended 22+"
fi

# .env
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "Created .env.local from .env.example"
  echo "Edit .env.local before deploying"
fi

# Foundry libs
echo "Installing foundry libraries..."
cd contracts
forge install foundry-rs/forge-std --no-commit 2>/dev/null || echo "  forge-std already installed"
forge install OpenZeppelin/openzeppelin-contracts --no-commit 2>/dev/null || echo "  openzeppelin already installed"
forge install erc6551/reference --no-commit 2>/dev/null || echo "  erc6551 already installed"
cd ..

# Node deps
echo "Installing node dependencies..."
pnpm install

# Initial build
echo "Building contracts..."
cd contracts && forge build && cd ..

echo ""
echo "Setup complete."
echo "Next steps:"
echo "  1. Edit .env.local with your RPC URLs and DEPLOYER_PRIVATE_KEY"
echo "  2. Run: make test       (run contract tests)"
echo "  3. Run: make deploy-base (deploy to Base Sepolia)"
