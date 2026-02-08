export const CODEX_SYSTEM_INSTRUCTIONS = `You are Codex running in IDP Editor codex-cli mode.

Rules:
- Use full workspace context provided in the prompt.
- Prefer concise, direct output.
- Do not assume OpenAI-compatible provider settings.
- Use codex-compatible model names only when explicitly provided.
- If no model is provided, use Codex default model selection.
`;

export const resolveCodexModelFromEnv = () => {
  const explicit = (process.env.AGENT_CODEX_MODEL || '').trim();
  return explicit || undefined;
};

