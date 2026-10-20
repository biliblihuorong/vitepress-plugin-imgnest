import type {
  Variant,
  SourceConfig,
  LookupResponse,
  ImgNestResponsiveOptions,
} from "./types";

interface Source {
  supports(url: string): boolean;
  resolve(urls: string[]): Promise<Map<string, Variant[]>>;
  describe(): string;
}

export class HostMatcher {
  private rules: { host: string; wildcard: boolean; pathPrefix: string }[];

  constructor(text: string) {
    this.rules = text
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(HostMatcher.parseRule);
  }

  private static parseRule(line: string) {
    let s = line
      .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "")
      .replace(/^\/\//, "");
    const slash = s.indexOf("/");
    let host = slash < 0 ? s : s.substring(0, slash);
    const path = slash < 0 ? "/" : s.substring(slash);
    const wildcard = host.startsWith("*.");
    if (wildcard) host = host.substring(1);
    return { host: host.toLowerCase(), wildcard, pathPrefix: path };
  }

  get isEmpty(): boolean {
    return this.rules.length === 0;
  }

  matches(rawUrl: string): boolean {
    let url: URL;
    try {
      const s = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
      url = new URL(s);
    } catch {
      return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const authority = url.hostname.toLowerCase();
    const path = url.pathname || "/";
    return this.rules.some(
      (r) =>
        (r.wildcard
          ? authority.endsWith(r.host)
          : authority === r.host) && path.startsWith(r.pathPrefix),
    );
  }
}

class LookupSource implements Source {
  static readonly BATCH = 50;
  // Mirrors the server-side per-link limit: one overlong link fails the
  // whole batch, so overlong links are skipped client-side instead.
  static readonly MAX_URL_LENGTH = 2048;

  private hosts: HostMatcher;
  private endpoint: URL;
  private timeout: number;
  private cache = new Map<string, Variant[]>();
  private rateLimited = false;
  private warned = new Set<string>();

  constructor(endpoint: string, hosts: HostMatcher, timeout: number) {
    this.endpoint = new URL(endpoint);
    this.hosts = hosts;
    this.timeout = timeout;
  }

  supports(url: string): boolean {
    return this.hosts.matches(url);
  }

  async resolve(urls: string[]): Promise<Map<string, Variant[]>> {
    const result = new Map<string, Variant[]>();
    const missing: string[] = [];
    for (const url of urls) {
      const cached = this.cache.get(url);
      if (cached) result.set(url, cached);
      else if (url.length <= LookupSource.MAX_URL_LENGTH) missing.push(url);
    }
    if (missing.length === 0 || this.rateLimited) return result;

    const batches: string[][] = [];
    for (let i = 0; i < missing.length; i += LookupSource.BATCH) {
      batches.push(missing.slice(i, i + LookupSource.BATCH));
    }
    // allSettled: one failed batch must not discard the answers of the rest.
    const settled = await Promise.allSettled(
      batches.map((batch) => this.lookup(batch)),
    );
    for (const settledBatch of settled) {
      if (settledBatch.status === "rejected") {
        this.warnOnce(
          "network",
          `[imgnest] variant lookup at ${this.endpoint} failed, images keep their original URLs this build (${settledBatch.reason instanceof Error ? settledBatch.reason.message : settledBatch.reason})`,
        );
        continue;
      }
      for (const [url, variants] of settledBatch.value) {
        this.cache.set(url, variants);
        result.set(url, variants);
      }
    }
    return result;
  }

