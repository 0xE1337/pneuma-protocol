.PHONY: setup install build test deploy-arc deploy-base register-skills seed-demo demo-prep smoke clean help

help:
	@echo "Pneuma Protocol — Makefile targets"
	@echo ""
	@echo "  setup            First-time bootstrap (forge install + pnpm install)"
	@echo "  install          Install all dependencies"
	@echo "  build            Build everything (contracts + packages + apps)"
	@echo "  test             Run all tests (forge + ts)"
	@echo "  deploy-arc       Deploy 8 contracts to Arc Testnet"
	@echo "  deploy-base      Deploy contracts to Base Sepolia (optional backup)"
	@echo "  register-skills  Register 5 demo skills (V4 + V5) on deployed SkillRegistry"
	@echo "  seed-demo        Seed Knowledge Commons with demo publications + citations"
	@echo "  demo-prep        Full demo prep: deploy + register-skills + seed-demo"
	@echo "  smoke            Run end-to-end smoke test"
	@echo "  clean            Clean build artifacts"

setup:
	@bash scripts/setup.sh

install:
	cd contracts && forge install foundry-rs/forge-std --no-commit || true
	cd contracts && forge install OpenZeppelin/openzeppelin-contracts --no-commit || true
	cd contracts && forge install erc6551/reference --no-commit || true

build:
	cd contracts && forge build
	pnpm build

test:
	cd contracts && forge test -vv
	pnpm test

deploy-arc:
	cd contracts && forge script script/Deploy.s.sol \
		--rpc-url $$ARC_TESTNET_RPC_URL \
		--private-key $$DEPLOYER_PRIVATE_KEY \
		--broadcast

deploy-base:
	cd contracts && forge script script/Deploy.s.sol \
		--rpc-url $$BASE_SEPOLIA_RPC_URL \
		--private-key $$DEPLOYER_PRIVATE_KEY \
		--broadcast --verify

register-skills:
	cd contracts && forge script script/RegisterSkills.s.sol \
		--rpc-url $$ARC_TESTNET_RPC_URL \
		--private-key $$DEPLOYER_PRIVATE_KEY \
		--broadcast --legacy

seed-demo:
	cd contracts && forge script script/SeedDemo.s.sol \
		--rpc-url $$ARC_TESTNET_RPC_URL \
		--private-key $$DEPLOYER_PRIVATE_KEY \
		--broadcast --legacy

demo-prep: deploy-arc register-skills seed-demo
	@echo ""
	@echo "✅ Demo prep complete."
	@echo "Next: copy NEXT_PUBLIC_* addresses from logs into apps/hub/.env.local"
	@echo "Then: cd apps/hub && pnpm dev"

smoke:
	bash scripts/smoke-test.sh

clean:
	cd contracts && forge clean
	rm -rf node_modules dist build .next .turbo
	pnpm -r exec rm -rf dist build .next 2>/dev/null || true
