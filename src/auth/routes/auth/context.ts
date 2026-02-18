import { Request } from 'express';
import { safeReturnTo } from '../../lib/http';
import { optionalString, optionalTenantOrgRandId } from '../helpers';

export interface AuthFlowContext {
  returnTo: string;
  clientId: string;
  tenantName: string;
  tenantOrgRandId: string;
}

export const readAuthFlowContext = (req: Request, defaultReturnTo = '/profile'): AuthFlowContext => {
  return {
    returnTo: safeReturnTo(req.body.returnTo || req.query.returnTo || defaultReturnTo, defaultReturnTo),
    clientId: optionalString(req.body.client_id || req.query.client_id, 120),
    tenantName: optionalString(req.body.tenant_name || req.query.tenant_name, 255),
    tenantOrgRandId: optionalTenantOrgRandId(
      req.body.tenant_org_id || req.body.tenantOrgRandId || req.query.tenant_org_id || req.query.tenantOrgRandId,
    ),
  };
};
