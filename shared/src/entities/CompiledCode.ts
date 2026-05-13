import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'compiled_codes' })
export class CompiledCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  code!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
