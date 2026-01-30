import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { Button } from '@/components/ui/Button';
import { useSessionToken } from '@/lib/client/session';
import { fetchJson } from '@/lib/client/api';

type ErrorFrame = {
  file?: string;
  line?: number;
  column?: number;
  method?: string;
};

type LogDetail = {
  id: number;
  level: string;
  source: string;
  action?: string | null;
  message?: string | null;
  meta?: any;
  createdAt?: string;
};

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

const renderMeta = (meta: any) => {
  if (!meta) return '-';
  try {
    return (
      <pre className="whitespace-pre-wrap rounded-lg bg-bgApp p-3 text-xs text-textPrimary">
        {JSON.stringify(meta, null, 2)}
      </pre>
    );
  } catch {
    return String(meta);
  }
};

export default function AdminLogDetailPage() {
  const router = useRouter();
  const { token, ready } = useSessionToken();
  const { id } = router.query;

  const [log, setLog] = useState<LogDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const frames: ErrorFrame[] = useMemo(() => {
    const meta = log?.meta;
    if (!meta) return [];
    if (meta.error?.frames) return meta.error.frames;
    if (meta.frames) return meta.frames;
    return [];
  }, [log]);

  const stackTrace = useMemo(() => {
    const meta = log?.meta;
    if (!meta) return '';
    return meta.error?.stack || meta.stack || '';
  }, [log]);

  const errorMeta = log?.meta?.error;
  const topFrame = frames[0];

  useEffect(() => {
    const load = async () => {
      if (!router.isReady || !id || !ready || !token) return;
      setLoading(true);
      setError('');
      try {
        const logId = Array.isArray(id) ? id[0] : id;
        const data = await fetchJson(`/api/admin/logs/${logId}`, { token });
        setLog(data.log);
      } catch (err: any) {
        setError(err.message || 'Failed to load log');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [router.isReady, id, ready, token]);

  return (
    <div className="page-container space-y-6 py-10">
      <PageHeader
        title="Log Details"
        subtitle="Full log payload and metadata."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" href="/admin/logs">
              Back to logs
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard title={log ? `Log #${log.id}` : 'Loading...'} subtitle={formatDate(log?.createdAt)}>
        {!log || loading ? (
          <div className="text-textMuted text-sm">Loading log...</div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${levelTone(
                  log.level
                )}`}
              >
                {levelLabel(log.level)}
              </span>
              <span className="text-sm text-textMuted">{log.source || '-'}</span>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-semibold text-textPrimary">Action</div>
              <div className="text-sm text-textMuted">{log.action || '-'}</div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-semibold text-textPrimary">Message</div>
              <div className="text-sm text-textMuted">{log.message || '-'}</div>
            </div>

            {errorMeta?.message && (
              <div className="space-y-1">
                <div className="text-sm font-semibold text-textPrimary">Error</div>
                <div className="text-sm text-textMuted">{errorMeta.message}</div>
                {topFrame && (
                  <div className="text-xs text-textMuted">
                    at {topFrame.file}:{topFrame.line}:{topFrame.column}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              <div className="text-sm font-semibold text-textPrimary">Metadata</div>
              {renderMeta(log.meta)}
            </div>

            {frames.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-textPrimary">Stack Frames</div>
                <div className="overflow-x-auto rounded-lg border border-borderSubtle">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-bgApp text-textMuted">
                      <tr>
                        <th className="px-3 py-2">Method</th>
                        <th className="px-3 py-2">File</th>
                        <th className="px-3 py-2">Line</th>
                        <th className="px-3 py-2">Column</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borderSubtle">
                      {frames.map((frame, idx) => (
                        <tr key={`${frame.file}-${frame.line}-${frame.column}-${idx}`}>
                          <td className="px-3 py-2 text-textPrimary">{frame.method || '-'}</td>
                          <td className="px-3 py-2 text-textMuted">{frame.file || '-'}</td>
                          <td className="px-3 py-2 text-textMuted">{frame.line ?? '-'}</td>
                          <td className="px-3 py-2 text-textMuted">{frame.column ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {stackTrace && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-textPrimary">Stack Trace</div>
                <pre className="whitespace-pre-wrap rounded-lg bg-bgApp p-3 text-xs text-textMuted">
                  {stackTrace}
                </pre>
              </div>
            )}
          </div>
        )}
      </DataCard>
    </div>
  );
}
