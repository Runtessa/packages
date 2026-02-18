export const DASHBOARD_UI_NAME = '@app/dashboard';

const UI_FORBIDDEN_IMPORTS = ['@app/runtime', 'typeorm'];
const MODULE_FORBIDDEN_IMPORTS = ['adapters'];
const KERNEL_API_CLIENT_MODULE = '@app/datacontext';
const MOCK_DATA_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bmock\s*data\b/i, label: 'mock data' },
  { pattern: /\bdummy\s*data\b/i, label: 'dummy data' },
  { pattern: /\bfake\s*data\b/i, label: 'fake data' },
  { pattern: /\bsample\s*data\b/i, label: 'sample data' },
  { pattern: /\bplaceholder\s*data\b/i, label: 'placeholder data' },
  { pattern: /\bTODO\b[^\n]*\bmock\b/i, label: 'TODO mock marker' },
  { pattern: /\bFIXME\b[^\n]*\bmock\b/i, label: 'FIXME mock marker' },
];

export const assertNoMockData = (code: string, scopeLabel: string) => {
  for (const entry of MOCK_DATA_PATTERNS) {
    if (entry.pattern.test(code)) {
      throw new Error(
        `${scopeLabel} must not include ${entry.label}. No mock data is allowed; build a real full-stack flow (backend + models + ACL + UI).`,
      );
    }
  }
};

