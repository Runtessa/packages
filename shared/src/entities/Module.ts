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

  @ManyToOne(() => SourceCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'source_code_id' })
  sourceCode?: Relation<SourceCode> | null;

  @Column({ name: 'file_extension', default: 'js' })
  fileExtension!: string;

  @Column({ name: 'draft_version', default: '' })
  draftVersion!: string;

  @Column({ name: 'published_version', type: 'varchar', nullable: true })
  publishedVersion?: string | null;

  @Column({ name: 'published_route_path', type: 'varchar', nullable: true })
  publishedRoutePath?: string | null;

  @Column({ name: 'published_method', type: 'enum', enum: HttpMethod, nullable: true })
  publishedMethod?: HttpMethod | null;

  @ManyToOne(() => SourceCode, { nullable: true, cascade: ['insert', 'update'] })
  @JoinColumn({ name: 'published_source_code_id' })
  publishedSourceCode?: Relation<SourceCode> | null;

  get code(): string {
    return this.sourceCode?.code ?? '';
  }

  set code(value: string) {
    this.sourceCode = { ...(this.sourceCode as any), code: value } as Relation<SourceCode>;
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

  @Column({ name: 'published_file_extension', type: 'varchar', nullable: true })
  publishedFileExtension?: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date | null;

  @ManyToOne(() => Tenant, (tenant) => tenant.modules, { onDelete: 'CASCADE' })
  tenant!: Relation<Tenant>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
