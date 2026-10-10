import { Account } from '../entities/Account';
import { CompiledCode } from '../entities/CompiledCode';
import { GlobalModuleEndpoint } from '../entities/GlobalModuleEndpoint';
import { GlobalModulePackage } from '../entities/GlobalModulePackage';
import { GlobalModulePackageFile } from '../entities/GlobalModulePackageFile';
import { GlobalUIPackage } from '../entities/GlobalUIPackage';
import { GlobalUIPackageFile } from '../entities/GlobalUIPackageFile';
import { LoginSession } from '../entities/LoginSession';
import { ModuleEntity } from '../entities/Module';
import { ModuleRevision } from '../entities/ModuleRevision';
import { OrchestrationAgent } from '../entities/OrchestrationAgent';
import { OrchestrationOperation } from '../entities/OrchestrationOperation';
import { OrchestrationPlacement } from '../entities/OrchestrationPlacement';
import { OrchestrationWorkload } from '../entities/OrchestrationWorkload';
import { OrmModel } from '../entities/OrmModel';
import { PublishRequest } from '../entities/PublishRequest';
import { Secret } from '../entities/Secret';
import { SourceCode } from '../entities/SourceCode';
import { SystemLog } from '../entities/SystemLog';
import { Team } from '../entities/Team';
import { TeamMember } from '../entities/TeamMember';
import { TeamTenant } from '../entities/TeamTenant';
import { Tenant } from '../entities/Tenant';
import { TenantNpmPackageBuild } from '../entities/TenantNpmPackageBuild';
import { UIPackage } from '../entities/UIEntities';
import { UIPackageRevision } from '../entities/UIPackageRevision';
import { User } from '../entities/User';

export const catalogEntities = [SourceCode, CompiledCode, GlobalModuleEndpoint,
  GlobalModulePackage, GlobalModulePackageFile, GlobalUIPackage, GlobalUIPackageFile];
export const coreEntities = [Tenant, Account, User, Secret, ModuleEntity, UIPackage,
  ...catalogEntities, ModuleRevision, UIPackageRevision, TenantNpmPackageBuild,
  OrmModel, PublishRequest, OrchestrationAgent, OrchestrationWorkload,
  OrchestrationPlacement, OrchestrationOperation];
export const ideEntities = [User, LoginSession, SystemLog, Team, TeamMember, TeamTenant];
