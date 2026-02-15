const splitCsv = (raw) => {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
};

const devOrigins = Array.from(
  new Set([
    ...splitCsv(process.env.AUTH_ALLOWED_ORIGINS),
    (process.env.AUTH_BASE_URL || '').trim(),
    `http://0.0.0.0:${process.env.AUTH_PORT || '3015'}`,
  ].filter(Boolean)),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: devOrigins,
};

export default nextConfig;
