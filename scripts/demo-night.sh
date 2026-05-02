#!/usr/bin/env bash
#
# demo-night.sh — "小陈睡觉赚钱" demo 的 12-call 洪峰模拟
#
# 三个 caller (Tokyo / Berlin / SF) × 4 次调用 = 12 次完整闭环
# 每次闭环：caller escrow → provider settle → caller reverse-rate
# 总 36 笔 tx 上 Arc Testnet → /admin/dashboard 实时看板会有 36 条事件滚入
#
# 用 cast send 而不是 forge script —— 绕过 Arc Circle USDC isBlocklisted
# precompile (0x1800...0001) 在 forge EVM 解释器下的 StackUnderflow bug.
#
# 前置：
#   1. SetupNight.s.sol 已经 broadcast 过，translate-pro skill #23 在链上
#   2. .env.local 含 TRANSLATE_PRO_SKILL_ID=23
#   3. .env.local 含 4 把 key（DEPLOYER + AGENT_CALLER + AGENT_FINANCE2 + AGENT_CHAT2）
#
# 用法：
#   bash scripts/demo-night.sh
#
# 选项（环境变量覆盖）：
#   FUND_TARGET=5000000   # caller 余额 < MIN_KEEP 时充到这个值（6 dec）
#   MIN_KEEP=2000000      # 触发补充的水位线
#   ROUND_DELAY=0         # 每轮 burst 之间 sleep 秒数（demo 想拉慢节奏可设 1-2）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Load env ────────────────────────────────────────────────────────
if [[ ! -f "$REPO_ROOT/.env.local" ]]; then
  echo "✗ .env.local missing at $REPO_ROOT/.env.local" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "$REPO_ROOT/.env.local"
set +a

: "${TRANSLATE_PRO_SKILL_ID:?must be set in .env.local — run forge script SetupNight.s.sol first}"
: "${DEPLOYER_PRIVATE_KEY:?missing}"
: "${AGENT_CALLER_PRIVATE_KEY:?missing}"
: "${AGENT_CALLER_ADDRESS:?missing}"
: "${AGENT_FINANCE2_PRIVATE_KEY:?missing}"
: "${AGENT_FINANCE2_ADDRESS:?missing}"
: "${AGENT_CHAT2_PRIVATE_KEY:?missing}"
: "${AGENT_CHAT2_ADDRESS:?missing}"
: "${USDC_ADDRESS:?missing}"
: "${NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS:?missing}"
: "${NEXT_PUBLIC_SOUL_NFT_ADDRESS:?missing}"
: "${ARC_TESTNET_RPC_URL:?missing}"

RPC="$ARC_TESTNET_RPC_URL"
USDC="$USDC_ADDRESS"
SKILL_REG="$NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS"
SOUL="$NEXT_PUBLIC_SOUL_NFT_ADDRESS"
SKILL_ID="$TRANSLATE_PRO_SKILL_ID"
PROVIDER_KEY="$DEPLOYER_PRIVATE_KEY"

FUND_TARGET="${FUND_TARGET:-5000000}"   # 5 USDC
MIN_KEEP="${MIN_KEEP:-2000000}"         # 2 USDC
ROUND_DELAY="${ROUND_DELAY:-0}"

# Caller config: name|key|address
CALLERS=(
  "Tokyo|$AGENT_CALLER_PRIVATE_KEY|$AGENT_CALLER_ADDRESS"
  "Berlin|$AGENT_FINANCE2_PRIVATE_KEY|$AGENT_FINANCE2_ADDRESS"
  "SF|$AGENT_CHAT2_PRIVATE_KEY|$AGENT_CHAT2_ADDRESS"
)

# 4 rounds per caller — input bytes / max output / actual output / rating / comment
INPUT_SIZES=(800 2200 3500 5000)
MAX_OUTPUTS=(1024 2500 4000 5500)
ACTUAL_OUTPUTS=(700 1900 3200 4400)
CALLER_RATINGS=(5 4 5 5)
CALLER_COMMENTS=(
  "Terminology spot-on, fast turnaround."
  "Good. Minor stylistic edits needed."
  "Excellent legal-doc translation, will use again."
  "Top-tier quality on long medical abstract."
)

