import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { createRequire } from 'module';

const TAILWIND_INPUT = '@tailwind base;\n@tailwind components;\n@tailwind utilities;';
const TAILWIND_SUFFIX = '__tw';
const TAILWIND_CONFIG_NAMES = [
  'tailwind.config',
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
  'tailwind.config.json',
];

const requireFn = createRequire(import.meta.url);

const normalizeConfigName = (value: string) =>
  value.replace(/\\/g, '/').split('/').filter(Boolean).pop()?.toLowerCase() ?? '';

export const getTailwindPackageName = (name: string) => `${name}${TAILWIND_SUFFIX}`;

export const isTailwindPackageName = (name: string) => name.endsWith(TAILWIND_SUFFIX);

export const isTailwindConfigName = (name: string) =>
  TAILWIND_CONFIG_NAMES.includes(normalizeConfigName(name));

export const isTailwindConfigPath = (path: string) =>
  TAILWIND_CONFIG_NAMES.includes(normalizeConfigName(path));

export const shouldBuildTailwind = (fileExtension?: string) =>
  (fileExtension ?? 'jsx').toLowerCase() !== 'css';

export const ensureTailwindDependency = (deps: string[], tailwindName: string) => {
  const filtered = deps.filter((dep) => dep !== tailwindName);
  return [...filtered, tailwindName];
};

export const stripTailwindDependency = (deps: string[], tailwindName: string) =>
  deps.filter((dep) => dep !== tailwindName);

export type TailwindSource = { raw: string; extension: string };

export const parseTailwindConfig = (source: string) => {
  const trimmed = (source ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  try {
    const module = { exports: {} as any };
    const exportReady = trimmed.replace(/export default\s+/g, 'module.exports = ');
    // eslint-disable-next-line no-new-func
    const factory = new Function('module', 'exports', 'require', exportReady);
    factory(module, module.exports, requireFn);
    const resolved = (module.exports as any)?.default ?? module.exports;
    if (!resolved || typeof resolved !== 'object') return null;
    return resolved;
  } catch {
    return null;
  }
};

export const buildTailwindCss = async (
  source: string | TailwindSource[],
  extension?: string,
  config?: Record<string, any> | null
): Promise<string> => {
  const envPreflight = process.env.TAILWIND_PREFLIGHT;
  const sources = Array.isArray(source)
    ? source
        .filter((item) => item && typeof item.raw === 'string')
        .map((item) => ({
          raw: item.raw,
          extension: (item.extension || 'jsx').replace(/^\./, '').toLowerCase(),
        }))
    : [
        {
          raw: source,
          extension: (extension || 'jsx').replace(/^\./, '').toLowerCase(),
        },
      ];

  const corePlugins = {
    ...(config?.corePlugins ?? {}),
  } as Record<string, any>;
  if (envPreflight === 'true') corePlugins.preflight = true;
  if (envPreflight === 'false') corePlugins.preflight = false;

  const resolvedConfig = {
    ...(config ?? {}),
    content: sources.map((item) => ({
      raw: item.raw,
      extension: item.extension,
    })),
    corePlugins,
  };
  const { default: cssnano } = await import('cssnano');
  const result = await postcss([
    tailwindcss(resolvedConfig),
    autoprefixer(),
    cssnano({ preset: 'default' }),
  ]).process(TAILWIND_INPUT, { from: undefined });
  return result.css;
};
