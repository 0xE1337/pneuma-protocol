#!/usr/bin/env node
/**
 * EIP-712 PaymentAuth 端到端 smoke test
 *
 * 验证 v5 安全升级：
 *   - 正确 caller 签名 → recovered === caller (PASS)
 *   - 错误私钥签名 → recovered !== caller (REJECT)
 *   - deadline 过期 → reason 包含 "deadline expired" (REJECT)
 *   - paymentHash 篡改 → recovered 是另一个地址 (REJECT)
 *
 * 运行：node packages/x402/scripts/eip712-smoke.mjs
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createWalletClient, http } from "viem";
import {
  buildPaymentDomain,
  signPaymentAuth,
  verifyPaymentAuth,
} from "../dist/eip712.js";

let pass = 0;
let fail = 0;

function expect(label, cond, extra = "") {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}${extra ? " — " + extra : ""}`);
    fail++;
  }
}

const SKILL_REGISTRY = "0x1234567890123456789012345678901234567890";
const CHAIN_ID = 5042002; // Arc Testnet
const TBA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// 1. 构造 caller wallet + domain + message
const callerKey = generatePrivateKey();
const caller = privateKeyToAccount(callerKey);
const callerWallet = createWalletClient({
  account: caller,
  transport: http("http://localhost:8545"), // 仅签名，不实际调 RPC
});

const domain = buildPaymentDomain({ chainId: CHAIN_ID, skillRegistry: SKILL_REGISTRY });
const baseMessage = {
  callId: 42n,
  paymentHash: "0x" + "ab".repeat(32),
  caller: caller.address,
  callerTBA: TBA,
  maxAmount: 64000n, // 0.064 USDC
  deadline: BigInt(Math.floor(Date.now() / 1000) + 300), // 5 min
};

console.log("EIP-712 PaymentAuth smoke test");
console.log("─".repeat(48));
console.log(`caller: ${caller.address}`);
console.log("");

// Test 1: 正确签名 → recovered === caller
console.log("[1] Correct signer → valid");
{
  const sig = await signPaymentAuth(callerWallet, domain, baseMessage);
  const result = await verifyPaymentAuth({
    domain,
    message: baseMessage,
    signature: sig,
    expectedCaller: caller.address,
  });
  expect("valid=true", result.valid === true, result.reason);
  expect(
    "recovered === caller",
    result.recovered?.toLowerCase() === caller.address.toLowerCase(),
  );
}

// Test 2: 错误私钥 → reject
console.log("\n[2] Wrong signer → reject");
{
  const attackerKey = generatePrivateKey();
  const attacker = privateKeyToAccount(attackerKey);
  const attackerWallet = createWalletClient({
    account: attacker,
    transport: http("http://localhost:8545"),
  });
  const sig = await signPaymentAuth(attackerWallet, domain, baseMessage);
  const result = await verifyPaymentAuth({
    domain,
    message: baseMessage,
    signature: sig,
    expectedCaller: caller.address, // 期望是 caller，但其实 attacker 签的
  });
  expect("valid=false", result.valid === false);
  expect("reason mentions mismatch", (result.reason ?? "").includes("mismatch"));
}

// Test 3: deadline 过期 → reject
console.log("\n[3] Expired deadline → reject");
{
  const expiredMessage = { ...baseMessage, deadline: BigInt(Math.floor(Date.now() / 1000) - 60) };
  const sig = await signPaymentAuth(callerWallet, domain, expiredMessage);
  const result = await verifyPaymentAuth({
    domain,
    message: expiredMessage,
    signature: sig,
    expectedCaller: caller.address,
  });
  expect("valid=false", result.valid === false);
  expect("reason mentions deadline", (result.reason ?? "").includes("deadline"));
}

// Test 4: paymentHash 篡改 → reject
console.log("\n[4] Tampered paymentHash → reject");
{
  const sig = await signPaymentAuth(callerWallet, domain, baseMessage);
  const tampered = { ...baseMessage, paymentHash: "0x" + "ff".repeat(32) };
  const result = await verifyPaymentAuth({
    domain,
    message: tampered,
    signature: sig,
    expectedCaller: caller.address,
  });
  expect("valid=false", result.valid === false);
  // recovered 会是某个不可预测地址，但不会等于 caller
  expect(
    "recovered !== caller",
    result.recovered?.toLowerCase() !== caller.address.toLowerCase(),
  );
}

// Test 5: callId 篡改 → reject
console.log("\n[5] Tampered callId → reject");
{
  const sig = await signPaymentAuth(callerWallet, domain, baseMessage);
  const tampered = { ...baseMessage, callId: 99n };
  const result = await verifyPaymentAuth({
    domain,
    message: tampered,
    signature: sig,
    expectedCaller: caller.address,
  });
  expect("valid=false", result.valid === false);
}

// Test 6: chainId 不匹配 → reject (跨链 replay 防御)
console.log("\n[6] Wrong chainId domain → reject (cross-chain replay防御)");
{
  const sig = await signPaymentAuth(callerWallet, domain, baseMessage);
  const wrongDomain = buildPaymentDomain({ chainId: 1, skillRegistry: SKILL_REGISTRY });
  const result = await verifyPaymentAuth({
    domain: wrongDomain,
    message: baseMessage,
    signature: sig,
    expectedCaller: caller.address,
  });
  expect("valid=false", result.valid === false);
}

// Test 7: SkillRegistry 地址不匹配 → reject (跨部署 replay 防御)
console.log("\n[7] Wrong SkillRegistry domain → reject (cross-deployment replay防御)");
{
  const sig = await signPaymentAuth(callerWallet, domain, baseMessage);
  const wrongDomain = buildPaymentDomain({
    chainId: CHAIN_ID,
    skillRegistry: "0x9999999999999999999999999999999999999999",
  });
  const result = await verifyPaymentAuth({
    domain: wrongDomain,
    message: baseMessage,
    signature: sig,
    expectedCaller: caller.address,
  });
  expect("valid=false", result.valid === false);
}

console.log("\n" + "─".repeat(48));
console.log(`Total: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
