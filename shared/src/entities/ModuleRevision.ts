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
import { ModuleEntity, HttpMethod } from './Module';
import { SourceCode } from './SourceCode';

@Entity({ name: 'module_revisions' })
@Index(['module', 'revision'], { unique: true })
export class ModuleRevision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => ModuleEntity, { onDelete: 'CASCADE' })
  module!: Relation<ModuleEntity>;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  tenant!: Relation<Tenant>;

  @Column()
  revision!: number;

  @Column()
  routePath!: string;

  @Column({ type: 'enum', enum: HttpMethod })
  method!: HttpMethod;

  @ManyToOne(() => SourceCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'source_code_id' })
  sourceCode?: Relation<SourceCode> | null;

  @Column({ name: 'code', type: 'text', nullable: true })
  legacyCode?: string | null;

  @Column({ name: 'file_extension', default: 'js' })
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
}
