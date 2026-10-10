export type SafeErrorFrame = { file: string; line: number; column: number; method?: string };
export type SafeErrorMeta = { name: string; frames: SafeErrorFrame[] };

// Exception messages, causes, SQL and parameters can contain user input or credentials.
// Keep only known error classes and source locations for diagnostics.
const knownNames = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'URIError', 'EvalError', 'AggregateError', 'QueryFailedError', 'AppError',
]);

export const safeErrorMeta = (error: unknown): SafeErrorMeta | null => {
  if (!error) return null;
  if (!(error instanceof Error)) return { name: 'Error', frames: [] };
  let stack: string, name: string;
  try {
    stack = typeof error.stack === 'string' ? error.stack.slice(0, 32768) : '';
    name = knownNames.has(error.name) ? error.name : 'Error';
  } catch { return { name: 'Error', frames: [] }; }
  const frames: SafeErrorFrame[] = [];
  for (const line of stack.split('\n').slice(1, 51)) {
    const match = line.match(/^\s*at\s+(?:(.*?)\s+\()?((?:\/|[A-Za-z]:\\|file:\/\/|node:)[^\s()?\x00-\x1f]+):(\d+):(\d+)\)?$/);
    if (!match) continue;
    const [, method, file, row, column] = match;
    frames.push({
      file, line: Number(row), column: Number(column),
      ...(method && /^[A-Za-z0-9_.$<> ]{1,120}$/.test(method) ? { method } : {}),
    });
  }
  return { name, frames };
};
