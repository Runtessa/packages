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
import { SourceCode } from './SourceCode';
import { CompiledCode } from './CompiledCode';

@Entity({ name: 'tenant_npm_package_builds' })
@Index(['tenant', 'specifier', 'requestedVersion'])
@Index(['tenant', 'specifier', 'resolvedVersion'], { unique: true })
export class TenantNpmPackageBuild {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.id, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<Tenant>;

  @Column()
  specifier!: string;

  @Column({ name: 'install_name' })
  installName!: string;

  @Column({ name: 'requested_version', default: 'latest' })
  requestedVersion!: string;

  @Column({ name: 'resolved_version' })
  resolvedVersion!: string;

  @ManyToOne(() => SourceCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'source_code_id' })
  sourceCode?: Relation<SourceCode> | null;

  @ManyToOne(() => CompiledCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'compiled_code_id' })
  compiledCode?: Relation<CompiledCode> | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  dependencies!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  get source(): string {
    return this.sourceCode?.code ?? '';
  }

  set source(value: string) {
    this.sourceCode = { ...(this.sourceCode as any), code: value } as Relation<SourceCode>;
  }

  get codeBlob(): string {
    return this.compiledCode?.code ?? '';
  }

  set codeBlob(value: string) {
    this.compiledCode = { ...(this.compiledCode as any), code: value } as Relation<CompiledCode>;
  }
}
