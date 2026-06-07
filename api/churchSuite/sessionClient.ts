import { RotaMember } from "../userProvider/types";
import {
  membersForDate,
  parseRotaOverviewHtml,
  ParsedRotaDate,
  servicesFromParsed,
} from "./parseRotaHtml";
import { CookieJar } from "./cookieJar";
import { loginWithBrowser } from "./browserAuth";
import { ChurchSuiteCredentials } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type { ChurchSuiteCredentials } from "./types";

export interface ChurchSuiteRotaClient {
  authenticate(): Promise<void>;
  getRotaOverview(from: Date, to: Date): Promise<ParsedRotaDate[]>;
  getRotaForDate(date: Date, rotaFilter?: string[]): Promise<RotaMember[]>;
  listUpcomingServices(daysAhead?: number): Promise<
    Array<{ date: Date; label: string; id: string }>
  >;
}

export class SessionChurchSuiteRotaClient implements ChurchSuiteRotaClient {
  private jar = new CookieJar();
  private authenticated = false;
  private cachedOverview: ParsedRotaDate[] | null = null;
  private cacheRange: { from: string; to: string } | null = null;

  constructor(private config: ChurchSuiteCredentials) {}

  private get accountHost(): string {
    const domain = this.config.domain ?? "churchsuite.com";
    return `https://${this.config.accountId}.${domain}`;
  }

  async authenticate(): Promise<void> {
    try {
      await this.authenticateWithFetch();
      return;
    } catch {
      await loginWithBrowser(this.config, this.jar);
    }

    if (this.config.siteId != null) {
      await this.switchSite(this.config.siteId);
    }

    this.authenticated = true;
  }

  private async authenticateWithFetch(): Promise<void> {
    const loginUrl = "https://login.churchsuite.com/";

    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `churchapp_login_account=${this.config.accountId}`,
      },
      body: new URLSearchParams({
        username: this.config.username,
        password: this.config.password,
        system: "admin",
      }),
      redirect: "manual",
    });

    this.jar.storeFromResponse(response, loginUrl);

    if (response.status >= 400) {
      throw new Error(`ChurchSuite login failed (${response.status})`);
    }

    const location = response.headers.get("location");
    if (location?.includes("login.churchsuite.com")) {
      throw new Error("ChurchSuite login failed — check credentials");
    }
  }

  private async switchSite(siteId: number) {
    const url = `${this.accountHost}/ajax/site`;
    const response = await this.fetchAuthenticated(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ site_id: String(siteId) }),
    });

    if (!response.ok) {
      throw new Error(`ChurchSuite site switch failed (${response.status})`);
    }
  }

  async getRotaOverview(from: Date, to: Date): Promise<ParsedRotaDate[]> {
    await this.ensureAuthenticated();

    const fromKey = toAjaxDate(from);
    const toKey = toAjaxDate(to);
    if (
      this.cachedOverview &&
      this.cacheRange?.from === fromKey &&
      this.cacheRange?.to === toKey
    ) {
      return this.cachedOverview;
    }

    const url =
      `${this.accountHost}/ajax/rotas/rajax` +
      `?date_start=${fromKey}` +
      `&date_end=${toKey}` +
      "&order_by=default" +
      "&break_page_on_week=off" +
      "&show_empty_dates=off" +
      "&show_members_table=off" +
      "&page=1" +
      "&submit_btn=Generate" +
      "&pg=rotas_overview" +
      "&view=dates";

    const response = await this.fetchAuthenticated(url);
    if (!response.ok) {
      throw new Error(`ChurchSuite rota fetch failed (${response.status})`);
    }

    const html = await response.text();
    this.cachedOverview = parseRotaOverviewHtml(html);
    this.cacheRange = { from: fromKey, to: toKey };
    return this.cachedOverview;
  }

  async getRotaForDate(
    date: Date,
    rotaFilter: string[] = this.config.rotaNames ?? [],
  ): Promise<RotaMember[]> {
    const from = new Date(date);
    from.setDate(from.getDate() - 1);
    const to = new Date(date);
    to.setDate(to.getDate() + 1);
    const overview = await this.getRotaOverview(from, to);
    return membersForDate(overview, date, rotaFilter);
  }

  async listUpcomingServices(daysAhead = 90) {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + daysAhead);
    const overview = await this.getRotaOverview(from, to);
    return servicesFromParsed(overview, this.config.rotaNames ?? []);
  }

  private async ensureAuthenticated() {
    if (!this.authenticated) {
      await this.authenticate();
    }
  }

  private async fetchAuthenticated(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const cookieHeader = this.jar.headerFor(url);
    const response = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": USER_AGENT,
        ...(init.headers ?? {}),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });
    this.jar.storeFromResponse(response, url);

    if (response.status === 401 || response.status === 403) {
      this.authenticated = false;
      await this.authenticate();
      return this.fetchAuthenticated(url, init);
    }

    return response;
  }
}

function toAjaxDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createChurchSuiteRotaClient(
  config: ChurchSuiteCredentials,
  mode: "session" | "scraper" = "session",
): ChurchSuiteRotaClient {
  // Both modes use the session AJAX client; scraper mode is reserved for a
  // future HTML-report fallback if ChurchSuite changes the AJAX endpoint.
  if (mode === "scraper" || mode === "session") {
    return new SessionChurchSuiteRotaClient(config);
  }
  return new SessionChurchSuiteRotaClient(config);
}
