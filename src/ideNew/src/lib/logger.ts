import { install, mapSourcePosition } from "source-map-support";
import { AppDataSource, ensureSchema } from "./db";
import { SystemLog } from '@idp/shared';

const globalAny = globalThis as typeof globalThis & { __WBOT_LOGGER_INIT?: boolean };

if (!globalAny.__WBOT_LOGGER_INIT) {
  globalAny.__WBOT_LOGGER_INIT = true;
  Error.stackTraceLimit = Math.max(Error.stackTraceLimit || 10, 100);
  if (typeof (process as any).setSourceMapsEnabled === "function") {
    try {
      (process as any).setSourceMapsEnabled(true);
    } catch {
      // ignore source map enabling errors
    }
  }
  install({ environment: "node", handleUncaughtExceptions: false });
}

export type LogEntry = {
  level: "info" | "warning" | "error";
  source: string;
  action?: string | null;
  message?: string | null;
  meta?: any;
};

type ErrorFrame = {
  file: string;
  line: number;
  column: number;
  method?: string;
};

export type ErrorMeta = {
  name?: string;
  message?: string;
  stack?: string;
  frames?: ErrorFrame[];
};

export const insertLog = async ({ level, source, action, message, meta }: LogEntry) => {
  try {
    await ensureSchema();
    const repo = AppDataSource.getRepository(SystemLog);
    const log = repo.create({
      level,
      source,
      action: action || null,
      message: message || null,
      meta: meta || null,
    });
    await repo.save(log);
  } catch (err) {
    // Logging failures must never crash the app
    console.error("Failed to insert log", err);
  }
};

export const toErrorMeta = (err: any): ErrorMeta | null => {
  if (!err) return null;
  const stack = typeof err.stack === "string" ? err.stack : undefined;
  const frames: ErrorFrame[] = [];

  if (stack) {
    const lines = stack.split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*at\s+(.*?)\s+\(?(.+):(\d+):(\d+)\)?$/);
      if (!match) continue;

      const [, rawMethod, filePath, lineStr, colStr] = match;
      const mapped = mapSourcePosition({
        source: filePath,
        line: Number(lineStr),
        column: Number(colStr),
      });

      frames.push({
        file: mapped.source || filePath,
        line: mapped.line || Number(lineStr),
        column: mapped.column || Number(colStr),
        method: rawMethod && rawMethod !== "Object.<anonymous>" ? rawMethod : undefined,
      });
    }
  }

  return {
    name: err.name || "Error",
    message: err.message || String(err),
    stack,
    frames,
  };
};

const baseLog =
  (level: LogEntry["level"]) =>
  (entry: Omit<LogEntry, "level">) => {
    if (level === "info") return Promise.resolve();
    return insertLog({ level, ...entry });
  };

export const logger = {
  info: baseLog("info"),
  warn: baseLog("warning"),
  error: baseLog("error"),
};
