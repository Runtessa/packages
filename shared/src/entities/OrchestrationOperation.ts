import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Tenant } from './Tenant';
import { OrchestrationWorkload } from './OrchestrationWorkload';

export type OrchestrationOperationType =
  | 'create'
  | 'update'
  | 'scale'
  | 'stop'
  | 'remove'
  | 'reconcile';
export type OrchestrationOperationStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

@Entity({ name: 'orchestration_operations' })
@Index(['tenantId', 'status'])
@Index(['tenantId', 'type'])
@Index(['tenantId', 'idempotencyKey'], { unique: true, where: '"idempotency_key" IS NOT NULL' })
export class OrchestrationOperation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Tenant, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<Tenant>;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => OrchestrationWorkload, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'workload_id' })
  workload?: Relation<OrchestrationWorkload> | null;

  @Column({ name: 'workload_id', type: 'uuid', nullable: true })
  workloadId?: string | null;

  @Column({ type: 'varchar', length: 24 })
  type!: OrchestrationOperationType;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: OrchestrationOperationStatus;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 120, nullable: true })
  idempotencyKey?: string | null;

  @Column({ name: 'requested_by', type: 'varchar', length: 200, nullable: true })
  requestedBy?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  request?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  result?: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
