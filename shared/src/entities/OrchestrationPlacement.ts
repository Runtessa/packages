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
import { OrchestrationAgent } from './OrchestrationAgent';
import { OrchestrationWorkload } from './OrchestrationWorkload';

export type OrchestrationPlacementStatus = 'pending' | 'running' | 'failed' | 'removed';

@Entity({ name: 'orchestration_placements' })
@Index(['tenantId', 'workloadId', 'agentId'], { unique: true })
@Index(['tenantId', 'status'])
export class OrchestrationPlacement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Tenant, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<Tenant>;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => OrchestrationWorkload, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workload_id' })
  workload!: Relation<OrchestrationWorkload>;

  @Column({ name: 'workload_id', type: 'uuid' })
  workloadId!: string;

  @ManyToOne(() => OrchestrationAgent, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'agent_id' })
  agent?: Relation<OrchestrationAgent> | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId?: string | null;

  @Column({ name: 'runtime_ref', type: 'varchar', length: 255, nullable: true })
  runtimeRef?: string | null;

  @Column({ name: 'desired_replicas', type: 'int', default: 0 })
  desiredReplicas!: number;

  @Column({ name: 'actual_replicas', type: 'int', default: 0 })
  actualReplicas!: number;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: OrchestrationPlacementStatus;

  @Column({ type: 'text', nullable: true })
  message?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
