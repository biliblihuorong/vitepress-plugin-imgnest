import type { Plugin } from "vite";
import type { ImgNestResponsiveOptions, Variant } from "./types";
import { VariantResolver } from "./resolver";
import { collectImageUrls, rewriteAll, type RewriteOptions } from "./rewrite";

const MD_RE = /\.md(?:$|\?)/;
const DEFAULT_SIZES = "(max-width: 800px) 100vw, 800px";

export function imgnestResponsiveImages(
  options: ImgNestResponsiveOptions,
): Plugin[] {
  const resolver = new VariantResolver(options);
  const rewriteOpts: RewriteOptions = {
    sizes: options.sizes ?? DEFAULT_SIZES,
    writeDimensions: options.writeDimensions,
    fallbackOnError: options.fallbackOnError,
  };

  const vitePlugin: Plugin = {
    name: "vitepress-plugin-imgnest",
    enforce: "pre",

    async transform(code, id) {
      if (!MD_RE.test(id)) return null;
      if (!resolver.hasSources) return null;

      const urls = collectImageUrls(code);
      if (urls.length === 0) return null;

      let variants: Map<string, Variant[]>;
      try {
        variants = await resolver.resolve(urls);
      } catch (err) {
        console.warn(
          `[imgnest] Failed to resolve variants for ${id}:`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }

      if (variants.size === 0) return null;

      const rewritten = rewriteAll(code, variants, rewriteOpts);
      if (rewritten === code) return null;

      return { code: rewritten, map: null };
    },
  };

  return [vitePlugin];
}
