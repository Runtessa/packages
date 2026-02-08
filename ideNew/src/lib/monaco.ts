import { loader } from '@monaco-editor/react';

const publicBase = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
const monacoBasePath = `${publicBase}/monaco`;

type MonacoWithTypes = typeof import('monaco-editor/esm/vs/editor/editor.api');

const configureMonaco = () => {
  if (typeof window !== 'undefined') {
    (window as any).MonacoEnvironment = (window as any).MonacoEnvironment ?? {
      getWorkerUrl: (_moduleId: string, label: string) => {
        const base = `${monacoBasePath}/vs`;
        if (label === 'typescript' || label === 'javascript') {
          return `${base}/language/typescript/ts.worker.js`;
        }
        if (label === 'json') return `${base}/language/json/json.worker.js`;
        if (label === 'css' || label === 'scss' || label === 'less') {
          return `${base}/language/css/css.worker.js`;
        }
        if (label === 'html' || label === 'handlebars' || label === 'razor') {
          return `${base}/language/html/html.worker.js`;
        }
        return `${base}/editor/editor.worker.js`;
      },
    };
  }

  // Point Monaco at the bundled assets in /public/monaco instead of the default CDN.
  loader.config({
    paths: {
      vs: `${monacoBasePath}/vs`,
    },
  });

  // Configure Monaco once it's ready so JSX/JS, CSS, and HTML work without a CDN.
  loader.init().then((monaco) => {
    const monacoWithTypes = monaco as unknown as MonacoWithTypes;
    const typescript = monacoWithTypes.languages?.typescript as any;

    if (!typescript) return;

    const idpTypes = `
declare var module: { exports: any };
declare var exports: any;
declare function require(id: string): any;
declare namespace Idp {
  interface HttpRequest {
    body?: any;
    query?: Record<string, any>;
    params?: Record<string, any>;
    headers?: Record<string, string>;
    method?: string;
    user?: any;
    tenant?: any;
  }
  interface HttpResponse {
    statusCode: number;
    body: any;
    headers?: Record<string, string>;
  }
  interface ReadWriteFactory<T> {
    (key: string): Promise<T>;
    readOnly: (key: string) => Promise<T>;
    readWrite: (key: string) => Promise<T>;
  }
  interface PostgresAdapter {
    query: (sql: string, params?: any[]) => Promise<any[]>;
  }
  interface MysqlAdapter {
    query: (sql: string, params?: any[]) => Promise<any[]>;
  }
  interface MssqlAdapter {
    query: (sql: string) => Promise<any[]>;
  }
  interface RedisAdapter {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, ttlSeconds?: number) => Promise<'OK'>;
    del: (key: string) => Promise<number>;
    publish: (channel: string, message: string) => Promise<number>;
  }
  interface KafkaAdapter {
    publish: (topic: string, messages: { key?: string; value: string }[]) => Promise<void>;
  }
  interface S3Adapter {
    putObject: (params: { bucket: string; key: string; body: Buffer | string }) => Promise<void>;
    getSignedUrl: (params: { bucket: string; key: string; expiresIn?: number }) => Promise<string>;
  }
  interface SharedModuleAdapter {
    require: (name: string, version?: string) => Promise<any>;
  }
  interface OrmAdapter {
    dataSource: any;
    entities: Record<string, any>;
    getRepository: (name: string) => any;
  }
  interface Adapters {
    postgres: ReadWriteFactory<PostgresAdapter>;
    mysql: ReadWriteFactory<MysqlAdapter>;
    mssql: ReadWriteFactory<MssqlAdapter>;
    orm: ReadWriteFactory<OrmAdapter>;
    redis: (envKey: string) => Promise<RedisAdapter>;
    kafka: (envKey: string) => Promise<KafkaAdapter>;
    s3: (envKey: string) => Promise<S3Adapter>;
    shared: SharedModuleAdapter;
    http?: {
      request: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: any; timeoutMs?: number }) => Promise<{ statusCode: number; headers: Record<string, string | string[]>; body: string }>;
    };
    compiler?: any;
  }
}
type IdpRequest = Idp.HttpRequest;
type IdpAdapters = Idp.Adapters;
type IdpResponse = Idp.HttpResponse;
type IdpModuleHandler = (req: IdpRequest, adapters: IdpAdapters) => Promise<IdpResponse>;
`;

    const uiTypes = `
declare module 'react' {
  export const useState: any;
  export const useEffect: any;
  export const useMemo: any;
  export const useCallback: any;
  export const useRef: any;
  export const useContext: any;
  export const useReducer: any;
  export const useLayoutEffect: any;
  export const useId: any;
  export const memo: any;
  export const createElement: any;
  export const Fragment: any;
  const React: any;
  export default React;
}
declare module 'react-dom' {
  export const render: any;
  export const createPortal: any;
  const ReactDOM: any;
  export default ReactDOM;
}
declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}
declare module 'react/jsx-dev-runtime' {
  export const jsxDEV: any;
  export const Fragment: any;
}
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
declare module '@shared/*' {
  const mod: any;
  export = mod;
}
declare module '@app/runtime' {
  // Backend runtime helpers are not available inside UI entities.
}
declare module '@app/datacontext' {
  export const DataContext: any;
  export const DataProvider: any;
  export const useDataContext: () => {
    api: {
      request: (path: string, options?: any) => Promise<any>;
      get: (path: string, options?: any) => Promise<any>;
      post: (path: string, body?: any, options?: any) => Promise<any>;
      put: (path: string, body?: any, options?: any) => Promise<any>;
      del: (path: string, options?: any) => Promise<any>;
    };
    tenantHost: string | null;
    previewMode: boolean;
    getToken: () => string | null;
  };
  export const useApiClient: () => {
    request: (path: string, options?: any) => Promise<any>;
    get: (path: string, options?: any) => Promise<any>;
    post: (path: string, body?: any, options?: any) => Promise<any>;
    put: (path: string, body?: any, options?: any) => Promise<any>;
    del: (path: string, options?: any) => Promise<any>;
  };
  export const getApiClient: () => ReturnType<typeof useApiClient>;
  export const api: ReturnType<typeof useApiClient>;
  const _default: {
    DataContext: any;
    DataProvider: any;
    useDataContext: typeof useDataContext;
    useApiClient: typeof useApiClient;
    getApiClient: typeof getApiClient;
    api: typeof api;
  };
  export default _default;
}
declare module 'adapters' {
  // Adapters must come from backend module handler arg: (req, adapters)
}
declare module '@app/*' {
  const mod: any;
  export = mod;
}
declare module '*.css' {
  const mod: any;
  export = mod;
}
`;

    const typeormTypes = `
declare module 'typeorm' {
  export function Entity(options?: any): ClassDecorator;
  export function Column(options?: any): PropertyDecorator;
  export function PrimaryGeneratedColumn(strategy?: any): PropertyDecorator;
  export function PrimaryColumn(options?: any): PropertyDecorator;
  export function CreateDateColumn(options?: any): PropertyDecorator;
  export function UpdateDateColumn(options?: any): PropertyDecorator;
  export function ManyToOne(typeFn?: any, inverse?: any, options?: any): PropertyDecorator;
  export function OneToMany(typeFn?: any, inverse?: any, options?: any): PropertyDecorator;
  export function OneToOne(typeFn?: any, inverse?: any, options?: any): PropertyDecorator;
  export function JoinColumn(options?: any): PropertyDecorator;
  export function Index(options?: any): ClassDecorator & PropertyDecorator;
  export class DataSource {
    constructor(options: any);
    initialize(): Promise<DataSource>;
    destroy(): Promise<void>;
    synchronize(): Promise<void>;
    getRepository(entity: any): any;
  }
}
`;

    const libIdpUri = 'inmemory://model/idp-editor.d.ts';
    const libUiUri = 'inmemory://model/idp-ui.d.ts';
    const libTypeormUri = 'inmemory://model/typeorm-shim.d.ts';
    typescript.javascriptDefaults.addExtraLib(idpTypes, libIdpUri);
    typescript.javascriptDefaults.addExtraLib(uiTypes, libUiUri);
    typescript.javascriptDefaults.addExtraLib(typeormTypes, libTypeormUri);
    typescript.typescriptDefaults.addExtraLib(idpTypes, libIdpUri);
    typescript.typescriptDefaults.addExtraLib(uiTypes, libUiUri);
    typescript.typescriptDefaults.addExtraLib(typeormTypes, libTypeormUri);

    typescript.javascriptDefaults.setCompilerOptions({
      allowJs: true,
      allowNonTsExtensions: true,
      checkJs: false,
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      moduleResolution: typescript.ModuleResolutionKind.NodeJs,
      target: typescript.ScriptTarget.ES2020,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      useDefineForClassFields: false,
    });
    typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    typescript.javascriptDefaults.setEagerModelSync(true);
    typescript.typescriptDefaults.setCompilerOptions({
      allowNonTsExtensions: true,
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      moduleResolution: typescript.ModuleResolutionKind.NodeJs,
      target: typescript.ScriptTarget.ES2020,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      useDefineForClassFields: false,
    });
    typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    typescript.typescriptDefaults.setEagerModelSync(true);
  });
};

if (typeof window !== 'undefined') {
  configureMonaco();
}

export { loader, monacoBasePath };
