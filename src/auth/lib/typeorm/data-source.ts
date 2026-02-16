import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from '../config';
import {
  ActivityEntity,
  AuthSessionEntity,
  OAuthAccessTokenEntity,
  OAuthAuthorizationCodeEntity,
  OAuthClientEntity,
  OtpChallengeEntity,
  OrganizationEntity,
  RoleEntity,
  TenantWhitelistEntity,
  UserEntity,
  UserOrganizationEntity,
  UserRoleEntity,
} from './entities';

export const entities = [
  ActivityEntity,
  AuthSessionEntity,
  OAuthAccessTokenEntity,
  OAuthAuthorizationCodeEntity,
  OAuthClientEntity,
  OtpChallengeEntity,
  OrganizationEntity,
  RoleEntity,
  TenantWhitelistEntity,
  UserEntity,
  UserOrganizationEntity,
  UserRoleEntity,
];

export const AuthDataSource = new DataSource({
  type: 'postgres',
  url: config.db.connectionString,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
  logging: false,
  synchronize: false,
  entities,
});
