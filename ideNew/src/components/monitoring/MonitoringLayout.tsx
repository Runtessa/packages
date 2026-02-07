import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';

const NAV_ITEMS = [
  { href: '/admin/monitoring', label: 'Overview' },
  { href: '/admin/monitoring/instances', label: 'Instances' },
  { href: '/admin/monitoring/tenants', label: 'Tenants' },
  { href: '/admin/monitoring/alerts', label: 'Alerts' },
];

type Props = {
  title: string;
  subtitle: string;
  windowMinutes: number;
  onWindowChange: (minutes: number) => void;
  onRefresh: () => void;
  children: ReactNode;
};

export default function MonitoringLayout({
  title,
  subtitle,
  windowMinutes,
  onWindowChange,
  onRefresh,
  children,
}: Props) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#1e1e1e] text-textPrimary">
      <div className="flex h-[41px] items-center justify-between border-b border-[#2a2d2e] px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-wide text-textPrimary">{title}</h1>
          <span className="text-xs text-textMuted">{subtitle}</span>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(windowMinutes)}
            onChange={(e) => onWindowChange(Number(e.target.value))}
            options={[
              { label: '15 min', value: '15' },
              { label: '60 min', value: '60' },
              { label: '6 hours', value: '360' },
              { label: '24 hours', value: '1440' },
            ]}
          />
          <Button variant="secondary" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex h-[calc(100vh-41px)] min-h-0">
        <aside className="w-52 shrink-0 border-r border-[#2a2d2e] bg-[#202223] p-2">
          <div className="mb-2 px-2 text-[11px] uppercase tracking-wide text-textMuted">Monitoring</div>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = router.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex h-8 items-center rounded px-2 text-sm transition ${
                    active
                      ? 'bg-[#2a2d2e] text-white'
                      : 'text-textMuted hover:bg-[#2a2d2e] hover:text-textPrimary'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-h-0 flex-1 overflow-auto p-3">{children}</main>
      </div>
    </div>
  );
}
