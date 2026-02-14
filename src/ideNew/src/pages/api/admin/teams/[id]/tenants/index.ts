import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { Team } from '@idp/shared';
import { TeamTenant } from '@idp/shared';
import { Tenant } from '@idp/shared';

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

const normalizeTenantId = (raw: unknown) => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('tenantId is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim();
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  await requireAdmin(req);
  const teamId = parseTeamId(req.query.id);
  await ensureSchema();
  await ensureCoreSchema();

  const teamRepo = AppDataSource.getRepository(Team);
  const mappingRepo = AppDataSource.getRepository(TeamTenant);
  const tenantRepo = CoreDataSource.getRepository(Tenant);

  const team = await teamRepo.findOne({ where: { id: teamId } });
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  if (req.method === 'GET') {
    const mappings = await mappingRepo.find({
      where: { teamId },
      order: { createdAt: 'ASC' },
    });
    const assignedSet = new Set(mappings.map((entry) => entry.tenantId));
    const tenants = await tenantRepo.find({ order: { hostname: 'ASC' } });
    res.status(200).json({
      teamId,
      assignments: mappings.map((entry) => ({
        id: entry.id,
        teamId: entry.teamId,
        tenantId: entry.tenantId,
        createdAt: entry.createdAt,
      })),
      tenants: tenants.map((tenant) => ({
        id: tenant.id,
        hostname: tenant.hostname,
        isSuspended: tenant.isSuspended,
        allowRegistration: tenant.allowRegistration ?? true,
        assigned: assignedSet.has(tenant.id),
      })),
    });
    return;
  }

  if (req.method === 'POST') {
    const tenantId = normalizeTenantId(req.body?.tenantId);
    const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    const existing = await mappingRepo.findOne({ where: { teamId, tenantId } });
    if (existing) {
      res.status(200).json({
        assignment: {
          id: existing.id,
          teamId: existing.teamId,
          tenantId: existing.tenantId,
          createdAt: existing.createdAt,
        },
      });
      return;
    }
    const created = mappingRepo.create({ teamId, tenantId });
    await mappingRepo.save(created);
    res.status(201).json({
      assignment: {
        id: created.id,
        teamId: created.teamId,
        tenantId: created.tenantId,
        createdAt: created.createdAt,
      },
    });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
