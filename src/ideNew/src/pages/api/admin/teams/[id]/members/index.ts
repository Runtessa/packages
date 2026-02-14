import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { Team } from '@idp/shared';
import { TeamMember } from '@idp/shared';
import { User } from '@idp/shared';
import {
  assertTeamRoleSequence,
  pickPrimaryTeamMemberRole,
  TEAM_MEMBER_ROLES,
} from '@/lib/team-roles';

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

const normalizeRoles = (rolesInput: unknown, fallbackRole: unknown) => {
  const normalized = assertTeamRoleSequence(rolesInput ?? fallbackRole ?? 'observer');
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

  if (req.method === 'GET') {
    await requireAdmin(req);
    await ensureSchema();

    const teamRepo = AppDataSource.getRepository(Team);
    const team = await teamRepo.findOne({ where: { id: teamId } });
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    const memberRepo = AppDataSource.getRepository(TeamMember);
    const members = await memberRepo.find({
      where: { teamId },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });

    res.status(200).json({
      members: members.map(serializeMember),
      allowedTeamRoles: TEAM_ROLES,
    });
    return;
  }

  if (req.method === 'POST') {
    await requireAdmin(req);
    await ensureSchema();

    const userId = parseId(req.body?.userId, 'user id');
    const roles = normalizeRoles(req.body?.roles, req.body?.role || 'observer');
    const role = pickPrimaryTeamMemberRole(roles);

    const teamRepo = AppDataSource.getRepository(Team);
    const userRepo = AppDataSource.getRepository(User);
    const memberRepo = AppDataSource.getRepository(TeamMember);

    const [team, user, existing] = await Promise.all([
      teamRepo.findOne({ where: { id: teamId } }),
      userRepo.findOne({ where: { id: userId } }),
      memberRepo.findOne({ where: { teamId, userId } }),
    ]);

    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (existing) {
      res.status(409).json({ error: 'User is already a member of this team' });
      return;
    }

    const membership = memberRepo.create({
      teamId,
      userId,
      role,
      roles,
    });
    await memberRepo.save(membership);

    const saved = await memberRepo.findOne({
      where: { id: membership.id },
      relations: { user: true },
    });

    res.status(201).json({
      member: saved ? serializeMember(saved) : serializeMember({ ...membership, user } as TeamMember),
    });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
