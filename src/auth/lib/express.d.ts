import type { SessionContext } from './sessions';

declare global {
  namespace Express {
    interface Request {
      sessionContext?: SessionContext | null;
      requestId?: string;
    }
  }
}

export {};
