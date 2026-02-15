import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

@Entity({ name: 'auth_sessions' })
@Index('auth_sessions_user_idx', ['userRandId', 'expiresAt', 'revokedAt'])
export class AuthSessionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'rand_id', type: 'varchar', length: 64, unique: true })
  randId!: string;

  @Column({ name: 'session_token_hash', type: 'varchar', length: 128, unique: true })
  sessionTokenHash!: string;

  @Column({ name: 'user_rand_id', type: 'varchar', length: 64 })
  userRandId!: string;

  @Column({ name: 'tenant_rand_id', type: 'varchar', length: 64, nullable: true })
  tenantRandId!: string | null;

  @Column({ name: 'csrf_token', type: 'varchar', length: 128 })
  csrfToken!: string;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'idle_expires_at', type: 'timestamptz' })
  idleExpiresAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz', default: () => 'NOW()' })
  lastSeenAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
