import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { resolveTenant } from '@/lib/tenancy';
import { Tenant } from '@idp/shared';

const defaultPermissions = { permissions: [] as Array<{ key: string; label?: string }> };
const defaultRoles = {
  roles: {} as Record<string, string[]>,
  groups: {} as Record<string, string[]>,
};
const defaultEndpoints = {} as Record<
  string,
  { read?: string[]; write?: string[]; edit?: string[]; delete?: string[]; allowAnonymous?: boolean }
>;

const parseJsonBody = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
};

const validateEndpointAcl = (endpoints: Record<string, any>) => {
  Object.entries(endpoints || {}).forEach(([path, config]) => {
    if (!config || typeof config !== 'object') {
      const err = new Error(`Invalid ACL config for endpoint ${path}`);
      (err as any).statusCode = 400;
      throw err;
    }
    if (
      (config as any).allowAnonymous !== undefined &&
      typeof (config as any).allowAnonymous !== 'boolean'
    ) {
      const err = new Error(`Endpoint ${path} allowAnonymous must be boolean`);
      (err as any).statusCode = 400;
      throw err;
    }
    const read = Array.isArray((config as any).read) ? (config as any).read : [];
    const write = Array.isArray((config as any).write) ? (config as any).write : [];
    const edit = Array.isArray((config as any).edit) ? (config as any).edit : [];
    const del = Array.isArray((config as any).delete) ? (config as any).delete : [];

    if (write.length > 0 && read.length === 0) {
      const err = new Error(`Endpoint ${path} write requires read permissions`);
      (err as any).statusCode = 400;
      throw err;
    }
    if (edit.length > 0 && write.length === 0) {
      const err = new Error(`Endpoint ${path} edit requires write permissions`);
      (err as any).statusCode = 400;
      throw err;
    }
    if (del.length > 0 && (edit.length === 0 || write.length === 0 || read.length === 0)) {
      const err = new Error(`Endpoint ${path} delete requires read, write, and edit permissions`);
      (err as any).statusCode = 400;
      throw err;
    }
  });
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  await requireUser(req);
  const tenant = await resolveTenant(req);
  const repo = CoreDataSource.getRepository(Tenant);

  if (req.method === 'GET') {
    res.status(200).json({
      permissions: tenant.aclPermissions ?? defaultPermissions,
      roles: tenant.aclRoles ?? defaultRoles,
      endpoints: tenant.aclEndpoints ?? defaultEndpoints,
    });
    return;
  }

  if (req.method === 'PUT') {
    const file = String(req.body?.file || '').toLowerCase();
    const content = parseJsonBody(req.body?.content);

    if (file && !content) {
      const err = new Error('Invalid JSON content');
      (err as any).statusCode = 400;
      throw err;
    }

    if (file === 'permissions') {
      tenant.aclPermissions = (content ?? defaultPermissions) as Tenant['aclPermissions'];
    } else if (file === 'roles') {
      tenant.aclRoles = (content ?? defaultRoles) as Tenant['aclRoles'];
    } else if (file === 'endpoints') {
      validateEndpointAcl(content ?? {});
      tenant.aclEndpoints = (content ?? defaultEndpoints) as Tenant['aclEndpoints'];
    } else {
      const permissions = parseJsonBody(req.body?.permissions);
      const roles = parseJsonBody(req.body?.roles);
      const endpoints = parseJsonBody(req.body?.endpoints);
      if (!permissions && !roles && !endpoints) {
        const err = new Error('No ACL content provided');
        (err as any).statusCode = 400;
        throw err;
      }
      if (permissions) tenant.aclPermissions = permissions as Tenant['aclPermissions'];
      if (roles) tenant.aclRoles = roles as Tenant['aclRoles'];
      if (endpoints) {
        validateEndpointAcl(endpoints);
        tenant.aclEndpoints = endpoints as Tenant['aclEndpoints'];
      }
    }

    await repo.save(tenant);
    res.status(200).json({
      permissions: tenant.aclPermissions ?? defaultPermissions,
      roles: tenant.aclRoles ?? defaultRoles,
      endpoints: tenant.aclEndpoints ?? defaultEndpoints,
    });
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT']);
  res.status(405).end();
});
