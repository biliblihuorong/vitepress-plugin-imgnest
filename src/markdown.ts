import type MarkdownIt from "markdown-it";
import type { Variant, ImgNestResponsiveOptions } from "./types";
import { VariantResolver } from "./resolver";
import { buildSrcset, rewriteImgTag, type RewriteOptions } from "./rewrite";

const FALLBACK_SCRIPT = "this.onerror=null;this.removeAttribute('srcset')";
const FALLBACK_LAZY = `${FALLBACK_SCRIPT};this.src=this.getAttribute('data-responsive-src')`;

export interface MarkdownPluginContext {
  resolver: VariantResolver;
  options: ImgNestResponsiveOptions;
}

export function imgnestMarkdownPlugin(
  md: MarkdownIt,
  ctx: MarkdownPluginContext,
): void {
  const { resolver, options } = ctx;
  const rewriteOpts: RewriteOptions = {
    sizes: options.sizes,
    writeDimensions: options.writeDimensions,
    fallbackOnError: options.fallbackOnError,
  };

  const defaultRender =
    md.renderer.rules.image ??
    ((tokens, idx, opts, _self, self2) => {
      return self2.renderToken(tokens, idx, opts);
    });

  md.renderer.rules.image = (tokens, idx, mdOptions, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src");
    if (src) {
      const variants = env.__imgnestVariants as
        | Map<string, Variant[]>
        | undefined;
      const v = variants?.get(src);
      if (v && v.length > 0) {
        token.attrSet("srcset", buildSrcset(v, src));
        if (options.sizes && !token.attrGet("sizes")) {
          token.attrSet("sizes", options.sizes.trim());
        }
        if (options.fallbackOnError !== false && !token.attrGet("onerror")) {
          token.attrSet("onerror", FALLBACK_SCRIPT);
        }
        if (options.writeDimensions) {
          const largest = v[v.length - 1];
          if (largest.height && !token.attrGet("width")) {
            token.attrSet("width", String(largest.width));
            token.attrSet("height", String(largest.height));
          }
        }
      }
    }
    return defaultRender(tokens, idx, mdOptions, env, self);
  };

  const defaultHtmlInline =
    md.renderer.rules.html_inline ??
    ((tokens, idx) => tokens[idx].content);

  md.renderer.rules.html_inline = (tokens, idx, mdOptions, env, self) => {
    const content = tokens[idx].content;
    if (!/<img\b/i.test(content)) {
      return defaultHtmlInline(tokens, idx, mdOptions, env, self);
    }
    const variants = env.__imgnestVariants as
      | Map<string, Variant[]>
      | undefined;
    if (!variants || variants.size === 0) {
      return defaultHtmlInline(tokens, idx, mdOptions, env, self);
    }
    return content.replace(/<img\b[^>]*\/?>/gi, (tag) => {
      const srcMatch = tag.match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const src = srcMatch ? srcMatch[1] ?? srcMatch[2] : null;
      if (!src) return tag;
      const v = variants.get(src.trim());
      if (!v || v.length === 0) return tag;
      return rewriteImgTag(tag, v, rewriteOpts);
    });
  };
}
