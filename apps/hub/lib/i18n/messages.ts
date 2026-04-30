/**
 * 中英文双语 dict —— Pneuma Hub
 *
 * 维护原则：
 * - key 用 `<scope>.<sub>` 命名（如 `home.hero.title`），方便按页面分组
 * - 中文 = 默认（CLAUDE.md "中文优先" + 南大 AI 学术评委）
 * - 缺失 key 时 t() fallback 到 key 字符串本身（不抛错，不阻塞 demo）
 * - 加新文案：先加 zh，再加 en，保持两边 key 一致
 */

export const messages = {
  zh: {
    // ── Navbar ────────────────────────────────────────
    "nav.mint": "铸造",
    "nav.wallet": "钱包",
    "nav.agents": "Agent 网络",
    "nav.skills": "能力筛选",
    "nav.run": "调用",
    "nav.commons": "知识公地",
    "nav.demo": "实时看板",
    "nav.island": "🏝 展厅",
    "nav.profile": "我的 Agent",
    "theme.toggle.to_island": "切到 Island 主题",

    // ── Home — Hero ───────────────────────────────────
    "home.live_pill": "Arc Testnet 已上线 · chain id 5042002",
    "home.hero.title.line1": "AI Agent",
    "home.hero.title.line2": "拥有自己的护照、",
    "home.hero.title.line3": "钱包和履历。",
    "home.hero.tagline":
      "Pneuma 是开放协议层。注册一个 Agent 身份，通过 x402 在任何服务上花 USDC，积累任何 dApp 都可读的链上履历。Agent 身份归你的钱包所有，不被任何平台托管。",
    "home.hero.cta_mint": "创建我的 Agent →",
    "home.hero.cta_run": "试试调度器",

    // ── Home — Agent Network Hero（Coze 同款"复制 URL 让 Agent 自己加入"）
    "agent_hero.pill": "● Open Agent Network · Arc Testnet 已上线",
    "agent_hero.title": "Agent 网络",
    "agent_hero.subtitle":
      "AI Agent 在这里铸造身份、调用彼此、积累链上履历。",
    "agent_hero.stat_souls": "Souls 已加入",
    "agent_hero.stat_skills": "active skills",
    "agent_hero.stat_calls": "calls 已结算",
    "agent_hero.copy_label": "加入 Pneuma:",
    "agent_hero.copy_button": "复制",
    "agent_hero.copied": "已复制 ✓",
    "agent_hero.copy_aria": "复制 skill.md 链接到剪贴板",
    "agent_hero.hint":
      "复制链接发送给你的 AI Agent（Claude / Cursor / GPT）—— 一次粘贴即接入开放协议，自动 mint Soul、注册 skill、开始结算。",
    "agent_hero.cta_manual_mint": "或手动铸造 Soul →",
    "agent_hero.cta_try_orchestrator": "试试调度器 →",
    "agent_hero.compat":
      "兼容 Agent Network 协议（agentnetwork.org.cn）—— Pneuma 给 anet mesh 加一层链上 USDC 支付 + 跨平台可携带声誉。",
    "agent_hero.compat_chip": "兼容 Agent Network · agentnetwork.org.cn",
    "agent_hero.daemon.loading": "anet daemon · 检测中…",
    "agent_hero.daemon.connected": "anet daemon · 已联动",
    "agent_hero.daemon.not_running": "anet daemon · 未启动",
    "agent_hero.daemon.not_running_hint":
      "anet 已安装但 daemon 没在跑。运行 `anet daemon &` 启动。",
    "agent_hero.daemon.not_installed": "anet daemon · 未安装",
    "agent_hero.daemon.not_installed_hint":
      "本机未装 anet。运行 `npm install -g @agentnetwork/anet` 后再启 daemon。",

    // ── Home — Product mockup ─────────────────────────
    "home.mockup.user_request_label": "用户请求",
    "home.mockup.plan_label": "LLM 规划 · 2 步",
    "home.mockup.exec_label": "并行 x402 执行",
    "home.mockup.exec_done": "2 / 2 ✓",
    "home.mockup.final_label": "最终答案 · 聚合",
    // Escrow 上限 + 实际花费 + 自动退款 —— 一次签名、N 笔原子结算的关键叙事
    "home.mockup.escrow_label": "EscrowAuth 上限",
    "home.mockup.escrow_actual_label": "实际",
    "home.mockup.escrow_refund_label": "自动退款",

    // Case 1 · 学术研究（默认）—— 南大 AI 学术圈
    "home.mockup.cases.research.tab": "学术研究",
    "home.mockup.cases.research.user_request":
      "最近 3 个月 retrieval-augmented generation 有什么新进展？开源实现里哪个值得 star？",
    "home.mockup.cases.research.step1": "01 → skill #1 Paper + Cite Graph · Semantic Scholar 225M 论文索引",
    "home.mockup.cases.research.step2": "02 → skill #2 Repo Deep Search · Sourcegraph 跨仓代码检索",
    "home.mockup.cases.research.final":
      "最新 5 篇 paper（按引用速度）：arXiv:2511.04617《Self-RAG v2》(124 cit/wk) · arXiv:2510.18234《Adaptive Retrieval》⋯ 高质量开源实现：langchain-ai/rag-from-scratch (12.4k★, 周活跃) · run-llama/rag-cli (3.8k★)。",

    // Case 2 · 钱包安全 —— Web3 builder
    "home.mockup.cases.wallet_safety.tab": "钱包安全",
    "home.mockup.cases.wallet_safety.user_request":
      "我想用钱包 0xad…d594 在 Aave 上 supply 1000 USDC，安全吗？这个钱包过去 90 天的画像怎么样？",
    "home.mockup.cases.wallet_safety.step1": "01 → skill #1 Wallet X-ray · Nansen 标签 + Smart Money 行为画像",
    "home.mockup.cases.wallet_safety.step2": "02 → skill #2 Tx Simulate · Tenderly fork 实际执行交易字节码",
    "home.mockup.cases.wallet_safety.final":
      "钱包画像：Smart Money DeFi User 标签，90 天 PnL +18.4%，主要交互 Aave / Curve / Convex，无可疑授权。交易模拟：supply 1000 USDC → 收到 999.7 aUSDC，gas $0.42，Aave reserve 健康度 88%（安全），无 honeypot / MEV 风险。",

    // Case 3 · 出行计划 —— 行业 / 大众评委
    "home.mockup.cases.travel.tab": "出行计划",
    "home.mockup.cases.travel.user_request":
      "五一带女朋友去东京，南京出发 5/3 - 5/6，搞定机票和第一天晚上人均 ¥800 以内的米其林餐厅。",
    "home.mockup.cases.travel.step1": "01 → skill #1 Flight Deal Watcher · Skyscanner 跨平台实时比价",
    "home.mockup.cases.travel.step2": "02 → skill #2 Restaurant Reserve · Yelp 真实空位查询 + 预订深链",
    "home.mockup.cases.travel.final":
      "推荐机票：南京⇋成田 春秋航空 5/3 11:30 起飞 / 5/6 19:40 返程，往返 ¥3,280。第一天晚餐：銀座 朔月（米其林一星 · 怀石）5/3 19:00 还有 2 位，人均 ¥720，已生成预订深链。",

    // Case 4 · 合约审计 + NFT 估值 —— 开发者 / DeFi 协议方
    "home.mockup.cases.audit.tab": "合约审计",
    "home.mockup.cases.audit.user_request":
      "我做了一个 NFT 抵押借贷合约 0x9f…d3，准备上主网。审一遍代码安全 + 给我池子里 BAYC 当前公允估值（用来设抵押率）。",
    "home.mockup.cases.audit.step1": "01 → skill #1 Contract Audit · Slither + Mythril 静态分析 + 符号执行",
    "home.mockup.cases.audit.step2": "02 → skill #2 NFT Fair Value · Reservoir 跨市场聚合 + traits-adjusted floor",
    "home.mockup.cases.audit.final":
      "审计：1 high (reentrancy in liquidate) + 2 medium (unchecked external call · missing oracle staleness)。BAYC #1234 公允估值 28.4 ETH（traits 加权后高于 floor 30 ETH 的 -8%），跨市场最优挂单 Blur 28.1 ETH。建议抵押率 ≤ 60%。",

    // ── Home — Pillars ────────────────────────────────
    "home.pillars.eyebrow": "四套标准 · 一个协议",
    "home.pillars.title": "身份 · 钱包 · 支付 · 声誉",
    "home.pillars.identity.tag": "身份",
    "home.pillars.identity.title": "可携带的 Soul",
    "home.pillars.identity.standards": "ERC-721 + ERC-6551",
    "home.pillars.identity.desc":
      "NFT 身份绑定一个智能账户钱包。转移 NFT → 钱包（和履历）跟着走。无平台锁定。",
    "home.pillars.money.tag": "支付",
    "home.pillars.money.title": "真 ERC-20 USDC",
    "home.pillars.money.standards": "ERC-20 + EIP-2612",
    "home.pillars.money.desc":
      "USDC 是真代币，不是平台积分。可转账、可在 DEX 兑换、可放任何钱包。任何 AI 服务都可通过 x402 接收。",
    "home.pillars.rep.tag": "声誉",
    "home.pillars.rep.title": "开放 Attestation",
    "home.pillars.rep.standards": "PneumaAttestation 原语",
    "home.pillars.rep.desc":
      "每次付费 skill 调用都会写一条可验证的 attestation，由链上 paymentHash 锚定。任何 dApp 都能读全量履历。",

    // ── Home — Protocol flow ──────────────────────────
    "home.flow.eyebrow": "协议流程",
    "home.flow.title": "一次 A2A 调用如何结算",
    "home.flow.step01": "客户端 POST /api/skill（不带 payment header）",
    "home.flow.step02": "服务端返回 402 + PaymentChallenge { skillId, asset, payTo, amount }",
    "home.flow.step03": "客户端 → SkillRegistry.escrowForCall(...) 链上锁仓 2 USDC",
    "home.flow.step04": "客户端带 X-PAYMENT: callId 重试 → 服务端 verify → 跑 handler",
    "home.flow.step05": "服务端 → settleCall(rating) → 触发 PneumaAttestation.attest()",
    "home.flow.step_done": "Attestation 写到 caller 的 TBA · 永远跨 dApp 可读",

    // ── Home — Cross platform highlight ───────────────
    "home.cross.pill": "开放协议亮点",
    "home.cross.title.line1": "关掉这个平台。",
    "home.cross.title.line2": "你的 Soul 还在这里。",
    "home.cross.tagline":
      "Pneuma Hub 只是这个协议上的一个 dApp。打开任何其他 Pneuma 兼容的 dApp（或自己写一个），连同一个 MetaMask，你的 Soul、USDC 余额、全部 attestation 历史都在那里。",
    "home.cross.tagline_strong": "无后端依赖。无平台锁定。",
    "home.cross.dapp_a_name": "Pneuma Hub",
    "home.cross.dapp_b_name": "AgentVault（第三方）",
    "home.cross.dapp_chips_etc": "·  ·  ·  任何未来的 dApp",

    // ── Mint page ─────────────────────────────────────
    "mint.title": "铸造你的 Pneuma Soul",
    "mint.subtitle": "ERC-721 NFT + 自动派生 ERC-6551 智能账户钱包 + ERC-8004 IdentityRegistry",
    "mint.input.name": "Agent 名称",
    "mint.input.metadata": "元数据 URI（可选）",
    "mint.button": "铸造 Soul",
    "mint.button.connecting": "连接钱包…",

    // ── Wallet page ───────────────────────────────────
    "wallet.title": "钱包",
    "wallet.balance": "USDC 余额",
    "wallet.faucet.title": "领测试 USDC",
    "wallet.faucet.cta": "前往 Circle Faucet",
    "wallet.faucet.note":
      "Pneuma 不发自创代币 — 直接用 Arc 原生 USDC，去 Circle 官方 faucet 领即可",

    // ── Skills page ───────────────────────────────────
    "skills.title": "技能市场",
    "skills.subtitle": "链上 SkillRegistry 直读 — 任何人可注册，任何人可查",
    "skills.col.name": "技能",
    "skills.col.price": "价格",
    "skills.col.rep": "声誉",
    "skills.col.calls": "调用次数",
    "skills.anet_banner.title": "兼容 Agent Network ANS",
    "skills.anet_banner.body":
      "下列每个 skill 在 Agent Network mesh 里也可被发现 —— 命名规则：agent://pneuma-receipt-<skillId>，capability tag 含 x402-payment、cross-platform-receipt、onchain-attestation。运行 `pneuma anet register-x402-skill` 自动 mirror 到 anet ANS。",
    "skills.anet_banner.cta": "查看 /skill.md →",
    "skills.empty": "尚无 active skill。先 mint Soul → `pneuma serve` 起一个端点，或 `pneuma anet bootstrap` 把现有 anet 服务接入。",
    "skills.badge.per_byte": "per-byte",
    "skills.badge.flat_rate": "flat-rate",
    "skills.empty": "暂无注册的 skill",

    // ── Agents network — main entry (sovereign Agent 视角) ───
    "agents.eyebrow": "Agent Network",
    "agents.title": "Agent 网络",
    "agents.subtitle":
      "每个 Agent 是 sovereign 实体——拥有 Soul、独立运行在自己的环境里、通过协议层互相调用。这里展示当前活跃在链上的全部 Agent。",
    "agents.stat.agents": "Agent 数量",
    "agents.stat.skills": "总能力数",
    "agents.stat.settlement": "结算资产",
    "agents.loading": "正在从链上读取…",
    "agents.empty":
      "目前还没有 Agent 注册。运行 script/RegisterSkills.s.sol 注入 demo Agent。",
    "agents.skills_link.hint":
      "想按具体能力筛选？/skills 提供能力维度的扁平视图——同一个 Agent 的多个 tier 会被独立列出。",
    "agents.skills_link.label": "能力维度浏览",

    "agents.card.sovereign_label": "Sovereign · self-hosted",
    "agents.card.skill_count_one": "skill",
    "agents.card.skill_count_many": "skills",
    "agents.card.upstream_label": "上游模型（自声明）",
    "agents.card.anet_label": "anet ANS 镜像",
    "agents.card.anet_discoverable": "可发现",
    "agents.card.total_calls": "累计调用",
    "agents.card.no_reputation": "暂无声誉",
    "agents.card.attestation_count_one": "条履历",
    "agents.card.attestation_count_many": "条履历",
    "agents.card.view_explorer": "链上查看",
    "agents.card.view_detail": "查看完整履历",

    "agents.detail.invalid_address": "无效的 Agent 地址",
    "agents.detail.back_to_list": "返回 Agent 列表",
    "agents.detail.eyebrow": "Agent profile",
    "agents.detail.view_explorer": "在区块浏览器中查看",
    "agents.detail.reputation_label": "Conviction-weighted 声誉",
    "agents.detail.stat.skills": "能力数",
    "agents.detail.stat.attestations": "有效履历",
    "agents.detail.stat.volume": "累计流水",
    "agents.detail.stat.idle_days": "距上次活跃",
    "agents.detail.formula_title": "声誉公式因子分解",
    "agents.detail.factor.volume": "Volume √",
    "agents.detail.factor.age": "Age (30d ramp)",
    "agents.detail.factor.rep": "Rep multiplier",
    "agents.detail.factor.decay": "Decay (idle)",
    "agents.detail.skills_title": "提供的能力（tier ladder）",
    "agents.detail.no_skills": "该 Agent 当前没有上架任何 skill。",
    "agents.detail.upstream": "上游模型",
    "agents.detail.markup": "markup",
    "agents.detail.calls_suffix": "次调用",
    "agents.detail.try_call": "调用此能力",
    "agents.detail.comments_title": "真实用户评论",
    "agents.detail.caller_rated_count": "条 caller 评分",
    "agents.detail.no_comments":
      "暂无 caller 评分。完成一次 settle 后，付费方可在 /run 页留下文字评论。",
    "agents.detail.no_comment_text": "（caller 未留下文字评论，仅打分）",
    "agents.detail.skill_label": "能力",
    "agents.detail.by": "评分人",
    "agents.detail.sovereign_title": "Sovereign deployment",
    "agents.detail.sovereign_intro":
      "Pneuma 不托管 Agent 计算。每个 Agent 跑在 owner 自己的环境里（CLI / 本地服务器 / 自部署 endpoint），协议层只做支付路由 + attestation 锚定。下列字段都是该 Agent 在链上的自声明，由声誉公式 + revoke→slash 经济回路兜底真实性。",
    "agents.detail.endpoints_label": "已声明 endpoints",
    "agents.detail.upstream_models_label": "上游模型自声明",
    "agents.detail.upstream_disclaimer":
      "上游模型 + markup 是反中转透明度抓手。市场逻辑会自动惩罚高 markup：caller 看得到、读得到评论、用脚投票。",

    // ── Run page ──────────────────────────────────────
    "run.title": "调用 Skill",
    "run.step.connect": "连接钱包",
    "run.step.pick_soul": "选择 Soul",
    "run.step.pick_skill": "选择 Skill",
    "run.step.query": "输入查询",
    "run.step.run": "执行调用",
    "run.button.run": "调用",
    "run.button.approving": "Approving USDC allowance",
    "run.button.escrowing": "链上 escrow 中",
    "run.button.calling": "调用 service…",
    "run.success": "调用成功",
    "run.error": "调用失败",

    // ── Profile page ──────────────────────────────────
    "profile.title": "我的 Agent",
    "profile.subtitle": "你钱包里的 SOUL NFT → 它的 TBA 累积链上履历。转移 NFT，履历跟着走。",
    "profile.timeline": "贡献历史",
    "profile.stats.calls": "调用",
    "profile.stats.usdc": "USDC paid",
    "profile.stats.rating": "平均星",
    "profile.spending_trail": "查看花费记录 →",

    // ── Common ────────────────────────────────────────
    "common.connect_wallet": "连接钱包",
    "common.loading": "加载中…",
    "common.coming_soon": "即将推出",
    "common.copy": "复制",
    "common.copied": "已复制",

    // ── Language toggle (按钮显示的目标语言) ──────────
    "lang.toggle": "EN",

    // ── Theme toggle (二态：island ↔ dark) ────────────
    "theme.toggle.to_dark": "切换到夜间模式",

    // ── Chain guard (wrong network / add Arc Testnet) ─
    "chain.wrong.eyebrow": "需要切换网络",
    "chain.wrong.title": "切换到 Arc Testnet",
    "chain.wrong.connected_prefix": "当前连接的是 chain",
    "chain.wrong.connected_suffix": "Pneuma 协议在 Arc Testnet (#5042002) 上运行。",
    "chain.wrong.add_button": "添加 Arc Testnet 并切换 →",
    "chain.wrong.switching": "切换中…",
    "chain.wrong.note":
      "如果钱包还没有 Arc Testnet，确认弹窗会提示添加（RPC: rpc.testnet.arc.network · chain id 5042002 · 原生 USDC 6 decimals）",
  },
  en: {
    // ── Navbar ────────────────────────────────────────
    "nav.mint": "Mint",
    "nav.wallet": "Wallet",
    "nav.agents": "Agents",
    "nav.skills": "Skills",
    "nav.run": "Run",
    "nav.commons": "Commons",
    "nav.demo": "Live Demo",
    "nav.island": "🏝 Showcase",
    "nav.profile": "Profile",
    "theme.toggle.to_island": "Switch to Island theme",

    // ── Home — Hero ───────────────────────────────────
    "home.live_pill": "Live on Arc Testnet · 5042002",
    "home.hero.title.line1": "AI Agents",
    "home.hero.title.line2": "with their own passport,",
    "home.hero.title.line3": "wallet, and resume.",
    "home.hero.tagline":
      "Pneuma is the open protocol layer. Create your Agent, spend USDC across any service via x402, build a verifiable on-chain resume any dApp can read. Your Agent lives in your wallet — not on any platform.",
    "home.hero.cta_mint": "Create your Agent →",
    "home.hero.cta_run": "Try the Orchestrator",

    // ── Home — Agent Network Hero (Coze-style "copy URL → agent self-onboards")
    "agent_hero.pill": "● Open Agent Network · Live on Arc Testnet",
    "agent_hero.title": "Agent Network.",
    "agent_hero.subtitle":
      "Where AI agents mint identity, call each other, and accumulate verifiable on-chain history.",
    "agent_hero.stat_souls": "Souls joined",
    "agent_hero.stat_skills": "active skills",
    "agent_hero.stat_calls": "calls settled",
    "agent_hero.copy_label": "Join Pneuma:",
    "agent_hero.copy_button": "Copy",
    "agent_hero.copied": "Copied ✓",
    "agent_hero.copy_aria": "Copy skill.md link to clipboard",
    "agent_hero.hint":
      "Drop this link into your AI agent (Claude / Cursor / GPT) — one paste to join the open protocol, auto-mint Soul, register skill, start settling.",
    "agent_hero.cta_manual_mint": "Or mint manually →",
    "agent_hero.cta_try_orchestrator": "Try the orchestrator →",
    "agent_hero.compat":
      "Compatible with the Agent Network protocol (agentnetwork.org.cn) — Pneuma adds on-chain USDC payment + cross-platform portable reputation on top of the anet mesh.",
    "agent_hero.compat_chip": "Compatible with Agent Network · agentnetwork.org.cn",
    "agent_hero.daemon.loading": "anet daemon · checking…",
    "agent_hero.daemon.connected": "anet daemon · linked",
    "agent_hero.daemon.not_running": "anet daemon · not running",
    "agent_hero.daemon.not_running_hint":
      "anet is installed but the daemon is not running. Start it with `anet daemon &`.",
    "agent_hero.daemon.not_installed": "anet daemon · not installed",
    "agent_hero.daemon.not_installed_hint":
      "anet not installed on this machine. Run `npm install -g @agentnetwork/anet`, then start the daemon.",

    // ── Home — Product mockup ─────────────────────────
    "home.mockup.user_request_label": "User Request",
    "home.mockup.plan_label": "LLM Plan · 2 steps",
    "home.mockup.exec_label": "Parallel x402 Execution",
    "home.mockup.exec_done": "2 / 2 ✓",
    "home.mockup.final_label": "Final Answer · Aggregated",
    "home.mockup.escrow_label": "EscrowAuth cap",
    "home.mockup.escrow_actual_label": "spent",
    "home.mockup.escrow_refund_label": "auto-refund",

    // Case 1 · Research workflow (default)
    "home.mockup.cases.research.tab": "Research",
    "home.mockup.cases.research.user_request":
      "What's new in retrieval-augmented generation in the past 3 months? Which open-source implementations are worth starring?",
    "home.mockup.cases.research.step1": "01 → skill #1 Paper + Cite Graph · Semantic Scholar 225M-paper index",
    "home.mockup.cases.research.step2": "02 → skill #2 Repo Deep Search · Sourcegraph cross-repo code search",
    "home.mockup.cases.research.final":
      "Top 5 papers (by citation velocity): arXiv:2511.04617 'Self-RAG v2' (124 cit/wk) · arXiv:2510.18234 'Adaptive Retrieval'… High-quality OSS: langchain-ai/rag-from-scratch (12.4k★, weekly active) · run-llama/rag-cli (3.8k★).",

    // Case 2 · Wallet safety
    "home.mockup.cases.wallet_safety.tab": "Wallet Safety",
    "home.mockup.cases.wallet_safety.user_request":
      "I want to supply 1000 USDC to Aave with wallet 0xad…d594. Is it safe? What's the 90-day profile of this wallet?",
    "home.mockup.cases.wallet_safety.step1": "01 → skill #1 Wallet X-ray · Nansen labels + Smart Money behavior profile",
    "home.mockup.cases.wallet_safety.step2": "02 → skill #2 Tx Simulate · Tenderly fork actually executes bytecode",
    "home.mockup.cases.wallet_safety.final":
      "Wallet profile: Smart Money DeFi User label, 90-day PnL +18.4%, top interactions Aave / Curve / Convex, no suspicious approvals. Tx sim: supply 1000 USDC → receive 999.7 aUSDC, gas $0.42, Aave reserve health 88% (safe), no honeypot / MEV risk.",

    // Case 3 · Travel planning
    "home.mockup.cases.travel.tab": "Travel Plan",
    "home.mockup.cases.travel.user_request":
      "Taking my partner to Tokyo for May Day, NJ departure 5/3-5/6. Find flights + a Michelin restaurant within ¥800/person for night 1.",
    "home.mockup.cases.travel.step1": "01 → skill #1 Flight Deal Watcher · Skyscanner cross-platform realtime",
    "home.mockup.cases.travel.step2": "02 → skill #2 Restaurant Reserve · Yelp real-time availability + booking deep-link",
    "home.mockup.cases.travel.final":
      "Flight: NJ ⇋ Narita Spring Airlines 5/3 11:30 dep / 5/6 19:40 ret, ¥3,280 round-trip. Night 1 dinner: Ginza Sakuzuki (Michelin 1★ · Kaiseki) 5/3 19:00 has 2 seats, ¥720/person, deep-link generated.",

    // Case 4 · Contract audit + NFT valuation
    "home.mockup.cases.audit.tab": "Contract Audit",
    "home.mockup.cases.audit.user_request":
      "Built an NFT lending contract 0x9f…d3 going to mainnet. Audit the code + give me current BAYC fair value to set the collateral ratio.",
    "home.mockup.cases.audit.step1": "01 → skill #1 Contract Audit · Slither + Mythril (static analysis + symbolic execution)",
    "home.mockup.cases.audit.step2": "02 → skill #2 NFT Fair Value · Reservoir cross-market + traits-adjusted floor",
    "home.mockup.cases.audit.final":
      "Audit: 1 high (reentrancy in liquidate) + 2 medium (unchecked external call · missing oracle staleness). BAYC #1234 fair value 28.4 ETH (traits-weighted, -8% vs 30 ETH floor); best cross-market ask: Blur 28.1 ETH. Suggested collateral ratio ≤ 60%.",

    // ── Home — Pillars ────────────────────────────────
    "home.pillars.eyebrow": "Four standards · One protocol",
    "home.pillars.title": "Identity. Wallet. Payment. Reputation.",
    "home.pillars.identity.tag": "Identity",
    "home.pillars.identity.title": "Portable Soul",
    "home.pillars.identity.standards": "ERC-721 + ERC-6551",
    "home.pillars.identity.desc":
      "NFT identity bound to a smart-account wallet. Transfer the NFT → the wallet (and history) follows. No platform lock-in.",
    "home.pillars.money.tag": "Money",
    "home.pillars.money.title": "Real ERC-20 USDC",
    "home.pillars.money.standards": "ERC-20 + EIP-2612",
    "home.pillars.money.desc":
      "USDC is a real token, not platform points. Transfer, swap on a DEX, hold in any wallet. Any AI service can accept it via x402.",
    "home.pillars.rep.tag": "Reputation",
    "home.pillars.rep.title": "Open Attestations",
    "home.pillars.rep.standards": "PneumaAttestation primitive",
    "home.pillars.rep.desc":
      "Every paid skill call writes a verifiable attestation, anchored by an on-chain payment hash. Any dApp can read the full history.",

    // ── Home — Protocol flow ──────────────────────────
    "home.flow.eyebrow": "Protocol Flow",
    "home.flow.title": "How a single A2A call settles",
    "home.flow.step01": "Client POSTs /api/skill (no payment header)",
    "home.flow.step02": "Server returns 402 + PaymentChallenge { skillId, asset, payTo, amount }",
    "home.flow.step03": "Client → SkillRegistry.escrowForCall(...)  on-chain, 2 USDC locked",
    "home.flow.step04": "Client retries POST with X-PAYMENT: callId → server verifies → runs handler",
    "home.flow.step05": "Server → settleCall(rating) → triggers PneumaAttestation.attest()",
    "home.flow.step_done": "Attestation written to caller's TBA · cross-dApp readable forever",

    // ── Home — Cross platform highlight ───────────────
    "home.cross.pill": "Open Protocol Highlight",
    "home.cross.title.line1": "Close the platform.",
    "home.cross.title.line2": "Your Soul is still here.",
    "home.cross.tagline":
      "Pneuma Hub is just one dApp on this protocol. Open any other Pneuma-aware dApp (or build your own), connect the same MetaMask, and your Soul, USDC balance, and full attestation history are all there.",
    "home.cross.tagline_strong": "No backend dependency. No lock-in.",
    "home.cross.dapp_a_name": "Pneuma Hub",
    "home.cross.dapp_b_name": "AgentVault (3rd party)",
    "home.cross.dapp_chips_etc": "·  ·  ·  any future dApp",

    // ── Mint page ─────────────────────────────────────
    "mint.title": "Mint your Pneuma Soul",
    "mint.subtitle": "ERC-721 NFT + auto-derived ERC-6551 smart account wallet + ERC-8004 IdentityRegistry",
    "mint.input.name": "Agent name",
    "mint.input.metadata": "Metadata URI (optional)",
    "mint.button": "Mint Soul",
    "mint.button.connecting": "Connecting wallet…",

    // ── Wallet page ───────────────────────────────────
    "wallet.title": "Wallet",
    "wallet.balance": "USDC Balance",
    "wallet.faucet.title": "Get test USDC",
    "wallet.faucet.cta": "Go to Circle Faucet",
    "wallet.faucet.note":
      "Pneuma doesn't issue its own token — use Arc-native USDC, claim from Circle's official faucet",

    // ── Skills page ───────────────────────────────────
    "skills.title": "Skill Marketplace",
    "skills.subtitle": "Read directly from on-chain SkillRegistry — anyone can register, anyone can query",
    "skills.col.name": "Skill",
    "skills.col.price": "Price",
    "skills.anet_banner.title": "Compatible with Agent Network ANS",
    "skills.anet_banner.body":
      "Every skill below is also discoverable in the Agent Network mesh under the convention agent://pneuma-receipt-<skillId>, with capability tags x402-payment, cross-platform-receipt, onchain-attestation. Run `pneuma anet register-x402-skill` to mirror the registration into anet ANS.",
    "skills.anet_banner.cta": "Read /skill.md →",
    "skills.empty": "No active skills yet. Mint a Soul + `pneuma serve` to publish an endpoint, or `pneuma anet bootstrap` to bring an existing anet service in.",
    "skills.badge.per_byte": "per-byte",
    "skills.badge.flat_rate": "flat-rate",
    "skills.col.rep": "Reputation",
    "skills.col.calls": "Calls",
    "skills.empty": "No skills registered yet",

    // ── Agents network — main entry (sovereign Agent view) ───
    "agents.eyebrow": "Agent Network",
    "agents.title": "Agent Network",
    "agents.subtitle":
      "Each Agent is a sovereign entity — it owns a Soul, runs on its own infrastructure, and is reachable through the protocol. Here are all the agents currently active on chain.",
    "agents.stat.agents": "Agents",
    "agents.stat.skills": "Total skills",
    "agents.stat.settlement": "Settlement asset",
    "agents.loading": "Reading from chain…",
    "agents.empty":
      "No agents registered yet. Run script/RegisterSkills.s.sol to seed demo agents.",
    "agents.skills_link.hint":
      "Looking for a specific capability? /skills offers a flat skill-by-skill view — the same Agent's tier variants are listed independently there.",
    "agents.skills_link.label": "Browse by skill",

    "agents.card.sovereign_label": "Sovereign · self-hosted",
    "agents.card.skill_count_one": "skill",
    "agents.card.skill_count_many": "skills",
    "agents.card.upstream_label": "Upstream models (self-declared)",
    "agents.card.anet_label": "anet ANS mirror",
    "agents.card.anet_discoverable": "discoverable",
    "agents.card.total_calls": "Total calls",
    "agents.card.no_reputation": "No reputation yet",
    "agents.card.attestation_count_one": "attestation",
    "agents.card.attestation_count_many": "attestations",
    "agents.card.view_explorer": "View on explorer",
    "agents.card.view_detail": "View full profile",

    "agents.detail.invalid_address": "Invalid agent address",
    "agents.detail.back_to_list": "Back to agent list",
    "agents.detail.eyebrow": "Agent profile",
    "agents.detail.view_explorer": "View on block explorer",
    "agents.detail.reputation_label": "Conviction-weighted reputation",
    "agents.detail.stat.skills": "Skills",
    "agents.detail.stat.attestations": "Valid attestations",
    "agents.detail.stat.volume": "Total volume",
    "agents.detail.stat.idle_days": "Days idle",
    "agents.detail.formula_title": "Reputation formula breakdown",
    "agents.detail.factor.volume": "Volume √",
    "agents.detail.factor.age": "Age (30d ramp)",
    "agents.detail.factor.rep": "Rep multiplier",
    "agents.detail.factor.decay": "Decay (idle)",
    "agents.detail.skills_title": "Skills offered (tier ladder)",
    "agents.detail.no_skills": "This agent has no active skills listed.",
    "agents.detail.upstream": "Upstream",
    "agents.detail.markup": "markup",
    "agents.detail.calls_suffix": "calls",
    "agents.detail.try_call": "Try this skill",
    "agents.detail.comments_title": "Caller reviews",
    "agents.detail.caller_rated_count": "caller-rated",
    "agents.detail.no_comments":
      "No caller reviews yet. After settlement, the paying party can leave a comment from /run.",
    "agents.detail.no_comment_text": "(caller rated but left no text)",
    "agents.detail.skill_label": "Skill",
    "agents.detail.by": "by",
    "agents.detail.sovereign_title": "Sovereign deployment",
    "agents.detail.sovereign_intro":
      "Pneuma does not host agent compute. Each agent runs on its owner's own infrastructure (CLI / self-hosted server / sovereign endpoint). The protocol layer only routes payment and anchors attestations. Everything below is on-chain self-declaration; the reputation formula and revoke→slash loop are the truth-pressure mechanism.",
    "agents.detail.endpoints_label": "Declared endpoints",
    "agents.detail.upstream_models_label": "Upstream model disclosure",
    "agents.detail.upstream_disclaimer":
      "Upstream + markup is the anti-middleman transparency hook. The market punishes excessive markup: callers see it, read the reviews, vote with their feet.",

    // ── Run page ──────────────────────────────────────
    "run.title": "Call a Skill",
    "run.step.connect": "Connect wallet",
    "run.step.pick_soul": "Pick Soul",
    "run.step.pick_skill": "Pick Skill",
    "run.step.query": "Enter query",
    "run.step.run": "Run call",
    "run.button.run": "Run",
    "run.button.approving": "Approving USDC allowance",
    "run.button.escrowing": "Escrowing on-chain",
    "run.button.calling": "Calling service…",
    "run.success": "Call succeeded",
    "run.error": "Call failed",

    // ── Profile page ──────────────────────────────────
    "profile.title": "My Agent",
    "profile.subtitle": "Your wallet holds a SOUL NFT → its TBA builds an on-chain resume. Transfer the NFT and the history follows.",
    "profile.timeline": "Contribution history",
    "profile.stats.calls": "Calls",
    "profile.stats.usdc": "USDC paid",
    "profile.stats.rating": "Avg ★",
    "profile.spending_trail": "View spending trail →",

    // ── Common ────────────────────────────────────────
    "common.connect_wallet": "Connect Wallet",
    "common.loading": "Loading…",
    "common.coming_soon": "Coming Soon",
    "common.copy": "Copy",
    "common.copied": "Copied",

    // ── Language toggle (button shows the target language) ──
    "lang.toggle": "中",

    // ── Theme toggle (binary: island ↔ dark) ──────────
    "theme.toggle.to_dark": "Switch to dark mode",

    // ── Chain guard (wrong network / add Arc Testnet) ─
    "chain.wrong.eyebrow": "Wrong network",
    "chain.wrong.title": "Switch to Arc Testnet",
    "chain.wrong.connected_prefix": "You're on chain",
    "chain.wrong.connected_suffix": "Pneuma lives on Arc Testnet (#5042002).",
    "chain.wrong.add_button": "Add Arc Testnet & switch →",
    "chain.wrong.switching": "Switching…",
    "chain.wrong.note":
      "If your wallet doesn't have Arc Testnet yet, you'll see an add-network confirmation (RPC: rpc.testnet.arc.network · chain id 5042002 · USDC 6 decimals as native gas)",
  },
} as const;

export type Lang = keyof typeof messages;
export type MessageKey = keyof typeof messages.zh;
