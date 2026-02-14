import bcrypt from 'bcryptjs';

export const hashPassword = async (password: string): Promise<string> => {
  if (!password) throw new Error('Password is required');
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

export const verifyPassword = async (password: string, hash?: string | null): Promise<boolean> => {
  if (!hash) return false;
  return bcrypt.compare(password || '', hash);
};
