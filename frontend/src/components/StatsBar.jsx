import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { tierColor } from "../tiers";

export default function StatsBar({ stats }) {
  if (!stats) return null;

  const tierData = [
    { name: "Immediate Review", count: stats.alerts_immediate },
    { name: "Scheduled Review", count: stats.alerts_scheduled },
    { name: "Monitor", count: stats.alerts_monitor },
  ];

  const cards = [
    { label: "Tenders", value: stats.total_tenders },
    { label: "Vendors", value: stats.total_vendors },
    { label: "Categories", value: stats.total_categories },
    { label: "Bid Records", value: stats.total_records },
    { label: "Flagged Cases", value: stats.total_cases },
  ];

  return (
    <div className="stats-section">
      <div className="stats-cards">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-value">{c.value}</div>
            <div className="stat-label">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="stats-chart">
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={tierData} layout="vertical" margin={{ left: 10, right: 20 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={130} tick={{ fill: "#c7cede", fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "#1c2333", border: "1px solid #333d54", borderRadius: 8, color: "#fff" }}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={22}>
              {tierData.map((d) => (
                <Cell key={d.name} fill={tierColor(d.name)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
