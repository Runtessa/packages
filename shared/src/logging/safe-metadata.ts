const redacted = '[REDACTED]';
const sensitive = /password|passwd|secret|token|authorization|cookie|credential|apikey|privatekey|csrf|saml|assertion|codeverifier|codechallenge/;
const rawPayload = new Set(['body', 'query', 'headers', 'payload', 'parameters', 'stack', 'cause', 'drivererror', 'request', 'response']);

export const safeLogPath = (value: string): string => {
  try {
    const url = new URL(value, 'http://log.invalid');
    return url.pathname.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512);
  } catch {
    return '[invalid path]';
  }
};

// Metadata is structured context, never a container for raw requests or errors.
// Bound recursion and avoid invoking getters or serialization hooks.
export const safeLogMetadata = (value: unknown): unknown => {
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item : null;
    if (typeof item === 'string') return item.slice(0, 512);
    if (typeof item !== 'object') return null;
    if (depth > 6 || seen.has(item)) return '[omitted]';
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return '[omitted]';
    seen.add(item);
    if (Array.isArray(item)) return Array.from({ length: Math.min(item.length, 50) }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
      return descriptor && 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[omitted]';
    });
    const output: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item)).slice(0, 50)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Presence flags carry no credential value and remain useful for auth failures.
      if ((sensitive.test(normalized) && !(normalized.startsWith('has') && typeof descriptor.value === 'boolean')) || rawPayload.has(normalized)) {
        output[key] = redacted;
      } else if ('value' in descriptor) {
        output[key] = /^(path|url|redirecturi|uri)$/.test(normalized) && typeof descriptor.value === 'string'
          ? safeLogPath(descriptor.value) : visit(descriptor.value, depth + 1);
      }
    }
    return output;
  };
  return visit(value, 0);
};
