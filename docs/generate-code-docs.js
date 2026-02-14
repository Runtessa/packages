#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.resolve(__dirname);
const ROOT = path.resolve(DOCS_DIR, '..');

const SOURCES = [
  { key: 'core', label: 'Core Runtime', dir: 'src/core' },
  { key: 'ide', label: 'IDE', dir: 'src/ideNew/src' },
  { key: 'kernel', label: 'Kernel', dir: 'src/kernel/src' },
  { key: 'shared', label: 'Shared Package', dir: 'src/packages/shared/src' },
];

const ENTITY_DIR = 'src/packages/shared/src/entities';
const NEXT_API_ROOT = 'src/ideNew/src/pages/api';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

function toRel(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function isCodeFile(file) {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file);
}

function countCodeLoc(lines) {
  let inBlock = false;
  let total = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    if (line.startsWith('//')) continue;
    total++;
  }
  return total;
}

function uniq(values) {
  return [...new Set(values)];
}

function parseImports(code) {
  const imports = [];
  const importRegex = /^\s*import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/gm;
  const requireRegex = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = importRegex.exec(code))) imports.push(m[1]);
  while ((m = requireRegex.exec(code))) imports.push(m[1]);
  return uniq(imports);
}

function parseExports(code) {
  const exports = [];
  const named = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm;
  const grouped = /^\s*export\s*\{([^}]+)\}/gm;
  const defaultRegex = /^\s*export\s+default\s+/gm;
  let m;
  while ((m = named.exec(code))) exports.push(m[1]);
  while ((m = grouped.exec(code))) {
    const parts = m[1].split(',').map((p) => p.trim()).filter(Boolean);
    for (const p of parts) exports.push(p.replace(/\s+as\s+.+$/, ''));
  }
  if (defaultRegex.test(code)) exports.push('default');
  if (/\bmodule\.exports\s*=/.test(code)) exports.push('module.exports');
  return uniq(exports);
}

function parseClasses(code) {
  const out = [];
  const re = /\bclass\s+([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(code))) out.push(m[1]);
  return uniq(out);
}

