import { redirect } from "next/navigation";

/**
 * /demo-dashboard —— legacy redirect
 *
 * 原本作为演示日 nav 主入口，IA 重构后看板移到 /admin/dashboard，
 * 加白名单 gating（NEXT_PUBLIC_ADMIN_ADDRESSES）。
 *
 * 这条 server-side redirect 确保旧链接、外部分享、demo 演示视频里的
 * /demo-dashboard 路径仍能命中正确页面。
 */
export default function DemoDashboardLegacyRedirect() {
  redirect("/admin/dashboard");
}
