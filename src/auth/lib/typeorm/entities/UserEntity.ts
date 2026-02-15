import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { VersionedEntityBase } from './VersionedEntityBase';

@Entity({ name: 'users' })
@Index('users_rand_version_uq', ['randId', 'versionNo'], { unique: true })
@Index('users_current_rand_uq', ['randId'], { unique: true, where: 'is_current = true' })
@Index('users_current_email_uq', ['email'], { unique: true, where: 'is_current = true' })
@Index('users_current_national_id_uq', ['nationalId'], { unique: true, where: 'is_current = true' })
@Index('users_current_phone_uq', ['phoneNumber'], { unique: true, where: 'is_current = true' })
@Index('users_current_lookup_idx', ['isCurrent', 'isActive'])
export class UserEntity extends VersionedEntityBase {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'national_id', type: 'varchar', length: 96 })
  nationalId!: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 32 })
  phoneNumber!: string;

  @Column({ name: 'is_phone_verified', type: 'boolean', default: false })
  isPhoneVerified!: boolean;

  @Column({ name: 'registered_at', type: 'timestamptz' })
  registeredAt!: Date;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'first_name', type: 'varchar', length: 120 })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 120 })
  lastName!: string;

  @Column({ name: 'email', type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ name: 'meta', type: 'jsonb', default: () => "'{}'::jsonb" })
  meta!: Record<string, unknown>;
}
