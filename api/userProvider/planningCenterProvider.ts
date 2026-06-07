import { Fetcher } from "../planningCenter";
import { PlanningCenterProviderConfig, RotaMember, ServiceRef, UserProvider } from "./types";
import { rotaMemberId } from "./rotaUtils";

export class PlanningCenterProvider implements UserProvider {
  private fetcher: Fetcher;

  constructor(config: PlanningCenterProviderConfig) {
    this.fetcher = new Fetcher(config);
  }

  async listServices(): Promise<ServiceRef[]> {
    const plans = await this.fetcher.getAllPlans();
    return plans.map((plan) => {
      const date = new Date(plan.sort_date);
      return {
        id: plan.id,
        label:
          `${plan.service_type?.name?.trim() ?? "Service"} - ${date.toDateString()} ${date.toLocaleTimeString()}`.trim(),
        date: date.toISOString(),
        meta: {
          serviceType: plan.service_type?.id,
          plan: plan.id,
        },
      };
    });
  }

  async getRotaMembers(service: ServiceRef): Promise<RotaMember[]> {
    const serviceTypeId = String(service.meta?.serviceType ?? "");
    const planId = String(service.meta?.plan ?? service.id);
    const teamMembers = (await this.fetcher.getTeamMembers(
      serviceTypeId,
      planId,
    )) as Array<{
      id: string;
      name: string;
      team_position_name: string;
      photo_thumbnail?: string;
    }>;

    return teamMembers.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.team_position_name,
      img: member.photo_thumbnail ?? null,
    }));
  }

  getFetcher() {
    return this.fetcher;
  }
}

export function mapPlanningCenterMembers(members: unknown[]): RotaMember[] {
  return (members as Array<Record<string, string>>).map((member) => ({
    id: String(member.id),
    name: String(member.name),
    role: String(member.team_position_name),
    img: member.photo_thumbnail ?? null,
  }));
}

export function planningCenterMemberId(name: string, role: string): string {
  return rotaMemberId(name, role);
}