  private async lookup(batch: string[]): Promise<Map<string, Variant[]>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: batch }),
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 429) {
          // Rate limited: stop querying this build, later pages would only
          // push the server further over its per-minute cap.
          this.rateLimited = true;
        }
        this.warnOnce(
          `http-${res.status}`,
          `[imgnest] variant lookup at ${this.endpoint} answered ${res.status}; matching images keep their original URLs${res.status === 429 ? " (rate limited, skipping further lookups this build; raise variant_lookup_per_minute server-side if needed)" : ""}`,
        );
        return new Map();
      }
      const body: LookupResponse = await res.json();
      return LookupSource.parse(batch, body);
    } finally {
      clearTimeout(timer);
    }
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(message);
  }

  static parse(batch: string[], body: LookupResponse): Map<string, Variant[]> {
    const items = body.data?.items ?? body.items;
    const result = new Map<string, Variant[]>();
    if (!Array.isArray(items)) return result;
    for (let i = 0; i < batch.length && i < items.length; i++) {
      const item = items[i];
      const variants: Variant[] = [];
      if (item.found !== false) {
        for (const v of item.variants ?? []) {
          if (v.url && v.width > 0) {
            variants.push({
              url: v.url,
              width: v.width,
              height: v.height && v.height > 0 ? v.height : undefined,
            });
          }
        }
      }
      variants.sort((a, b) => a.width - b.width);
      result.set(batch[i], variants);
    }
    return result;
  }

  describe(): string {
    return `lookup:${this.endpoint}`;
  }
}

class TemplateSource implements Source {
  private hosts: HostMatcher;
  private widths: number[];
  private template: string;

  constructor(hosts: HostMatcher, widths: number[], template: string) {
    this.hosts = hosts;
    this.widths = widths.filter((w) => w > 0).sort((a, b) => a - b);
    this.template = template;
  }

  supports(url: string): boolean {
    return (
      this.template.includes("{width}") &&
      this.widths.length > 0 &&
      this.hosts.matches(url)
    );
  }

  async resolve(urls: string[]): Promise<Map<string, Variant[]>> {
    const result = new Map<string, Variant[]>();
    for (const url of urls) {
      result.set(
        url,
        this.widths.map((w) => ({ url: this.build(url, w), width: w })),
      );
    }
    return result;
  }

  private build(url: string, width: number): string {
    const sep = url.includes("?") ? "&" : "?";
    return this.template
      .replace("{url}", url)
      .replace("{sep}", sep)
      .replace("{width}", String(width));
  }

  describe(): string {
    return `template:${this.template}:${this.widths}`;
  }
}

export class VariantResolver {
  private sources: Source[];
  private timeout: number;

  constructor(options: ImgNestResponsiveOptions) {
    this.timeout = options.timeout ?? 5000;
    this.sources = options.sources
      .map((cfg) => this.buildSource(cfg))
      .filter((s): s is Source => s !== null);
  }

  private buildSource(cfg: SourceConfig): Source | null {
    const hosts = new HostMatcher(cfg.hosts);
    if (hosts.isEmpty) return null;

    if (cfg.type === "template") {
      if (!cfg.template?.includes("{width}")) return null;
      const widths = (cfg.widths ?? "400,800,1600")
        .split(/[,\s]+/)
        .filter((s) => /^\d{1,5}$/.test(s))
        .map(Number);
      return new TemplateSource(hosts, widths, cfg.template);
    }

    if (!cfg.endpoint) return null;
    try {
      return new LookupSource(cfg.endpoint, hosts, this.timeout);
    } catch {
      return null;
    }
  }

  private pick(url: string): Source | undefined {
    return this.sources.find((s) => s.supports(url));
  }

  async resolve(urls: string[]): Promise<Map<string, Variant[]>> {
    const grouped = new Map<Source, string[]>();
    for (const url of urls) {
      const source = this.pick(url);
      if (source) {
        if (!grouped.has(source)) grouped.set(source, []);
        grouped.get(source)!.push(url);
      }
    }
    const results = await Promise.all(
      [...grouped.entries()].map(([src, u]) => src.resolve(u)),
    );
    const merged = new Map<string, Variant[]>();
    for (const r of results) {
      for (const [k, v] of r) merged.set(k, v);
    }
    return merged;
  }

  get hasSources(): boolean {
    return this.sources.length > 0;
  }
}