function parseFunctions(code) {
  const out = [];
  const decl = /\bfunction\s+([A-Za-z0-9_$]+)\s*\(/g;
  const arrow = /\bconst\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  let m;
  while ((m = decl.exec(code))) out.push(m[1]);
  while ((m = arrow.exec(code))) out.push(m[1]);
  return uniq(out);
}

function getArea(relPath) {
  if (relPath.startsWith('src/core/')) return 'core';
  if (relPath.startsWith('src/ideNew/src/')) return 'ide';
  if (relPath.startsWith('src/kernel/src/')) return 'kernel';
  if (relPath.startsWith('src/packages/shared/src/')) return 'shared';
  return 'other';
}

function collectFilesMeta() {
  const rows = [];
  for (const src of SOURCES) {
    const abs = path.join(ROOT, src.dir);
    const files = walk(abs).filter((f) => isCodeFile(f));
    for (const file of files) {
      const rel = toRel(file);
      const code = fs.readFileSync(file, 'utf8');
      const lines = code.split(/\r?\n/);
      rows.push({
        path: rel,
        area: getArea(rel),
        loc: lines.length,
        codeLoc: countCodeLoc(lines),
        imports: parseImports(code),
        exports: parseExports(code),
        classes: parseClasses(code),
        functions: parseFunctions(code),
      });
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return rows;
}

function parseExpressRoutes(code) {
  const routes = [];
  const re = /\b(?:app|router)\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/g;
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
  if (methods.size === 0) methods.add('ANY');
  return [...methods];
}

function nextRouteFromFile(relPath) {
  let route = relPath.replace(/^src\/ideNew\/src\/pages\/api/, '/api').replace(/\.(ts|tsx|js|jsx)$/, '');
  route = route.replace(/\/index$/, '');
  return route || '/api';
}

function collectApiMeta() {
  const express = [];
  const expressFiles = walk(path.join(ROOT, 'src/core')).filter((f) => /\.(ts|js)$/.test(f));
  for (const file of expressFiles) {
    const rel = toRel(file);
    const code = fs.readFileSync(file, 'utf8');
    for (const route of parseExpressRoutes(code)) {
      express.push({ ...route, source: rel });
    }
  }

  const nextApi = [];
  const nextFiles = walk(path.join(ROOT, NEXT_API_ROOT)).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));
  for (const file of nextFiles) {
    const rel = toRel(file);
    const code = fs.readFileSync(file, 'utf8');
    const methods = inferNextMethods(code);
    nextApi.push({
      route: nextRouteFromFile(rel),
      methods,
      source: rel,
    });
  }

  express.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  nextApi.sort((a, b) => a.route.localeCompare(b.route));

  return { express, nextApi };
}

function collectEntitiesMeta() {
  const relationDecorators = ['ManyToOne', 'OneToMany', 'ManyToMany', 'OneToOne'];
  const entities = [];
  const entityFiles = walk(path.join(ROOT, ENTITY_DIR)).filter((f) => f.endsWith('.ts'));

  for (const file of entityFiles) {
    const rel = toRel(file);
    const code = fs.readFileSync(file, 'utf8');
    const lines = code.split(/\r?\n/);
    const classMatch = code.match(/export\s+class\s+([A-Za-z0-9_]+)/);
    const entityName = classMatch ? classMatch[1] : path.basename(file, '.ts');
    const entityDecorator = code.match(/@Entity\(([^)]*)\)/);

    const fields = [];
    let pending = [];

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('@')) {
        pending.push(line);
        continue;
      }
      const prop = line.match(/^([A-Za-z0-9_]+)\??:\s*([^;]+);/);
      if (prop && pending.length > 0) {
        const decorators = pending.slice();
        pending = [];
        fields.push({
          name: prop[1],
          type: prop[2].trim(),
          decorators,
        });
      } else if (line && !line.startsWith('//')) {
        pending = [];
      }
    }

    const relations = fields
      .filter((f) => f.decorators.some((d) => relationDecorators.some((r) => d.includes(`@${r}`))))
      .map((f) => {
        const relDec = f.decorators.find((d) => relationDecorators.some((r) => d.includes(`@${r}`))) || '';
        const relType = relationDecorators.find((r) => relDec.includes(`@${r}`)) || 'Relation';
        const target = (relDec.match(/=>\s*([A-Za-z0-9_]+)/) || [])[1] || 'unknown';
        return { field: f.name, relation: relType, target };
      });

    entities.push({
      name: entityName,
      source: rel,
      table: entityDecorator ? entityDecorator[1].trim() : '',
      fields,
      relations,
    });
  }

  entities.sort((a, b) => a.name.localeCompare(b.name));
  return entities;
}

function nav() {
  return `
<nav class="nav">
  <a href="./index.html">Index</a>
  <a href="./architecture.html">Architecture</a>
  <a href="./couplings.html">Couplings</a>
  <a href="./metrics.html">Code Metrics</a>
  <a href="./code-reference.html">Code Reference</a>
  <a href="./api-reference.html">API Reference</a>
  <a href="./entities-reference.html">Entities</a>
</nav>`;
}

