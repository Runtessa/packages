import { Router } from "express";
import { RegistryController } from "../controllers/RegistryController";
import { ModuleController } from "../controllers/ModuleController";
import { UIEntityController } from "../controllers/UIEntityController";

export const ApiRouter = (
  contextMiddleware: any,
  authGuard: any,
  registryController: RegistryController,
  moduleController: ModuleController,
  uiEntityController: UIEntityController
) => {
  const router = Router();

  router.get(
    "/registry/:name/:version?",
    contextMiddleware,
    registryController.resolve
  );
  router.get("/modules", contextMiddleware, authGuard, moduleController.list);
  router.get(
    "/modules/:id",
    contextMiddleware,
    authGuard,
    moduleController.getById
  );
  router.get(
    "/modules/:id/versions",
    contextMiddleware,
    authGuard,
    moduleController.listVersions
  );
  router.post(
    "/modules",
    contextMiddleware,
    authGuard,
    moduleController.create
  );
  router.put(
    "/modules/:id",
    contextMiddleware,
    authGuard,
    moduleController.update
  );
  router.post(
    "/modules/:id/rollback/:revisionId",
    contextMiddleware,
    authGuard,
    moduleController.rollback
  );
  router.delete(
    "/modules/:id",
    contextMiddleware,
    authGuard,
    moduleController.remove
  );

  router.get(
    "/ui-entities",
    contextMiddleware,
    authGuard,
    uiEntityController.list
  );
  router.get(
    "/ui-entities/:id",
    contextMiddleware,
    authGuard,
    uiEntityController.getById
  );
  router.get(
    "/ui-entities/:id/versions",
    contextMiddleware,
    authGuard,
    uiEntityController.listVersions
  );
  router.post(
    "/ui-entities",
    contextMiddleware,
    authGuard,
    uiEntityController.create
  );
  router.put(
    "/ui-entities/:id",
    contextMiddleware,
    authGuard,
    uiEntityController.update
  );
  router.post(
    "/ui-entities/:id/rollback/:revisionId",
    contextMiddleware,
    authGuard,
    uiEntityController.rollback
  );
  router.delete(
    "/ui-entities/:id",
    contextMiddleware,
    authGuard,
    uiEntityController.remove
  );
  return router;
};
