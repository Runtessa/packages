import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'source_codes' })
export class SourceCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  code!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
