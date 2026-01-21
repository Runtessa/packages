import "dotenv/config";
import "reflect-metadata";
import express, { NextFunction, Request, Response } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";
import path from "path";
import { AppError } from "./common/AppError";
import { initializeDataSource, AppDataSource } from "./core/datasource";
import { CryptoService } from "./core/security/CryptoService";
import { AdapterFactory } from "./engine/AdapterFactory";
import { SandboxRunner } from "./engine/SandboxRunner";
import { AuthController } from "./app/controllers/AuthController";
import { Dispatcher } from "./app/controllers/Dispatcher";
import { AuthGuard } from "./app/middleware/AuthGuard";
import { ContextMiddleware } from "./app/middleware/ContextMiddleware";
import { AdminController } from "./app/controllers/AdminController";
import { TenantStage } from "./entities/Tenant";
import { TenantRequest } from "./types/RequestContext";
import { RegistryController } from "./app/controllers/RegistryController";
import { ModuleController } from "./app/controllers/ModuleController";
import { UIEntityController } from "./app/controllers/UIEntityController";

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

// Proxy all non-API routes to the CRA dev server (port 3001) with HMR/WebSocket support
const frontendProxy = createProxyMiddleware({
  target: "http://localhost:3001",
  changeOrigin: true,
  ws: true,
});

app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (p.startsWith("/api") || p.startsWith("/auth") || p.startsWith("/admin")) {
    return next();
  }
  return frontendProxy(req, res, next);
});

// Fallback static (for production build)
app.use(
  express.static(path.resolve(__dirname, "..", "ide", "build"), {
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

  const contextMiddleware = ContextMiddleware(AppDataSource);
  const authGuard = AuthGuard(AppDataSource, cryptoService);
  // app.use(
  //   "/",
  //   createProxyMiddleware({
  //     target: "http://localhost:3001",
  //     changeOrigin: true,
  //     ws: true, // IMPORTANT: proxy websockets for HMR
  //     // logLevel: "silent",
  //   })
  // );
  app.post("/admin/tenants", adminController.createTenant);
  app.post("/auth/register", contextMiddleware, authController.register);
  app.post("/auth/login", contextMiddleware, authController.login);
  app.get(
    "/api/registry/:name/:version?",
    contextMiddleware,
    registryController.resolve
  );
  app.get("/api/modules", contextMiddleware, authGuard, moduleController.list);
  app.get(
    "/api/modules/:id",
    contextMiddleware,
    authGuard,
    moduleController.getById
  );
  app.post(
    "/api/modules",
    contextMiddleware,
    authGuard,
    moduleController.create
  );
  app.put(
    "/api/modules/:id",
    contextMiddleware,
    authGuard,
    moduleController.update
  );
  app.delete(
    "/api/modules/:id",
    contextMiddleware,
    authGuard,
    moduleController.remove
  );

  app.get(
    "/api/ui-entities",
    contextMiddleware,
    authGuard,
    uiEntityController.list
  );
  app.get(
    "/api/ui-entities/:id",
    contextMiddleware,
    authGuard,
    uiEntityController.getById
  );
  app.post(
    "/api/ui-entities",
    contextMiddleware,
    authGuard,
    uiEntityController.create
  );
  app.put(
    "/api/ui-entities/:id",
    contextMiddleware,
    authGuard,
    uiEntityController.update
  );
  app.delete(
    "/api/ui-entities/:id",
    contextMiddleware,
    authGuard,
    uiEntityController.remove
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
    const indexPath = path.resolve(
      __dirname,
      "..",
      "ide",
      "build",
      "index.html"
    );
    return res.sendFile(indexPath);
  });

  app.all("*", contextMiddleware, authGuard, dispatcher.handle);

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const tenantStage =
      (req as TenantRequest).tenant?.stage ?? res.locals?.tenantStage;
    const isAppError = err instanceof AppError;
    const status = isAppError ? err.status : 500;
    const payload: Record<string, unknown> = {
      error: err.message,
      ...(isAppError && (err as AppError).code
        ? { code: (err as AppError).code }
        : {}),
    };

    if (tenantStage === TenantStage.DEV) {
      payload.stack = err.stack;
    } else if (tenantStage === TenantStage.PROD && status >= 500) {
      payload.error = "Internal server error";
    }

    if (!isAppError) {
      console.error("Unhandled error:", err);
    }

    return res.status(status).json(payload);
  });

  const server = app.listen(port, () => {
    console.log(`FaaS runtime listening on port ${port}`);
  });
  server.on("upgrade", (req, socket, head) => {
    const pathname = req.url ? req.url.split("?")[0].toLowerCase() : "";
    if (
      pathname.startsWith("/api") ||
      pathname.startsWith("/auth") ||
      pathname.startsWith("/admin")
    ) {
      socket.destroy();
      return;
    }
    frontendProxy.upgrade(req as any, socket as any, head);
  });
};

bootstrap().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
