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

export type OrchestrationWorkloadState = 'running' | 'stopped' | 'removed';

@Entity({ name: 'orchestration_workloads' })
@Index(['tenantId', 'key'], { unique: true })
@Index(['tenantId', 'runtimeType'])
@Index(['tenantId', 'state'])
export class OrchestrationWorkload {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Tenant, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<Tenant>;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 160 })
  key!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'runtime_type', type: 'varchar', length: 16, default: 'docker' })
  runtimeType!: 'docker' | 'k8s';

  @Column({ type: 'varchar', length: 24, default: 'running' })
  state!: OrchestrationWorkloadState;

  @Column({ type: 'varchar', length: 255 })
  image!: string;

  @Column({ name: 'desired_replicas', type: 'int', default: 1 })
  desiredReplicas!: number;

  @Column({ name: 'revision', type: 'int', default: 1 })
  revision!: number;

  @Column({ type: 'jsonb', nullable: true })
  config?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  placement?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
