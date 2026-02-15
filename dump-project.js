#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, "src");
const OUTPUT_DIR = path.join(ROOT, "project_dumps");
const MAX_BYTES = 200 * 1024; // skip files larger than this
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".next",
  ".codex-gateway",
  ".vscode",
  ".idea",
  "coverage",
  ".turbo",
  ".cache",
]);
const IGNORE_FILES = new Set([
  "project_dump.md",
  ".env",
  ".env.local",
  "dump-project.js",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "npm-shrinkwrap.json",
  "tsconfig.tsbuildinfo",
]);
const IGNORE_PATH_SNIPPETS = [
  "/.codex-gateway/",
  "/public/monaco/",
  "/public/babel/",
];
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp3",
  ".mp4",
  ".webm",
]);

const languageMap = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".json": "json",
  ".md": "md",
  ".yml": "yaml",
  ".yaml": "yaml",
};

const shouldIgnoreDir = (name) => IGNORE_DIRS.has(name);
const shouldIgnoreFile = (name) => {
  if (
    IGNORE_FILES.has(name) ||
    name.endsWith(".log") ||
    name.endsWith(".jsonl") ||
    name.endsWith(".lock") ||
    name.endsWith(".tmp")
  ) {
    return true;
  }
  const ext = path.extname(name).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
};

const normalizeRelPath = (fullPath) =>
  path.relative(ROOT, fullPath).replace(/\\/g, "/");

const shouldIgnorePath = (relPath) =>
  IGNORE_PATH_SNIPPETS.some((snippet) => relPath.includes(snippet));

const collectFiles = async (dir) => {
  if (!fs.existsSync(dir)) return [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      if (shouldIgnoreDir(entry.name) || shouldIgnoreFile(entry.name)) continue;
    }
    const fullPath = path.join(dir, entry.name);
    const relPath = normalizeRelPath(fullPath);
    if (shouldIgnorePath(relPath)) continue;
    if (entry.isDirectory()) {
      if (shouldIgnoreDir(entry.name)) continue;
      files.push(...(await collectFiles(fullPath)));
    } else if (entry.isFile()) {
      if (shouldIgnoreFile(entry.name)) continue;
      files.push(fullPath);
    }
  }
  return files;
};

const detectLang = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  return languageMap[ext] || "";
};

const makeOutputPath = (folderName) =>
  path.join(OUTPUT_DIR, `project_dump.${folderName}.md`);

const writeHeader = async (outputPath, folderRelPath) => {
  const header =
    `# Project Code Dump\n\n` +
    `_Generated: ${new Date().toISOString()}_\n\n` +
    `_Source folder: ${folderRelPath}_\n\n`;
  await fs.promises.writeFile(outputPath, header, "utf8");
};

const appendFileSection = async (outputPath, filePath) => {
  const relPath = normalizeRelPath(filePath);
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_BYTES) {
    const note = `\n## ${relPath}\n\n_Skipped: file size ${stat.size} exceeds ${MAX_BYTES} bytes_\n`;
    await fs.promises.appendFile(outputPath, note, "utf8");
    return;
  }

  const raw = await fs.promises.readFile(filePath);
  if (raw.includes(0)) {
    const note = `\n## ${relPath}\n\n_Skipped: binary content_\n`;
    await fs.promises.appendFile(outputPath, note, "utf8");
    return;
  }
  const content = raw.toString("utf8");
  const lang = detectLang(filePath);
  const section = `\n## ${relPath}\n\n\`\`\`${lang}\n${content}\n\`\`\`\n`;
  await fs.promises.appendFile(outputPath, section, "utf8");
};

const listTopLevelSourceDirs = async () => {
  if (!fs.existsSync(SOURCE_ROOT)) return [];
  const entries = await fs.promises.readdir(SOURCE_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !shouldIgnoreDir(entry.name))
    .map((entry) => entry.name)
    .sort();
};

const dumpSourceFolder = async (folderName) => {
  const dirPath = path.join(SOURCE_ROOT, folderName);
  const folderRelPath = path.relative(ROOT, dirPath).replace(/\\/g, "/");
  const outputPath = makeOutputPath(folderName);
  const files = (await collectFiles(dirPath)).sort();

  await writeHeader(outputPath, folderRelPath);
  await fs.promises.appendFile(outputPath, `Total files: ${files.length}\n`, "utf8");
  for (const file of files) {
    await appendFileSection(outputPath, file);
  }
  return outputPath;
};

const run = async () => {
  const folders = await listTopLevelSourceDirs();
  if (!folders.length) {
    throw new Error(`No source folders found under ${SOURCE_ROOT}`);
  }
  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

  const outputs = [];
  for (const folderName of folders) {
    const outputPath = await dumpSourceFolder(folderName);
    outputs.push(outputPath);
    console.log(`Wrote ${outputPath}`);
  }
  console.log(`Created ${outputs.length} dump files in ${OUTPUT_DIR}`);
};

run().catch((err) => {
  console.error("Failed to dump project:", err);
  process.exit(1);
});
