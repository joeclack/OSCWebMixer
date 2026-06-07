import { ServiceRef, UserProvider } from "./types";

export class OfflineProvider implements UserProvider {
  async listServices(): Promise<ServiceRef[]> {
    return [];
  }

  async getRotaMembers(): Promise<never[]> {
    return [];
  }
}
