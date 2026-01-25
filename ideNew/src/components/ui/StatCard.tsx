import React from 'react';

type StatCardProps = {
  label: string;
  value: string;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  trend?: string;
  tone?: 'default' | 'positive' | 'negative';
};

export const StatCard = ({ label, value, icon: Icon, trend, tone = 'default' }: StatCardProps) => {
  const trendColor =
    tone === 'positive'
      ? 'text-accent'
      : tone === 'negative'
        ? 'text-danger'
        : 'text-textMuted';

  return (
    <div className="card flex items-center justify-between gap-3 p-4">
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bgApp text-accent">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <div className="flex-1 text-left">
        <div className="text-sm text-textMuted">{label}</div>
        <div className="text-2xl font-semibold text-textPrimary">{value}</div>
        {trend && <div className={`text-xs font-semibold ${trendColor}`}>{trend}</div>}
      </div>
    </div>
  );
};

export default StatCard;
