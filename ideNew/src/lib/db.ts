import "reflect-metadata";
import { DataSource, DataSourceOptions } from "typeorm";
import { User } from "./entities/User";
import { LoginSession } from "./entities/LoginSession";
import { SystemLog } from "./entities/SystemLog";
import { hashPassword } from "./password";

const dbType = (process.env.DB_TYPE || "postgres") as DataSourceOptions["type"];

const baseOptions = {
  type: dbType,
  url: process.env.DATABASE_URL,
  database: process.env.DB_NAME,
  synchronize: true,
  logging: false,
  entities: [User, LoginSession, SystemLog],
} as DataSourceOptions;

export const AppDataSource = new DataSource(baseOptions);

let initialized = false;

export const ensureSchema = async () => {
  if (!initialized) {
    await AppDataSource.initialize();
    initialized = true;
    console.log(`Data Source has been initialized (${dbType})!`);
  }
};

export const ensureAdminUser = async () => {
  await ensureSchema();
  const repo = AppDataSource.getRepository(User);
  const token = process.env.ADMIN_TOKEN;
  const email = process.env.ADMIN_EMAIL || "admin@example.com";
  const password = process.env.ADMIN_PASSWORD;

  if (!token) throw new Error("ADMIN_TOKEN is required to bootstrap the admin user.");
  if (!password) throw new Error("ADMIN_PASSWORD is required to bootstrap the admin user.");

  let admin = await repo.findOne({ where: { email } });
  const passwordHash = await hashPassword(password);

  if (!admin) {
    admin = repo.create({ email, token, passwordHash, role: "admin" });
  } else {
    admin.token = token;
    admin.passwordHash = passwordHash;
    admin.role = "admin";
  }
  await repo.save(admin);
};

export const getDataSource = () => AppDataSource;
