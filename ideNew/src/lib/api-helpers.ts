import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { ensureAppInitialized } from './init';
import { logger, toErrorMeta } from './logger';

export const withApiHandler =
  (handler: NextApiHandler) =>
  async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
    const action = `${req.method} ${req.url}`;
    try {
      await ensureAppInitialized();
      await handler(req, res);
      await logger.info({
        source: 'api',
        action,
        message: 'API request handled successfully'
      });
    } catch (err: any) {
      const status = err?.statusCode || err?.status || 500;
      await logger.error({
        source: 'api',
        action,
        message: err?.message || 'API request failed',
        meta: {
          status,
          query: req.query,
          body: (() => {
            try {
              return JSON.stringify(req.body);
            } catch {
              return '[unserializable body]';
            }
          })(),
          error: toErrorMeta(err)
        }
      });
      res.status(status).json({
        error:
          err?.userMessage ||
          (status >= 500
            ? 'Something went wrong on the server. Please try again later.'
            : err?.message || 'Request failed')
      });
    }
  };
