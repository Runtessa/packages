import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Tenant } from './Tenant';

@Entity({ name: 'secrets' })
@Unique(['keyName', 'tenant'])
export class Secret {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  keyName!: string;

  @Column({ type: 'text' })
  encryptedValue!: string;

  @Column()
  iv!: string;

  @Column()
  authTag!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.secrets, { onDelete: 'CASCADE' })
  tenant!: Relation<Tenant>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
