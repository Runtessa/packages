import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { User } from '@/lib/entities/User';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    await requireAdmin(req);
    await ensureSchema();
    const repo = AppDataSource.getRepository(User);
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const [users, total] = await repo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit
    });

    res.status(200).json({ users, total });
    return;
  }

  if (req.method === 'POST') {
    await requireAdmin(req);
    const { email, token, role = 'user', password } = req.body || {};
    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }
    if (!['admin', 'user'].includes(role)) {
      res.status(400).json({ error: 'role must be admin or user' });
      return;
    }

    await ensureSchema();
    const repo = AppDataSource.getRepository(User);
    const apiToken = token || crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(password);

    let user = await repo.findOne({ where: { email } });
    if (!user) {
      user = repo.create({ email, token: apiToken, passwordHash, role });
    } else {
      user.token = apiToken;
      user.passwordHash = passwordHash;
      user.role = role;
    }

    await repo.save(user);

    res.status(201).json({ user: { email: user.email, role: user.role, token: user.token } });
    return;
  }

  if (req.method === 'PUT') {
    await requireAdmin(req);
    const { email, token, role, password } = req.body || {};
    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }
    const updates: string[] = [];
    const values: any[] = [];

    if (role) {
      if (!['admin', 'user'].includes(role)) {
        res.status(400).json({ error: 'role must be admin or user' });
        return;
      }
      updates.push(`role = $${values.length + 1}`);
      values.push(role);
    }

    if (token) {
      updates.push(`token = $${values.length + 1}`);
      values.push(token);
    }

    if (password) {
      const passwordHash = await hashPassword(password);
      updates.push(`password_hash = $${values.length + 1}`);
      values.push(passwordHash);
    }

    if (!updates.length) {
      res.status(400).json({ error: 'nothing to update' });
      return;
    }

    await ensureSchema();
    const repo = AppDataSource.getRepository(User);
    const existing = await repo.findOne({ where: { email } });
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (role) {
      existing.role = role;
    }
    if (token) {
      existing.token = token;
    }
    if (password) {
      const passwordHash = await hashPassword(password);
      existing.passwordHash = passwordHash;
    }

    const saved = await repo.save(existing);
    res.status(200).json({
      user: { email: saved.email, role: saved.role, token: saved.token, createdAt: saved.createdAt }
    });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST', 'PUT']);
  res.status(405).end();
});
