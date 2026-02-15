import { AuthDataSource } from './db';
import { randomId } from './crypto';
import { ActivityEntity } from './typeorm/entities';

export interface ActivityEntry {
  eventType: string;
  actorUserRandId?: string | null;
  actorTenantRandId?: string | null;
  targetType?: string | null;
  targetRandId?: string | null;
  oauthClientId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  payload?: Record<string, unknown> | null;
}

export const logActivity = async ({
  eventType,
  actorUserRandId = null,
  actorTenantRandId = null,
  targetType = null,
  targetRandId = null,
  oauthClientId = null,
  ipAddress = null,
  userAgent = null,
  payload = null,
}: ActivityEntry): Promise<void> => {
  const repo = AuthDataSource.getRepository(ActivityEntity);
  const row = repo.create({
    randId: randomId(16),
    eventType,
    actorUserRandId,
    actorTenantRandId,
    targetType,
    targetRandId,
    oauthClientId,
    ipAddress,
    userAgent,
    payload,
  });

  await repo.save(row);
};
