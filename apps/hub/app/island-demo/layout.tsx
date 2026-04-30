/**
 * island-demo 路由级 layout
 *
 * 历史变更（V6.1 island 主题成为默认 之后）：
 *   - animal-island-ui CSS 已经在 root layout 全局加载（layout.tsx 顶部 import），
 *     这里不再 import 一次（避免重复）
 *   - data-experiment 标签保留，方便在 DevTools 里仍然识别这是"样板展厅"
 *     页面，与主站普通路由区分
 */

export default function IslandLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div data-experiment="island-ui">{children}</div>;
}
