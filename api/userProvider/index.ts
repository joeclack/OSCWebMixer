import { ChurchSuiteProvider } from "./churchSuiteProvider";
import { OfflineProvider } from "./offlineProvider";
import { PlanningCenterProvider } from "./planningCenterProvider";
import {
  ChurchSuiteConfig,
  PlanningCenterProviderConfig,
  UserProvider,
  UserProviderType,
} from "./types";

export * from "./types";
export * from "./rotaUtils";
export * from "./offlineProvider";
export * from "./planningCenterProvider";
export * from "./churchSuiteProvider";

export type UserProviderFactoryConfig = {
  type: UserProviderType;
  churchsuite?: ChurchSuiteConfig;
  planningCenter?: PlanningCenterProviderConfig;
  secrets?: {
    churchsuite?: { username: string; password: string };
    planningCenter?: { appId: string; secret: string };
  };
};

export function createUserProvider(
  config: UserProviderFactoryConfig,
): UserProvider {
  switch (config.type) {
    case "churchsuite": {
      if (!config.churchsuite) {
        throw new Error("churchsuite config is required");
      }
      const secrets = config.secrets?.churchsuite;
      if (!secrets?.username || !secrets?.password) {
        throw new Error("churchsuite credentials are required in secrets.json");
      }
      return new ChurchSuiteProvider(config.churchsuite, secrets);
    }
    case "planningCenter": {
      if (!config.planningCenter) {
        throw new Error("planningCenter config is required");
      }
      const pcSecrets = config.secrets?.planningCenter;
      if (!pcSecrets?.appId || !pcSecrets?.secret) {
        throw new Error(
          "planningCenter credentials are required in secrets.json",
        );
      }
      return new PlanningCenterProvider({
        ...config.planningCenter,
        ...pcSecrets,
      });
    }
    case "offline":
    default:
      return new OfflineProvider();
  }
}

export function isPlanningCenterProvider(
  provider: UserProvider,
): provider is PlanningCenterProvider {
  return provider instanceof PlanningCenterProvider;
}
