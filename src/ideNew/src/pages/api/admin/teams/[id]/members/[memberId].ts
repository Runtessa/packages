import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { TeamMember } from '@idp/shared';
import {
  assertTeamRoleSequence,
  pickPrimaryTeamMemberRole,
} from '@/lib/team-roles';

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

const normalizeRoles = (rolesInput: unknown, fallbackRole: unknown) => {
  const normalized = assertTeamRoleSequence(rolesInput ?? fallbackRole);
  if (!normalized.length) {
    const err = new Error('roles are required');
    (err as any).statusCode = 400;
    throw err;
  }
  return normalized;
};

const serializeMember = (member: TeamMember) => ({
  id: member.id,
  teamId: member.teamId,
  userId: member.userId,
  teamRoles: Array.isArray(member.roles) ? member.roles : [member.role || 'observer'],
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

    const roles = normalizeRoles(req.body?.roles, req.body?.role);
    const role = pickPrimaryTeamMemberRole(roles);
    const repo = AppDataSource.getRepository(TeamMember);
    const member = await repo.findOne({ where: { id: memberId, teamId }, relations: { user: true } });
    if (!member) {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }

    member.role = role;
    member.roles = roles;
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