function page(title, subtitle, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="./assets/docs.css" />
  </head>
  <body>
    <header>
      <div class="wrap">
        <h1 class="title">${escapeHtml(title)}</h1>
        <p class="subtitle">${escapeHtml(subtitle)}</p>
        ${nav()}
      </div>
    </header>
    <main class="wrap">
      ${body}
    </main>
  </body>
</html>`;
}

function renderCodeReference(filesMeta) {
  const totalLoc = filesMeta.reduce((sum, f) => sum + f.loc, 0);
  const totalCodeLoc = filesMeta.reduce((sum, f) => sum + f.codeLoc, 0);
  const totalImports = filesMeta.reduce((sum, f) => sum + f.imports.length, 0);
  const totalExports = filesMeta.reduce((sum, f) => sum + f.exports.length, 0);

  const byArea = {
    core: filesMeta.filter((f) => f.area === 'core'),
    ide: filesMeta.filter((f) => f.area === 'ide'),
    kernel: filesMeta.filter((f) => f.area === 'kernel'),
    shared: filesMeta.filter((f) => f.area === 'shared'),
  };

  const cards = Object.entries(byArea)
    .map(([area, files]) => {
      const areaLoc = files.reduce((sum, f) => sum + f.loc, 0);
      return `<div class="card"><span class="k">${escapeHtml(area)}</span><div class="v">${files.length} files</div><p class="muted">${areaLoc} LOC</p></div>`;
    })
    .join('\n');

  const areaSections = Object.entries(byArea)
    .map(([area, files]) => {
      const rows = files
        .map((f) => {
          return `<tr>
<td><code>${escapeHtml(f.path)}</code></td>
<td>${f.loc}</td>
<td>${f.codeLoc}</td>
<td>${f.imports.length}</td>
<td>${f.exports.length}</td>
<td>${f.classes.length}</td>
<td>${f.functions.length}</td>
</tr>`;
        })
        .join('\n');

      return `<section>
<h2>${escapeHtml(area.toUpperCase())} Files</h2>
<table>
  <thead>
    <tr>
      <th>File</th>
      <th>LOC</th>
      <th>Code LOC</th>
      <th>Imports</th>
      <th>Exports</th>
      <th>Classes</th>
      <th>Functions</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
</section>`;
    })
    .join('\n');

  const largeFiles = filesMeta
    .slice()
    .sort((a, b) => b.loc - a.loc)
    .slice(0, 30)
    .map((f) => `<tr><td><code>${escapeHtml(f.path)}</code></td><td>${f.loc}</td><td>${escapeHtml(f.exports.join(', ') || '-')}</td></tr>`)
    .join('\n');

  return page(
    'IdpCore Full Code Reference',
    'Project-wide source inventory and symbol-level metrics.',
    `<section>
  <h2>Global Summary</h2>
  <div class="grid cards">
    <div class="card"><span class="k">Files</span><div class="v">${filesMeta.length}</div></div>
    <div class="card"><span class="k">LOC</span><div class="v">${totalLoc}</div></div>
    <div class="card"><span class="k">Code LOC</span><div class="v">${totalCodeLoc}</div></div>
    <div class="card"><span class="k">Import links</span><div class="v">${totalImports}</div></div>
    <div class="card"><span class="k">Export symbols</span><div class="v">${totalExports}</div></div>
  </div>
</section>
<section>
  <h2>By Domain</h2>
  <div class="grid cards">${cards}</div>
</section>
<section>
  <h2>Largest Files</h2>
  <table>
    <thead><tr><th>File</th><th>LOC</th><th>Exported symbols</th></tr></thead>
    <tbody>${largeFiles}</tbody>
  </table>
</section>
${areaSections}`
  );
}

function renderApiReference(apiMeta) {
  const expressRows = apiMeta.express
    .map((r) => `<tr><td><code>${escapeHtml(r.method)}</code></td><td><code>${escapeHtml(r.path)}</code></td><td><code>${escapeHtml(r.source)}</code></td></tr>`)
    .join('\n');

  const nextRows = apiMeta.nextApi
    .map((r) => `<tr><td><code>${escapeHtml(r.methods.join(', '))}</code></td><td><code>${escapeHtml(r.route)}</code></td><td><code>${escapeHtml(r.source)}</code></td></tr>`)
    .join('\n');

  return page(
    'IdpCore API Reference',
    'Express runtime routes and Next.js panel APIs.',
    `<section>
  <h2>Summary</h2>
  <div class="grid cards">
    <div class="card"><span class="k">Express routes</span><div class="v">${apiMeta.express.length}</div></div>
    <div class="card"><span class="k">Next API handlers</span><div class="v">${apiMeta.nextApi.length}</div></div>
  </div>
</section>
<section>
  <h2>Core Express Routes</h2>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Source</th></tr></thead>
    <tbody>${expressRows || '<tr><td colspan="3">No routes parsed.</td></tr>'}</tbody>
  </table>
</section>
<section>
  <h2>IDE Next API Routes</h2>
  <table>
    <thead><tr><th>Methods</th><th>Route</th><th>Source</th></tr></thead>
    <tbody>${nextRows || '<tr><td colspan="3">No handlers parsed.</td></tr>'}</tbody>
  </table>
</section>`
  );
}

function renderEntitiesReference(entities) {
  const entityCards = entities
    .map((e) => `<div class="card"><span class="k">${escapeHtml(e.name)}</span><div class="v">${e.fields.length} fields</div><p class="muted">${e.relations.length} relations</p><p><code>${escapeHtml(e.source)}</code></p></div>`)
    .join('\n');

  const sections = entities
    .map((e) => {
      const fieldRows = e.fields
        .map((f) => `<tr><td><code>${escapeHtml(f.name)}</code></td><td><code>${escapeHtml(f.type)}</code></td><td>${escapeHtml(f.decorators.join(', '))}</td></tr>`)
        .join('\n');

      const relationRows = e.relations
        .map((r) => `<tr><td><code>${escapeHtml(r.field)}</code></td><td>${escapeHtml(r.relation)}</td><td><code>${escapeHtml(r.target)}</code></td></tr>`)
        .join('\n');

      return `<section>
  <h2>${escapeHtml(e.name)}</h2>
  <p class="muted">Source: <code>${escapeHtml(e.source)}</code>${e.table ? ` | @Entity(${escapeHtml(e.table)})` : ''}</p>
  <h3>Fields</h3>
  <table>
    <thead><tr><th>Field</th><th>Type</th><th>Decorators</th></tr></thead>
    <tbody>${fieldRows || '<tr><td colspan="3">No decorated fields parsed.</td></tr>'}</tbody>
  </table>
  <h3>Relations</h3>
  <table>
    <thead><tr><th>Field</th><th>Relation</th><th>Target</th></tr></thead>
    <tbody>${relationRows || '<tr><td colspan="3">No relations.</td></tr>'}</tbody>
  </table>
</section>`;
    })
    .join('\n');

  return page(
    'IdpCore Entities Reference',
    'Shared TypeORM entities used by core and IDE.',
    `<section>
  <h2>Entity Inventory</h2>
  <div class="grid cards">
    ${entityCards}
  </div>
</section>
${sections}`
  );
}

function patchNav(filePath) {
  if (!fs.existsSync(filePath)) return;
  const abs = path.join(ROOT, filePath);
  const content = fs.readFileSync(abs, 'utf8');
  const replaced = content.replace(/<nav class="nav">[\s\S]*?<\/nav>/, nav().trim());
  if (replaced !== content) fs.writeFileSync(abs, replaced, 'utf8');
}

function patchIndexDocumentSet() {
  const indexPath = path.join(ROOT, 'docs/index.html');
  if (!fs.existsSync(indexPath)) return;
  let html = fs.readFileSync(indexPath, 'utf8');

  if (!html.includes('Code Reference')) {
    html = html.replace(
      '</div>\n      </section>',
      `          <div class="card">\n            <h3>Code Reference</h3>\n            <p>\n              Full file-level documentation with LOC, exports, imports, classes and functions by domain.\n            </p>\n            <a href="./code-reference.html">Open code reference</a>\n          </div>\n          <div class="card">\n            <h3>API Reference</h3>\n            <p>\n              Runtime Express routes and IDE API handlers with source mapping.\n            </p>\n            <a href="./api-reference.html">Open API reference</a>\n          </div>\n          <div class="card">\n            <h3>Entities</h3>\n            <p>\n              Shared TypeORM entities, decorators, field map, and relation inventory.\n            </p>\n            <a href="./entities-reference.html">Open entities reference</a>\n          </div>\n        </div>\n      </section>`
    );
  }

  fs.writeFileSync(indexPath, html, 'utf8');
}

function main() {
  const filesMeta = collectFilesMeta();
  const apiMeta = collectApiMeta();
  const entities = collectEntitiesMeta();

  fs.writeFileSync(path.join(ROOT, 'docs/code-reference.html'), renderCodeReference(filesMeta), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'docs/api-reference.html'), renderApiReference(apiMeta), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'docs/entities-reference.html'), renderEntitiesReference(entities), 'utf8');

  patchNav('docs/index.html');
  patchNav('docs/architecture.html');
  patchNav('docs/couplings.html');
  patchNav('docs/metrics.html');
  patchIndexDocumentSet();

  console.log('Generated docs: code-reference.html, api-reference.html, entities-reference.html');
  console.log(`Files scanned: ${filesMeta.length}`);
  console.log(`Express routes: ${apiMeta.express.length}`);
  console.log(`Next APIs: ${apiMeta.nextApi.length}`);
  console.log(`Entities: ${entities.length}`);
}

main();
