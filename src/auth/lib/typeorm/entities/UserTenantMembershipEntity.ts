import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { VersionedEntityBase } from './VersionedEntityBase';

@Entity({ name: 'user_tenant_memberships' })
@Index('user_tenant_memberships_rand_version_uq', ['randId', 'versionNo'], { unique: true })
@Index('user_tenant_memberships_current_rand_uq', ['randId'], { unique: true, where: 'is_current = true' })
@Index('user_tenant_memberships_current_pair_uq', ['userRandId', 'tenantName', 'orgRandId'], {
  unique: true,
  where: 'is_current = true',
})
@Index('user_tenant_memberships_tenant_lookup_idx', ['tenantName', 'orgRandId', 'isCurrent', 'isActive'])
@Index('user_tenant_memberships_user_lookup_idx', ['userRandId', 'isCurrent', 'isActive'])
export class UserTenantMembershipEntity extends VersionedEntityBase {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'user_rand_id', type: 'varchar', length: 64 })
  userRandId!: string;

  @Column({ name: 'tenant_name', type: 'varchar', length: 255 })
  tenantName!: string;

  @Column({ name: 'tenant_rand_id', type: 'varchar', length: 64, nullable: true })
  tenantRandId!: string | null;

  @Column({ name: 'org_rand_id', type: 'varchar', length: 64, nullable: true })
  orgRandId!: string | null;

  @Column({ name: 'source', type: 'varchar', length: 32, default: 'signup' })
  source!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'meta', type: 'jsonb', default: () => "'{}'::jsonb" })
  meta!: Record<string, unknown>;
}

