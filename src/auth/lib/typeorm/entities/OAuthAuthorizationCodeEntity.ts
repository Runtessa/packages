import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

@Entity({ name: 'oauth_authorization_codes' })
@Index('oauth_code_client_user_idx', ['clientId', 'userRandId', 'expiresAt'])
@Index('oauth_code_tenant_name_idx', ['tenantName', 'expiresAt'])
export class OAuthAuthorizationCodeEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'code_hash', type: 'varchar', length: 128, unique: true })
  codeHash!: string;

  @Column({ name: 'client_id', type: 'varchar', length: 120 })
  clientId!: string;

  @Column({ name: 'tenant_rand_id', type: 'varchar', length: 64 })
  tenantRandId!: string;

  @Column({ name: 'tenant_name', type: 'varchar', length: 255 })
  tenantName!: string;

  @Column({ name: 'user_rand_id', type: 'varchar', length: 64 })
  userRandId!: string;

  @Column({ name: 'redirect_uri', type: 'text' })
  redirectUri!: string;

  @Column({ name: 'scope', type: 'text' })
  scope!: string;

  @Column({ name: 'code_challenge', type: 'text', nullable: true })
  codeChallenge!: string | null;

  @Column({ name: 'code_challenge_method', type: 'varchar', length: 12, nullable: true })
  codeChallengeMethod!: string | null;

  @Column({ name: 'state', type: 'text', nullable: true })
  state!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
