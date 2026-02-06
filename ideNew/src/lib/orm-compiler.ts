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
  return result.outputText || source;
};
