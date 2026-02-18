#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SITE_DOCS = path.join(ROOT, 'docs/site/docs');
const OPENAPI_OUT = path.join(ROOT, 'docs/site/static/openapi/idpcore-openapi.json');

const SERVICE_DIRS = [
  { id: 'core', label: 'Core Runtime', dir: 'src/core' },
  { id: 'ide', label: 'IDE', dir: 'src/ideNew/src' },
  { id: 'auth', label: 'Auth Service', dir: 'src/auth' },
  { id: 'kernel', label: 'Kernel', dir: 'src/kernel/src' },
  { id: 'container-agent', label: 'Container Agent', dir: 'src/container-agent' },
  { id: 'codex-gateway', label: 'Codex Gateway', dir: 'src/codex-gateway' },
  { id: 'monitoring', label: 'Monitoring', dir: 'src/monitoring' },
  { id: 'shared', label: 'Shared Package', dir: 'src/packages/shared/src' },
];

const API_SERVICE_DIRS = [
  { id: 'core', dir: 'src/core' },
  { id: 'auth', dir: 'src/auth' },
  { id: 'container-agent', dir: 'src/container-agent' },
  { id: 'codex-gateway', dir: 'src/codex-gateway' },
  { id: 'monitoring', dir: 'src/monitoring' },
];

const NEXT_API_ROOT = 'src/ideNew/src/pages/api';

const SKIP = new Set(['node_modules', '.next', 'dist', 'build', '.git', '.venv', 'vendor', 'target']);

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function toApiPath(raw) {
  const withSlashes = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlashes.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function parseExpressRoutes(code) {
  const re = /\b(?:app|router)\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/g;
  const routes = [];
  let m;
  while ((m = re.exec(code))) {
    routes.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  return routes;
}

function inferNextMethods(code) {
  const methods = new Set();
  let m;
  const ifRe = /req\.method\s*===\s*['"]([A-Z]+)['"]/g;
  const caseRe = /case\s+['"]([A-Z]+)['"]/g;
  while ((m = ifRe.exec(code))) methods.add(m[1]);
  while ((m = caseRe.exec(code))) methods.add(m[1]);
  if (!methods.size) methods.add('ANY');
  return [...methods];
}

function nextRouteFromFile(relativePath) {
  let route = relativePath
    .replace(/^src\/ideNew\/src\/pages\/api/, '/api')
    .replace(/\.(ts|tsx|js|jsx)$/, '')
    .replace(/\/index$/, '');
  return route || '/api';
}

function collectServiceInventory() {
  return SERVICE_DIRS.map((service) => {
    const files = walk(path.join(ROOT, service.dir)).filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));
    const loc = files.reduce((sum, file) => {
      const content = fs.readFileSync(file, 'utf8');
      return sum + content.split(/\r?\n/).length;
    }, 0);
    return {
      id: service.id,
      label: service.label,
      dir: service.dir,
      files: files.length,
      loc,
    };
  });
}

function collectRoutes() {
  const expressRoutes = [];
  for (const service of API_SERVICE_DIRS) {
    const files = walk(path.join(ROOT, service.dir)).filter((f) => /\.(ts|js)$/.test(f));
    for (const file of files) {
      const code = fs.readFileSync(file, 'utf8');
      for (const route of parseExpressRoutes(code)) {
        expressRoutes.push({
          service: service.id,
          method: route.method,
          path: route.path,
          source: rel(file),
        });
      }
    }
  }

  const nextRoutes = [];
  const nextFiles = walk(path.join(ROOT, NEXT_API_ROOT)).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));
  for (const file of nextFiles) {
    const code = fs.readFileSync(file, 'utf8');
    const relativePath = rel(file);
    nextRoutes.push({
      service: 'ide',
      methods: inferNextMethods(code),
      path: nextRouteFromFile(relativePath),
      source: relativePath,
    });
  }

  expressRoutes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  nextRoutes.sort((a, b) => a.path.localeCompare(b.path));
  return { expressRoutes, nextRoutes };
}

