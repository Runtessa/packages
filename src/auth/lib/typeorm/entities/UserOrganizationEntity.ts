import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { VersionedEntityBase } from './VersionedEntityBase';

@Entity({ name: 'user_orgs' })
@Index('user_orgs_rand_version_uq', ['randId', 'versionNo'], { unique: true })
@Index('user_orgs_current_rand_uq', ['randId'], { unique: true, where: 'is_current = true' })
@Index('user_orgs_current_pair_uq', ['userRandId', 'orgRandId'], { unique: true, where: 'is_current = true' })
@Index('user_orgs_user_lookup_idx', ['userRandId', 'isCurrent', 'isAssignmentActive'])
export class UserOrganizationEntity extends VersionedEntityBase {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'user_rand_id', type: 'varchar', length: 64 })
  userRandId!: string;

  @Column({ name: 'org_rand_id', type: 'varchar', length: 64 })
  orgRandId!: string;

  @Column({ name: 'is_assignment_active', type: 'boolean', default: true })
  isAssignmentActive!: boolean;

  @Column({ name: 'meta', type: 'jsonb', default: () => "'{}'::jsonb" })
  meta!: Record<string, unknown>;
}
