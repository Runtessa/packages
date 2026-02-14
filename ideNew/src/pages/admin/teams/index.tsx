import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAdminGuard } from '@/lib/client/use-admin-guard';
import { fetchTeams, type TeamSummary } from '@/lib/client/teams-admin';
import { AccessTabs } from '@/components/admin/AccessTabs';

export default function AdminTeamsListPage() {
  const { token, ready, isAdmin, loading: authLoading, error: authError } = useAdminGuard('ide.users.manage');

  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const stats = useMemo(() => {
    const active = teams.filter((team) => team.isActive).length;
    const inactive = Math.max(teams.length - active, 0);
    const listedMembers = teams.reduce((acc, team) => acc + Number(team.memberCount || 0), 0);
    return { active, inactive, listedMembers };
  }, [teams]);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchTeams(token, { page, limit, q: search });
      setTeams(Array.isArray(data.teams) ? data.teams : []);
      setTotal(Number(data.total || 0));
    } catch (err: any) {
      setError(err.message || 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !token || !isAdmin) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, isAdmin, page, limit, search]);

  return (
    <div className="space-y-6">
      <AccessTabs />
      <PageHeader
        title="Team Management"
        subtitle="Teams directory and high-level management."
        actions={
          <div className="flex items-center gap-2">
            <Button href="/admin/teams/new" variant="primary" size="sm">
              New Team
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        }
      />

      {authLoading || loading ? <DataCard title="Loading teams" subtitle="Please wait..." /> : null}

      {authError ? (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">{authError}</div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">{error}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
          <div className="text-xs uppercase text-textMuted">Total Teams</div>
          <div className="mt-1 text-xl font-semibold text-textPrimary">{total}</div>
        </div>
        <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
          <div className="text-xs uppercase text-textMuted">Active</div>
          <div className="mt-1 text-xl font-semibold text-textPrimary">{stats.active}</div>
        </div>
        <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
          <div className="text-xs uppercase text-textMuted">Inactive</div>
          <div className="mt-1 text-xl font-semibold text-textPrimary">{stats.inactive}</div>
        </div>
        <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
          <div className="text-xs uppercase text-textMuted">Members (listed)</div>
          <div className="mt-1 text-xl font-semibold text-textPrimary">{stats.listedMembers}</div>
        </div>
      </div>

      <DataCard title="Teams Directory" subtitle="Open a team to manage members and roles.">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by name, key, or description"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPage(1);
                setSearch(searchInput.trim());
              }}
            >
              Search
            </Button>
          </div>

          <DataTable
            headers={['Team', 'Key', 'Status', 'Members', 'Updated', 'Actions']}
            loading={loading}
            emptyMessage="No teams found."
          >
            {teams.map((team) => (
              <tr key={team.id} className="hover:bg-bgApp transition">
                <td className="px-4 py-3">
                  <div className="font-medium text-textPrimary">{team.name}</div>
                  <div className="text-xs text-textMuted">{team.description || '-'}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-textMuted">{team.key}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${
                      team.isActive
                        ? 'border-accent/60 bg-accent/10 text-textPrimary'
                        : 'border-borderSubtle text-textMuted'
                    }`}
                  >
                    {team.isActive ? 'active' : 'inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-textMuted">{team.memberCount}</td>
                <td className="px-4 py-3 text-xs text-textMuted">
                  {team.updatedAt ? new Date(team.updatedAt).toLocaleString() : '-'}
                </td>
                <td className="px-4 py-3">
                  <Button href={`/admin/teams/${team.id}`} variant="secondary" size="sm">
                    Open
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>

          <div className="flex items-center justify-between text-xs text-textMuted">
            <span>
              Page {page} / {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="xs"
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="xs"
                disabled={page >= totalPages}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
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
