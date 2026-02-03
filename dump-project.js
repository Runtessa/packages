#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "project_dump.md");
const MAX_BYTES = 200 * 1024; // skip files larger than this
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".vscode",
  ".idea",
]);
const IGNORE_FILES = new Set([
  "project_dump.md",
  ".env",
  ".env.local",
  "dump-project.js",
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
const shouldIgnoreFile = (name) =>
  IGNORE_FILES.has(name) || name.endsWith(".log");

const collectFiles = async (dir) => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      if (shouldIgnoreDir(entry.name) || shouldIgnoreFile(entry.name)) continue;
    }
    const fullPath = path.join(dir, entry.name);
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

const writeHeader = async () => {
  const header = `# Project Code Dump\n\n_Generated: ${new Date().toISOString()}_\n\n`;
  await fs.promises.writeFile(OUTPUT, header, "utf8");
};

const appendFileSection = async (filePath) => {
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, "/");
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_BYTES) {
    const note = `\n## ${relPath}\n\n_Skipped: file size ${stat.size} exceeds ${MAX_BYTES} bytes_\n`;
    await fs.promises.appendFile(OUTPUT, note, "utf8");
    return;
  }

  const content = await fs.promises.readFile(filePath, "utf8");
  const lang = detectLang(filePath);
  const section = `\n## ${relPath}\n\n\`\`\`${lang}\n${content}\n\`\`\`\n`;
  await fs.promises.appendFile(OUTPUT, section, "utf8");
};

const run = async () => {
  await writeHeader();
  const files = await collectFiles(path.join(ROOT, "ideNew"));
  const sorted = files.sort();
  for (const file of sorted) {
    await appendFileSection(file);
  }
  console.log(`Wrote ${OUTPUT}`);
};

run().catch((err) => {
  console.error("Failed to dump project:", err);
  process.exit(1);
});
