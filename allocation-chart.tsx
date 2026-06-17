import React from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

const data = [
  { name: "Community Airdrop", value: 40, color: "hsl(var(--chart-1))" },
  { name: "Team & Advisors", value: 20, color: "hsl(var(--chart-3))" },
  { name: "Ecosystem & DAO", value: 20, color: "hsl(var(--chart-2))" },
  { name: "Strategic Reserve", value: 10, color: "hsl(var(--chart-4))" },
  { name: "Liquidity", value: 10, color: "hsl(var(--chart-5))" },
];

export function AllocationChart() {
  return (
    <div className="w-full h-[350px] relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={80}
            outerRadius={120}
            paddingAngle={2}
            dataKey="value"
            stroke="none"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip 
            formatter={(value: number) => [`${value}%`, 'Allocation']}
            contentStyle={{ 
              backgroundColor: 'hsl(var(--card))', 
              borderColor: 'hsl(var(--border))',
              borderRadius: '0.5rem',
              color: 'white',
              fontFamily: 'var(--app-font-mono)'
            }}
            itemStyle={{ color: 'hsl(var(--primary))' }}
          />
          <Legend 
            verticalAlign="bottom" 
            height={36} 
            iconType="circle"
            formatter={(value) => <span className="text-white/80 font-medium ml-1">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
      
      {/* Center text for donut */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-8">
        <span className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Total Supply</span>
        <span className="text-2xl font-mono font-bold text-white">10B JUP</span>
      </div>
    </div>
  );
}
