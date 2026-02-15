import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { VersionedEntityBase } from './VersionedEntityBase';

@Entity({ name: 'organizations' })
@Index('organizations_rand_version_uq', ['randId', 'versionNo'], { unique: true })
@Index('organizations_current_rand_uq', ['randId'], { unique: true, where: 'is_current = true' })
@Index('organizations_current_code_uq', ['code'], { unique: true, where: 'is_current = true' })
@Index('organizations_parent_lookup_idx', ['parentOrgRandId'])
export class OrganizationEntity extends VersionedEntityBase {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'name', type: 'varchar', length: 180 })
  name!: string;

  @Column({ name: 'code', type: 'varchar', length: 96 })
  code!: string;

  @Column({ name: 'parent_org_rand_id', type: 'varchar', length: 64, nullable: true })
  parentOrgRandId!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'meta', type: 'jsonb', default: () => "'{}'::jsonb" })
  meta!: Record<string, unknown>;
}
