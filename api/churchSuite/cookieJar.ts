export class CookieJar {
  private cookies = new Map<string, string>();

  storeFromResponse(response: Response, url: string) {
    const raw =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : splitSetCookieHeader(response.headers.get("set-cookie"));

    if (!raw?.length) {
      return;
    }

    const hostname = new URL(url).hostname;
    for (const cookie of raw) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      if (separator === -1) {
        continue;
      }
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      this.cookies.set(`${hostname}:${name}`, value);
    }
  }

  headerFor(url: string): string | undefined {
    const hostname = new URL(url).hostname;
    const pairs: string[] = [];
    for (const [key, value] of this.cookies.entries()) {
      const [host, name] = key.split(":");
      if (host === hostname || hostname.endsWith(`.${host}`)) {
        pairs.push(`${name}=${value}`);
      }
    }
    return pairs.length > 0 ? pairs.join("; ") : undefined;
  }

  set(key: string, value: string) {
    this.cookies.set(key, value);
  }
}

function splitSetCookieHeader(header: string | null): string[] {
  if (!header) {
    return [];
  }
  return header.split(/,(?=\s*[^;]+=[^;]+)/);
}
