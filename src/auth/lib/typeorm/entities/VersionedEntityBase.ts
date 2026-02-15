import { Column, CreateDateColumn } from 'typeorm';

export abstract class VersionedEntityBase {
  @Column({ name: 'rand_id', type: 'varchar', length: 64 })
  randId!: string;

  @Column({ name: 'version_no', type: 'integer' })
  versionNo!: number;

  @Column({ name: 'is_current', type: 'boolean', default: true })
  isCurrent!: boolean;

  @Column({ name: 'previous_row_id', type: 'bigint', nullable: true })
  previousRowId!: string | null;

  @Column({ name: 'changed_at', type: 'timestamptz', default: () => 'NOW()' })
  changedAt!: Date;

  @Column({ name: 'changed_by_user_rand_id', type: 'varchar', length: 64, nullable: true })
  changedByUserRandId!: string | null;

  @Column({ name: 'changed_by_tenant_rand_id', type: 'varchar', length: 64, nullable: true })
  changedByTenantRandId!: string | null;

  @Column({ name: 'change_reason', type: 'text', nullable: true })
  changeReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
