import { createChurchSuiteRotaClient } from "../churchSuite/sessionClient";
import {
  ChurchSuiteConfig,
  RotaMember,
  ServiceRef,
  UserProvider,
} from "./types";

export type ChurchSuiteProviderSecrets = {
  username: string;
  password: string;
};

export class ChurchSuiteProvider implements UserProvider {
  private client;

  constructor(
    config: ChurchSuiteConfig,
    secrets: ChurchSuiteProviderSecrets,
  ) {
    this.client = createChurchSuiteRotaClient(
      {
        accountId: config.accountId,
        username: secrets.username,
        password: secrets.password,
        siteId: config.siteId,
        domain: config.domain,
        rotaNames: config.rotaNames,
      },
      config.clientMode ?? "session",
    );
  }

  async listServices(): Promise<ServiceRef[]> {
    const services = await this.client.listUpcomingServices();
    return services.map((service) => ({
      id: service.id,
      label: service.label,
      date: service.date.toISOString(),
      meta: { date: service.id },
    }));
  }

  async getRotaMembers(service: ServiceRef): Promise<RotaMember[]> {
    const date = new Date(String(service.meta?.date ?? service.date));
    return this.client.getRotaForDate(date);
  }
}
