import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { TeamMember } from '@idp/shared';
import { TEAM_MEMBER_ROLES } from '@/lib/team-roles';

const TEAM_ROLES = TEAM_MEMBER_ROLES;

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

const normalizeRole = (raw: unknown) => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('role is required');
    (err as any).statusCode = 400;
    throw err;
  }
  const role = raw.trim().toLowerCase();
  if (!TEAM_ROLES.includes(role as (typeof TEAM_ROLES)[number])) {
    const err = new Error(`role must be one of: ${TEAM_ROLES.join(', ')}`);
    (err as any).statusCode = 400;
    throw err;
  }
  return role;
};

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
  const memberId = parseId(req.query.memberId, 'member id');

  if (req.method === 'PUT') {
    await requireAdmin(req);
    await ensureSchema();

    const role = normalizeRole(req.body?.role);
    const repo = AppDataSource.getRepository(TeamMember);
    const member = await repo.findOne({ where: { id: memberId, teamId }, relations: { user: true } });
    if (!member) {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }

    member.role = role;
    await repo.save(member);

    res.status(200).json({ member: serializeMember(member) });
    return;
  }

  if (req.method === 'DELETE') {
    await requireAdmin(req);
    await ensureSchema();

    const repo = AppDataSource.getRepository(TeamMember);
    const member = await repo.findOne({ where: { id: memberId, teamId } });
    if (!member) {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }

    await repo.remove(member);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  res.status(405).end();
});
