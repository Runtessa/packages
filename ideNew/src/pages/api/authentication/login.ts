import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '../../../lib/api-helpers';
import { authenticateUser, createLoginSession } from '../../../lib/auth';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const user = await authenticateUser({ email, password });
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const sessionToken = await createLoginSession(user.id);
  res.status(200).json({ sessionToken, user });
});
