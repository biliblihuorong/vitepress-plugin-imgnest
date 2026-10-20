// Test VitePress plugin with real blog data.
// Run with Node >= 22.18 (native TS type stripping):
//   node --experimental-strip-types test-integration.js
import { VariantResolver } from "./src/resolver.ts";
import { collectImageUrls, rewriteAll } from "./src/rewrite.ts";

const SAMPLE_MARKDOWN = `# Thinkpad T14 Gen2A

这是一篇测试文章。

![photo1](https://img.ning.moe/ShellBlogImg/2026/10/6ad4b31622f41.webp)

第二张图片：

![photo2](https://img.ning.moe/i/1/23/01/30/63d759cdaccfe.webp)

第三张图片（HTML img 标签）：

<img src="https://img.ning.moe/ShellBlogImg/1/2026/05/15/6a0704dc3843c.webp" alt="photo3">

懒加载图片：

<img data-src="https://img.ning.moe/ShellBlogImg/1/2026/05/16/6a07e2b1ad9c2.webp" src="placeholder.gif" alt="lazy">

不匹配域名的图片（不应处理）：

![external](https://other-cdn.com/image.png)
`;

async function main() {
  const resolver = new VariantResolver({
    sources: [
      {
        type: "lookup",
        hosts: "img.ning.moe",
        endpoint: "https://imgnest.ning.moe/api/variants",
      },
    ],
    timeout: 10000,
  });

  console.log("=== VitePress Plugin Test ===\n");
  console.log("Sources:", resolver.hasSources ? "OK" : "FAIL");

  // Step 1: Collect URLs
  const urls = collectImageUrls(SAMPLE_MARKDOWN);
  console.log(`\nCollected ${urls.length} image URLs:`);
  urls.forEach((u) => console.log(`  - ${u}`));

  // Step 2: Resolve variants
  const variants = await resolver.resolve(urls);
  console.log(`\nResolved variants for ${variants.size} images:`);
  for (const [url, vs] of variants) {
    console.log(`  - ${url}: ${vs.length} variants (${vs.map((v) => v.width).join(", ")}w)`);
  }

  // Step 3: Rewrite
  const result = rewriteAll(SAMPLE_MARKDOWN, variants, {
    sizes: "(max-width: 800px) 100vw, 800px",
    writeDimensions: true,
    fallbackOnError: true,
  });

  // Verify
  const checks = [
    { name: "markdown image converted to img with srcset", test: result.includes("srcset=") && result.includes("6ad4b31622f41_w400_v1.webp 400w") },
    { name: "markdown image has sizes", test: result.includes('sizes="(max-width: 800px) 100vw, 800px"') },
    { name: "markdown image has onerror fallback", test: result.includes("onerror=") },
    { name: "markdown image has width/height", test: result.includes('width="800"') },
    { name: "HTML img tag has srcset", test: result.includes("6a0704dc3843c_w400_v1.webp 400w") },
    { name: "lazy img has data-srcset", test: result.includes("data-srcset=") },
    { name: "lazy img has data-responsive-src", test: result.includes('data-responsive-src="https://img.ning.moe/ShellBlogImg/1/2026/05/16/6a07e2b1ad9c2.webp"') },
    { name: "external image not modified", test: result.includes("![external](https://other-cdn.com/image.png)") },
  ];

  console.log("\n--- Checks ---");
  let passed = 0;
  for (const c of checks) {
    const status = c.test ? "PASS" : "FAIL";
    console.log(`  [${status}] ${c.name}`);
    if (c.test) passed++;
  }

  console.log(`\nResult: ${passed}/${checks.length} checks passed`);
  console.log("\n--- Rewritten content ---");
  console.log(result);

  if (passed < checks.length) process.exit(1);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
