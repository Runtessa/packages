import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';

const NAV_ITEMS = [
  { href: '/admin/containers', label: 'Overview' },
  { href: '/admin/containers/services', label: 'Services' },
  { href: '/admin/containers/containers', label: 'Containers' },
];

type Props = {
  title: string;
  subtitle: string;
  onRefresh?: () => void;
  actions?: ReactNode;
  children: ReactNode;
};

export default function ContainerManagerLayout({
  title,
  subtitle,
  onRefresh,
  actions,
  children,
}: Props) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-2">
            {actions}
            {onRefresh ? (
              <Button variant="secondary" size="sm" onClick={onRefresh}>
                <FiRefreshCw className="h-3.5 w-3.5" />
                <span>Refresh</span>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="rounded-xl border border-borderSubtle bg-bgSurface p-2">
        <nav className="flex flex-wrap gap-2">
          {NAV_ITEMS.map((item) => {
            const active =
              router.pathname === item.href || (item.href !== '/admin/containers' && router.pathname.startsWith(`${item.href}/`));
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

      <main className="space-y-4 pb-4">{children}</main>
    </div>
  );
}
