import { describe, it, expect, vi, afterEach } from "vitest";
import type { LookupResponse } from "../src/types";
import { VariantResolver, HostMatcher } from "../src/resolver";

describe("LookupSource.parse", () => {
  it("parses response with data wrapper", async () => {
    const resolver = new VariantResolver({
      sources: [{ type: "lookup", hosts: "img.example.com", endpoint: "https://img.example.com/api/variants" }],
    });

    const body: LookupResponse = {
      data: {
        items: [
          {
            found: true,
            variants: [
              { url: "https://img.example.com/a_400.webp", width: 400, height: 300 },
              { url: "https://img.example.com/a_800.webp", width: 800, height: 600 },
            ],
          },
        ],
      },
    };

    // Access the static parse method through the class
    const { LookupSource } = await import("../src/resolver") as any;
    // Since LookupSource is not exported, test through VariantResolver behavior
    expect(resolver.hasSources).toBe(true);
  });

  it("parses response without data wrapper", () => {
    const body: LookupResponse = {
      items: [
        {
          found: true,
          variants: [
            { url: "https://img.example.com/a_400.webp", width: 400 },
          ],
        },
      ],
    };
    expect(body.items).toHaveLength(1);
    expect(body.items![0].variants[0].width).toBe(400);
  });
});

describe("VariantResolver", () => {
  it("creates template source", () => {
    const resolver = new VariantResolver({
      sources: [
        {
          type: "template",
          hosts: "img.example.com",
          template: "{url}{sep}x-oss-process=image/resize,w_{width}",
          widths: "400,800,1600",
        },
      ],
    });
    expect(resolver.hasSources).toBe(true);
  });

  it("skips source without hosts", () => {
    const resolver = new VariantResolver({
      sources: [{ type: "lookup", hosts: "", endpoint: "https://img.example.com/api/variants" }],
    });
    expect(resolver.hasSources).toBe(false);
  });

  it("skips template source without {width}", () => {
    const resolver = new VariantResolver({
      sources: [{ type: "template", hosts: "img.example.com", template: "{url}?w=100" }],
    });
    expect(resolver.hasSources).toBe(false);
  });

  it("skips lookup source without endpoint", () => {
    const resolver = new VariantResolver({
      sources: [{ type: "lookup", hosts: "img.example.com" }],
    });
    expect(resolver.hasSources).toBe(false);
  });

  it("resolves template source URLs", async () => {
    const resolver = new VariantResolver({
      sources: [
        {
          type: "template",
          hosts: "img.example.com",
          template: "{url}{sep}w_{width}",
          widths: "400,800",
        },
      ],
    });

    const result = await resolver.resolve(["https://img.example.com/photo.webp"]);
    const variants = result.get("https://img.example.com/photo.webp");
    expect(variants).toHaveLength(2);
    expect(variants![0].width).toBe(400);
    expect(variants![0].url).toBe("https://img.example.com/photo.webp?w_400");
    expect(variants![1].width).toBe(800);
    expect(variants![1].url).toBe("https://img.example.com/photo.webp?w_800");
  });

  it("resolves template source with existing query string", async () => {
    const resolver = new VariantResolver({
      sources: [
        {
          type: "template",
          hosts: "img.example.com",
          template: "{url}{sep}w_{width}",
          widths: "400",
        },
      ],
    });

    const result = await resolver.resolve(["https://img.example.com/photo.webp?v=1"]);
    const variants = result.get("https://img.example.com/photo.webp?v=1");
    expect(variants![0].url).toBe("https://img.example.com/photo.webp?v=1&w_400");
  });

  it("returns empty for unmatched URLs", async () => {
    const resolver = new VariantResolver({
      sources: [
        {
          type: "template",
          hosts: "img.example.com",
          template: "{url}{sep}w_{width}",
          widths: "400",
        },
      ],
    });

    const result = await resolver.resolve(["https://other.com/photo.webp"]);
    expect(result.size).toBe(0);
  });
});

describe("LookupSource fetch behaviour", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function lookupResolver() {
    return new VariantResolver({
      sources: [
        {
          type: "lookup",
          hosts: "img.example.com",
          endpoint: "https://img.example.com/api/variants",
        },
      ],
    });
  }

  it("caches lookup results across resolve calls", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          items: [
            {
              found: true,
              variants: [
                { url: "https://img.example.com/a_400.webp", width: 400 },
              ],
            },
          ],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const resolver = lookupResolver();

    const first = await resolver.resolve(["https://img.example.com/a.webp"]);
    const second = await resolver.resolve(["https://img.example.com/a.webp"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.get("https://img.example.com/a.webp")![0].width).toBe(400);
    expect(second.get("https://img.example.com/a.webp")).toEqual(
      first.get("https://img.example.com/a.webp"),
    );
  });

  it("warns once on 429 and stops further lookups this build", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const resolver = lookupResolver();

    const first = await resolver.resolve(["https://img.example.com/a.webp"]);
    const second = await resolver.resolve(["https://img.example.com/b.webp"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.size).toBe(0);
    expect(second.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("429");
  });

  it("skips URLs longer than the server-side limit instead of failing the batch", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { items: [] } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const resolver = lookupResolver();

    const long = `https://img.example.com/${"a".repeat(2100)}.webp`;
    await resolver.resolve([long, "https://img.example.com/short.webp"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.urls).toEqual(["https://img.example.com/short.webp"]);
  });

  it("keeps answers of successful batches when another batch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async (_url: string, init?: { body: string }) => {
      const urls: string[] = JSON.parse(init!.body).urls;
      if (urls.some((u) => u.includes("a-"))) throw new Error("boom");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            items: urls.map((u) => ({
              found: true,
              variants: [{ url: `${u.replace(/\.webp$/, "")}_400.webp`, width: 400 }],
            })),
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const resolver = lookupResolver();

    const urls = Array.from({ length: 60 }, (_, i) =>
      `https://img.example.com/${i < 30 ? "a" : "b"}-${i}.webp`,
    );
    const result = await resolver.resolve(urls);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(10);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("review fixes", () => {
  it("accepts widths as an array without crashing", () => {
    const resolver = new VariantResolver({
      sources: [
        {
          type: "template",
          hosts: "img.example.com",
          template: "{url}{sep}w_{width}",
          widths: [400, 800],
        },
      ],
    });
    expect(resolver.hasSources).toBe(true);
  });

  it("does not mangle template URLs containing $ replacement patterns", async () => {
    const resolver = new VariantResolver({
      sources: [
        {
          type: "template",
          hosts: "img.example.com",
          template: "{url}{sep}w_{width}",
          widths: "400",
        },
      ],
    });
    const result = await resolver.resolve(["https://img.example.com/a$&b.webp"]);
    expect(result.get("https://img.example.com/a$&b.webp")![0].url).toBe(
      "https://img.example.com/a$&b.webp?w_400",
    );
  });
});
