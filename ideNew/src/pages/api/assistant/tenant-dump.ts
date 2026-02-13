import type { NextApiRequest, NextApiResponse } from 'next';
import { In } from 'typeorm';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { resolveTenant } from '@/lib/tenancy';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import {
  GlobalModulePackage,
  GlobalModulePackageFile,
  GlobalUIPackage,
  GlobalUIPackageFile,
  ModuleEntity,
  OrmModel,
  UIPackage,
} from '@idp/shared';

const toFenceLanguage = (ext?: string | null, fallback = 'txt') => {
  const normalized = String(ext || '').replace(/^\./, '').toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'ts' || normalized === 'tsx') return 'js';
  if (normalized === 'jsx' || normalized === 'js') return normalized;
  if (normalized === 'json') return 'json';
  if (normalized === 'css') return 'css';
  if (normalized === 'md') return 'md';
  return fallback;
};

const asJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

const sanitizeFilePart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tenant';

const codeBlock = (lang: string, code: string) => `\`\`\`${lang}\n${code || ''}\n\`\`\``;

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end();
    return;
  }

  const user = await requireUser(req);
  const tenant = await resolveTenant(req);
  await ensureCoreSchema();

  const moduleRepo = CoreDataSource.getRepository(ModuleEntity);
  const modelRepo = CoreDataSource.getRepository(OrmModel);
  const uiRepo = CoreDataSource.getRepository(UIPackage);

  const modules = await moduleRepo.find({
    where: { tenant: { id: tenant.id } },
    order: { routePath: 'ASC', method: 'ASC' },
  });
  const models = await modelRepo.find({
    where: { tenant: { id: tenant.id } },
    order: { path: 'ASC' },
  });
  const uiPackages = await uiRepo.find({
    where: { tenant: { id: tenant.id } },
    order: { name: 'ASC', version: 'DESC' },
  });

  let sharedUi: GlobalUIPackage[] = [];
  let sharedModules: GlobalModulePackage[] = [];
  let sharedUiFiles: GlobalUIPackageFile[] = [];
  let sharedModuleFiles: GlobalModulePackageFile[] = [];
  if (user.isAdmin) {
    sharedUi = await CoreDataSource.getRepository(GlobalUIPackage).find({
      order: { name: 'ASC', version: 'DESC' },
    });
    sharedModules = await CoreDataSource.getRepository(GlobalModulePackage).find({
      order: { name: 'ASC', version: 'DESC' },
    });
    if (sharedUi.length) {
      sharedUiFiles = await CoreDataSource.getRepository(GlobalUIPackageFile).find({
        where: { project: { id: In(sharedUi.map((item) => item.id)) } },
        relations: { project: true },
        order: { path: 'ASC' },
      });
    }
    if (sharedModules.length) {
      sharedModuleFiles = await CoreDataSource.getRepository(GlobalModulePackageFile).find({
        where: { project: { id: In(sharedModules.map((item) => item.id)) } },
        relations: { project: true },
        order: { path: 'ASC' },
      });
    }
  }

  const uiFileMap = new Map<string, GlobalUIPackageFile[]>();
  for (const file of sharedUiFiles) {
    const key = file.project?.id;
    if (!key) continue;
    if (!uiFileMap.has(key)) uiFileMap.set(key, []);
    uiFileMap.get(key)?.push(file);
  }

  const moduleFileMap = new Map<string, GlobalModulePackageFile[]>();
  for (const file of sharedModuleFiles) {
    const key = file.project?.id;
    if (!key) continue;
    if (!moduleFileMap.has(key)) moduleFileMap.set(key, []);
    moduleFileMap.get(key)?.push(file);
  }

  const lines: string[] = [];
  lines.push('# Tenant Workspace Dump');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Tenant Host: ${tenant.hostname}`);
  lines.push(`Tenant ID: ${tenant.id}`);
  lines.push(`Requested By: ${user.email} (id:${user.id}, role:${user.role})`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Backend modules: ${modules.length}`);
  lines.push(`- ORM models: ${models.length}`);
  lines.push(`- UI packages: ${uiPackages.length}`);
  lines.push(`- Shared UI projects: ${sharedUi.length}`);
  lines.push(`- Shared backend projects: ${sharedModules.length}`);
  lines.push('');
  lines.push('## Tenant Configuration');
  lines.push('');
  lines.push('### resourceConfig');
  lines.push(codeBlock('json', asJson(tenant.resourceConfig)));
  lines.push('');
  lines.push('### adapterAccess');
  lines.push(codeBlock('json', asJson(tenant.adapterAccess)));
  lines.push('');
  lines.push('### adapterConfig');
  lines.push(codeBlock('json', asJson(tenant.adapterConfig)));
  lines.push('');
  lines.push('### authDbConfig');
  lines.push(codeBlock('json', asJson(tenant.authDbConfig)));
  lines.push('');
  lines.push('### allowRegistration / isSuspended');
  lines.push(codeBlock('json', asJson({
    allowRegistration: tenant.allowRegistration,
    isSuspended: tenant.isSuspended,
  })));
  lines.push('');
  lines.push('## ACL');
  lines.push('');
  lines.push('### permissions.json');
  lines.push(codeBlock('json', asJson(tenant.aclPermissions)));
  lines.push('');
  lines.push('### roles.json');
  lines.push(codeBlock('json', asJson(tenant.aclRoles)));
  lines.push('');
  lines.push('### endpoints.json');
  lines.push(codeBlock('json', asJson(tenant.aclEndpoints)));
  lines.push('');
  lines.push('## Backend Modules');
  lines.push('');
  if (!modules.length) {
    lines.push('_No backend modules._');
    lines.push('');
  } else {
    for (const mod of modules) {
      lines.push(`### ${mod.method} ${mod.routePath}`);
      lines.push(`- id: ${mod.id}`);
      lines.push(`- fileExtension: ${mod.fileExtension || 'js'}`);
      lines.push(codeBlock(toFenceLanguage(mod.fileExtension, 'js'), mod.code || ''));
      lines.push('');
    }
  }

  lines.push('## ORM Models');
  lines.push('');
  if (!models.length) {
    lines.push('_No ORM models._');
    lines.push('');
  } else {
    for (const model of models) {
      lines.push(`### ${model.path}`);
      lines.push(`- id: ${model.id}`);
      lines.push(`- fileExtension: ${model.fileExtension || 'js'}`);
      lines.push(codeBlock(toFenceLanguage(model.fileExtension, 'js'), model.code || ''));
      lines.push('');
    }
  }

  lines.push('## UI Packages');
  lines.push('');
  if (!uiPackages.length) {
    lines.push('_No UI packages._');
    lines.push('');
  } else {
    for (const ui of uiPackages) {
      lines.push(`### ${ui.name}@${ui.version}`);
      lines.push(`- id: ${ui.id}`);
      lines.push(`- fileExtension: ${ui.fileExtension || 'jsx'}`);
      lines.push(`- dependencies: ${(ui.dependencies || []).join(', ') || '-'}`);
      lines.push(codeBlock(toFenceLanguage(ui.fileExtension, 'jsx'), ui.code || ''));
      lines.push('');
    }
  }

  lines.push('## Shared UI Projects');
  lines.push('');
  if (!sharedUi.length) {
    lines.push('_No shared UI projects or access denied._');
    lines.push('');
  } else {
    for (const project of sharedUi) {
      lines.push(`### ${project.name}@${project.version}`);
      lines.push(`- id: ${project.id}`);
      lines.push(`- entryPath: ${project.entryPath}`);
      lines.push(`- dependencies: ${(project.dependencies || []).join(', ') || '-'}`);
      const files = (uiFileMap.get(project.id) || []).sort((a, b) =>
        a.path.localeCompare(b.path)
      );
      for (const file of files) {
        lines.push(`#### ${file.path}`);
        lines.push(codeBlock(toFenceLanguage(file.fileExtension, 'jsx'), file.content || ''));
      }
      lines.push('');
    }
  }

  lines.push('## Shared Backend Projects');
  lines.push('');
  if (!sharedModules.length) {
    lines.push('_No shared backend projects or access denied._');
    lines.push('');
  } else {
    for (const project of sharedModules) {
      lines.push(`### ${project.name}@${project.version}`);
      lines.push(`- id: ${project.id}`);
      lines.push(`- entryPath: ${project.entryPath}`);
      lines.push(`- dependencies: ${(project.dependencies || []).join(', ') || '-'}`);
      const files = (moduleFileMap.get(project.id) || []).sort((a, b) =>
        a.path.localeCompare(b.path)
      );
      for (const file of files) {
        lines.push(`#### ${file.path}`);
        lines.push(codeBlock(toFenceLanguage(file.fileExtension, 'js'), file.content || ''));
      }
      lines.push('');
    }
  }

  const markdown = lines.join('\n');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${sanitizeFilePart(tenant.hostname)}-workspace-dump-${stamp}.md`;

  res.status(200).json({
    filename,
    markdown,
    stats: {
      modules: modules.length,
      models: models.length,
      uiPackages: uiPackages.length,
      sharedUi: sharedUi.length,
      sharedModules: sharedModules.length,
    },
  });
});
