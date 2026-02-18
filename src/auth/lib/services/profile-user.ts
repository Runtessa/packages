import { findCurrentUserByRandId } from './versioning';

export const readCurrentUser = async (userRandId: string) => {
  const user = await findCurrentUserByRandId(userRandId);
  if (!user) {
    const error = new Error('User not found');
    (error as Error & { statusCode: number }).statusCode = 404;
    throw error;
  }
  return user;
};
