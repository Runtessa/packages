import express from 'express';
import { config } from '../../lib/config';
import { registerLimiter, requireTrustedOrigin } from '../../lib/security';
import { createSession, issueSessionCookie } from '../../lib/sessions';
import { requestIp, requestUserAgent } from '../../lib/http';
import { assertPhoneRegistrationAllowed, registerUser, registerUserByPhone } from '../../lib/services/auth';
import { issueOtpChallenge, verifyOtpChallenge } from '../../lib/services/otp';
import { logActivity } from '../../lib/activity';
import { assignUserOrganization } from '../../lib/services/access-admin';
import { resolveTenantOrgContext, upsertUserTenantMembership } from '../../lib/services/user-tenant-context';
import {
  appendAuthContext,
  appendQuery,
  encodeErrorParam,
  optionalString,
  optionalTenantOrgRandId,
  resolveTenantHostForCookie,
  toErrorMessage,
  wantsJson,
} from '../helpers';
import { setLoginUiState } from '../login-ui-state';
import { readAuthFlowContext } from './context';

export const registerAuthRegisterRoutes = (app: express.Express): void => {
  app.post('/auth/register/start', registerLimiter, requireTrustedOrigin, async (req, res) => {
    const { returnTo, clientId, tenantName, tenantOrgRandId } = readAuthFlowContext(req);
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);
    const requestedSignupStep = optionalString(req.body.signup_step || req.query.signup_step, 16).toLowerCase();

    try {
      const tenantContext = tenantName
        ? await resolveTenantOrgContext({ tenantName, tenantOrgRandId: tenantOrgRandId || null })
        : { tenantName: null, tenantRandId: null, effectiveOrgRandId: null };
      const normalizedPhone = await assertPhoneRegistrationAllowed({
        phoneNumber,
        clientId: clientId || undefined,
        tenantName: tenantContext.tenantName || tenantName || undefined,
      });

      const challenge = await issueOtpChallenge({
        purpose: 'signup',
        destinationPhone: normalizedPhone,
        payload: {
          clientId: clientId || null,
          tenantName: tenantContext.tenantName || tenantName || null,
          tenantRandId: tenantContext.tenantRandId || null,
          tenantOrgRandId: tenantContext.effectiveOrgRandId || null,
        },
      });

      await logActivity({
        eventType: 'auth.register.otp.sent',
        targetType: 'user',
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: {
          phoneNumber: normalizedPhone,
          expiresAt: challenge.expiresAt.toISOString(),
          clientId: clientId || null,
          tenantName: tenantContext.tenantName || tenantName || null,
          tenantRandId: tenantContext.tenantRandId || null,
          tenantOrgRandId: tenantContext.effectiveOrgRandId || null,
        },
      });

      if (wantsJson(req)) {
        res.status(202).json({
          ok: true,
          requiresOtp: true,
          phoneNumber: normalizedPhone,
          resendAvailableAt: challenge.resendAvailableAt.toISOString(),
          ...(config.isDevelopment ? { otpDebugCode: challenge.code } : {}),
        });
        return;
      }

      setLoginUiState(res, {
        mode: 'signup',
        signupStep: 'verify',
        otpWaitUntilMs: challenge.resendAvailableAt.getTime(),
        phoneNumber: normalizedPhone,
        success: config.isDevelopment
          ? `OTP sent. Dev OTP: ${challenge.code}`
          : 'OTP sent. Enter the code to complete signup.',
      });
      res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId }));
    } catch (error) {
      if (wantsJson(req)) {
        res.status((error as { statusCode?: number }).statusCode || 400).json({
          error: error instanceof Error ? error.message : 'OTP request failed',
        });
        return;
      }

      setLoginUiState(res, {
        mode: 'signup',
        signupStep: requestedSignupStep === 'verify' ? 'verify' : 'start',
        otpWaitUntilMs:
          typeof (error as { retryAfterAt?: unknown }).retryAfterAt === 'number'
            ? (error as { retryAfterAt: number }).retryAfterAt
            : undefined,
        phoneNumber,
        error: toErrorMessage(error, 'OTP request failed'),
      });
      res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId }));
    }
  });

  app.post('/auth/register/complete', registerLimiter, requireTrustedOrigin, async (req, res) => {
    const { returnTo, clientId, tenantName, tenantOrgRandId } = readAuthFlowContext(req);
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);
    const otpCode = optionalString(req.body.otp_code || req.body.otpCode || req.query.otp_code, 12);

    try {
      const verified = await verifyOtpChallenge({
        purpose: 'signup',
        destinationPhone: phoneNumber,
        code: otpCode,
      });

      const payloadTenantName = optionalString(verified.payload.tenantName, 255);
      const payloadTenantRandId = optionalString(verified.payload.tenantRandId, 64) || null;
      const payloadTenantOrgRandId = optionalTenantOrgRandId(verified.payload.tenantOrgRandId);
      const effectiveTenantName = payloadTenantName || tenantName || '';
      const requestedTenantOrgRandId = tenantOrgRandId || payloadTenantOrgRandId;
      const tenantContext = effectiveTenantName
        ? await resolveTenantOrgContext({
            tenantName: effectiveTenantName,
            tenantOrgRandId: requestedTenantOrgRandId || null,
          })
        : {
            tenantName: null,
            tenantRandId: payloadTenantRandId || null,
            effectiveOrgRandId: requestedTenantOrgRandId || null,
          };

      const user = await registerUserByPhone({
        phoneNumber,
        clientId: clientId || undefined,
        tenantName: tenantContext.tenantName || effectiveTenantName || undefined,
      });

      if (tenantContext.tenantName) {
        await upsertUserTenantMembership({
          userRandId: user.randId,
          tenantName: tenantContext.tenantName,
          tenantRandId: tenantContext.tenantRandId || payloadTenantRandId || null,
          orgRandId: tenantContext.effectiveOrgRandId || null,
          source: 'signup',
          actorUserRandId: user.randId,
          actorTenantRandId: tenantContext.tenantRandId || payloadTenantRandId || null,
        });

        if (tenantContext.effectiveOrgRandId) {
          await assignUserOrganization({
            userRandId: user.randId,
            orgRandId: tenantContext.effectiveOrgRandId,
            isAssignmentActive: true,
            actorUserRandId: user.randId,
          });
        }
      }

      const { sessionToken, sessionEntity } = await createSession({
        userRandId: user.randId,
        tenantRandId: null,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      issueSessionCookie(req, res, sessionToken, resolveTenantHostForCookie(req, returnTo));

      await logActivity({
        eventType: 'auth.register.success',
        actorUserRandId: user.randId,
        targetType: 'user',
        targetRandId: user.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: { via: 'phone_otp' },
      });

      if (wantsJson(req)) {
        res.status(201).json({ ok: true, returnTo, csrfToken: sessionEntity.csrfToken });
        return;
      }

      res.redirect(returnTo);
    } catch (error) {
      await logActivity({
        eventType: 'auth.register.failed',
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: {
          message: error instanceof Error ? error.message : 'register_failed',
          phoneNumber,
          clientId,
          flow: 'phone_otp',
        },
      });

      if (wantsJson(req)) {
        res.status((error as { statusCode?: number }).statusCode || 400).json({
          error: error instanceof Error ? error.message : 'Registration failed',
        });
        return;
      }

      setLoginUiState(res, {
        mode: 'signup',
        signupStep: 'verify',
        phoneNumber,
        error: toErrorMessage(error, 'Registration failed'),
      });
      res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId }));
    }
  });

  app.post('/auth/register', registerLimiter, requireTrustedOrigin, async (req, res) => {
    const { returnTo, clientId, tenantName, tenantOrgRandId } = readAuthFlowContext(req);
    const authUi = optionalString(req.body.auth_ui, 32).toLowerCase();

    try {
      const tenantContext = tenantName
        ? await resolveTenantOrgContext({ tenantName, tenantOrgRandId: tenantOrgRandId || null })
        : { tenantName: null, tenantRandId: null, effectiveOrgRandId: null };
      const user = await registerUser({
        email: String(req.body.email || ''),
        password: String(req.body.password || ''),
        firstName: String(req.body.first_name || req.body.firstName || ''),
        lastName: String(req.body.last_name || req.body.lastName || ''),
        nationalId: String(req.body.national_id || req.body.nationalId || ''),
        phoneNumber: String(req.body.phone_number || req.body.phoneNumber || ''),
        clientId: clientId || undefined,
        tenantName: tenantContext.tenantName || tenantName || undefined,
      });

      if (tenantContext.tenantName) {
        await upsertUserTenantMembership({
          userRandId: user.randId,
          tenantName: tenantContext.tenantName,
          tenantRandId: tenantContext.tenantRandId || null,
          orgRandId: tenantContext.effectiveOrgRandId || null,
          source: 'signup',
          actorUserRandId: user.randId,
          actorTenantRandId: tenantContext.tenantRandId || null,
        });

        if (tenantContext.effectiveOrgRandId) {
          await assignUserOrganization({
            userRandId: user.randId,
            orgRandId: tenantContext.effectiveOrgRandId,
            isAssignmentActive: true,
            actorUserRandId: user.randId,
          });
        }
      }

      const { sessionToken, sessionEntity } = await createSession({
        userRandId: user.randId,
        tenantRandId: null,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      issueSessionCookie(req, res, sessionToken, resolveTenantHostForCookie(req, returnTo));

      await logActivity({
        eventType: 'auth.register.success',
        actorUserRandId: user.randId,
        targetType: 'user',
        targetRandId: user.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      if (wantsJson(req)) {
        res.status(201).json({ ok: true, returnTo, csrfToken: sessionEntity.csrfToken });
        return;
      }

      res.redirect(returnTo);
    } catch (error) {
      await logActivity({
        eventType: 'auth.register.failed',
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: {
          message: error instanceof Error ? error.message : 'register_failed',
          email: String(req.body.email || '').toLowerCase(),
          clientId,
        },
      });

      if (wantsJson(req)) {
        res.status((error as { statusCode?: number }).statusCode || 400).json({
          error: error instanceof Error ? error.message : 'Registration failed',
        });
        return;
      }

      if (authUi === 'login') {
        setLoginUiState(res, {
          mode: 'signup',
          error: toErrorMessage(error, 'Registration failed'),
          phoneNumber: optionalString(req.body.phone_number || req.body.phoneNumber || '', 32),
        });
        res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId }));
        return;
      }

      let location = `/register?error=${encodeErrorParam(error)}&returnTo=${encodeURIComponent(returnTo)}`;
      if (clientId) location = appendQuery(location, 'client_id', clientId);
      if (tenantName) location = appendQuery(location, 'tenant_name', tenantName);
      if (tenantOrgRandId) location = appendQuery(location, 'tenant_org_id', tenantOrgRandId);
      res.redirect(location);
    }
  });
};
