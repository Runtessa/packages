import express from 'express';
import { registerAuthLoginRoutes } from './login';
import { registerAuthRegisterRoutes } from './register';
import { registerAuthSessionRoutes } from './session';

export const registerAuthRoutes = (app: express.Express, opts: { sessionCookieName: string }): void => {
  registerAuthLoginRoutes(app);
  registerAuthRegisterRoutes(app);
  registerAuthSessionRoutes(app, opts);
};
