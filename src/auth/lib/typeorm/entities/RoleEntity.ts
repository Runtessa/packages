import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { VersionedEntityBase } from './VersionedEntityBase';

@Entity({ name: 'roles' })
@Index('roles_rand_version_uq', ['randId', 'versionNo'], { unique: true })
@Index('roles_current_rand_uq', ['randId'], { unique: true, where: 'is_current = true' })
@Index('roles_org_code_current_uq', ['orgRandId', 'roleCode'], { unique: true, where: 'is_current = true' })
@Index('roles_org_lookup_idx', ['orgRandId', 'isCurrent'])
export class RoleEntity extends VersionedEntityBase {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'role_name', type: 'varchar', length: 160 })
  roleName!: string;

  @Column({ name: 'role_code', type: 'varchar', length: 96 })
  roleCode!: string;

  @Column({ name: 'org_rand_id', type: 'varchar', length: 64 })
  orgRandId!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'meta', type: 'jsonb', default: () => "'{}'::jsonb" })
  meta!: Record<string, unknown>;
}
