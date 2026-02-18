import { Request, Response } from 'express';
import { createSession, issueSessionCookie } from '../../lib/sessions';
import { requestIp, requestUserAgent } from '../../lib/http';
import { logActivity } from '../../lib/activity';
import { readUserSecurityState } from '../../lib/services/auth';
import { resolveTenantOrgContext, upsertUserTenantMembership } from '../../lib/services/user-tenant-context';
import { appendAuthContext, resolveTenantHostForCookie, toErrorMessage, wantsJson } from '../helpers';
import { clearLoginTwoFactorPending, setLoginTwoFactorPending, setLoginUiState } from '../login-ui-state';

export type LoginFlowContext = {
  returnTo: string;
  clientId: string;
  tenantName: string;
  tenantOrgRandId: string;
};

export const requiresAuthenticatorTwoFactor = (
  security: ReturnType<typeof readUserSecurityState>
): boolean => {
  return Boolean(security.twoFactorEnabled && security.twoFactorMethod === 'app' && security.twoFactorSecret);
};

export const setTwoFactorPendingForUser = (
  res: Response,
  context: LoginFlowContext,
  userRandId: string
): void => {
  setLoginTwoFactorPending(res, {
    userRandId,
    returnTo: context.returnTo,
    clientId: context.clientId || undefined,
    tenantName: context.tenantName || undefined,
    tenantOrgRandId: context.tenantOrgRandId || undefined,
  });
};

export const respondTwoFactorRequired = (
  req: Request,
  res: Response,
  options: {
    context: LoginFlowContext;
    phoneNumber: string;
    signinMethod: 'password' | 'otp';
    successMessage: string;
  }
): void => {
  const { context, phoneNumber, signinMethod, successMessage } = options;
  if (wantsJson(req)) {
    res.status(202).json({
      ok: false,
      requiresTwoFactor: true,
      twoFactorMethod: 'authenticator',
      message: 'Enter authenticator verification code',
    });
    return;
  }

  setLoginUiState(res, {
    mode: 'signin',
    signinMethod,
    signinStep: 'twofactor',
    require2fa: true,
    phoneNumber,
    success: successMessage,
  });
  res.redirect(
    appendAuthContext('/login', {
      returnTo: context.returnTo,
      clientId: context.clientId,
      tenantName: context.tenantName,
      tenantOrgRandId: context.tenantOrgRandId,
    })
  );
};

export const completeLoginForUser = async (
  req: Request,
  res: Response,
  options: {
    context: LoginFlowContext;
    user: { randId: string; phoneNumber: string };
    successEventType: string;
  }
): Promise<void> => {
  const { context, user, successEventType } = options;

  const { sessionToken, sessionEntity } = await createSession({
    userRandId: user.randId,
    tenantRandId: null,
    ipAddress: requestIp(req),
    userAgent: requestUserAgent(req),
  });

  clearLoginTwoFactorPending(res);
  issueSessionCookie(req, res, sessionToken, resolveTenantHostForCookie(req, context.returnTo));

  if (context.tenantName) {
    const tenantContext = await resolveTenantOrgContext({
      tenantName: context.tenantName,
      tenantOrgRandId: context.tenantOrgRandId || null,
    });
    await upsertUserTenantMembership({
      userRandId: user.randId,
      tenantName: tenantContext.tenantName || context.tenantName,
      tenantRandId: tenantContext.tenantRandId,
      orgRandId: tenantContext.effectiveOrgRandId,
      source: 'login',
      actorUserRandId: user.randId,
      actorTenantRandId: tenantContext.tenantRandId || null,
    });
  }

  await logActivity({
    eventType: successEventType,
    actorUserRandId: user.randId,
    targetType: 'user',
    targetRandId: user.randId,
    ipAddress: requestIp(req),
    userAgent: requestUserAgent(req),
  });

  if (wantsJson(req)) {
    res.status(200).json({ ok: true, returnTo: context.returnTo, csrfToken: sessionEntity.csrfToken });
    return;
  }

  res.redirect(context.returnTo);
};

export const respondLoginError = (
  req: Request,
  res: Response,
  options: {
    context: LoginFlowContext;
    signinMethod: 'password' | 'otp';
    signinStep: 'phone' | 'password' | 'otp' | 'twofactor';
    phoneNumber: string;
    fallbackMessage: string;
    error: unknown;
    otpWaitUntilMs?: number;
    require2fa?: boolean;
  }
): void => {
  const {
    context,
    signinMethod,
    signinStep,
    phoneNumber,
    fallbackMessage,
    error,
    otpWaitUntilMs,
    require2fa,
  } = options;

  if (wantsJson(req)) {
    res.status((error as { statusCode?: number }).statusCode || 400).json({
      error: error instanceof Error ? error.message : fallbackMessage,
    });
    return;
  }

  setLoginUiState(res, {
    mode: 'signin',
    signinMethod,
    signinStep,
    require2fa,
    phoneNumber,
    otpWaitUntilMs,
    error: toErrorMessage(error, fallbackMessage),
  });
  res.redirect(
    appendAuthContext('/login', {
      returnTo: context.returnTo,
      clientId: context.clientId,
      tenantName: context.tenantName,
      tenantOrgRandId: context.tenantOrgRandId,
    })
  );
};
