import express, { Request, Response } from 'express';
import { config } from '../../lib/config';
import { loginLimiter, requireTrustedOrigin } from '../../lib/security';
import { requestIp, requestUserAgent } from '../../lib/http';
import {
  authenticateUser,
  readActiveUserByPhone,
  readActiveUserByRandId,
  readUserSecurityState,
} from '../../lib/services/auth';
import { issueOtpChallenge, verifyOtpChallenge } from '../../lib/services/otp';
import { normalizeTotpCode, verifyTotpCode } from '../../lib/services/totp';
import { logActivity } from '../../lib/activity';
import {
  appendAuthContext,
  optionalString,
  toErrorMessage,
  wantsJson,
} from '../helpers';
import {
  clearLoginTwoFactorPending,
  readLoginTwoFactorPending,
  setLoginUiState,
} from '../login-ui-state';
import { readAuthFlowContext } from './context';
import {
  completeLoginForUser,
  requiresAuthenticatorTwoFactor,
  respondLoginError,
  respondTwoFactorRequired,
  setTwoFactorPendingForUser,
  type LoginFlowContext,
} from './login-flow';

const toLoginFlowContext = (req: Request): LoginFlowContext => {
  const { returnTo, clientId, tenantName, tenantOrgRandId } = readAuthFlowContext(req);
  return {
    returnTo,
    clientId,
    tenantName,
    tenantOrgRandId,
  };
};

