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
import { SourceCode } from './SourceCode';
import { CompiledCode } from './CompiledCode';

@Entity({ name: 'global_module_packages' })
@Index(['name', 'version'], { unique: true })
export class GlobalModulePackage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  version!: string;

  @Column({ name: 'entry_path', default: 'src/index.js' })
  entryPath!: string;

  @ManyToOne(() => SourceCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'source_code_id' })
  sourceCode?: Relation<SourceCode> | null;

  @ManyToOne(() => CompiledCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'compiled_code_id' })
  compiledCode?: Relation<CompiledCode> | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  dependencies!: string[];

  @Column({ name: 'file_extension', default: 'js' })
  fileExtension!: string;

  @Column({ name: 'draft_version', default: '' })
  draftVersion!: string;

  @Column({ name: 'published_version', type: 'varchar', nullable: true })
  publishedVersion?: string | null;

  @ManyToOne(() => SourceCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'published_source_code_id' })
  publishedSourceCode?: Relation<SourceCode> | null;

  @ManyToOne(() => CompiledCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'published_compiled_code_id' })
  publishedCompiledCode?: Relation<CompiledCode> | null;

  @Column({ name: 'published_dependencies', type: 'jsonb', nullable: true })
  publishedDependencies?: string[] | null;

  @Column({ name: 'published_file_extension', type: 'varchar', nullable: true })
  publishedFileExtension?: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date | null;

  @Column({ name: 'owner_team_id', type: 'int', nullable: true })
  ownerTeamId?: number | null;

  @Column({ name: 'editor_team_ids', type: 'jsonb', default: () => "'[]'" })
  editorTeamIds!: number[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
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

  get publishedCode(): string | null {
    return this.publishedSourceCode?.code ?? null;
  }

  set publishedCode(value: string | null) {
    this.publishedSourceCode =
      value === null
        ? null
        : ({ ...(this.publishedSourceCode as any), code: value } as Relation<SourceCode>);
  }

  get publishedCodeBlob(): string | null {
    return this.publishedCompiledCode?.code ?? null;
  }

  set publishedCodeBlob(value: string | null) {
    this.publishedCompiledCode =
      value === null
        ? null
        : ({ ...(this.publishedCompiledCode as any), code: value } as Relation<CompiledCode>);
  }
}
