import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'tenant_sso_whitelist' })
@Index('tenant_sso_whitelist_name_uq', ['tenantName'], { unique: true })
@Index('tenant_sso_whitelist_active_idx', ['isActive'])
export class TenantWhitelistEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'tenant_name', type: 'varchar', length: 255 })
  tenantName!: string;

  @Column({ name: 'tenant_rand_id', type: 'varchar', length: 64, nullable: true })
  tenantRandId!: string | null;

  @Column({ name: 'sso_token_hash', type: 'varchar', length: 128 })
  ssoTokenHash!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'meta', type: 'jsonb', default: () => "'{}'::jsonb" })
  meta!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
