import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { Team } from '@idp/shared';
import { TeamMember } from '@idp/shared';

const parseId = (raw: unknown, label: string) => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error(`invalid ${label}`);
    (err as any).statusCode = 400;
    throw err;
  }
  return id;
};

const normalizeName = (raw: unknown) => {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('name must be a non-empty string');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim().slice(0, 160);
};

const buildKey = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

const normalizeKey = (raw: unknown) => {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    const err = new Error('key must be a string');
    (err as any).statusCode = 400;
    throw err;
  }
  const normalized = buildKey(raw);
  if (!normalized) {
    const err = new Error('key must contain letters or numbers');
    (err as any).statusCode = 400;
    throw err;
  }
  return normalized;
};

const normalizeDescription = (raw: unknown) => {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string') {
    const err = new Error('description must be a string');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim().slice(0, 2000) || null;
};

const normalizeBoolean = (raw: unknown) => {
  if (raw === undefined) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  const err = new Error('isActive must be a boolean');
  (err as any).statusCode = 400;
  throw err;
};

const serializeTeam = (team: Team, memberCount = 0) => ({
  id: team.id,
  key: team.key,
  name: team.name,
  description: team.description,
  isActive: team.isActive,
  memberCount,
  createdAt: team.createdAt,
  updatedAt: team.updatedAt,
});

const serializeMember = (member: TeamMember) => ({
  id: member.id,
  teamId: member.teamId,
  userId: member.userId,
  teamRole: member.role,
  userEmail: member.user?.email || null,
  userRole: member.user?.role || null,
  createdAt: member.createdAt,
  updatedAt: member.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const teamId = parseId(req.query.id, 'team id');

  if (req.method === 'GET') {
    await requireAdmin(req);
    await ensureSchema();

    const teamRepo = AppDataSource.getRepository(Team);
    const memberRepo = AppDataSource.getRepository(TeamMember);

    const team = await teamRepo.findOne({ where: { id: teamId } });
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    const members = await memberRepo.find({
      where: { teamId },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });

    res.status(200).json({
      team: serializeTeam(team, members.length),
      members: members.map(serializeMember),
    });
    return;
  }

  if (req.method === 'PUT') {
    await requireAdmin(req);
    await ensureSchema();

    const repo = AppDataSource.getRepository(Team);
    const team = await repo.findOne({ where: { id: teamId } });
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    const nextName = normalizeName(req.body?.name);
    const nextKey = normalizeKey(req.body?.key);
    const nextDescription = normalizeDescription(req.body?.description);
    const nextIsActive = normalizeBoolean(req.body?.isActive);

    if (nextName && nextName !== team.name) {
      const duplicateName = await repo.findOne({ where: { name: nextName } });
      if (duplicateName && duplicateName.id !== team.id) {
        res.status(409).json({ error: 'Team name already exists' });
        return;
      }
      team.name = nextName;
    }

    if (nextKey && nextKey !== team.key) {
      const duplicateKey = await repo.findOne({ where: { key: nextKey } });
      if (duplicateKey && duplicateKey.id !== team.id) {
        res.status(409).json({ error: 'Team key already exists' });
        return;
      }
      team.key = nextKey;
    }

    if (nextDescription !== undefined) {
      team.description = nextDescription;
    }
    if (nextIsActive !== undefined) {
      team.isActive = nextIsActive;
    }

    await repo.save(team);
    const memberRepo = AppDataSource.getRepository(TeamMember);
    const memberCount = await memberRepo.count({ where: { teamId } });

    res.status(200).json({ team: serializeTeam(team, memberCount) });
    return;
  }

  if (req.method === 'DELETE') {
    await requireAdmin(req);
    await ensureSchema();

    const repo = AppDataSource.getRepository(Team);
    const team = await repo.findOne({ where: { id: teamId } });
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    await repo.remove(team);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
  res.status(405).end();
});
