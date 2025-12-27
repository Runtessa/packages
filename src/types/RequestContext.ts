import { Request } from 'express';
import { Account } from '../entities/Account';
import { Tenant } from '../entities/Tenant';
import { TokenPayload } from '../core/security/CryptoService';

export interface TenantRequest extends Request {
  tenant?: Tenant;
  account?: Account;
  tokenPayload?: TokenPayload;
}
