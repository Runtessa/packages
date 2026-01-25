import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { User } from '@/lib/entities/User';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    const user = await requireUser(req);
    res.status(200).json({ user });
    return;
  }

  if (req.method === 'PUT') {
    const user = await requireUser(req);
    const { email, password } = req.body || {};
    const cleanEmail = (email || '').trim();

    if (!cleanEmail && !password) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }

    await ensureSchema();
    const repo = AppDataSource.getRepository(User);
    const current = await repo.findOne({ where: { id: user.id } });
    if (!current) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (cleanEmail) {
      const existing = await repo.findOne({ where: { email: cleanEmail } });
      if (existing && existing.id !== user.id) {
        res.status(409).json({ error: 'Email already in use' });
        return;
      }
      current.email = cleanEmail;
    }
    if (password) {
      const passwordHash = await hashPassword(password);
      current.passwordHash = passwordHash;
    }

    const saved = await repo.save(current);
    res.status(200).json({ user: { ...saved, isAdmin: saved.role === 'admin' } });
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT']);
  res.status(405).end();
});
