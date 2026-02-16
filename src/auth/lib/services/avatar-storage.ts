import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const AVATAR_ROOT_SEGMENTS = ['uploads', 'avatars'] as const;
const AVATAR_PUBLIC_PREFIX = `/${AVATAR_ROOT_SEGMENTS.join('/')}/`;
const AVATAR_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

const publicRootDir = path.resolve(__dirname, '..', '..', 'public');
const avatarRootDir = path.resolve(publicRootDir, ...AVATAR_ROOT_SEGMENTS);

const badRequest = (message: string): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
};

const unsupportedMedia = (message: string): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 415;
  return error;
};

const sanitizeUserSegment = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);

const normalizeAvatarUrl = (value: string): string => value.trim().split('?')[0]?.split('#')[0] || '';

const absolutePathForManagedAvatar = (avatarUrl: string): string | null => {
  const normalized = normalizeAvatarUrl(avatarUrl);
  if (!normalized.startsWith(AVATAR_PUBLIC_PREFIX)) return null;
  const relativePath = normalized.slice(1);
  if (!relativePath) return null;
  const absolutePath = path.resolve(publicRootDir, relativePath);
  const prefix = `${avatarRootDir}${path.sep}`;
  if (absolutePath !== avatarRootDir && !absolutePath.startsWith(prefix)) return null;
  return absolutePath;
};

export const isSupportedAvatarMime = (mimeType: string): boolean =>
  Object.prototype.hasOwnProperty.call(AVATAR_MIME_TO_EXT, mimeType);

export const isManagedAvatarUrl = (value: unknown): boolean =>
  typeof value === 'string' && absolutePathForManagedAvatar(value) !== null;

export const saveAvatarToDisk = async (userRandId: string, image: Buffer, mimeType: string): Promise<string> => {
  const ext = AVATAR_MIME_TO_EXT[mimeType];
  if (!ext) {
    throw unsupportedMedia('Avatar file type is not supported');
  }

  if (!image.length) {
    throw badRequest('Avatar file is empty');
  }

  const userSegment = sanitizeUserSegment(userRandId);
  if (!userSegment) {
    throw badRequest('Invalid avatar owner');
  }

  const userDir = path.join(avatarRootDir, userSegment);
  await fs.mkdir(userDir, { recursive: true });

  const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const diskPath = path.join(userDir, fileName);
  await fs.writeFile(diskPath, image);

  return `${AVATAR_PUBLIC_PREFIX}${userSegment}/${fileName}`;
};

export const saveAvatarDataUrlToDisk = async (
  userRandId: string,
  dataUrl: string,
  maxBytes: number,
): Promise<string> => {
  const raw = String(dataUrl || '').trim();
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(raw);
  if (!match) {
    throw badRequest('Avatar data URL is invalid');
  }

  const mimeType = match[1].toLowerCase();
  if (!isSupportedAvatarMime(mimeType)) {
    throw unsupportedMedia('Avatar file type is not supported');
  }

  let image: Buffer;
  try {
    image = Buffer.from(match[2], 'base64');
  } catch {
    throw badRequest('Avatar data URL is invalid');
  }

  if (!image.length) {
    throw badRequest('Avatar file is empty');
  }
  if (image.length > maxBytes) {
    const error = new Error('Avatar file is too large. Maximum size is 2 MB.') as Error & { statusCode: number };
    error.statusCode = 413;
    throw error;
  }

  return saveAvatarToDisk(userRandId, image, mimeType);
};

export const removeManagedAvatarFromDisk = async (avatarUrl: string | null | undefined): Promise<void> => {
  if (!avatarUrl) return;
  const filePath = absolutePathForManagedAvatar(avatarUrl);
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
};
