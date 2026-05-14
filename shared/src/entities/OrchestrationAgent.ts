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

export type OrchestrationRuntime = 'docker' | 'k8s';
export type OrchestrationAgentStatus = 'online' | 'degraded' | 'offline';

@Entity({ name: 'orchestration_agents' })
@Index(['tenantId', 'key'], { unique: true })
@Index(['tenantId', 'runtimeType'])
@Index(['tenantId', 'status'])
export class OrchestrationAgent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Tenant, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<Tenant>;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 128 })
  key!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160, nullable: true })
  displayName?: string | null;

  @Column({ name: 'runtime_type', type: 'varchar', length: 16, default: 'docker' })
  runtimeType!: OrchestrationRuntime;

  @Column({ name: 'server_host', type: 'varchar', length: 255, nullable: true })
  serverHost?: string | null;

  @Column({ type: 'varchar', length: 16, default: 'online' })
  status!: OrchestrationAgentStatus;

  @Column({ type: 'jsonb', nullable: true })
  labels?: Record<string, string> | null;

  @Column({ type: 'jsonb', nullable: true })
  capacity?: Record<string, number | string | boolean> | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
