import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Tenant } from './Tenant';
import { User } from './User';

export enum PublishRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('publish_requests')
export class PublishRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Tenant, { nullable: false, onDelete: 'CASCADE' })
  tenant!: Relation<Tenant>;

  @ManyToOne(() => User, { nullable: false })
  requester!: Relation<User>;

  @Column('text')
  comment!: string;

  @Column('jsonb')
  items!: {
    kind: 'module' | 'ui' | 'shared';
    id: string; // backendId
    title: string;
    data: any; // Snapshot of the data to be published
  }[];

  @Column({
    type: 'enum',
    enum: PublishRequestStatus,
    default: PublishRequestStatus.PENDING,
  })
  status!: PublishRequestStatus;

  @ManyToOne(() => User, { nullable: true })
  approver?: Relation<User>;

  @Column('text', { nullable: true })
  rejectionNote?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column('timestamp', { nullable: true })
  publishedAt?: Date;
}
