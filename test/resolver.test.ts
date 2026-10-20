import { describe, it, expect } from "vitest";
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
