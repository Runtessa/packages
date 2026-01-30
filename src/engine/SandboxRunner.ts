import vm from 'vm';
import { SandboxAdapters } from './AdapterFactory';
import { AccountRole } from '@idp/shared';
import { AppError } from '../common/AppError';

export interface SandboxRequestContext {
  path: string;
  method: string;
  headers: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  params: Record<string, string>;
  tenant: {
    id: string;
    hostname: string;
    resourceConfig: {
      memory: number;
      timeout: number;
    };
  };
  account?: {
    id: string;
    email: string;
    role: AccountRole;
  };
}

export interface SandboxContext {
  request: SandboxRequestContext;
  adapters: SandboxAdapters;
}

export interface SandboxResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export class SandboxRunner {
  constructor(private readonly maxTimeoutMs = 30_000) {}

  async run(code: string, context: SandboxContext): Promise<SandboxResult> {
    const safeRequest = this.sanitizeRequest(context.request);
    const effectiveTimeout = this.resolveTimeout(safeRequest.tenant.resourceConfig);

    const frozenAdapters: SandboxAdapters = context.adapters;
    const frozenRequest = Object.freeze({ ...safeRequest }) as SandboxRequestContext;

    const sandboxGlobals: Record<string, unknown> = {
      request: frozenRequest,
      adapters: frozenAdapters,
      console,
    };
    Object.freeze(sandboxGlobals);

    const vmContext = vm.createContext(sandboxGlobals);
    const script = new vm.Script(
      `
        "use strict";
        const module = { exports: {} };
        const exports = module.exports;
        ${code}
        module.exports;
      `,
      { filename: 'tenant-module.js' },
    );

    let exported: unknown;
    try {
      exported = script.runInContext(vmContext, { timeout: effectiveTimeout });
    } catch (error) {
      throw new AppError(`Sandbox execution failed: ${(error as Error).message}`, 500);
    }

    const handler = this.resolveHandler(exported);
    if (typeof handler !== 'function') {
      throw new AppError('Module must export a function', 400);
    }

    try {
      const result = await Promise.race([
        Promise.resolve(handler(frozenRequest, frozenAdapters)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Execution timed out')), effectiveTimeout),
        ),
      ]);

      if (result && typeof result === 'object') {
        const typed = result as SandboxResult;
        return {
          statusCode: typed.statusCode ?? 200,
          headers: typed.headers,
          body: typed.body,
        };
      }

      return { statusCode: 200, body: result };
    } catch (error) {
      throw new AppError(`Module error: ${(error as Error).message}`, 500);
    }
  }

  private resolveHandler(exported: unknown): unknown {
    if (typeof exported === 'function') {
      return exported;
    }

    if (exported && typeof exported === 'object' && (exported as Record<string, unknown>).default) {
      return (exported as Record<string, unknown>).default;
    }

    return null;
  }

  private sanitizeRequest(request: SandboxRequestContext): SandboxRequestContext {
    return {
      path: request.path,
      method: request.method,
      headers: { ...request.headers },
      query: { ...request.query },
      body: request.body,
      params: { ...(request.params ?? {}) },
      tenant: {
        id: request.tenant.id,
        hostname: request.tenant.hostname,
        resourceConfig: { ...request.tenant.resourceConfig },
      },
      account: request.account
        ? {
            id: request.account.id,
            email: request.account.email,
            role: request.account.role,
          }
        : undefined,
    };
  }

  private resolveTimeout(resourceConfig: { memory: number; timeout: number }): number {
    const configured = resourceConfig?.timeout ?? 5_000;
    return Math.min(configured, this.maxTimeoutMs);
  }
}
