import express from 'express';
import { registerProfileAccountRoutes } from './account';
import { registerProfileTwoFactorRoutes } from './two-factor';

export const registerProfileRoutes = (app: express.Express): void => {
  registerProfileAccountRoutes(app);
  registerProfileTwoFactorRoutes(app);
};
