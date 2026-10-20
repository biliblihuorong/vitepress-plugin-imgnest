import { describe, it, expect } from "vitest";
import {
  collectImageUrls,
  rewriteMarkdownImages,
  rewriteHtmlImages,
  rewriteImgTag,
  buildSrcset,
  rewriteAll,
} from "../src/rewrite";
import type { Variant } from "../src/types";

const variants400_800: Variant[] = [
  { url: "https://img.example.com/a_400.webp", width: 400, height: 300 },
  { url: "https://img.example.com/a_800.webp", width: 800, height: 600 },
];

describe("buildSrcset", () => {
  it("builds srcset string", () => {
    expect(buildSrcset(variants400_800)).toBe(
      "https://img.example.com/a_400.webp 400w, https://img.example.com/a_800.webp 800w",
    );
  });

  it("encodes spaces in URLs", () => {
    const v: Variant[] = [{ url: "https://img.example.com/a b.webp", width: 400 }];
    expect(buildSrcset(v)).toBe("https://img.example.com/a%20b.webp 400w");
  });
});

describe("collectImageUrls", () => {
  it("collects markdown image URLs", () => {
    const content = "# Title\n\n![alt](https://img.example.com/a.webp)\n\n![b](https://img.example.com/b.webp)";
    const urls = collectImageUrls(content);
    expect(urls).toContain("https://img.example.com/a.webp");
    expect(urls).toContain("https://img.example.com/b.webp");
  });

  it("collects HTML img URLs", () => {
    const content = '<img src="https://img.example.com/a.webp">\n<img src="https://img.example.com/b.webp">';
    const urls = collectImageUrls(content);
    expect(urls).toContain("https://img.example.com/a.webp");
    expect(urls).toContain("https://img.example.com/b.webp");
  });

  it("collects from lazy load attributes", () => {
    const content = '<img data-src="https://img.example.com/a.webp" src="placeholder.gif">';
    const urls = collectImageUrls(content);
    expect(urls).toContain("https://img.example.com/a.webp");
  });

  it("deduplicates URLs", () => {
    const content = "![a](https://img.example.com/a.webp)\n![a](https://img.example.com/a.webp)";
    const urls = collectImageUrls(content);
    expect(urls).toHaveLength(1);
  });

  it("ignores non-image URLs in markdown", () => {
    const content = "[link](https://example.com/page)";
    const urls = collectImageUrls(content);
    expect(urls).toHaveLength(0);
  });
});

describe("rewriteMarkdownImages", () => {
  it("rewrites markdown image to img with srcset", () => {
    const content = "![alt text](https://img.example.com/a.webp)";
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    const result = rewriteMarkdownImages(content, variants, { sizes: "(max-width: 800px) 100vw, 800px" });
    expect(result).toContain('src="https://img.example.com/a.webp"');
    expect(result).toContain("srcset=");
    expect(result).toContain("400w");
    expect(result).toContain("800w");
    expect(result).toContain('alt="alt text"');
    expect(result).toContain("sizes=");
  });

  it("preserves title in markdown image", () => {
    const content = '![alt](https://img.example.com/a.webp "My Title")';
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    const result = rewriteMarkdownImages(content, variants, {});
    expect(result).toContain('title="My Title"');
  });

  it("adds onerror fallback by default", () => {
    const content = "![alt](https://img.example.com/a.webp)";
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    const result = rewriteMarkdownImages(content, variants, {});
    expect(result).toContain("onerror=");
  });

  it("skips onerror when fallbackOnError is false", () => {
    const content = "![alt](https://img.example.com/a.webp)";
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    const result = rewriteMarkdownImages(content, variants, { fallbackOnError: false });
    expect(result).not.toContain("onerror=");
  });

  it("adds width/height when writeDimensions is true", () => {
    const content = "![alt](https://img.example.com/a.webp)";
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    const result = rewriteMarkdownImages(content, variants, { writeDimensions: true });
    expect(result).toContain('width="800"');
    expect(result).toContain('height="600"');
  });

  it("leaves unmatched images unchanged", () => {
    const content = "![alt](https://other.com/a.webp)";
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    const result = rewriteMarkdownImages(content, variants, {});
    expect(result).toBe(content);
  });
});

describe("rewriteImgTag", () => {
  it("adds srcset to simple img tag", () => {
    const tag = '<img src="https://img.example.com/a.webp">';
    const result = rewriteImgTag(tag, variants400_800, {});
    expect(result).toContain("srcset=");
    expect(result).toContain("400w");
    expect(result).toContain("800w");
  });

  it("does not overwrite existing srcset with different URLs", () => {
    const tag = '<img src="https://img.example.com/a.webp" srcset="https://img.example.com/a_400.webp 400w, https://img.example.com/a_800.webp 800w">';
    const result = rewriteImgTag(tag, variants400_800, {});
    expect(result).toBe(tag);
  });

  it("overwrites srcset when all items are the src URL (placeholder)", () => {
    const tag = '<img src="https://img.example.com/a.webp" srcset="https://img.example.com/a.webp 1x">';
    const result = rewriteImgTag(tag, variants400_800, {});
    expect(result).toContain("a_400.webp 400w");
  });

  it("adds sizes when missing", () => {
    const tag = '<img src="https://img.example.com/a.webp">';
    const result = rewriteImgTag(tag, variants400_800, { sizes: "100vw" });
    expect(result).toContain('sizes="100vw"');
  });

  it("does not overwrite existing sizes", () => {
    const tag = '<img src="https://img.example.com/a.webp" sizes="50vw">';
    const result = rewriteImgTag(tag, variants400_800, { sizes: "100vw" });
    expect(result).toContain('sizes="50vw"');
    expect(result).not.toContain('sizes="100vw"');
  });

  it("handles lazy load data-src", () => {
    const tag = '<img data-src="https://img.example.com/a.webp" src="placeholder.gif">';
    const result = rewriteImgTag(tag, variants400_800, {});
    expect(result).toContain("data-srcset=");
    expect(result).toContain('data-responsive-src="https://img.example.com/a.webp"');
  });

  it("returns tag unchanged when no variants", () => {
    const tag = '<img src="https://img.example.com/a.webp">';
    const result = rewriteImgTag(tag, [], {});
    expect(result).toBe(tag);
  });
});

describe("rewriteHtmlImages", () => {
  it("rewrites HTML img tags", () => {
    const content = '<img src="https://img.example.com/a.webp">';
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    const result = rewriteHtmlImages(content, variants, { sizes: "100vw" });
    expect(result).toContain("srcset=");
    expect(result).toContain('sizes="100vw"');
  });

  it("handles self-closing tags", () => {
    const content = '<img src="https://img.example.com/a.webp" />';
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    const result = rewriteHtmlImages(content, variants, {});
    expect(result).toContain("srcset=");
  });
});

describe("rewriteAll", () => {
  it("rewrites both markdown and HTML images", () => {
    const content = [
      "# Title",
      "![alt](https://img.example.com/a.webp)",
      '<img src="https://img.example.com/b.webp">',
    ].join("\n");
    const variants = new Map<string, Variant[]>([
      ["https://img.example.com/a.webp", variants400_800],
      ["https://img.example.com/b.webp", [{ url: "https://img.example.com/b_400.webp", width: 400 }]],
    ]);
    const result = rewriteAll(content, variants, {});
    expect(result).toContain("srcset=");
    expect(result).toContain("a_400.webp");
    expect(result).toContain("b_400.webp");
  });
});
