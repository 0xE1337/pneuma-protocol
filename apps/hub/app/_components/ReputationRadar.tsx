"use client";

/**
 * ReputationRadar — V6.0.3 4 维 reputation 雷达图
 *
 * 用纯 SVG 渲染（无依赖），4 个维度：
 *   - Economic    (cyan)    — 付费交易历史
 *   - Intellectual (magenta) — 知识公地引用
 *   - Social      (amber)   — 担保图 stake
 *   - Judicial    (soul)    — 陪审员表现 (V6.1 roadmap)
 *
 * 每个维度 0-100 分，半径按比例填充。
 *
 * 设计选择：
 *   - 不用 chart.js / d3，自己画 SVG —— 0 依赖，bundle 小
 *   - 4 边形（不是 5 边或 6 边）—— 跟 4 维匹配，对称美观
 *   - 半径 100px，hovers 显示 detail
 */

import type { ReputationV2Breakdown } from "@/lib/reputationScore.v2";
import { scaleToDisplayScore, getTier } from "@pneuma/reputation-formula";

interface RadarProps {
  breakdown: ReputationV2Breakdown;
  size?: number; // pixel size, default 240
}

export function ReputationRadar({ breakdown, size = 240 }: RadarProps) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = (size / 2) * 0.78; // 留 22% margin 给 label

  // 0-100 raw → 0-1000 display + 段位
  const displayScore = scaleToDisplayScore(breakdown.total);
  const tier = getTier(displayScore);

  // 4 个维度按 NESW 方位
  const dims: Array<{
    label: string;
    score: number;
    angle: number; // radians
    color: string;
    detailLabel: string;
  }> = [
    {
      label: "Economic",
      score: breakdown.economic.score,
      angle: -Math.PI / 2, // top
      color: "#22d3ee", // cyan-400
      detailLabel: `${breakdown.economic.detail.validCount ?? 0} calls`,
    },
    {
      label: "Intellectual",
      score: breakdown.intellectual.score,
      angle: 0, // right
      color: "#e879f9", // magenta/fuchsia-400
      detailLabel: `${breakdown.intellectual.detail.publications ?? 0} pubs`,
    },
    {
      label: "Social",
      score: breakdown.social.score,
      angle: Math.PI / 2, // bottom
      color: "#fbbf24", // amber-400
      detailLabel: `${breakdown.social.detail.totalStakeUsdc ?? "0"} USDC`,
    },
    {
      label: "Judicial",
      score: breakdown.judicial.score,
      angle: Math.PI, // left
      color: "#a78bfa", // violet-400
      detailLabel: "V6.1",
    },
  ];

  // grid rings (25/50/75/100)
  const rings = [0.25, 0.5, 0.75, 1.0];

  // path through 4 dim points based on score
  const scorePoints = dims
    .map((d) => {
      const r = (d.score / 100) * maxR;
      const x = cx + r * Math.cos(d.angle);
      const y = cy + r * Math.sin(d.angle);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="flex flex-col items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="overflow-visible"
      >
        {/* Background rings */}
        {rings.map((r) => (
          <polygon
            key={r}
            points={dims
              .map((d) => {
                const radius = r * maxR;
                const x = cx + radius * Math.cos(d.angle);
                const y = cy + radius * Math.sin(d.angle);
                return `${x},${y}`;
              })
              .join(" ")}
            fill="none"
            stroke="rgba(150,150,150,0.15)"
            strokeWidth="1"
          />
        ))}

        {/* Axis lines */}
        {dims.map((d) => {
          const x = cx + maxR * Math.cos(d.angle);
          const y = cy + maxR * Math.sin(d.angle);
          return (
            <line
              key={d.label}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="rgba(150,150,150,0.2)"
              strokeWidth="1"
            />
          );
        })}

        {/* Score polygon (filled) */}
        <polygon
          points={scorePoints}
          fill="rgba(232,121,249,0.15)"
          stroke="rgba(232,121,249,0.6)"
          strokeWidth="2"
        />

        {/* Score points (with dim color) */}
        {dims.map((d) => {
          const r = (d.score / 100) * maxR;
          const x = cx + r * Math.cos(d.angle);
          const y = cy + r * Math.sin(d.angle);
          return (
            <circle key={d.label} cx={x} cy={y} r={4} fill={d.color} />
          );
        })}

        {/* Labels */}
        {dims.map((d) => {
          const labelR = maxR + 18;
          const x = cx + labelR * Math.cos(d.angle);
          const y = cy + labelR * Math.sin(d.angle);
          return (
            <g key={`label-${d.label}`}>
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="ui-monospace, SF Mono, monospace"
                fontSize="11"
                fill={d.color}
                fontWeight="600"
              >
                {d.label}
              </text>
              <text
                x={x}
                y={y + 14}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="ui-monospace, SF Mono, monospace"
                fontSize="10"
                fill="rgba(200,200,200,0.6)"
              >
                {d.score.toFixed(0)} · {d.detailLabel}
              </text>
            </g>
          );
        })}

        {/* Center total score —— display 0-1000 + tier emoji */}
        <circle cx={cx} cy={cy} r={32} fill="rgba(0,0,0,0.55)" />
        <text
          x={cx}
          y={cy - 8}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="ui-monospace, SF Mono, monospace"
          fontSize="20"
          fontWeight="700"
          fill="white"
        >
          {displayScore}
        </text>
        <text
          x={cx}
          y={cy + 11}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="14"
        >
          {tier.emoji}
        </text>
      </svg>

      {/* 段位 + raw 双行说明，放图下方比挤在 SVG 中心更可读 */}
      <div className="flex items-baseline gap-2 font-mono text-[11px] text-ink-faint">
        <span className="font-semibold text-ink-dim">{tier.zhName}（{tier.enName}）</span>
        <span>·</span>
        <span>raw {breakdown.total.toFixed(1)} / 100</span>
      </div>
    </div>
  );
}
