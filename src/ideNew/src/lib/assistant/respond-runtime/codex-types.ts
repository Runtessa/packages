export type CodexOperation = {
  tool?: string;
  name?: string;
  action?: string;
  toolId?: string;
  args?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  input?: Record<string, unknown>;
  reason?: string;
};

export type CodexPlan = {
  summary?: string;
  operations?: CodexOperation[];
};

export type FileDirective = {
  path: string;
  action: 'create' | 'edit' | 'delete';
  content?: string;
};

export const executeTool = async <T, I>(tool: any, input: I): Promise<T> => {
  if (!tool?.execute) throw new Error('Tool is not available');
  const result = await tool.execute(input, {});
  if (result && typeof result === 'object' && (result as any).error) {
    throw new Error((result as any).message || 'Tool validation failed');
  }
  return result as T;
};
