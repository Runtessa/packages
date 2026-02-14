import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { GlobalUIPackage, Team } from '@idp/shared';
import {
  applySharedProjectTeamAccess,
  canManageSharedProjectAccess,
  claimSharedProjectOwnershipIfNeeded,
  ensureSharedProjectAccessManaged,
  getSharedProjectTeamAccess,
  normalizeTeamIdList,
} from '@/lib/shared-project-access';

const normalizeOwnerTeamId = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    const err = new Error('ownerTeamId must be a positive integer');
    (err as any).statusCode = 400;
    throw err;
  }
  return value;
};

const serializeTeams = (teams: Team[]) =>
  teams.map((team) => ({
    id: team.id,
    key: team.key,
    name: team.name,
    isActive: team.isActive,
  }));

const ensureValidTeamIds = (requestedIds: number[], availableIds: Set<number>) => {
  const invalid = requestedIds.filter((id) => !availableIds.has(id));
  if (!invalid.length) return;
  const err = new Error(`Unknown team ids: ${invalid.join(', ')}`);
  (err as any).statusCode = 400;
  throw err;
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const user = await requireAdmin(req);
  await ensureCoreSchema();
  await ensureSchema();

  const projectRepo = CoreDataSource.getRepository(GlobalUIPackage);
  const teamRepo = AppDataSource.getRepository(Team);
  const project = await projectRepo.findOne({ where: { id: req.query.id as string } });
  if (!project) {
    res.status(404).json({ error: 'Shared package not found' });
    return;
  }

  const allTeams = await teamRepo.find({ order: { name: 'ASC' } });
  const activeTeams = allTeams.filter((team) => team.isActive);
  const knownTeamIds = new Set(allTeams.map((team) => team.id));

  if (req.method === 'GET') {
    const access = getSharedProjectTeamAccess(project);
    res.status(200).json({
      access: {
        ownerTeamId: access.ownerTeamId,
        editorTeamIds: access.editorTeamIds,
        canManage: canManageSharedProjectAccess(user, project),
        canChangeOwner: Boolean(user.isAdmin),
      },
      teams: serializeTeams(activeTeams),
    });
    return;
  }

  if (req.method === 'PUT') {
    const manageAccess = ensureSharedProjectAccessManaged(user, project);
    const claimed = claimSharedProjectOwnershipIfNeeded(project, manageAccess);
    if (claimed) {
      await projectRepo.save(project);
    }

    const currentAccess = getSharedProjectTeamAccess(project);
    const requestedOwnerProvided = req.body?.ownerTeamId !== undefined;
    const requestedOwnerTeamId = normalizeOwnerTeamId(req.body?.ownerTeamId);
    if (!user.isAdmin && requestedOwnerProvided && requestedOwnerTeamId !== currentAccess.ownerTeamId) {
      const err = new Error('Only platform admins can change ownerTeamId');
      (err as any).statusCode = 403;
      throw err;
    }

    const nextOwnerTeamId = requestedOwnerProvided ? requestedOwnerTeamId : currentAccess.ownerTeamId;
    const nextEditorTeamIds =
      req.body?.editorTeamIds !== undefined
        ? normalizeTeamIdList(req.body.editorTeamIds)
        : currentAccess.editorTeamIds;

    ensureValidTeamIds(
      [nextOwnerTeamId, ...nextEditorTeamIds].filter((value): value is number =>
        Number.isInteger(value)
      ),
      knownTeamIds
    );

    applySharedProjectTeamAccess(project, nextOwnerTeamId, nextEditorTeamIds);
    await projectRepo.save(project);

    const access = getSharedProjectTeamAccess(project);
    res.status(200).json({
      access: {
        ownerTeamId: access.ownerTeamId,
        editorTeamIds: access.editorTeamIds,
        canManage: canManageSharedProjectAccess(user, project),
        canChangeOwner: Boolean(user.isAdmin),
      },
      teams: serializeTeams(activeTeams),
    });
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT']);
  res.status(405).end();
});
