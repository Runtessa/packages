import "reflect-metadata";
import { DataSource, DataSourceOptions } from "typeorm";
import { User } from '@idp/shared';
import { LoginSession } from '@idp/shared';
import { SystemLog } from '@idp/shared';
import { Team } from '@idp/shared';
import { TeamMember } from '@idp/shared';
import { TeamTenant } from '@idp/shared';
import { hashPassword } from "./password";

const dbType = (process.env.DB_TYPE || "postgres") as DataSourceOptions["type"];
const dbName = process.env.DB_NAME;
const normalizeDatabaseUrl = (rawUrl?: string, name?: string) => {
  if (!rawUrl || !name) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.pathname && parsed.pathname !== "/") {
      return rawUrl;
    }
    parsed.pathname = `/${name}`;
    return parsed.toString();
  } catch {
    return rawUrl;
  }
};
const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL, dbName);

const baseOptions = {
  type: dbType,
  url: databaseUrl,
  database: dbName,
  synchronize: true,
  logging: false,
  entities: [User, LoginSession, SystemLog, Team, TeamMember, TeamTenant],
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
