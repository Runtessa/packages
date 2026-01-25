import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(process.cwd());
const outputFileName = 'PROJECT_FULL_DUMP.md';
const outputPath = path.join(repoRoot, outputFileName);

const normalizePath = (targetPath) =>
  path.relative(repoRoot, targetPath).split(path.sep).join('/');

const excludedDirectories = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  '.turbo',
  '.cache',
  '.vercel',
  'coverage'
]);

const allowedExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.cjs',
  '.mjs',
  '.cs',
  '.css',
  '.scss',
  '.json',
  '.md',
  '.yml',
  '.yaml'
]);

const languageByExtension = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.jsx': 'jsx',
  '.cjs': 'js',
  '.mjs': 'js',
  '.cs': 'cs',
  '.css': 'css',
  '.scss': 'scss',
  '.json': 'json',
  '.md': 'md',
  '.yml': 'yaml',
  '.yaml': 'yaml'
};

const filesToDump = [];

const outputExclusions = new Set([
  outputFileName.toLowerCase(),
  normalizePath(outputPath).toLowerCase()
]);

async function walkDirectory(dir, isRoot = false) {
  const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
  dirents.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const children = [];

  for (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name);
    const relativePath = normalizePath(fullPath);

    if (dirent.isSymbolicLink()) continue;

    if (dirent.isDirectory()) {
      if (excludedDirectories.has(dirent.name)) continue;
      const childNode = await walkDirectory(fullPath);
      if (childNode) {
        children.push(childNode);
      }
      continue;
    }

    if (!dirent.isFile()) continue;

    const ext = path.extname(dirent.name).toLowerCase();
    if (!allowedExtensions.has(ext)) continue;
    if (
      outputExclusions.has(dirent.name.toLowerCase()) ||
      outputExclusions.has(relativePath.toLowerCase())
    ) {
      continue;
    }

    const fileNode = {
      type: 'file',
      name: dirent.name,
      fullPath,
      relativePath,
      language: languageByExtension[ext] ?? ''
    };

    filesToDump.push(fileNode);
    children.push(fileNode);
  }

  if (children.length === 0 && !isRoot) {
    return null;
  }

  return {
    type: 'dir',
    name: isRoot ? '.' : path.basename(dir),
    children
  };
}

function renderTree(node) {
  const lines = [node.name];

  const traverse = (children, prefix) => {
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const connector = isLast ? '└── ' : '├── ';

      if (child.type === 'dir') {
        lines.push(`${prefix}${connector}${child.name}/`);
        traverse(child.children ?? [], `${prefix}${isLast ? '    ' : '│   '}`);
      } else {
        lines.push(`${prefix}${connector}${child.name}`);
      }
    });
  };

  traverse(node.children ?? [], '');
  return lines.join('\n');
}

async function buildMarkdown() {
  const tree = await walkDirectory(repoRoot, true);
  if (!tree) {
    throw new Error('No files found to include in the dump.');
  }

  const mapSection = renderTree(tree);

  const sourceSections = await Promise.all(
    filesToDump.map(async (file) => {
      const contents = await fs.promises.readFile(file.fullPath, 'utf8');
      const lang = file.language;
      return [
        `## ${file.relativePath}`,
        '',
        `\`\`\`${lang}`,
        contents,
        '```',
        ''
      ].join('\n');
    })
  );

  const markdown = [
    '# Project Full Dump',
    '',
    '## Project Map',
    '',
    mapSection,
    '',
    '## Source Files',
    '',
    sourceSections.join('\n')
  ].join('\n');

  await fs.promises.writeFile(outputPath, markdown, 'utf8');
}

buildMarkdown()
  .then(() => {
    console.log(`Wrote ${outputPath}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
