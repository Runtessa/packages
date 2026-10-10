export const normalizePath = (value: string) => {
  const raw = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  const stack: string[] = [];
  parts.forEach((part) => {
    if (part === '.' || part === '') return;
    if (part === '..') {
      stack.pop();
      return;
    }
    stack.push(part);
  });
  return stack.join('/');
};
export const ensureJsExtension = (value: string) => {
  if (!value) return '';
  const extMatch = value.match(/\.([^.\/]+)$/);
  if (!extMatch) return `${value}.js`;
  const ext = extMatch[1]?.toLowerCase();
  if (ext !== 'js') {
    return value.replace(/\.[^.\/]+$/, '.js');
  }
  return value;
};

const EXTENSIONS = ['.js'];

export const findKeyInsensitive = (value: string, moduleMap: Map<string, string>) => {
  const target = value.toLowerCase();
  for (const key of moduleMap.keys()) {
    if (key.toLowerCase() === target) return key;
  }
  return null;
};

export const findByBasename = (name: string, moduleMap: Map<string, string>) => {
  if (!name) return null;
  const baseName = name.split('/').pop() || name;
  const baseNoExt = baseName.replace(/\.[^.]+$/, '');
  const matches: string[] = [];
  for (const key of moduleMap.keys()) {
    const keyBase = key.split('/').pop() || key;
    const keyBaseNoExt = keyBase.replace(/\.[^.]+$/, '');
    if (
      keyBase === baseName ||
      keyBaseNoExt === baseNoExt ||
      keyBase.toLowerCase() === baseName.toLowerCase() ||
      keyBaseNoExt.toLowerCase() === baseNoExt.toLowerCase()
    ) {
      matches.push(key);
    }
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const exact = matches.find((key) => (key.split('/').pop() || key) === baseName);
    return exact ?? matches[0];
  }
  return null;
};

export const resolveModule = (request: string, from: string, moduleMap: Map<string, string>) => {
  const raw = String(request || '').trim();
  if (!raw) return '';
  const normalizedBare = normalizePath(raw);
  const resolveBare = () => {
    if (!normalizedBare) return null;
    if (moduleMap.has(normalizedBare)) return normalizedBare;
    const insensitive = findKeyInsensitive(normalizedBare, moduleMap);
    if (insensitive) return insensitive;
    for (const ext of EXTENSIONS) {
      if (moduleMap.has(normalizedBare + ext)) return normalizedBare + ext;
      const insensitiveExt = findKeyInsensitive(normalizedBare + ext, moduleMap);
      if (insensitiveExt) return insensitiveExt;
    }
    const baseNoExt = normalizedBare.replace(/\.[^.]+$/, '');
    if (baseNoExt && baseNoExt !== normalizedBare) {
      for (const ext of EXTENSIONS) {
        if (moduleMap.has(baseNoExt + ext)) return baseNoExt + ext;
        const insensitiveBase = findKeyInsensitive(baseNoExt + ext, moduleMap);
        if (insensitiveBase) return insensitiveBase;
      }
    }
    const byBasename = findByBasename(normalizedBare, moduleMap);
    if (byBasename) return byBasename;
    return null;
  };
  if (!raw.startsWith('.') && !raw.startsWith('/')) {
    const resolvedBare = resolveBare();
    return resolvedBare ?? raw;
  }
  const baseParts = from ? normalizePath(from).split('/').slice(0, -1) : [];
  const targetParts = raw.startsWith('/') ? raw.split('/') : baseParts.concat(raw.split('/'));
  const normalized = normalizePath(targetParts.join('/'));
  if (moduleMap.has(normalized)) return normalized;
  const insensitive = findKeyInsensitive(normalized, moduleMap);
  if (insensitive) return insensitive;
  for (const ext of EXTENSIONS) {
    if (moduleMap.has(normalized + ext)) return normalized + ext;
    const insensitiveExt = findKeyInsensitive(normalized + ext, moduleMap);
    if (insensitiveExt) return insensitiveExt;
  }
  const normalizedNoExt = normalized.replace(/\.[^.]+$/, '');
  if (normalizedNoExt && normalizedNoExt !== normalized) {
    for (const ext of EXTENSIONS) {
      if (moduleMap.has(normalizedNoExt + ext)) return normalizedNoExt + ext;
      const insensitiveNoExt = findKeyInsensitive(normalizedNoExt + ext, moduleMap);
      if (insensitiveNoExt) return insensitiveNoExt;
    }
  }
  const fallback = findByBasename(normalized, moduleMap);
  if (fallback) return fallback;
  return normalized;
};
