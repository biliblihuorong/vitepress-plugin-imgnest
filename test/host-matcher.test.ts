import { describe, it, expect } from "vitest";
import { HostMatcher } from "../src/resolver";

describe("HostMatcher", () => {
  it("matches exact host", () => {
    const m = new HostMatcher("img.example.com");
    expect(m.matches("https://img.example.com/a.webp")).toBe(true);
    expect(m.matches("https://other.com/a.webp")).toBe(false);
  });

  it("matches host with path prefix", () => {
    const m = new HostMatcher("img.example.com/blog/");
    expect(m.matches("https://img.example.com/blog/a.webp")).toBe(true);
    expect(m.matches("https://img.example.com/other/a.webp")).toBe(false);
  });

  it("matches wildcard host", () => {
    const m = new HostMatcher("*.example.com");
    expect(m.matches("https://img.example.com/a.webp")).toBe(true);
    expect(m.matches("https://cdn.example.com/a.webp")).toBe(true);
    expect(m.matches("https://example.com/a.webp")).toBe(false);
  });

  it("matches multiple hosts", () => {
    const m = new HostMatcher("img.example.com\ncdn.other.com");
    expect(m.matches("https://img.example.com/a.webp")).toBe(true);
    expect(m.matches("https://cdn.other.com/a.webp")).toBe(true);
    expect(m.matches("https://unknown.com/a.webp")).toBe(false);
  });

  it("strips protocol from host", () => {
    const m = new HostMatcher("https://img.example.com");
    expect(m.matches("https://img.example.com/a.webp")).toBe(true);
    expect(m.matches("http://img.example.com/a.webp")).toBe(true);
  });

  it("handles protocol-relative URLs", () => {
    const m = new HostMatcher("img.example.com");
    expect(m.matches("//img.example.com/a.webp")).toBe(true);
  });

  it("isEmpty when no rules", () => {
    expect(new HostMatcher("").isEmpty).toBe(true);
    expect(new HostMatcher("  \n  ").isEmpty).toBe(true);
    expect(new HostMatcher("img.example.com").isEmpty).toBe(false);
  });

  it("rejects non-http URLs", () => {
    const m = new HostMatcher("img.example.com");
    expect(m.matches("ftp://img.example.com/a.webp")).toBe(false);
    expect(m.matches("data:image/png;base64,abc")).toBe(false);
    expect(m.matches("")).toBe(false);
  });
});