const completeTwoFactorLogin = async (req: Request, res: Response): Promise<void> => {
  const context = toLoginFlowContext(req);
  const verificationCode = normalizeTotpCode(
    optionalString(
      req.body.verification_code ??
        req.body.verificationCode ??
        req.body.two_factor_code ??
        req.body.twoFactorCode ??
        req.body.otp_code ??
        req.body.otpCode,
      16,
    ),
  );

  try {
    const pending = readLoginTwoFactorPending(req);
    if (!pending) {
      const error = new Error('2FA login session expired. Start login again.');
      (error as Error & { statusCode: number }).statusCode = 401;
      throw error;
    }

    if (verificationCode.length !== config.totp.digits) {
      const error = new Error(`Verification code must be ${config.totp.digits} digits`);
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const effectiveUser = await readActiveUserByRandId(pending.userRandId);
    if (!effectiveUser) {
      const error = new Error('Account not found');
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

    const security = readUserSecurityState(effectiveUser);
    if (!requiresAuthenticatorTwoFactor(security) || !security.twoFactorSecret) {
      const error = new Error('2FA is not configured for this account');
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const valid = verifyTotpCode({
      secret: security.twoFactorSecret,
      code: verificationCode,
    });
    if (!valid) {
      const error = new Error('Invalid authenticator verification code');
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    await completeLoginForUser(req, res, {
      context: {
        returnTo: pending.returnTo || context.returnTo,
        clientId: pending.clientId || context.clientId,
        tenantName: pending.tenantName || context.tenantName,
        tenantOrgRandId: pending.tenantOrgRandId || context.tenantOrgRandId,
      },
      user: { randId: effectiveUser.randId, phoneNumber: effectiveUser.phoneNumber },
      successEventType: 'auth.login.2fa.success',
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode || 400;
    if (statusCode >= 401) {
      clearLoginTwoFactorPending(res);
    }
    if (wantsJson(req)) {
      res.status(statusCode).json({
        error: error instanceof Error ? error.message : '2FA verification failed',
      });
      return;
    }

    setLoginUiState(res, {
      mode: 'signin',
      signinMethod: 'password',
      signinStep: 'twofactor',
      require2fa: true,
      error: toErrorMessage(error, '2FA verification failed'),
    });
    res.redirect(
      appendAuthContext('/login', {
        returnTo: context.returnTo,
        clientId: context.clientId,
        tenantName: context.tenantName,
        tenantOrgRandId: context.tenantOrgRandId || undefined,
      }),
    );
  }
};

export const registerAuthLoginRoutes = (app: express.Express): void => {
  app.post('/auth/login/otp/start', loginLimiter, requireTrustedOrigin, async (req, res) => {
    const context = toLoginFlowContext(req);
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);
    const requestedSigninStep = optionalString(req.body.signin_step || req.query.signin_step, 24).toLowerCase();

    try {
      const user = await readActiveUserByPhone(phoneNumber);
      if (!user) {
        if (wantsJson(req)) {
          res.status(404).json({ error: 'Account not found' });
          return;
        }

        setLoginUiState(res, {
          mode: 'signin',
          signinMethod: 'otp',
          signinStep: requestedSigninStep === 'otp' ? 'otp' : 'phone',
          phoneNumber,
          error: 'Account not found',
        });
        res.redirect(
          appendAuthContext('/login', {
            returnTo: context.returnTo,
            clientId: context.clientId,
            tenantName: context.tenantName,
            tenantOrgRandId: context.tenantOrgRandId,
          })
        );
        return;
      }

      const challenge = await issueOtpChallenge({
        purpose: 'login_otp',
        destinationPhone: user.phoneNumber,
        payload: { userRandId: user.randId, phoneNumber: user.phoneNumber },
      });

      await logActivity({
        eventType: 'auth.login.otp.challenge.sent',
        actorUserRandId: user.randId,
        targetType: 'user',
        targetRandId: user.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: { expiresAt: challenge.expiresAt.toISOString() },
      });

      if (wantsJson(req)) {
        res.status(202).json({
          ok: true,
          requiresOtp: true,
          phoneNumber: user.phoneNumber,
          resendAvailableAt: challenge.resendAvailableAt.toISOString(),
          ...(config.isDevelopment ? { otpDebugCode: challenge.code } : {}),
        });
        return;
      }

      setLoginUiState(res, {
        mode: 'signin',
        signinMethod: 'otp',
        signinStep: 'otp',
        phoneNumber: user.phoneNumber,
        otpWaitUntilMs: challenge.resendAvailableAt.getTime(),
        success: config.isDevelopment ? `OTP sent. Dev OTP: ${challenge.code}` : 'OTP sent to your phone',
      });
      res.redirect(
        appendAuthContext('/login', {
          returnTo: context.returnTo,
          clientId: context.clientId,
          tenantName: context.tenantName,
          tenantOrgRandId: context.tenantOrgRandId,
        })
      );
    } catch (error) {
      respondLoginError(req, res, {
        context,
        signinMethod: 'otp',
        signinStep: requestedSigninStep === 'otp' ? 'otp' : 'phone',
        phoneNumber,
        fallbackMessage: 'OTP request failed',
        error,
        otpWaitUntilMs:
          typeof (error as { retryAfterAt?: unknown }).retryAfterAt === 'number'
            ? (error as { retryAfterAt: number }).retryAfterAt
            : undefined,
      });
    }
  });

  app.post('/auth/login/otp/complete', loginLimiter, requireTrustedOrigin, async (req, res) => {
    const context = toLoginFlowContext(req);
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);
    const otpCode = optionalString(req.body.otp_code || req.body.otpCode || req.query.otp_code, 12);

    try {
      const user = await readActiveUserByPhone(phoneNumber);
      if (!user) {
        throw new Error('Account not found');
      }

      const verified = await verifyOtpChallenge({
        purpose: 'login_otp',
        destinationPhone: user.phoneNumber,
        code: otpCode,
      });

      const payloadUserRandId = optionalString(verified.payload.userRandId, 64);
      if (payloadUserRandId && payloadUserRandId !== user.randId) {
        const error = new Error('OTP challenge does not match this account');
        (error as Error & { statusCode: number }).statusCode = 400;
        throw error;
      }

      const security = readUserSecurityState(user);
      if (requiresAuthenticatorTwoFactor(security)) {
        setTwoFactorPendingForUser(res, context, user.randId);
        respondTwoFactorRequired(req, res, {
          context,
          phoneNumber: user.phoneNumber,
          signinMethod: 'otp',
          successMessage: 'Enter authenticator verification code',
        });
        return;
      }
      await completeLoginForUser(req, res, {
        context,
        user: { randId: user.randId, phoneNumber: user.phoneNumber },
        successEventType: 'auth.login.otp.success',
      });
    } catch (error) {
      respondLoginError(req, res, {
        context,
        signinMethod: 'otp',
        signinStep: 'otp',
        phoneNumber,
        fallbackMessage: 'Login failed',
        error,
        otpWaitUntilMs:
          typeof (error as { retryAfterAt?: unknown }).retryAfterAt === 'number'
            ? (error as { retryAfterAt: number }).retryAfterAt
            : undefined,
      });
    }
  });

  app.post('/auth/login/two-factor/complete', loginLimiter, requireTrustedOrigin, async (req, res) => {
    await completeTwoFactorLogin(req, res);
  });

  app.post('/auth/login/password/complete', loginLimiter, requireTrustedOrigin, async (req, res) => {
    await completeTwoFactorLogin(req, res);
  });

  app.post('/auth/login', loginLimiter, requireTrustedOrigin, async (req, res) => {
    const context = toLoginFlowContext(req);
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);

    try {
      const user = await authenticateUser({
        phoneNumber,
        password: String(req.body.password || ''),
      });

      if (!user) {
        await logActivity({
          eventType: 'auth.login.failed',
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
          payload: { phoneNumber },
        });

        if (wantsJson(req)) {
          res.status(401).json({ error: 'Invalid credentials' });
          return;
        }

        setLoginUiState(res, {
          mode: 'signin',
          signinMethod: 'password',
          signinStep: 'password',
          phoneNumber,
          error: 'Invalid credentials',
        });
        res.redirect(
          appendAuthContext('/login', {
            returnTo: context.returnTo,
            clientId: context.clientId,
            tenantName: context.tenantName,
            tenantOrgRandId: context.tenantOrgRandId,
          })
        );
        return;
      }

      const security = readUserSecurityState(user);
      if (requiresAuthenticatorTwoFactor(security)) {
        setTwoFactorPendingForUser(res, context, user.randId);

        await logActivity({
          eventType: 'auth.login.2fa.required',
          actorUserRandId: user.randId,
          targetType: 'user',
          targetRandId: user.randId,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
          payload: { method: 'authenticator' },
        });

        respondTwoFactorRequired(req, res, {
          context,
          phoneNumber: user.phoneNumber,
          signinMethod: 'password',
          successMessage: 'Enter authenticator verification code',
        });
        return;
      }
      await completeLoginForUser(req, res, {
        context,
        user: { randId: user.randId, phoneNumber: user.phoneNumber },
        successEventType: 'auth.login.success',
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Login failed');
      const isTwoFactorError =
        message.toLowerCase().includes('2fa') || message.toLowerCase().includes('verification code');
      respondLoginError(req, res, {
        context,
        signinMethod: 'password',
        signinStep: isTwoFactorError ? 'twofactor' : 'password',
        require2fa: isTwoFactorError,
        phoneNumber,
        fallbackMessage: message,
        error,
      });
    }
  });
};