# ─── helpers ─────────────────────────────────────────────────────────
# Arc Testnet RPC is flaky (TLS handshake EOF). 设计原则：
#   - cast call (read): 失败安全可 retry
#   - cast send (write): 失败 NOT safe to retry —— 可能是 receipt fetch 失败但 tx 已 broadcast
#                        重试会用新 nonce 创建重复 tx → callCount 漂移 → 算错 callId。
#                        改成单次尝试，失败就跳过本轮。
#   - SEND_DELAY 让 RPC 喘息（Arc 单 RPC 节点压力大）
SEND_DELAY="${SEND_DELAY:-1.5}"
CALL_RETRIES="${CALL_RETRIES:-4}"
CALL_RETRY_SLEEP="${CALL_RETRY_SLEEP:-2}"

cast_call() {
  local attempt=0
  local out
  while (( attempt < CALL_RETRIES )); do
    if out=$(cast call --rpc-url "$RPC" "$@" 2>&1); then
      echo "$out"
      return 0
    fi
    attempt=$((attempt + 1))
    if (( attempt < CALL_RETRIES )); then
      sleep "$CALL_RETRY_SLEEP"
    fi
  done
  echo "✗ cast call failed: $*" >&2
  return 1
}

# Single-attempt send — returns 0 on success (tx mined), nonzero on any failure.
# Sleeps SEND_DELAY before to space out RPC load.
cast_send() {
  sleep "$SEND_DELAY"
  cast send --rpc-url "$RPC" --legacy "$@" >/dev/null 2>/dev/null
}

# Strip cast's "[1.234e5]" suffix → bare integer
strip_sci() {
  awk '{print $1}'
}

# Find first Soul tokenId owned by an address (loop 1..totalMinted)
find_soul_id() {
  local owner=$1
  local minted
  minted=$(cast_call "$SOUL" "totalMinted()(uint256)" | strip_sci)
  local owner_lc
  owner_lc=$(echo "$owner" | tr '[:upper:]' '[:lower:]')
  local i
  for ((i=1; i<=minted; i++)); do
    local o
    o=$(cast_call "$SOUL" "ownerOf(uint256)(address)" "$i" 2>/dev/null || echo "")
    if [[ -n "$o" ]]; then
      local o_lc
      o_lc=$(echo "$o" | tr '[:upper:]' '[:lower:]')
      if [[ "$o_lc" == "$owner_lc" ]]; then
        echo "$i"
        return
      fi
    fi
  done
  echo "0"
}

# ─── 1. Fund callers if low ──────────────────────────────────────────
echo "=== [1/3] Fund callers if balance < $MIN_KEEP (top up to $FUND_TARGET) ==="
for entry in "${CALLERS[@]}"; do
  IFS='|' read -r name _key addr <<< "$entry"
  bal=$(cast_call "$USDC" "balanceOf(address)(uint256)" "$addr" | strip_sci)
  if (( bal < MIN_KEEP )); then
    needed=$((FUND_TARGET - bal))
    echo "  [fund] $name ($addr) bal=$bal -> +$needed (6 dec)"
    if ! cast_send --private-key "$PROVIDER_KEY" "$USDC" "transfer(address,uint256)" "$addr" "$needed"; then
      echo "    ⚠ fund tx failed — caller may run out mid-burst, continuing"
    fi
  else
    echo "  [skip] $name ($addr) bal=$bal sufficient"
  fi
done

# ─── 2. Caller approvals ─────────────────────────────────────────────
echo ""
echo "=== [2/3] Caller approvals (24 USDC each -> SkillRegistry) ==="
for entry in "${CALLERS[@]}"; do
  IFS='|' read -r name key _addr <<< "$entry"
  echo "  [approve] $name -> $SKILL_REG"
  if ! cast_send --private-key "$key" "$USDC" "approve(address,uint256)" "$SKILL_REG" 24000000; then
    echo "    ⚠ approve failed — escrow will likely revert for $name"
  fi
done

