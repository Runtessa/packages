import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from './Account';
import { Secret } from './Secret';
import { ModuleEntity } from './Module';

export enum TenantStage {
  DEV = 'DEV',
  STAGING = 'STAGING',
  PROD = 'PROD',
}

@Entity({ name: 'tenants' })
@Unique(['hostname'])
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  hostname!: string;

  @Column({ type: 'enum', enum: TenantStage, default: TenantStage.DEV })
  stage!: TenantStage;

  @Column({ type: 'jsonb', default: () => "'{\"memory\":512,\"timeout\":5000}'" })
  resourceConfig!: {
    memory: number;
    timeout: number;
  };

  @Column({ default: false })
  isSuspended!: boolean;

  @OneToMany(() => Account, (account) => account.tenant, { cascade: true })
  accounts!: Account[];

  @OneToMany(() => Secret, (secret) => secret.tenant, { cascade: true })
  secrets!: Secret[];

  @OneToMany(() => ModuleEntity, (module) => module.tenant, { cascade: true })
  modules!: ModuleEntity[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
