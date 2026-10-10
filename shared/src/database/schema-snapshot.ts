import type { Table } from 'typeorm';

export type SchemaSnapshot = { name: string; [key: string]: unknown };
export const canonicalJson = (value: unknown): string => JSON.stringify(value, function (_key, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
});
const ordered = <T>(items: T[]): T[] => items.sort((a, b) => {
  const left = canonicalJson(a), right = canonicalJson(b);
  return left < right ? -1 : left > right ? 1 : 0;
});

// Compare structure only; never read application rows when adopting an existing schema.
export const snapshotTable = (table: Table): SchemaSnapshot => ({
  name: table.name.replace(/^public\./, ''),
  columns: ordered(table.columns.map((column) => ({
    name: column.name, type: column.type, length: column.length,
    precision: column.precision, scale: column.scale, isNullable: column.isNullable,
    isPrimary: column.isPrimary, isUnique: column.isUnique, isGenerated: column.isGenerated,
    generationStrategy: column.generationStrategy, default: column.default,
    enum: column.enum, enumName: column.enumName, isArray: column.isArray,
    collation: column.collation, asExpression: column.asExpression, generatedType: column.generatedType,
  }))),
  indices: ordered(table.indices.map((index) => ({ name: index.name,
    columnNames: index.columnNames, isUnique: index.isUnique, where: index.where,
    isSpatial: index.isSpatial, isFulltext: index.isFulltext }))),
  uniques: ordered(table.uniques.map((unique) => ({ name: unique.name, columnNames: unique.columnNames }))),
  foreignKeys: ordered(table.foreignKeys.map((key) => ({ name: key.name, columnNames: key.columnNames,
    referencedTableName: key.referencedTableName.replace(/^public\./, ''),
    referencedColumnNames: key.referencedColumnNames, onDelete: key.onDelete, onUpdate: key.onUpdate }))),
  checks: ordered(table.checks.map((check) => ({ name: check.name, expression: check.expression }))),
  exclusions: ordered(table.exclusions.map((exclusion) => ({ name: exclusion.name, expression: exclusion.expression }))),
});
