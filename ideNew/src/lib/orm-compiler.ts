import ts from 'typescript';

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2019,
  esModuleInterop: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  allowJs: true,
};

const normalizeExt = (value?: string) => value?.replace(/^\./, '').toLowerCase() ?? '';

export const compileOrmSource = (source: string, fileExtension?: string) => {
  const ext = normalizeExt(fileExtension);
  if (ext && ext !== 'js') {
    throw new Error('Only .js model files are supported.');
  }
  const result = ts.transpileModule(source, {
    compilerOptions,
    fileName: 'model.js',
  });
  const diagnostics = result.diagnostics ?? [];
  const errors = diagnostics.filter(
    (diag) => diag.category === ts.DiagnosticCategory.Error
  );
  if (errors.length) {
    const host: ts.FormatDiagnosticsHost = {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    };
    const formatted = ts
      .formatDiagnosticsWithColorAndContext(errors, host)
      .replace(/\x1B\[[0-9;]*m/g, '');
    throw new Error(`Model compile error:\n${formatted}`);
  }
  return result.outputText || source;
};