const hasKernelClientImport = (code: string) =>
  /from\s+['"]@app\/datacontext['"]/m.test(code) ||
  /require\(\s*['"]@app\/datacontext['"]\s*\)/m.test(code);

const hasKernelClientUsage = (code: string) =>
  /\buseApiClient\s*\(/m.test(code) || /\bgetApiClient\s*\(/m.test(code);

export const assertUiCodeIsRuntimeSafe = (code: string) => {
  assertNoMockData(code, 'UI code');
  for (const specifier of UI_FORBIDDEN_IMPORTS) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const importPattern = new RegExp(
      `(?:import\\s+[^;]*?from\\s+['"]${escaped}['"]|require\\(\\s*['"]${escaped}['"]\\s*\\))`,
      'm',
    );
    if (importPattern.test(code)) {
      throw new Error(
        `UI packages cannot import "${specifier}". Use backend modules for adapters/ORM logic and call API endpoints from UI.`,
      );
    }
  }
  const directNetworkPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bfetch\s*\(/m, label: 'fetch(...)' },
    { pattern: /\baxios\b/m, label: 'axios' },
    { pattern: /\bXMLHttpRequest\b/m, label: 'XMLHttpRequest' },
  ];
  for (const entry of directNetworkPatterns) {
    if (entry.pattern.test(code)) {
      throw new Error(
        `UI packages must use the kernel API client from "${KERNEL_API_CLIENT_MODULE}". Direct network usage (${entry.label}) is not allowed.`,
      );
    }
  }
  const mentionsApiPath = /(['"`])\/api\/[^'"`\s]+/m.test(code);
  if (mentionsApiPath) {
    if (!hasKernelClientImport(code) || !hasKernelClientUsage(code)) {
      throw new Error(
        `UI packages that call /api/* must import and use "${KERNEL_API_CLIENT_MODULE}" (useApiClient/getApiClient).`,
      );
    }
  }
};

export const assertBackendModuleContract = (code: string) => {
  assertNoMockData(code, 'Backend module code');
  for (const specifier of MODULE_FORBIDDEN_IMPORTS) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const importPattern = new RegExp(
      `(?:import\\s+[^;]*?from\\s+['"]${escaped}['"]|require\\(\\s*['"]${escaped}['"]\\s*\\))`,
      'm',
    );
    if (importPattern.test(code)) {
      throw new Error(
        `Backend modules must not import "${specifier}". Use the injected adapters argument: module.exports = async function handler(req, adapters) { ... }.`,
      );
    }
  }
  const directDbAdapterPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\badapters\.postgres\b/m, label: 'adapters.postgres' },
    { pattern: /\badapters\.mysql\b/m, label: 'adapters.mysql' },
    { pattern: /\badapters\.mssql\b/m, label: 'adapters.mssql' },
  ];
  for (const entry of directDbAdapterPatterns) {
    if (entry.pattern.test(code)) {
      throw new Error(
        `Direct DB adapter usage (${entry.label}) is not allowed in backend modules. Use adapters.orm('<adapter:key>') only.`,
      );
    }
  }
  const directDbLibraryPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /require\(\s*['"]pg['"]\s*\)/m, label: 'pg' },
    { pattern: /require\(\s*['"]mysql2?['"]\s*\)/m, label: 'mysql/mysql2' },
    { pattern: /require\(\s*['"]mssql['"]\s*\)/m, label: 'mssql' },
    { pattern: /require\(\s*['"]typeorm['"]\s*\)/m, label: 'typeorm' },
    { pattern: /from\s+['"]pg['"]/m, label: 'pg' },
    { pattern: /from\s+['"]mysql2?['"]/m, label: 'mysql/mysql2' },
    { pattern: /from\s+['"]mssql['"]/m, label: 'mssql' },
    { pattern: /from\s+['"]typeorm['"]/m, label: 'typeorm' },
  ];
  for (const entry of directDbLibraryPatterns) {
    if (entry.pattern.test(code)) {
      throw new Error(
        `Direct DB library import (${entry.label}) is not allowed in backend modules. Use adapters.orm('<adapter:key>') only.`,
      );
    }
  }
  if (!/module\.exports\s*=/m.test(code)) {
    throw new Error(
      'Backend module must export a CommonJS handler via module.exports = async function handler(req, adapters) { ... }.',
    );
  }
  if (!/\(\s*req\s*,\s*adapters\s*\)/m.test(code)) {
    throw new Error('Backend module handler must accept (req, adapters) parameters.');
  }

  const ormCallPattern = /\badapters\.orm\s*\(([^)]*)\)/g;
  let ormCallMatch: RegExpExecArray | null = ormCallPattern.exec(code);
  while (ormCallMatch) {
    const argRaw = String(ormCallMatch[1] ?? '').trim();
    const stringLiteral = argRaw.match(/^['"]([^'"]+)['"]$/);
    if (!stringLiteral?.[1]) {
      throw new Error(
        'Backend modules must call adapters.orm with a string key in "<database>:<key>" format (example: await adapters.orm("postgres:pga1")).',
      );
    }
    const ormKey = stringLiteral[1].trim();
    if (!ormKey.includes(':')) {
      throw new Error(
        `Invalid adapters.orm key "${ormKey}". Use "<database>:<key>" format (example: "postgres:pga1").`,
      );
    }
    if (/^pga\d+$/i.test(ormKey)) {
      throw new Error(
        `Invalid adapters.orm key "${ormKey}". Bare keys are not allowed; use "<database>:<key>" (example: "postgres:${ormKey}").`,
      );
    }
    const before = code.slice(Math.max(0, ormCallMatch.index - 48), ormCallMatch.index);
    if (!/\bawait\s*$/m.test(before)) {
      throw new Error(
        'adapters.orm(...) must be awaited. Use "await adapters.orm(\'<database>:<key>\')" before using repository/dataSource.',
      );
    }
    ormCallMatch = ormCallPattern.exec(code);
  }
};

export const assertDashboardEntrypointCode = (name: string, code: string) => {
  if (name !== DASHBOARD_UI_NAME) return;
  if (!/export\s+function\s+App\s*\(/m.test(code)) {
    throw new Error('Entrypoint UI package "@app/dashboard" must export a named function App().');
  }
  if (/export\s+default\s+/m.test(code)) {
    throw new Error(
      'Entrypoint UI package "@app/dashboard" cannot use default export. Use "export function App()".',
    );
  }
  if (!hasKernelClientImport(code) || !hasKernelClientUsage(code)) {
    throw new Error(
      `Entrypoint UI package "${DASHBOARD_UI_NAME}" must import and use "${KERNEL_API_CLIENT_MODULE}" (useApiClient/getApiClient).`,
    );
  }
};

export const assertNonDashboardDoesNotDefineAppEntrypoint = (name: string, code: string) => {
  if (name === DASHBOARD_UI_NAME) return;
  if (
    /export\s+function\s+App\s*\(/m.test(code) ||
    /export\s+default\s+function\s+App\s*\(/m.test(code)
  ) {
    throw new Error(
      'Only "@app/dashboard" may define/export App(). Create reusable components in other packages and import them into @app/dashboard.',
    );
  }
};

export const assertOrmModelDecoratorNotation = (code: string) => {
  assertNoMockData(code, 'ORM model code');
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error('Model code cannot be empty.');
  }
  if (/^[\[{]/.test(trimmed)) {
    throw new Error('Model must be JavaScript class code with TypeORM decorators, not JSON.');
  }
  if (!/@Entity\s*\(/m.test(code)) {
    throw new Error('Model must include @Entity(...) decorator.');
  }
  if (!/\bclass\s+[A-Za-z_$][\w$]*\b/m.test(code)) {
    throw new Error('Model must declare at least one class.');
  }
  if (!/@(?:PrimaryGeneratedColumn|PrimaryColumn|Column|CreateDateColumn|UpdateDateColumn)\s*\(/m.test(code)) {
    throw new Error(
      'Model must include at least one TypeORM field decorator such as @PrimaryGeneratedColumn or @Column.',
    );
  }
  if (!/require\(\s*['"]typeorm['"]\s*\)/m.test(code) && !/from\s+['"]typeorm['"]/m.test(code)) {
    throw new Error('Model must import TypeORM decorators from "typeorm".');
  }
  if (!/module\.exports\s*=/m.test(code)) {
    throw new Error('Model must export class(es) using module.exports = { ... }.');
  }
};
