import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createPublicClient, http, type Address } from "viem";
import { Erc20Abi } from "@pneuma/x402";

const USDC = process.env.NEXT_PUBLIC_USDC_ADDRESS as Address;
const SKILL = process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address;
const RPC = process.env.ARC_TESTNET_RPC_URL!;
const DEPLOYER = "0xadC40c12caDE96d5c47A9e986eB6557453E1d594" as Address;

console.log("USDC: ", USDC);
console.log("SKILL:", SKILL);

const pc = createPublicClient({ transport: http(RPC) });

const balance = await pc.readContract({
  address: USDC,
  abi: Erc20Abi,
  functionName: "balanceOf",
  args: [DEPLOYER],
});
console.log("balance:  ", balance.toString());

const allowance = await pc.readContract({
  address: USDC,
  abi: Erc20Abi,
  functionName: "allowance",
  args: [DEPLOYER, SKILL],
});
console.log("allowance:", allowance.toString());
