export {
  detectLanguage,
  sanitizeForFilename,
  splitRoutePath,
  buildRoutePath,
  splitUiName,
  buildUiName,
  coerceModuleExtension,
  coerceUiExtension,
  formatModuleFileName,
  formatUiFileName,
  getScopeInfo,
  getSharedPathFromNodes,
  findPathById,
  getSharedNodeId,
  normalizeSharedPath,
  splitSharedPath,
  normalizeModelPath,
  splitModelPath,
  extractFileExtension,
  formatHistoryTimestamp,
  getRevisionContent,
  pathStartsWith,
  resolveSharedExtension,
  escapeRegExp,
  getFileIdFromUriPath,
} from './utils/paths';

export {
  makeSharedFolderId,
  ensureSharedFolderPath,
  buildSharedTree,
  buildSharedContentMap,
  buildExplorerTree,
  buildPersistedContentMap,
} from './utils/tree';

export {
  parseDependencies,
  extractUiDependencies,
  compileWithBabel,
  buildCssModuleSource,
  buildSharedBundle,
} from './utils/shared';

export {
  buildSearchPattern,
  buildSearchResults,
  parseFilterRegex,
  replaceAtRange,
} from './utils/search';
