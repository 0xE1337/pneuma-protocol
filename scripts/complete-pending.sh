#!/usr/bin/env bash
#
# complete-pending.sh — recovery 工具
# 扫描 SkillRegistry 上 [SCAN_FROM, callCount] 范围内属于 translate-pro
# (skillId=$TRANSLATE_PRO_SKILL_ID) 且状态为 Pending(0) 的 calls，
# 一一调 settleCall + callerRateSkill 把闭环跑完。
#
# 用途：demo-night.sh 因 RPC 抖动中途失败 / 多次重试导致 escrow 上链但 settle 没跑
# 时，作为 recovery。
#
# 用法：
#   SCAN_FROM=88 bash scripts/complete-pending.sh
#   （SCAN_FROM 默认 = max(callCount - 30, 1)）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
set -a
# shellcheck disable=SC1091
source "$REPO_ROOT/.env.local"
set +a

RPC="$ARC_TESTNET_RPC_URL"
SKILL_REG="$NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS"
SKILL_ID="${TRANSLATE_PRO_SKILL_ID:?missing}"
PROVIDER_KEY="$DEPLOYER_PRIVATE_KEY"

# Caller address → private key / label (bash 3.2 compat — case statement, no assoc arrays)
TOKYO_LC=$(echo "$AGENT_CALLER_ADDRESS"  | tr 'A-Z' 'a-z')
BERLIN_LC=$(echo "$AGENT_FINANCE2_ADDRESS" | tr 'A-Z' 'a-z')
SF_LC=$(echo "$AGENT_CHAT2_ADDRESS"   | tr 'A-Z' 'a-z')

caller_to_key() {
  case "$1" in
    "$TOKYO_LC")  echo "$AGENT_CALLER_PRIVATE_KEY";;
    "$BERLIN_LC") echo "$AGENT_FINANCE2_PRIVATE_KEY";;
    "$SF_LC")     echo "$AGENT_CHAT2_PRIVATE_KEY";;
    *)            echo "";;
  esac
}

caller_to_label() {
  case "$1" in
    "$TOKYO_LC")  echo "Tokyo";;
    "$BERLIN_LC") echo "Berlin";;
    "$SF_LC")     echo "SF";;
    *)            echo "Unknown";;
  esac
}

CR_TYPE="(uint256,uint256,address,address,uint256,bytes32,uint8,uint256,bool,uint32,uint32,uint32)"

cast_call() {
  local attempt=0
  while (( attempt < 4 )); do
    if out=$(cast call --rpc-url "$RPC" "$@" 2>/dev/null); then
      echo "$out"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}

cast_send() {
  cast send --rpc-url "$RPC" --legacy "$@" >/dev/null 2>&1
}

CALL_COUNT=$(cast_call "$SKILL_REG" "callCount()(uint256)" | awk '{print $1}')
SCAN_FROM="${SCAN_FROM:-$(( CALL_COUNT > 30 ? CALL_COUNT - 30 : 1 ))}"

echo "=== Scan callIds [$SCAN_FROM, $CALL_COUNT] for translate-pro pending ==="
echo "    SKILL_ID=$SKILL_ID"
echo ""

found=0
recovered=0
skipped_other=0
skipped_done=0

for ((id=SCAN_FROM; id<=CALL_COUNT; id++)); do
  rec=$(cast_call "$SKILL_REG" "getCall(uint256)$CR_TYPE" "$id" 2>/dev/null || echo "")
  if [[ -z "$rec" ]] || [[ "$rec" != \(* ]]; then
    # callId doesn't exist (revert) or unexpected format
    continue
  fi
  # rec format: "(95, 7, 0x..., 0x..., 500000, 0x..., 1, 1777..., false, 58, 0, 0)"
  # Strip outer parens, split on comma+space
  inner=$(echo "$rec" | sed 's/^(\(.*\))$/\1/')
  set +u
  IFS=',' read -ra fields <<< "$inner"
  set -u
  if (( ${#fields[@]} < 11 )); then
    echo "  [warn] callId=$id unexpected field count ${#fields[@]} — skip"
    continue
  fi
  # Trim whitespace and brackets like "[5e5]"
  call_id=$(echo "${fields[0]}"  | awk '{print $1}')
  skill_id=$(echo "${fields[1]}" | awk '{print $1}')
  caller=$(echo "${fields[2]}"   | awk '{print $1}')
  status=$(echo "${fields[6]}"   | awk '{print $1}')
  input_bytes=$(echo "${fields[9]}"   | awk '{print $1}')
  max_output=$(echo "${fields[10]}"   | awk '{print $1}')

  if [[ "$skill_id" != "$SKILL_ID" ]]; then
    skipped_other=$((skipped_other + 1))
    continue
  fi

  found=$((found + 1))
  caller_lc=$(echo "$caller" | tr 'A-Z' 'a-z')
  label=$(caller_to_label "$caller_lc")

  if [[ "$status" != "0" ]]; then
    echo "  [skip] callId=$id $label status=$status (already settled/refunded)"
    skipped_done=$((skipped_done + 1))
    continue
  fi

  # Pick actual output as 75% of max (always less → triggers per-byte refund visualization)
  actual_out=$(( max_output * 75 / 100 ))
  if (( actual_out < 100 )); then actual_out=100; fi

  echo "  [settle+rate] callId=$id $label in=$input_bytes max=$max_output actual=$actual_out"

  caller_key=$(caller_to_key "$caller_lc")
  if [[ -z "$caller_key" ]]; then
    echo "    ✗ unknown caller $caller — skipping rate"
    continue
  fi

  if cast_send --private-key "$PROVIDER_KEY" "$SKILL_REG" \
      "settleCall(uint256,uint32,uint8,string)" \
      "$id" "$actual_out" 5 "Recovered: clean payload."; then
    if cast_send --private-key "$caller_key" "$SKILL_REG" \
        "callerRateSkill(uint256,uint8,string)" \
        "$id" 5 "Excellent translation, fast turnaround."; then
      recovered=$((recovered + 1))
    else
      echo "    ⚠ settle ok but caller-rate failed (will retry next run)"
    fi
  else
    echo "    ⚠ settle failed (RPC?) — try again"
  fi
done

echo ""
echo "=== Recovery summary ==="
echo "  scanned range:    [$SCAN_FROM, $CALL_COUNT]"
echo "  translate-pro:    $found calls found"
echo "  recovered:        $recovered (settled + rated this run)"
echo "  already done:     $skipped_done"
echo "  other skills:     $skipped_other"
