import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { DecisionReport } from '../model';

const COLORS = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ec4899'];

interface TradeoffsRadarChartProps {
  tradeoffs: NonNullable<DecisionReport['tradeoffs']>;
}

export function TradeoffsRadarChart({ tradeoffs }: TradeoffsRadarChartProps) {
  const metrics = tradeoffs.headers;
  const chartData = metrics.map((dim) => {
    const row: Record<string, string | number> = { metric: dim };
    for (const r of tradeoffs.rows) {
      row[r.optionId] = typeof r.scores[dim] === 'number' ? r.scores[dim] : 0;
    }
    return row;
  });

  return (
    <div className="w-full h-[320px] min-h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={chartData} margin={{ top: 16, right: 24, bottom: 8, left: 24 }}>
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: '#6b7280', fontSize: 11 }} />
          <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fill: '#9ca3af', fontSize: 10 }} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
            formatter={(value: number) => [value.toFixed(1), '']}
          />
          {tradeoffs.rows.map((r, i) => (
            <Radar
              key={r.optionId}
              name={r.optionName}
              dataKey={r.optionId}
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          ))}
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </RadarChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-gray-500 text-center mt-1" style={{ fontWeight: 500 }}>
        Scores are 0–10 (higher EV / GoalAlign is better; higher Risk / Regret / Uncertainty means more caution)
      </p>
    </div>
  );
}
