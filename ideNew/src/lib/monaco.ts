import { loader } from '@monaco-editor/react';

const publicBase = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
const monacoBasePath = `${publicBase}/monaco`;

type MonacoWithTypes = typeof import('monaco-editor');

const configureMonaco = () => {
  // Point Monaco at the bundled assets in /public/monaco instead of the default CDN.
  loader.config({
    paths: {
      vs: `${monacoBasePath}/vs`,
    },
  });

  // Configure Monaco once it's ready so JSX/JS, CSS, and HTML work without a CDN.
  loader.init().then((monaco) => {
    const monacoWithTypes = monaco as MonacoWithTypes;
    const typescript = monacoWithTypes.languages?.typescript as any;

    if (!typescript) return;

    typescript.javascriptDefaults.setCompilerOptions({
      allowJs: true,
      allowNonTsExtensions: true,
      checkJs: false,
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2020,
    });
    typescript.javascriptDefaults.setEagerModelSync(true);
    typescript.typescriptDefaults.setCompilerOptions({
      allowNonTsExtensions: true,
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2020,
    });
    typescript.typescriptDefaults.setEagerModelSync(true);
  });
};

if (typeof window !== 'undefined') {
  configureMonaco();
}

export { loader, monacoBasePath };
