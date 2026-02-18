import { Tenant } from '@idp/shared';

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
};

export const normalizeAclPermissionsValue = (value: unknown): Tenant['aclPermissions'] => {
  const obj = asObject(value);
  if (!obj) return { permissions: [] };
  return {
    permissions: Array.isArray(obj.permissions)
      ? obj.permissions.map((item) => {
          const row = asObject(item) ?? {};
          return {
            key: String(row.key ?? ''),
            label: row.label === undefined ? undefined : String(row.label),
          };
        })
      : [],
  };
};

export const normalizeAclRolesValue = (value: unknown): Tenant['aclRoles'] => {
  const obj = asObject(value);
  if (!obj) return { roles: {}, groups: {} };
  const rolesObj = asObject(obj.roles) ?? {};
  const groupsObj = asObject(obj.groups) ?? {};
  const roles: Record<string, string[]> = {};
  const groups: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(rolesObj)) {
    roles[key] = asStringArray(val);
  }
  for (const [key, val] of Object.entries(groupsObj)) {
    groups[key] = asStringArray(val);
  }
  return { roles, groups };
};

export const normalizeAclEndpointsValue = (value: unknown): Tenant['aclEndpoints'] => {
  const root = asObject(value);
  if (!root) return {};
  const candidate = asObject(root.endpoints) ?? root;
  const output: Tenant['aclEndpoints'] = {};
  for (const [routePath, rawRules] of Object.entries(candidate)) {
    const rules = asObject(rawRules);
    if (!rules) continue;
    output[routePath] = {
      read: asStringArray(rules.read),
      write: asStringArray(rules.write),
      edit: asStringArray(rules.edit),
      delete: asStringArray(rules.delete),
      allowAnonymous: Boolean(rules.allowAnonymous),
    };
  }
  return output;
};
