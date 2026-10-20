import type { Plugin } from "vite";
import type { ImgNestResponsiveOptions, Variant } from "./types";
import { VariantResolver } from "./resolver";
import { collectImageUrls, rewriteAll, type RewriteOptions } from "./rewrite";
import { imgnestMarkdownPlugin, type MarkdownPluginContext } from "./markdown";

const MD_RE = /\.md(?:$|\?)/;

export function imgnestResponsiveImages(
  options: ImgNestResponsiveOptions,
): Plugin[] {
  const resolver = new VariantResolver(options);
  const rewriteOpts: RewriteOptions = {
    sizes: options.sizes,
    writeDimensions: options.writeDimensions,
    fallbackOnError: options.fallbackOnError,
  };

  const mdCtx: MarkdownPluginContext = { resolver, options };

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

  return [vitePlugin, {
    name: "vitepress-plugin-imgnest:markdown",
    configResolved(config) {
      const vpConfig = config as unknown as {
        vitepress?: {
          site?: {
            markdown?: {
              config?: (md: unknown) => void;
            };
          };
        };
      };
      if (!vpConfig.vitepress?.site?.markdown) return;

      const origConfig = vpConfig.vitepress.site.markdown.config;
      vpConfig.vitepress.site.markdown.config = (md: unknown) => {
        origConfig?.(md);
        imgnestMarkdownPlugin(md as Parameters<typeof imgnestMarkdownPlugin>[0], mdCtx);
      };
    },
  }];
}
