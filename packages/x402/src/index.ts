/**
 * /x402 — main entry
 *
 * 直接 import 拿全部能力：
 *   import { x402 } from "@pneuma/x402/hono";
 *   import { PneumaClient } from "@pneuma/x402/client";
 */

export * from "./types.js";
export * from "./abi.js";
export { PneumaMiddleware } from "./server/middleware.js";
export {
  createServerClients,
  readSkill,
  verifyCall,
  settleCall,
} from "./server/contract.js";
// V5 EIP-712 PaymentAuth —— x402 X-Payment 头核心安全抓手
export {
  buildPaymentDomain,
  signPaymentAuth,
  recoverPaymentAuthSigner,
  verifyPaymentAuth,
  PAYMENT_AUTH_TYPES,
  PNEUMA_PAYMENT_DOMAIN_NAME,
  PNEUMA_PAYMENT_VERSION,
  type PaymentAuthMessage,
} from "./eip712.js";
