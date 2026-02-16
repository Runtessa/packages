import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'auth_otp_challenges' })
@Index('auth_otp_challenges_rand_id_uq', ['randId'], { unique: true })
@Index('auth_otp_challenges_lookup_idx', ['purpose', 'destination', 'expiresAt'])
export class OtpChallengeEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'rand_id', type: 'varchar', length: 64 })
  randId!: string;

  @Column({ name: 'purpose', type: 'varchar', length: 32 })
  purpose!: string;

  @Column({ name: 'channel', type: 'varchar', length: 16, default: 'sms' })
  channel!: string;

  @Column({ name: 'destination', type: 'varchar', length: 64 })
  destination!: string;

  @Column({ name: 'code_hash', type: 'varchar', length: 128 })
  codeHash!: string;

  @Column({ name: 'attempts_used', type: 'integer', default: 0 })
  attemptsUsed!: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 5 })
  maxAttempts!: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'payload', type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
