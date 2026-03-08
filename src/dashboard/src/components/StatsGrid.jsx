import { useAppState } from '../context.jsx';
import { formatUptime } from '../utils.jsx';

export default function StatsGrid() {
  const { stats } = useAppState();

  const cards = [
    {
      label: 'Messages',
      value: stats.total >= 1000 ? (stats.total / 1000).toFixed(1) + 'k' : stats.total,
      icon: 'mail',
      iconColor: 'text-dim',
      change: stats.total > 0 ? '+12%' : null,
      changeColor: 'text-green bg-green-light',
    },
    {
      label: 'Errors',
      value: stats.errorCount || 0,
      icon: 'error',
      iconColor: 'text-red',
      change: stats.errorCount > 0 ? `${stats.errorCount}` : '0%',
      changeColor: stats.errorCount > 0 ? 'text-red bg-red-light' : 'text-dim',
    },
    {
      label: 'Latency',
      value: `${stats.avgLatency || 0}ms`,
      icon: 'speed',
      iconColor: 'text-orange',
      change: null,
      changeColor: '',
    },
    {
      label: 'Uptime',
      value: formatUptime(stats.uptime),
      icon: 'check_circle',
      iconColor: 'text-green',
      change: 'Stable',
      changeColor: 'text-dim',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(card => (
        <div key={card.label} className="bg-surface border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-dim text-sm font-medium">{card.label}</p>
            <span className={`material-symbols-outlined ${card.iconColor}`}>{card.icon}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-text text-2xl font-bold tracking-tight">{card.value}</p>
            {card.change && (
              <p className={`text-xs font-semibold ${card.changeColor} px-1.5 py-0.5 rounded`}>
                {card.change}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
