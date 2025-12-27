import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './Tenant';

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
}

@Entity({ name: 'modules' })
@Index(['tenant', 'routePath', 'method'], { unique: true })
export class ModuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  routePath!: string;

  @Column({ type: 'enum', enum: HttpMethod, default: HttpMethod.GET })
  method!: HttpMethod;

  @Column({ type: 'text' })
  code!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.modules, { onDelete: 'CASCADE' })
  tenant!: Tenant;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
