export type RotaMember = {
  id: string;
  name: string;
  role: string;
  img?: string | null;
};

export type RotaPerson = {
  id: string;
  name: string;
  roles: string[];
  img?: string | null;
};

export type ServiceRef = {
  id: string;
  label: string;
  date: string;
  meta?: Record<string, unknown>;
};

export interface UserProvider {
  listServices(): Promise<ServiceRef[]>;
  getRotaMembers(service: ServiceRef): Promise<RotaMember[]>;
}

export type UserProviderType = "churchsuite" | "planningCenter" | "offline";

export type ChurchSuiteConfig = {
  accountId: string;
  siteId?: number;
  domain?: string;
  rotaNames?: string[];
  clientMode?: "session" | "scraper";
};

export type PlanningCenterProviderConfig = {
  baseUrl: string;
  appId: string;
  secret: string;
  worshipTeamId: string;
};