# ─── 3. 12-call burst ────────────────────────────────────────────────
echo ""
echo "=== [3/3] 12-call burst (3 callers x 4 rounds, skill #$SKILL_ID) ==="
total_calls=0
for entry in "${CALLERS[@]}"; do
  IFS='|' read -r name key addr <<< "$entry"
  soul_id=$(find_soul_id "$addr")
  if [[ "$soul_id" == "0" ]]; then
    echo "  ✗ $name has no Soul — skipping batch" >&2
    continue
  fi
  tba=$(cast_call "$SOUL" "tbaOf(uint256)(address)" "$soul_id")
  echo ""
  echo "  --- $name (Soul #$soul_id, TBA $tba) ---"

  for r in 0 1 2 3; do
    in_bytes=${INPUT_SIZES[$r]}
    max_out=${MAX_OUTPUTS[$r]}
    actual_out=${ACTUAL_OUTPUTS[$r]}
    rating=${CALLER_RATINGS[$r]}
    comment="${CALLER_COMMENTS[$r]}"
    ts=$(date +%s)

    # paymentHash = keccak256(abi.encode("pneuma-night", tba, skillId, ts, r))
    encoded=$(cast abi-encode 'f(string,address,uint256,uint256,uint256)' \
                "pneuma-night" "$tba" "$SKILL_ID" "$ts" "$r")
    payment_hash=$(cast keccak "$encoded")

    # Capture pre-call count so we can derive callId post-escrow
    pre_count=$(cast_call "$SKILL_REG" "callCount()(uint256)" | strip_sci)
    if [[ -z "$pre_count" ]]; then
      echo "    ✗ couldn't read callCount, abort batch"
      break
    fi

    # 1. caller escrow — fail-fast, single attempt
    if ! cast_send --private-key "$key" "$SKILL_REG" \
        "escrowForCall(uint256,address,bytes32,uint32,uint32)" \
        "$SKILL_ID" "$tba" "$payment_hash" "$in_bytes" "$max_out"; then
      echo "    [round $((r+1))] ✗ escrow failed (RPC) — skip"
      continue
    fi

    # Verify our escrow really landed: post_count should = pre_count + 1
    # (if other tx interleaved, our callId might be different — read by paymentHash search)
    post_count=$(cast_call "$SKILL_REG" "callCount()(uint256)" | strip_sci)
    if [[ -z "$post_count" ]] || (( post_count <= pre_count )); then
      echo "    [round $((r+1))] ✗ escrow tx returned ok but callCount didn't move — skip"
      continue
    fi

    # Find our callId by scanning [pre_count+1, post_count] for matching paymentHash
    call_id=0
    for ((cid=pre_count+1; cid<=post_count; cid++)); do
      rec=$(cast_call "$SKILL_REG" "getCall(uint256)((uint256,uint256,address,address,uint256,bytes32,uint8,uint256,bool,uint32,uint32,uint32))" "$cid" 2>/dev/null || echo "")
      if [[ "$rec" == *"$payment_hash"* ]]; then
        call_id=$cid
        break
      fi
    done

    if (( call_id == 0 )); then
      echo "    [round $((r+1))] ✗ couldn't locate our escrow in [$((pre_count+1)),$post_count] — skip"
      continue
    fi

    # 2. provider settle
    if ! cast_send --private-key "$PROVIDER_KEY" "$SKILL_REG" \
        "settleCall(uint256,uint32,uint8,string)" \
        "$call_id" "$actual_out" 5 "Clear request, clean payload."; then
      echo "    [round $((r+1))] callId=$call_id ✗ settle failed (will recover via complete-pending)"
      continue
    fi

    # 3. caller reverse-rate
    if ! cast_send --private-key "$key" "$SKILL_REG" \
        "callerRateSkill(uint256,uint8,string)" \
        "$call_id" "$rating" "$comment"; then
      echo "    [round $((r+1))] callId=$call_id ⚠ settle ok but rate failed"
    fi

    total_calls=$((total_calls + 1))
    echo "    [round $((r+1))] ✓ callId=$call_id in=$in_bytes max=$max_out actual=$actual_out star=$rating"

    if (( ROUND_DELAY > 0 )); then
      sleep "$ROUND_DELAY"
    fi
  done
done

echo ""
echo "=== Burst complete ==="
echo "  total calls: $total_calls"
echo "  total tx (3 fund-or-skip + 3 approve + 3*12 burst) ~= 42"
echo ""
echo "Verify on chain:"
echo "  /admin/dashboard (live event stream)"
echo "  /profile/<deployer-soul-id>"
echo "  https://testnet.arcscan.app/address/$NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS"
