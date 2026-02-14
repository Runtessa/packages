import { resolveCodexGatewayModeValue } from '@/lib/assistant/gateway-runtime';

export const resolveCodexGatewayBase = () => {
  const raw = String(
    process.env.AGENT_CODEX_GATEWAY_URL ||
      process.env.CODEX_GATEWAY_URL ||
      'http://127.0.0.1:4040',
  ).trim();
  return raw.replace(/\/+$/, '');
};

export const resolveCodexGatewayProvider = () => {
  const mode = resolveCodexGatewayModeValue();
  if (mode === 'off' || mode === 'none' || mode === 'disabled') return 'codex-cli';
  if (mode === 'container') return 'codex-gateway-container';
  return 'codex-gateway';
};
