import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { resolveTenant } from '@/lib/tenancy';
import { rollbackChanges } from '@/lib/assistant/tools';
import type { AssistantChange } from '@/lib/assistant/types';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  const user = await requireUser(req);
  const tenant = await resolveTenant(req);
  const { changes } = req.body ?? {};
  if (!Array.isArray(changes)) {
    const err = new Error('changes must be an array');
    (err as any).statusCode = 400;
    throw err;
  }

  const result = await rollbackChanges(changes as AssistantChange[], {
    tenant,
    userId: user.id,
    role: user.normalizedRole,
    permissions: user.permissions,
    isAdmin: user.isAdmin,
    changes: [],
  });

  res.status(200).json(result);
});
