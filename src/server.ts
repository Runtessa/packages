import "dotenv/config";
import "reflect-metadata";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import path from "path";
import { AppError } from "./common/AppError";
import { initializeDataSource, AppDataSource } from "./core/datasource";
import { CryptoService } from "./core/security/CryptoService";
import { AdapterFactory } from "./engine/AdapterFactory";
import { SandboxRunner } from "./engine/SandboxRunner";
import { AuthController } from "./app/controllers/AuthController";
import { Dispatcher } from "./app/controllers/Dispatcher";
import { AuthGuard, OptionalAuthGuard } from "./app/middleware/AuthGuard";
import { ContextMiddleware, OptionalContextMiddleware } from "./app/middleware/ContextMiddleware";
import { AdminController } from "./app/controllers/AdminController";
import { RegistryController } from "./app/controllers/RegistryController";
import { ModuleController } from "./app/controllers/ModuleController";
import { UIEntityController } from "./app/controllers/UIEntityController";
import { ApiRouter } from "./app/routers/api";
import { TenantAclController } from "./app/controllers/TenantAclController";

const app = express();

// CORS for API routes; frontend is proxied so origin is same
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/public", express.static("public"));

// Fallback static (for production build)
app.use(
  express.static(path.resolve(__dirname, "..", "public"), {
    index: false,
  })
);
const port = parseInt(process.env.PORT ?? "3000", 10);

const buildCryptoService = (): CryptoService => {
  const encryptionKey = getKeyFromEnv("ENCRYPTION_KEY", 32);
  const tokenSecret = getKeyFromEnv("TOKEN_SECRET", 32);
  return new CryptoService(encryptionKey, tokenSecret);
};

const getKeyFromEnv = (envName: string, expectedBytes: number): Buffer => {
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`${envName} is required`);
  }

  const isHex = /^[a-fA-F0-9]+$/.test(raw) && raw.length === expectedBytes * 2;
  const buffer = isHex ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buffer.length !== expectedBytes) {
    throw new Error(`${envName} must decode to ${expectedBytes} bytes`);
  }
  return buffer;
};

const bootstrap = async () => {
  await initializeDataSource();
  const cryptoService = buildCryptoService();

  const adapterFactory = new AdapterFactory(AppDataSource, cryptoService);
  const sandboxRunner = new SandboxRunner(30_000);
  const authController = new AuthController(AppDataSource, cryptoService);
  const adminController = new AdminController(AppDataSource);
  const dispatcher = new Dispatcher(
    AppDataSource,
    adapterFactory,
    sandboxRunner
  );
  const registryController = new RegistryController(AppDataSource);
  const moduleController = new ModuleController(AppDataSource);
  const uiEntityController = new UIEntityController(AppDataSource);
  const tenantAclController = new TenantAclController(AppDataSource);

  const contextMiddleware = ContextMiddleware(AppDataSource);
  const optionalContextMiddleware = OptionalContextMiddleware(AppDataSource);
  const authGuard = AuthGuard(AppDataSource, cryptoService);
  const optionalAuthGuard = OptionalAuthGuard(AppDataSource, cryptoService);

  app.post("/admin/tenants", adminController.createTenant);
  app.post("/auth/register", contextMiddleware, authController.register);
  app.post("/auth/login", contextMiddleware, authController.login);
  app.use(
    "/api",
    ApiRouter(
      contextMiddleware,
      optionalContextMiddleware,
      authGuard,
      registryController,
      moduleController,
      uiEntityController,
      tenantAclController
    )
  );
  // Serve frontend (IDE) for non-API routes
  app.get("*", (req, res, next) => {
    const p = req.path.toLowerCase();
    if (
      p.startsWith("/api") ||
      p.startsWith("/auth") ||
      p.startsWith("/admin")
    ) {
      return next();
    }
    const indexPath = path.resolve(__dirname, "..", "public", "index.html");
    return res.sendFile(indexPath);
  });

  app.all("*", contextMiddleware, optionalAuthGuard, dispatcher.handle);

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const isAppError = err instanceof AppError;
    const status = isAppError ? err.status : 500;
    const payload: Record<string, unknown> = {
      error: err.message,
      ...(isAppError && (err as AppError).code
        ? { code: (err as AppError).code }
        : {}),
    };

    const isDev = process.env.NODE_ENV !== "production";
    if (isDev) {
      payload.stack = err.stack;
    } else if (status >= 500) {
      payload.error = "Internal server error";
    }

    if (!isAppError) {
      console.error("Unhandled error:", err);
    }

    return res.status(status).json(payload);
  });

  app.listen(port, () => {
    console.log(`FaaS runtime listening on port ${port}`);
  });
};

bootstrap().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
