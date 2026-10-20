import type { Variant } from "./types";

export interface RewriteOptions {
  sizes?: string;
  writeDimensions?: boolean;
  fallbackOnError?: boolean;
}

const MARKER = "data-responsive-src";
const FALLBACK_SCRIPT = "this.onerror=null;this.removeAttribute('srcset')";
const FALLBACK_LAZY = `${FALLBACK_SCRIPT};this.src=this.getAttribute('${MARKER}')`;

const LAZY_ATTRS = ["data-src", "data-lazy-src", "data-original"];

export function buildSrcset(variants: Variant[], originalUrl?: string): string {
  const entries = variants.map(
    (v) => `${v.url.replace(/ /g, "%20")} ${v.width}w`,
  );
  if (originalUrl) {
    const alreadyIncluded = variants.some((v) => v.url === originalUrl);
    if (!alreadyIncluded) {
      const w = variants.length > 0 ? Math.max(variants[variants.length - 1].width + 1, 9999) : 9999;
      entries.push(`${originalUrl.replace(/ /g, "%20")} ${w}w`);
    }
  }
  return entries.join(", ");
}

export function isImageUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v.startsWith("http://") || v.startsWith("https://") || v.startsWith("//");
}

function hasText(value: string | null | undefined): boolean {
  return value != null && value.trim().length > 0;
}

function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = tag.match(re);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`, "i");
  if (re.test(tag)) {
    return tag.replace(re, ` ${name}="${value}"`);
  }
  return tag.replace(/\/?\s*>$/, ` ${name}="${value}">`);
}

function hasAttr(tag: string, name: string): boolean {
  return new RegExp(`\\s${name}(?:\\s|=|>|/)`, "i").test(tag);
}

function isPlaceholderSrcset(
  srcset: string | null,
  url: string,
  src: string | null,
): boolean {
  if (!hasText(srcset)) return true;
  const items = srcset!.split(/,\s+|,$/);
  for (const item of items) {
    const parts = item.trim().split(/\s+/);
    if (!parts[0]) continue;
    if (parts[0] !== url && parts[0] !== (src ?? "").trim()) return false;
  }
  return true;
}

interface Candidate {
  url: string;
  fromLazyAttr: boolean;
}

function findCandidate(tag: string): Candidate | null {
  for (const name of LAZY_ATTRS) {
    const value = getAttr(tag, name);
    if (isImageUrl(value)) {
      return { url: value!.trim(), fromLazyAttr: true };
    }
  }
  const src = getAttr(tag, "src");
  if (isImageUrl(src)) {
    return { url: src!.trim(), fromLazyAttr: false };
  }
  return null;
}

export function rewriteImgTag(
  tag: string,
  variants: Variant[],
  options: RewriteOptions,
): string {
  if (variants.length === 0) return tag;

  const candidate = findCandidate(tag);
  if (!candidate) return tag;

  if (candidate.url === getAttr(tag, MARKER)) return tag;

  const srcsetAttr = candidate.fromLazyAttr ? "data-srcset" : "srcset";
  const existingSrcset = getAttr(tag, srcsetAttr);
  const src = getAttr(tag, "src");

  if (!isPlaceholderSrcset(existingSrcset, candidate.url, src)) {
    return tag;
  }

  let result = tag;
  result = setAttr(result, srcsetAttr, buildSrcset(variants, candidate.url));

  if (candidate.fromLazyAttr) {
    result = setAttr(result, MARKER, candidate.url);
  }

  if (
    options.fallbackOnError !== false &&
    srcsetAttr === "srcset" &&
    !hasAttr(result, "onerror")
  ) {
    const script = candidate.fromLazyAttr ? FALLBACK_LAZY : FALLBACK_SCRIPT;
    result = setAttr(result, "onerror", script);
  }

  if (!hasText(getAttr(result, "sizes")) && hasText(options.sizes)) {
    result = setAttr(result, "sizes", options.sizes!.trim());
  }

  if (options.writeDimensions) {
    const largest = variants[variants.length - 1];
    if (
      largest.height &&
      !hasAttr(result, "width") &&
      !hasAttr(result, "height")
    ) {
      result = setAttr(result, "width", String(largest.width));
      result = setAttr(result, "height", String(largest.height));
    }
  }

  return result;
}

const MD_IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const HTML_IMG_RE = /<img\b[^>]*\/?>/gi;

export function collectImageUrls(content: string): string[] {
  const urls = new Set<string>();

  let m: RegExpExecArray | null;
  const mdRe = new RegExp(MD_IMG_RE.source, "g");
  while ((m = mdRe.exec(content)) !== null) {
    const url = m[2].split(/\s+/)[0];
    if (isImageUrl(url)) urls.add(url.trim());
  }

  const htmlRe = new RegExp(HTML_IMG_RE.source, "gi");
  while ((m = htmlRe.exec(content)) !== null) {
    const candidate = findCandidate(m[0]);
    if (candidate) urls.add(candidate.url);
  }

  return [...urls];
}

export function rewriteMarkdownImages(
  content: string,
  variants: Map<string, Variant[]>,
  options: RewriteOptions,
): string {
  return content.replace(
    new RegExp(MD_IMG_RE.source, "g"),
    (match, alt: string, urlPart: string) => {
      const parts = urlPart.split(/\s+/);
      const url = parts[0];
      const v = variants.get(url);
      if (!v || v.length === 0) return match;

      const titleMatch = urlPart.match(/"([^"]*)"/);
      const title = titleMatch ? ` title="${titleMatch[1]}"` : "";
      const srcset = buildSrcset(v, url);
      const sizes = options.sizes ? ` sizes="${options.sizes.trim()}"` : "";

      let tag = `<img src="${url}" srcset="${srcset}"${sizes} alt="${alt}"${title}`;

      if (options.fallbackOnError !== false) {
        tag += ` onerror="${FALLBACK_SCRIPT}"`;
      }

      if (options.writeDimensions) {
        const largest = v[v.length - 1];
        if (largest.height) {
          tag += ` width="${largest.width}" height="${largest.height}"`;
        }
      }

      return `${tag}>`;
    },
  );
}

export function rewriteHtmlImages(
  content: string,
  variants: Map<string, Variant[]>,
  options: RewriteOptions,
): string {
  return content.replace(
    new RegExp(HTML_IMG_RE.source, "gi"),
    (tag) => {
      const candidate = findCandidate(tag);
      if (!candidate) return tag;
      const v = variants.get(candidate.url);
      if (!v || v.length === 0) return tag;
      return rewriteImgTag(tag, v, options);
    },
  );
}

export function rewriteAll(
  content: string,
  variants: Map<string, Variant[]>,
  options: RewriteOptions,
): string {
  let result = rewriteMarkdownImages(content, variants, options);
  result = rewriteHtmlImages(result, variants, options);
  return result;
}
