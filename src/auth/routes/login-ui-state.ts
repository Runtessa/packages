import { Request, Response } from 'express';
import { config } from '../lib/config';

export type LoginUiMode = 'signin' | 'signup';
export type LoginUiSignupStep = 'start' | 'verify';

export interface LoginUiState {
  mode?: LoginUiMode;
  signinMethod?: 'password' | 'otp';
  signinStep?: 'method' | 'phone' | 'password' | 'otp' | 'twofactor';
  signupStep?: LoginUiSignupStep;
  require2fa?: boolean;
  otpWaitUntilMs?: number;
  phoneNumber?: string;
  success?: string;
  error?: string;
}

export interface LoginTwoFactorPendingState {
  userRandId: string;
  returnTo: string;
  clientId?: string;
  tenantName?: string;
  tenantOrgRandId?: string;
  expiresAt: number;
}

export const LOGIN_UI_STATE_COOKIE = 'idp_login_ui_state';
export const LOGIN_2FA_PENDING_COOKIE = 'idp_login_2fa_pending';
export const LOGIN_2FA_PENDING_TTL_MS = 5 * 60 * 1000;

const loginUiCookieOptions = {
  path: '/',
  httpOnly: true,
  signed: true,
  sameSite: config.cookie.sameSite,
  secure: config.cookie.secure,
  domain: config.cookie.domain,
};

export const setLoginUiState = (res: Response, state: LoginUiState): void => {
  const payload = JSON.stringify(state);
  res.cookie(LOGIN_UI_STATE_COOKIE, payload, { ...loginUiCookieOptions, maxAge: 5 * 60 * 1000 });
};

export const clearLoginUiState = (res: Response): void => {
  res.clearCookie(LOGIN_UI_STATE_COOKIE, loginUiCookieOptions);
};

export const setLoginTwoFactorPending = (
  res: Response,
  state: Omit<LoginTwoFactorPendingState, 'expiresAt'>,
): void => {
  const expiresAt = Date.now() + LOGIN_2FA_PENDING_TTL_MS;
  const payload = JSON.stringify({
    ...state,
    expiresAt,
  });
  res.cookie(LOGIN_2FA_PENDING_COOKIE, payload, {
    ...loginUiCookieOptions,
    maxAge: LOGIN_2FA_PENDING_TTL_MS,
  });
};

export const clearLoginTwoFactorPending = (res: Response): void => {
  res.clearCookie(LOGIN_2FA_PENDING_COOKIE, loginUiCookieOptions);
};

export const readLoginTwoFactorPending = (req: Request): LoginTwoFactorPendingState | null => {
  const raw = req.signedCookies?.[LOGIN_2FA_PENDING_COOKIE];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as LoginTwoFactorPendingState;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.userRandId || !parsed.returnTo || !Number.isFinite(parsed.expiresAt)) return null;
    if (Date.now() >= parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
};
