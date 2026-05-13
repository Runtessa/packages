import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Tenant } from './Tenant';
import { UIPackage } from './UIEntities';
import { SourceCode } from './SourceCode';
import { CompiledCode } from './CompiledCode';

@Entity({ name: 'ui_package_revisions' })
@Index(['uiPackage', 'revision'], { unique: true })
export class UIPackageRevision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => UIPackage, { onDelete: 'CASCADE' })
  uiPackage!: Relation<UIPackage>;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  tenant!: Relation<Tenant>;

  @Column()
  revision!: number;

  @Column()
  name!: string;

  @Column()
  version!: string;

  @ManyToOne(() => SourceCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'source_code_id' })
  sourceCode?: Relation<SourceCode> | null;

  @ManyToOne(() => CompiledCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'compiled_code_id' })
  compiledCode?: Relation<CompiledCode> | null;

  @Column({ name: 'code', type: 'text', nullable: true, default: '' })
  legacyCode?: string | null;

  @Column({ name: 'code_blob', type: 'text', nullable: true, default: '' })
  legacyCodeBlob?: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  dependencies!: string[];

  @Column({ name: 'file_extension', default: 'jsx' })
  fileExtension!: string;

  @Column({ nullable: true })
  action?: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  get code(): string {
    return this.sourceCode?.code ?? this.legacyCode ?? '';
  }

  set code(value: string) {
    this.sourceCode = { ...(this.sourceCode as any), code: value } as Relation<SourceCode>;
    this.legacyCode = value;
  }

  get codeBlob(): string {
    return this.compiledCode?.code ?? this.legacyCodeBlob ?? '';
  }

  set codeBlob(value: string) {
    this.compiledCode = { ...(this.compiledCode as any), code: value } as Relation<CompiledCode>;
    this.legacyCodeBlob = value;
  }
}
