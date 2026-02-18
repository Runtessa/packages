import express from 'express';

export const registerSessionRoutes = (
  app: express.Express,
  opts: { isAuthAdmin: (req: express.Request) => boolean },
): void => {
  app.get('/api/session', async (req, res) => {
    if (!req.sessionContext) {
      res.status(200).json({ authenticated: false });
      return;
    }

    res.status(200).json({
      authenticated: true,
      csrfToken: req.sessionContext.session.csrfToken,
      user: {
        randId: req.sessionContext.user.randId,
        email: req.sessionContext.user.email,
        firstName: req.sessionContext.user.firstName,
        lastName: req.sessionContext.user.lastName,
        isAuthAdmin: opts.isAuthAdmin(req),
      },
      tenantRandId: req.sessionContext.session.tenantRandId,
    });
  });
};
