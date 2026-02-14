import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { Team } from '@idp/shared';
import { TeamMember } from '@idp/shared';
import { TEAM_MEMBER_ROLES } from '@/lib/team-roles';

const TEAM_ROLES = TEAM_MEMBER_ROLES;

const normalizeName = (raw: unknown) => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('name is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim().slice(0, 160);
};

const normalizeDescription = (raw: unknown) => {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') {
    const err = new Error('description must be a string');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim().slice(0, 2000) || null;
};

const normalizeBoolean = (raw: unknown, fallback: boolean) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  const err = new Error('isActive must be a boolean');
  (err as any).statusCode = 400;
  throw err;
};

const buildKey = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

const normalizeKey = (raw: unknown, fallbackName: string) => {
  if (raw === undefined || raw === null || raw === '') {
    const generated = buildKey(fallbackName);
    if (!generated) {
      const err = new Error('unable to generate team key from name');
      (err as any).statusCode = 400;
      throw err;
    }
    return generated;
  }
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

const parsePagination = (rawPage: unknown, rawLimit: unknown) => {
  const pageValue = Array.isArray(rawPage) ? rawPage[0] : rawPage;
  const limitValue = Array.isArray(rawLimit) ? rawLimit[0] : rawLimit;
  const pageNum = Number(pageValue ?? 1);
  const limitNum = Number(limitValue ?? 20);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1;
  const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(100, Math.floor(limitNum)) : 20;
  return { page, limit, skip: (page - 1) * limit };
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

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    await requireAdmin(req);
    await ensureSchema();

    const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);
    const qRaw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
    const q = typeof qRaw === 'string' ? qRaw.trim().toLowerCase() : '';
    const qTerm = `%${q}%`;

    const teamRepo = AppDataSource.getRepository(Team);
    const memberRepo = AppDataSource.getRepository(TeamMember);

    const baseQuery = teamRepo.createQueryBuilder('team');
    if (q) {
      baseQuery.where(
        '(LOWER(team.name) LIKE :q OR LOWER(team.key) LIKE :q OR LOWER(COALESCE(team.description, \'\')) LIKE :q)',
        { q: qTerm }
      );
    }

    const total = await baseQuery.clone().getCount();
    const teams = await baseQuery
      .orderBy('team.name', 'ASC')
      .skip(skip)
      .take(limit)
      .getMany();

    const teamIds = teams.map((team) => team.id);
    let memberCountMap = new Map<number, number>();
    if (teamIds.length) {
      const counts = await memberRepo
        .createQueryBuilder('member')
        .select('member.teamId', 'teamId')
        .addSelect('COUNT(member.id)', 'count')
        .where('member.teamId IN (:...teamIds)', { teamIds })
        .groupBy('member.teamId')
        .getRawMany<{ teamId: string; count: string }>();
      memberCountMap = new Map(counts.map((row) => [Number(row.teamId), Number(row.count)]));
    }

    res.status(200).json({
      teams: teams.map((team) => serializeTeam(team, memberCountMap.get(team.id) || 0)),
      page,
      limit,
      total,
      allowedTeamRoles: TEAM_ROLES,
    });
    return;
  }

  if (req.method === 'POST') {
    await requireAdmin(req);
    await ensureSchema();

    const name = normalizeName(req.body?.name);
    const key = normalizeKey(req.body?.key, name);
    const description = normalizeDescription(req.body?.description);
    const isActive = normalizeBoolean(req.body?.isActive, true);

    const repo = AppDataSource.getRepository(Team);
    const duplicateKey = await repo.findOne({ where: { key } });
    if (duplicateKey) {
      res.status(409).json({ error: 'Team key already exists' });
      return;
    }
    const duplicateName = await repo.findOne({ where: { name } });
    if (duplicateName) {
      res.status(409).json({ error: 'Team name already exists' });
      return;
    }

    const team = repo.create({
      key,
      name,
      description,
      isActive,
    });
    await repo.save(team);

    res.status(201).json({ team: serializeTeam(team, 0) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
