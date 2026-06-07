import { RotaMember, RotaPerson } from "./types";

export type AuxRoleConfig = {
  label: string | null;
  channel: number;
  extraRoleNames?: string[];
  extraPlanningCenterNames?: string[];
};

export function getExtraRoleNames(aux: AuxRoleConfig): string[] {
  return aux.extraRoleNames ?? aux.extraPlanningCenterNames ?? [];
}

export function roleMatchesAux(role: string, aux: AuxRoleConfig): boolean {
  return (
    role === aux.label || getExtraRoleNames(aux).some((name) => name === role)
  );
}

export function mapMembersToAuxs<T extends AuxRoleConfig>(
  auxs: T[],
  members: RotaMember[],
): (T & { user: RotaMember | null })[] {
  const found = new Set<string>();
  return auxs.map((aux) => {
    const user = members.find(
      (member) =>
        !found.has(member.id) && roleMatchesAux(member.role, aux),
    );
    if (user) {
      found.add(user.id);
    }
    return { ...aux, user: user ?? null };
  });
}

export function buildRotaPeople(members: RotaMember[]): RotaPerson[] {
  const byId = new Map<string, RotaPerson>();

  for (const member of members) {
    const existing = byId.get(member.id);
    if (existing) {
      if (!existing.roles.includes(member.role)) {
        existing.roles.push(member.role);
      }
      if (!existing.img && member.img) {
        existing.img = member.img;
      }
      continue;
    }

    byId.set(member.id, {
      id: member.id,
      name: member.name,
      roles: [member.role],
      img: member.img ?? null,
    });
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findAuxChannelForRole(
  auxs: AuxRoleConfig[],
  role: string,
): number | null {
  const match = auxs.find((aux) => roleMatchesAux(role, aux));
  return match?.channel ?? null;
}

export function findMemberAssignments(
  members: RotaMember[],
  personId: string,
): RotaMember[] {
  return members.filter((member) => member.id === personId);
}

export function rotaMemberId(name: string, role: string): string {
  return `${name.trim().toLowerCase()}::${role.trim().toLowerCase()}`;
}
