import { redirect } from "next/navigation";

/**
 * /wallet —— legacy redirect
 *
 * IA 重构后钱包功能不再独立 nav，合并到 /profile?tab=wallet。
 * 这个 server-side redirect 保留旧链接的可访问性。
 */
export default function WalletLegacyRedirect() {
  redirect("/profile?tab=wallet");
}
