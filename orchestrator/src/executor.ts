/**
 * Executor —— 并行调用 plan 里的所有 skill，每个走 x402 闭环
 */

import { PneumaClient } from "@pneuma/x402/client";
import type { Address, Hex } from "viem";
import type { DiscoveredSkill } from "./discovery.js";
import type { PlanStep } from "./planner.js";

export interface ExecutionResult {
  step: PlanStep;
  skill: DiscoveredSkill;
  success: boolean;
  data?: unknown;
  error?: string;
  callId?: string;
  paidAmount?: bigint;
  escrowTxHash?: Hex;
  durationMs: number;
}

export interface ExecutorConfig {
  rpcUrl: string;
  chainId: number;
  paymentToken: Address;
  skillRegistry: Address;
  privateKey: Hex;
  /** 调用方的 SoulAccount TBA（attestation 挂这里） */
  callerTBA: Address;
}

export class Executor {
  private client: PneumaClient;
  private config: ExecutorConfig;

  constructor(config: ExecutorConfig) {
    this.config = config;
    this.client = new PneumaClient({
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
      paymentToken: config.paymentToken,
      skillRegistry: config.skillRegistry,
      privateKey: config.privateKey,
    });
  }

  async executeSequential(steps: PlanStep[], skills: DiscoveredSkill[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    for (const step of steps) {
      const skill = skills.find((s) => s.skillId === step.skillId);
      if (!skill) {
        results.push({
          step,
          skill: {} as DiscoveredSkill,
          success: false,
          error: `skill ${step.skillId} not found`,
          durationMs: 0,
        });
        continue;
      }
      results.push(await this.runOne(step, skill));
    }
    return results;
  }

  async executeParallel(steps: PlanStep[], skills: DiscoveredSkill[]): Promise<ExecutionResult[]> {
    return Promise.all(
      steps.map((step) => {
        const skill = skills.find((s) => s.skillId === step.skillId);
        if (!skill) {
          return {
            step,
            skill: {} as DiscoveredSkill,
            success: false,
            error: `skill ${step.skillId} not found`,
            durationMs: 0,
          };
        }
        return this.runOne(step, skill);
      }),
    );
  }

  private async runOne(step: PlanStep, skill: DiscoveredSkill): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      console.log(`  → calling skill #${skill.skillId} "${skill.name}" @ ${skill.endpoint}`);
      const result = await this.client.callSkill({
        endpoint: skill.endpoint,
        callerTBA: this.config.callerTBA,
        body: step.body,
      });
      const duration = Date.now() - start;
      console.log(`    ✅ ok (${duration}ms, ${Number(result.paidAmount) / 1e6} USDC)`);
      return {
        step,
        skill,
        success: true,
        data: result.data,
        callId: result.callId,
        paidAmount: result.paidAmount,
        escrowTxHash: result.escrowTxHash,
        durationMs: duration,
      };
    } catch (err) {
      const duration = Date.now() - start;
      console.log(`    ❌ failed: ${(err as Error).message}`);
      return {
        step,
        skill,
        success: false,
        error: (err as Error).message,
        durationMs: duration,
      };
    }
  }
}
