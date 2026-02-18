const parseEnvList = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
};

const parseEnvMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    const safeKey = String(key || '').trim();
    if (!safeKey) continue;
    result[safeKey] = String(raw ?? '');
  }
  return result;
};

const parseExtraServices = ({ pickEnv, sanitizeSegment, parseIntBounded, codexPublicHost }) => {
  const raw = pickEnv('CONTAINER_MANAGER_SERVICES_JSON', 'CONTAINER_AGENT_SERVICES_JSON') || '';
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const result = {};
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const key = sanitizeSegment(entry.key, 64);
      const image = String(entry.image || '').trim();
      const containerName = sanitizeSegment(entry.containerName, 64);
      if (!key || !image || !containerName) continue;
      const containerPort = parseIntBounded(entry.containerPort, 8080, 1, 65535);
      const hostPort = parseIntBounded(entry.hostPort, containerPort, 1, 65535);
      const protocol =
        String(entry.protocol || 'http').trim().toLowerCase() === 'https' ? 'https' : 'http';
      const publicHost = String(entry.publicHost || codexPublicHost()).trim() || codexPublicHost();
      const envMap = parseEnvMap(entry.envMap);
      const env = [...parseEnvList(entry.env), ...Object.entries(envMap).map(([k, v]) => `${k}=${v}`)];
      const binds = parseEnvList(entry.binds);
      const labels = parseEnvMap(entry.labels);
      result[key] = {
        key,
        image,
        containerName,
        containerPort,
        hostPort,
        protocol,
        publicHost,
        env,
        binds,
        labels,
      };
    }
    return result;
  } catch {
    return {};
  }
};

const parseQueryBool = (value, fallback, asBool) => {
  if (Array.isArray(value)) {
    return parseQueryBool(value[0], fallback, asBool);
  }
  if (typeof value !== 'string') return fallback;
  return asBool(value, fallback);
};

const formatContainerSummary = (row) => ({
  id: row.Id,
  names: row.Names,
  image: row.Image,
  imageId: row.ImageID,
  command: row.Command,
  created: row.Created,
  state: row.State,
  status: row.Status,
  labels: row.Labels,
  ports: row.Ports,
});

const readDockerLogBuffer = async (value) => {
  if (!value) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  if (typeof value.on === 'function') {
    const chunks = [];
    await new Promise((resolve, reject) => {
      value.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      });
      value.on('end', resolve);
      value.on('error', reject);
    });
    return Buffer.concat(chunks);
  }
  return Buffer.alloc(0);
};

const demuxDockerLogs = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return '';
  let offset = 0;
  const lines = [];
  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    const chunkLength = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > buffer.length) break;
    const payload = buffer.slice(start, end).toString('utf8');
    if (payload) {
      const prefix = streamType === 2 ? '[stderr] ' : streamType === 1 ? '[stdout] ' : '';
      lines.push(
        payload
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => `${prefix}${line}`)
          .join('\n')
      );
    }
    offset = end;
  }
  if (offset === 0) {
    return buffer.toString('utf8');
  }
  return lines.filter(Boolean).join('\n');
};

module.exports = {
  parseEnvList,
  parseEnvMap,
  parseExtraServices,
  parseQueryBool,
  formatContainerSummary,
  readDockerLogBuffer,
  demuxDockerLogs,
};
