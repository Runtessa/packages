import * as typeorm from 'typeorm';

export const collectOrmExports = (exportsList: any[]) => {
  const getMetadataStorage = () => {
    if (typeof (typeorm as any)?.getMetadataArgsStorage === 'function') {
      return (typeorm as any).getMetadataArgsStorage();
    }
    return null;
  };
  const metadataStorage = getMetadataStorage();
  const metadataTargets = new Set(
    (metadataStorage?.tables ?? []).map((table: { target: any }) => table.target)
  );
  const entities: any[] = [];
  const entityMap: Record<string, any> = {};
  let matched = 0;

  const pushEntity = (key: string, value: any) => {
    if (typeof value !== 'function') return;
    if (entities.includes(value)) return;
    entities.push(value);
    entityMap[key] = value;
    if (value.name && !entityMap[value.name]) {
      entityMap[value.name] = value;
    }
  };

  exportsList.forEach((exports) => {
    if (!exports) return;
    if (typeof exports === 'function') {
      if (metadataTargets.has(exports)) {
        pushEntity(exports.name || 'Entity', exports);
        matched += 1;
      }
      return;
    }
    if (typeof exports !== 'object') return;
    Object.entries(exports).forEach(([key, value]) => {
      if (typeof value !== 'function') return;
      if (metadataTargets.has(value)) {
        pushEntity(key, value);
        matched += 1;
      }
    });
  });

  if (matched === 0) {
    exportsList.forEach((exports) => {
      if (!exports) return;
      if (typeof exports === 'function') {
        pushEntity(exports.name || 'Entity', exports);
        return;
      }
      if (typeof exports !== 'object') return;
      Object.entries(exports).forEach(([key, value]) => {
        if (typeof value !== 'function') return;
        pushEntity(key, value);
      });
    });
  }

  return { entities, entityMap };
};
