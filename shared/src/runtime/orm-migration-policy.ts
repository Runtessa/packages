import { createHash } from 'node:crypto';

export type SchemaQuery = { query: string; parameters?: any[] };

// Ignore quoted names/literals without interpreting SQL inside them as keywords.
function keywords(sql: string): string | null {
  let result = '';
  for (let i = 0; i < sql.length; i++) {
    const start = sql[i];
    if (start === "'" || start === '"' || start === '`' || start === '[') {
      const end = start === '[' ? ']' : start;
      let closed = false;
      for (i++; i < sql.length; i++) {
        // Backslash quoting depends on the database/session mode; fail closed.
        if (sql[i] === '\\') return null;
        if (sql[i] !== end) continue;
        if (sql[i + 1] === end) { i++; continue; }
        closed = true; break;
      }
      if (!closed) return null;
      result += ' identifier ';
    } else {
      if ((start === '-' && sql[i + 1] === '-') || (start === '/' && sql[i + 1] === '*')) return null;
      result += start;
    }
  }
  result = result.trim().replace(/;$/, '').trim();
  return result.includes(';') ? null : result;
}

export function isAdditiveSchemaQuery(sql: string): boolean {
  const text = keywords(sql);
  if (!text) return false;
  const operations = text.replace(/\bON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION|RESTRICT)\b/gi, '');
  if (!operations || /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME|MODIFY|EXEC|EXECUTE)\b/i.test(operations)) return false;
  if (/^CREATE\s+(TABLE|TYPE|SEQUENCE|(?:UNIQUE\s+)?INDEX)\b/i.test(text)) return true;
  if (/^COMMENT\s+ON\s+(TABLE|COLUMN)\b/i.test(text)) return true;
  if (/^CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\b/i.test(text)) {
    return /^CREATE EXTENSION IF NOT EXISTS "(?:uuid-ossp|pgcrypto)"$/i.test(sql.trim());
  }
  return /^ALTER\s+TABLE\s+[\w.\s]+\s+ADD\s+/i.test(text) &&
    !/\b(ALTER|CHANGE)\b/i.test(text.replace(/^ALTER\s+TABLE/i, ''));
}

export function schemaPlan(queries: SchemaQuery[]) {
  const statements = queries.map(({ query, parameters }) => ({ query, parameters: parameters ?? [] }));
  const hash = createHash('sha256').update(JSON.stringify(statements)).digest('hex');
  const blocked = statements.filter(({ query }) => !isAdditiveSchemaQuery(query));
  return { hash, safe: blocked.length === 0, statements, blocked };
}
