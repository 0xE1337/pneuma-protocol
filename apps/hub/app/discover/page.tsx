import { redirect } from "next/navigation";

/**
 * /discover — P0 stub
 *
 * IA 第一刀只把主 nav 4 项整理出来，先把 /discover 作为单一入口确立。
 * P1 阶段会把这个页面改成真实的 Discover：
 *   - 自然语言搜索框（接 /api/orchestrate 的 plan-only 模式）
 *   - 双栏 Top 10 排行榜（Agent / Skill）
 *   - 全量列表 + 类型/段位/价格 筛选
 *   - 点 agent 或 skill 卡片进现有详情页
 *   - 「一键调用」跳 /run?query=...&plan=... 预填 Smart 模式
 *
 * 在那之前，先把流量导到现有 /agents 列表页，避免 404 + 保留导航连续性。
 */
export default function DiscoverStubPage() {
  redirect("/agents");
}
