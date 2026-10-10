export const parseNpmRequestSpecifier = (
  request: string
): { installName: string; requestSpecifier: string; runtimeSpecifier: string } | null => {
  const normalized = String(request || '').trim();
  if (!normalized) return null;
  if (normalized.startsWith('.') || normalized.startsWith('/')) return null;
  if (
    normalized.includes('\0') ||
    normalized.includes('\\') ||
    normalized.includes('..') ||
    normalized.includes('?') ||
    normalized.includes('#')
  ) {
    return null;
  }

  if (normalized === 'react-router/dom') {
    return {
      installName: 'react-router-dom',
      requestSpecifier: normalized,
      runtimeSpecifier: 'react-router-dom',
    };
  }

  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return null;
  if (normalized.startsWith('@')) {
    if (parts.length < 2) return null;
    const scope = parts[0];
    const pkg = parts[1];
    if (!/^@[a-z0-9][a-z0-9._-]*$/i.test(scope)) return null;
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pkg)) return null;
    return {
      installName: `${scope}/${pkg}`,
      requestSpecifier: normalized,
      runtimeSpecifier: normalized,
    };
  }
  const pkg = parts[0];
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pkg)) return null;
  return {
    installName: pkg,
    requestSpecifier: normalized,
    runtimeSpecifier: normalized,
  };
};
