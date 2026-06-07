import * as cheerio from "cheerio";
import { RotaMember } from "../userProvider/types";

export type ParsedRotaDate = {
  date: Date;
  rotas: Map<string, RotaMember[]>;
};

export function parseRotaOverviewHtml(html: string): ParsedRotaDate[] {
  const $ = cheerio.load(html);
  const results: ParsedRotaDate[] = [];

  $(".rota-section h2.report_break").each((_index, dateEl) => {
    const dateText = $(dateEl).text().trim();
    if (!dateText) {
      return;
    }

    const parsedDate = new Date(dateText);
    if (Number.isNaN(parsedDate.getTime())) {
      return;
    }

    const rotas = new Map<string, RotaMember[]>();
    const section = $(dateEl).parent();

    section.find("div.rota-date").each((_rotaIndex, rotaEl) => {
      const teamName = $(rotaEl).find(".date-rota-name").first().text().trim();
      if (!teamName) {
        return;
      }

      const members: RotaMember[] = [];
      $(rotaEl)
        .find("ul.date-members li.profile-initial")
        .each((_memberIndex, memberEl) => {
          const name = $(memberEl).find(".profile-name").first().text().trim();
          const role = $(memberEl).find(".roles").first().text().trim();
          if (!name) {
            return;
          }

          const resolvedRole = role || teamName;
          members.push({
            id: personIdFromName(name),
            name,
            role: resolvedRole,
            img: null,
          });
        });

      rotas.set(teamName, members);
    });

    results.push({ date: parsedDate, rotas });
  });

  return results;
}

export function membersForDate(
  parsed: ParsedRotaDate[],
  date: Date,
  rotaNames: string[] = [],
): RotaMember[] {
  const target = toDateKey(date);
  const day = parsed.find((entry) => toDateKey(entry.date) === target);
  if (!day) {
    return [];
  }

  const members: RotaMember[] = [];
  for (const [rotaName, rotaMembers] of day.rotas.entries()) {
    if (rotaNames.length > 0 && !rotaNames.includes(rotaName)) {
      continue;
    }
    members.push(...rotaMembers);
  }

  return members;
}

export function servicesFromParsed(
  parsed: ParsedRotaDate[],
  rotaNames: string[] = [],
): Array<{ date: Date; label: string; id: string }> {
  const services: Array<{ date: Date; label: string; id: string }> = [];

  for (const day of parsed) {
    const matchingRotas = [...day.rotas.keys()].filter(
      (name) => rotaNames.length === 0 || rotaNames.includes(name),
    );
    if (matchingRotas.length === 0) {
      continue;
    }

    const dateKey = toDateKey(day.date);
    services.push({
      date: day.date,
      id: dateKey,
      label: `${day.date.toDateString()} (${matchingRotas.join(", ")})`,
    });
  }

  services.sort((a, b) => a.date.getTime() - b.date.getTime());
  return services;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function personIdFromName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}
