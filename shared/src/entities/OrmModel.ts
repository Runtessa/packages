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

@Entity({ name: 'orm_models' })
@Index(['tenant', 'path'], { unique: true })
export class OrmModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.ormModels, { onDelete: 'CASCADE' })
  tenant!: Relation<Tenant>;

  @Column()
  path!: string;

  @ManyToOne(() => SourceCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'source_code_id' })
  sourceCode?: Relation<SourceCode> | null;

  @ManyToOne(() => CompiledCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'compiled_code_id' })
  compiledCode?: Relation<CompiledCode> | null;

  @Column({ name: 'file_extension', default: 'js' })
  fileExtension!: string;

  @Column({ name: 'draft_version', default: '' })
  draftVersion!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  get code(): string {
    return this.sourceCode?.code ?? '';
  }

  set code(value: string) {
    this.sourceCode = { ...(this.sourceCode as any), code: value } as Relation<SourceCode>;
  }

  get codeBlob(): string {
    return this.compiledCode?.code ?? '';
  }

  set codeBlob(value: string) {
    this.compiledCode = { ...(this.compiledCode as any), code: value } as Relation<CompiledCode>;
  }
}
