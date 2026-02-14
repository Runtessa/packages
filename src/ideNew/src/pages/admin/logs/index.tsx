import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useSessionToken } from '@/lib/client/session';
import { fetchJson } from '@/lib/client/api';

type SystemLog = {
  id: number;
  level: string;
  source: string;
  action: string | null;
  message: string | null;
  meta?: any;
  createdAt?: string;
};

const levelOptions = [
  { label: 'All Levels', value: '' },
  { label: 'Info', value: 'info' },
  { label: 'Warning', value: 'warning' },
  { label: 'Error', value: 'error' }
];

const levelTone = (level: string) => {
  const l = (level || '').toLowerCase();
  if (l === 'error') return 'bg-danger/20 text-danger border border-danger/30';
  if (l === 'warning' || l === 'warn') return 'bg-warning/20 text-warning border border-warning/30';
  return 'bg-primary/10 text-accent border border-primary/30';
};

const levelLabel = (level: string) => {
  const l = (level || '').toLowerCase();
  if (l === 'error') return 'Error';
  if (l === 'warning' || l === 'warn') return 'Warning';
  return 'Info';
};

const formatDate = (value?: string) => {
  if (!value) return '-';
  return new Date(value).toLocaleString();
};

export default function AdminLogsPage() {
  const router = useRouter();
  const { token, ready } = useSessionToken();

  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 25;
  const [filters, setFilters] = useState({ level: '', source: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);

  useEffect(() => {
    if (!ready || !token) return;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const qs = new URLSearchParams({
          page: String(page),
          limit: String(limit)
        });
        if (filters.level) qs.set('level', filters.level);
        if (filters.source) qs.set('source', filters.source);
        const data = await fetchJson(`/api/admin/logs?${qs.toString()}`, { token });
        setLogs(data.logs || []);
        setTotal(data.total || 0);
      } catch (err: any) {
        setError(err.message || 'Failed to load logs');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [ready, token, page, filters.level, filters.source]);

  return (
    <div className="page-container space-y-6 py-10">
      <PageHeader title="System Logs" subtitle="Inspect backend activity and errors." />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard title="Filters" subtitle="Refine logs by severity or source.">
        <div className="grid gap-3 md:grid-cols-3">
          <Select
            label="Level"
            value={filters.level}
            onChange={(e) => {
              setFilters((f) => ({ ...f, level: e.target.value }));
              setPage(1);
            }}
            options={levelOptions}
          />
          <Input
            label="Source"
            placeholder="auth, registry, editor"
            value={filters.source}
            onChange={(e) => {
              setFilters((f) => ({ ...f, source: e.target.value }));
              setPage(1);
            }}
          />
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => {
                setFilters({ level: '', source: '' });
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>
      </DataCard>

      <DataCard title="Recent activity" subtitle={`Showing ${logs.length} of ${total} logs`}>
        <div className="space-y-4">
          <DataTable
            headers={['Level', 'Source', 'Action', 'Message', 'Time', 'Details']}
            loading={loading}
            emptyMessage={loading ? 'Loading logs...' : 'No logs yet.'}
          >
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-bgApp transition">
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${levelTone(
                      log.level
                    )}`}
                  >
                    {levelLabel(log.level)}
                  </span>
                </td>
                <td className="px-4 py-3 text-textMuted">{log.source || '-'}</td>
                <td className="px-4 py-3 text-textPrimary text-sm">{log.action || '-'}</td>
                <td className="px-4 py-3 text-textMuted text-sm">{log.message || '-'}</td>
                <td className="px-4 py-3 text-textMuted text-sm">{formatDate(log.createdAt)}</td>
                <td className="px-4 py-3 text-textMuted text-sm">
                  <Button variant="secondary" size="sm" href={`/admin/logs/${log.id}`}>
                    View
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>

          <div className="flex items-center justify-between px-2 pt-3">
            <div className="text-sm text-textMuted">
              Page {page} of {totalPages}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </DataCard>
    </div>
  );
}
