import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { TeamTenant } from '@idp/shared';

const parseTeamId = (raw: unknown) => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('invalid team id');
    (err as any).statusCode = 400;
    throw err;
  }
  return id;
};

const parseTenantId = (raw: unknown) => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.trim()) {
    const err = new Error('invalid tenant id');
    (err as any).statusCode = 400;
    throw err;
  }
  return value.trim();
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    res.status(405).end();
    return;
  }

  await requireAdmin(req);
  await ensureSchema();
  const teamId = parseTeamId(req.query.id);
  const tenantId = parseTenantId(req.query.tenantId);

  const repo = AppDataSource.getRepository(TeamTenant);
  const mapping = await repo.findOne({ where: { teamId, tenantId } });
  if (!mapping) {
    res.status(404).json({ error: 'Team tenant assignment not found' });
    return;
  }

  await repo.remove(mapping);
  res.status(204).end();
});
