import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

@Entity({ name: 'oauth_access_tokens' })
@Index('oauth_access_tokens_lookup_idx', ['clientId', 'userRandId', 'expiresAt', 'revokedAt'])
@Index('oauth_access_tokens_tenant_name_idx', ['tenantName', 'expiresAt', 'revokedAt'])
export class OAuthAccessTokenEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 128, unique: true })
  tokenHash!: string;

  @Column({ name: 'client_id', type: 'varchar', length: 120 })
  clientId!: string;

  @Column({ name: 'tenant_rand_id', type: 'varchar', length: 64 })
  tenantRandId!: string;

  @Column({ name: 'tenant_name', type: 'varchar', length: 255 })
  tenantName!: string;

  @Column({ name: 'user_rand_id', type: 'varchar', length: 64, nullable: true })
  userRandId!: string | null;

  @Column({ name: 'scope', type: 'text' })
  scope!: string;

  @Column({ name: 'grant_type', type: 'varchar', length: 40 })
  grantType!: string;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
