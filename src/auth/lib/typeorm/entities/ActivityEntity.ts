import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

@Entity({ name: 'activity' })
@Index('activity_created_idx', ['createdAt'])
@Index('activity_actor_idx', ['actorUserRandId', 'actorTenantRandId', 'createdAt'])
@Index('activity_event_idx', ['eventType', 'createdAt'])
export class ActivityEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'rand_id', type: 'varchar', length: 64, unique: true })
  randId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 96 })
  eventType!: string;

  @Column({ name: 'actor_user_rand_id', type: 'varchar', length: 64, nullable: true })
  actorUserRandId!: string | null;

  @Column({ name: 'actor_tenant_rand_id', type: 'varchar', length: 64, nullable: true })
  actorTenantRandId!: string | null;

  @Column({ name: 'target_type', type: 'varchar', length: 64, nullable: true })
  targetType!: string | null;

  @Column({ name: 'target_rand_id', type: 'varchar', length: 64, nullable: true })
  targetRandId!: string | null;

  @Column({ name: 'oauth_client_id', type: 'varchar', length: 120, nullable: true })
  oauthClientId!: string | null;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'payload', type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
