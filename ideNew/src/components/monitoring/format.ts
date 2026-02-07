export const fmtNum = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '0';

export const fmtDate = (value?: string) => (value ? new Date(value).toLocaleString() : '-');

export const fmtBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[idx]}`;
};

export const severityTone = (severity: string) => {
  if (severity === 'critical') return 'text-danger';
  if (severity === 'warning') return 'text-warning';
  return 'text-accent';
};
