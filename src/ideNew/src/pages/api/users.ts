import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { User } from '@idp/shared';
import { canAssignRole, listAssignableRoles, normalizeIdeRole } from '@/lib/rbac';

const RESERVED_ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();

const serializeUser = (user: User) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  token: user.token,
  createdAt: user.createdAt,
});

const ensureRoleAssignable = (actorRole: string, targetEmail: string, requestedRole: unknown) => {
  const role = normalizeIdeRole(requestedRole);
  const email = String(targetEmail || '').trim().toLowerCase();
  if (role === 'admin' && email !== RESERVED_ADMIN_EMAIL) {
    const err = new Error(`role "admin" is reserved for ${RESERVED_ADMIN_EMAIL}`);
    (err as any).statusCode = 400;
    throw err;
  }
  if (!canAssignRole(actorRole, role) && role !== normalizeIdeRole(actorRole)) {
    const err = new Error(`Role "${actorRole}" cannot assign "${role}"`);
    (err as any).statusCode = 403;
    throw err;
  }
  return role;
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    const actor = await requireAdmin(req);
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

    res.status(200).json({
      users: users.map(serializeUser),
      total,
      assignableRoles: listAssignableRoles(actor.normalizedRole),
    });
    return;
  }

  if (req.method === 'POST') {
    const actor = await requireAdmin(req);
    const { email, token, role = 'user', password } = req.body || {};
    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }
    const resolvedRole = ensureRoleAssignable(actor.role, email, role);

    await ensureSchema();
    const repo = AppDataSource.getRepository(User);
    const apiToken = token || crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(password);

    let user = await repo.findOne({ where: { email } });
    if (!user) {
      user = repo.create({ email, token: apiToken, passwordHash, role: resolvedRole });
    } else {
      user.token = apiToken;
      user.passwordHash = passwordHash;
      user.role = resolvedRole;
    }

    await repo.save(user);

    res.status(201).json({ user: serializeUser(user) });
    return;
  }

  if (req.method === 'PUT') {
    const actor = await requireAdmin(req);
    const { email, token, role, password } = req.body || {};
    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }
    const updates: string[] = [];
    const values: any[] = [];

    if (role) {
      const resolvedRole = ensureRoleAssignable(actor.role, email, role);
      updates.push(`role = $${values.length + 1}`);
      values.push(resolvedRole);
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
      existing.role = ensureRoleAssignable(actor.role, email, role);
    }
    if (token) {
      existing.token = token;
    }
    if (password) {
      const passwordHash = await hashPassword(password);
      existing.passwordHash = passwordHash;
    }

    const saved = await repo.save(existing);
    res.status(200).json({ user: serializeUser(saved) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST', 'PUT']);
  res.status(405).end();
});
