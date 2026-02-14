import Link from 'next/link';
import { useRouter } from 'next/router';

const TABS = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/teams', label: 'Teams' },
];

const isActivePath = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function AccessTabs() {
  const router = useRouter();
  const pathname = String(router.pathname || '');

  return (
    <div className="inline-flex rounded-lg border border-borderSubtle bg-bgSurface p-1">
      {TABS.map((tab) => {
        const active = isActivePath(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              active
                ? 'bg-bgApp text-textPrimary'
                : 'text-textMuted hover:bg-bgApp hover:text-textPrimary'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
