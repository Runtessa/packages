import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'oauth_clients' })
@Index('oauth_clients_tenant_idx', ['tenantRandId', 'isActive'])
export class OAuthClientEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'rand_id', type: 'varchar', length: 64, unique: true })
  randId!: string;

  @Column({ name: 'client_id', type: 'varchar', length: 120, unique: true })
  clientId!: string;

  @Column({ name: 'client_secret_hash', type: 'varchar', length: 255 })
  clientSecretHash!: string;

  @Column({ name: 'tenant_rand_id', type: 'varchar', length: 64 })
  tenantRandId!: string;

  @Column({ name: 'name', type: 'varchar', length: 180 })
  name!: string;

  @Column({ name: 'allowed_redirect_uris', type: 'text', array: true })
  allowedRedirectUris!: string[];

  @Column({ name: 'allowed_scopes', type: 'text', array: true })
  allowedScopes!: string[];

  @Column({ name: 'require_pkce', type: 'boolean', default: true })
  requirePkce!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'meta', type: 'jsonb', default: () => "'{}'::jsonb" })
  meta!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
