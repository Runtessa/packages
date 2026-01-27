import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'global_ui_packages' })
@Index(['name', 'version'], { unique: true })
export class GlobalUIPackage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  version!: string;

  @Column({ name: 'entry_path', default: 'src/index.tsx' })
  entryPath!: string;

  @Column({ type: 'text', default: '' })
  code!: string;

  @Column({ name: 'code_blob', type: 'text' })
  codeBlob!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  dependencies!: string[];

  @Column({ name: 'file_extension', default: 'jsx' })
  fileExtension!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