function buildOpenApi(expressRoutes, nextRoutes) {
  const paths = {};

  for (const route of expressRoutes) {
    const method = route.method === 'ALL' ? 'post' : route.method.toLowerCase();
    const apiPath = toApiPath(route.path);
    if (!paths[apiPath]) paths[apiPath] = {};
    paths[apiPath][method] = {
      tags: [route.service],
      summary: `${route.service} ${route.method} ${route.path}`,
      operationId: `${route.service}_${method}_${apiPath.replace(/[^A-Za-z0-9]/g, '_')}`,
      responses: {
        '200': { description: 'OK' },
      },
      'x-source-file': route.source,
    };
  }

  for (const route of nextRoutes) {
    const apiPath = toApiPath(route.path);
    if (!paths[apiPath]) paths[apiPath] = {};
    for (const m of route.methods) {
      const method = m === 'ANY' ? 'post' : m.toLowerCase();
      if (paths[apiPath][method]) continue;
      paths[apiPath][method] = {
        tags: ['ide'],
        summary: `ide ${m} ${route.path}`,
        operationId: `ide_${method}_${apiPath.replace(/[^A-Za-z0-9]/g, '_')}`,
        responses: {
          '200': { description: 'OK' },
        },
        'x-source-file': route.source,
      };
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'IdpCore API',
      version: '1.0.0',
      description: 'Generated API catalog for IdpCore services',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local core' },
      { url: 'http://localhost:3015', description: 'Local auth' },
      { url: 'http://localhost:3002', description: 'Local IDE' },
    ],
    tags: SERVICE_DIRS.map((s) => ({ name: s.id, description: s.label })),
    paths,
  };
}

function writeServiceInventoryMarkdown(services) {
  const totalFiles = services.reduce((s, item) => s + item.files, 0);
  const totalLoc = services.reduce((s, item) => s + item.loc, 0);
  const tableRows = services
    .map((s) => `| ${s.label} | \`${s.dir}\` | ${s.files} | ${s.loc} |`)
    .join('\n');

  const md = `---
title: Service Inventory
---

_Auto-generated by_ \`node docs/scripts/generate-advanced-docs.js\`.

- Total files: **${totalFiles}**
- Total LOC: **${totalLoc}**

| Service | Root | Files | LOC |
| --- | --- | ---: | ---: |
${tableRows}
`;

  fs.writeFileSync(path.join(SITE_DOCS, 'reference/services.md'), md, 'utf8');
}

function writeRoutesMarkdown(expressRoutes, nextRoutes) {
  const expressRows = expressRoutes
    .map((r) => `| ${r.service} | ${r.method} | \`${r.path}\` | \`${r.source}\` |`)
    .join('\n');
  const nextRows = nextRoutes
    .map((r) => `| ${r.service} | ${r.methods.join(', ')} | \`${r.path}\` | \`${r.source}\` |`)
    .join('\n');

  const md = `---
title: Route Inventory
---

_Auto-generated by_ \`node docs/scripts/generate-advanced-docs.js\`.

- Express routes: **${expressRoutes.length}**
- Next API handlers: **${nextRoutes.length}**

## Express Services

| Service | Method | Path | Source |
| --- | --- | --- | --- |
${expressRows || '| - | - | - | - |'}

## IDE Next API

| Service | Methods | Path | Source |
| --- | --- | --- | --- |
${nextRows || '| - | - | - | - |'}
`;

  fs.writeFileSync(path.join(SITE_DOCS, 'reference/routes.md'), md, 'utf8');
}

function main() {
  const services = collectServiceInventory();
  const { expressRoutes, nextRoutes } = collectRoutes();
  const openapi = buildOpenApi(expressRoutes, nextRoutes);

  fs.mkdirSync(path.dirname(OPENAPI_OUT), { recursive: true });
  fs.writeFileSync(OPENAPI_OUT, JSON.stringify(openapi, null, 2), 'utf8');

  fs.mkdirSync(path.join(SITE_DOCS, 'reference'), { recursive: true });
  writeServiceInventoryMarkdown(services);
  writeRoutesMarkdown(expressRoutes, nextRoutes);

  console.log(`[advanced-docs] services: ${services.length}`);
  console.log(`[advanced-docs] express routes: ${expressRoutes.length}`);
  console.log(`[advanced-docs] next api routes: ${nextRoutes.length}`);
  console.log(`[advanced-docs] openapi: ${OPENAPI_OUT}`);
}

main();
