import { chromium, type Browser, type Page } from "playwright";
import { CookieJar } from "./cookieJar";
import { ChurchSuiteCredentials } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

function accountHost(config: ChurchSuiteCredentials): string {
  const domain = config.domain ?? "churchsuite.com";
  return `https://${config.accountId}.${domain}`;
}

async function fillLoginForm(page: Page, config: ChurchSuiteCredentials) {
  await page.waitForSelector("input", { timeout: 60000 });

  const userField = page
    .locator(
      'input[name="username"], input[name="email"], input[type="email"], input[autocomplete="username"]',
    )
    .first();
  const passField = page
    .locator(
      'input[name="password"], input[type="password"], input[autocomplete="current-password"]',
    )
    .first();

  await userField.fill(config.username);
  await passField.fill(config.password);

  const submit = page
    .locator(
      'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in")',
    )
    .first();
  await submit.click();
}

async function storeContextCookies(
  context: Awaited<ReturnType<Browser["newContext"]>>,
  jar: CookieJar,
) {
  const cookies = await context.cookies();
  for (const cookie of cookies) {
    const host = cookie.domain.startsWith(".")
      ? cookie.domain.slice(1)
      : cookie.domain;
    jar.set(`${host}:${cookie.name}`, cookie.value);
  }
}

export async function loginWithBrowser(
  config: ChurchSuiteCredentials,
  jar: CookieJar,
): Promise<void> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();

  try {
    await context.addCookies([
      {
        name: "churchapp_login_account",
        value: config.accountId,
        domain: ".churchsuite.com",
        path: "/",
      },
    ]);

    await page.goto(accountHost(config), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    if (page.url().includes("login.churchsuite.com") || (await page.locator("input[type='password']").count()) > 0) {
      await fillLoginForm(page, config);
    } else {
      await page.goto("https://login.churchsuite.com/", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await fillLoginForm(page, config);
    }

    await page.waitForURL(
      (url) =>
        url.hostname.includes(`${config.accountId}.`) ||
        (!url.hostname.startsWith("login.") && url.hostname.includes("churchsuite")),
      { timeout: 60000 },
    );

    await storeContextCookies(context, jar);
  } finally {
    await context.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}
