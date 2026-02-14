import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import { PageHeader } from '@/components/layout/PageHeader';
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
  const intervalOptions = [
    { label: '15m', value: 15 },
    { label: '1h', value: 60 },
    { label: '6h', value: 360 },
    { label: '24h', value: 1440 },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-borderSubtle bg-bgSurface p-1">
              {intervalOptions.map((option) => {
                const active = windowMinutes === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onWindowChange(option.value)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                      active
                        ? 'bg-primaryDark text-textPrimary'
                        : 'text-textMuted hover:bg-bgApp hover:text-textPrimary'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <Button variant="secondary" size="sm" onClick={onRefresh} className="!px-3">
              <FiRefreshCw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </Button>
          </div>
        }
      />

      <div className="rounded-xl border border-borderSubtle bg-bgSurface p-2">
        <nav className="flex flex-wrap gap-2">
          {NAV_ITEMS.map((item) => {
            const active = router.pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? 'border-primary bg-primaryDark text-textPrimary'
                    : 'border-borderSubtle text-textMuted hover:bg-bgApp hover:text-textPrimary'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <main>{children}</main>
    </div>
  );
}
