# vitepress-plugin-imgnest

[English](./README.md) | 简体中文

ImgNest 响应式图片的 VitePress 插件。构建时扫描 Markdown 文件中的图片，批量查询 ImgNest 的衍生版本接口，自动为 `<img>` 补上 `srcset` 和 `sizes`。

## 前置要求

需要一台开启了响应式衍生图功能的 ImgNest 服务器。构建机器需能访问公开查询接口（`POST /api/variants`）——查询由 Node 发起而非浏览器，因此无需配置 CORS。

## 安装

```bash
npm install vitepress-plugin-imgnest
```

## 配置

在 `.vitepress/config.ts` 中使用：

```ts
import { defineConfig } from "vitepress";
import { imgnestResponsiveImages } from "vitepress-plugin-imgnest";

export default defineConfig({
  vite: {
    plugins: [
      ...imgnestResponsiveImages({
        sources: [
          {
            type: "lookup",
            hosts: "img.example.com",
            endpoint: "https://img.example.com/api/variants",
          },
        ],
        sizes: "(max-width: 800px) 100vw, 800px",
      }),
    ],
  },
});
```

## 图片来源

### 查询接口（ImgNest）

适合 ImgNest 等预生成衍生图的图床：

```ts
{
  type: "lookup",
  hosts: "img.example.com",
  endpoint: "https://img.example.com/api/variants",
}
```

构建时向 `POST {endpoint}` 发送 `{"urls": [...]}`，每批最多 50 条，与 ImgNest `/api/variants` 协议完全一致。

### URL 规则（CDN）

适合能实时缩放的 CDN（阿里云 OSS、腾讯云 COS、七牛等）：

```ts
{
  type: "template",
  hosts: "img.example.com",
  template: "{url}{sep}x-oss-process=image/resize,w_{width}",
  widths: "400,800,1600",
}
```

不发请求，直接按模板拼接 URL。`{url}` 为原图地址，`{sep}` 自动为 `?` 或 `&`，`{width}` 为宽度值。

## 配置项

| 选项 | 默认值 | 说明 |
|---|---|---|
| `sources` | （必填） | 图片来源列表，按顺序匹配 |
| `sizes` | `(max-width: 800px) 100vw, 800px` | 图片没有 `sizes` 时补上的默认值 |
| `writeDimensions` | `false` | 写入最大版本的 `width`/`height`，建议在 CSS 中设置 `height: auto` 保持宽高比 |
| `fallbackOnError` | `true` | 衍生图加载失败时撤下 `srcset`，回退到原图 |
| `timeout` | `5000` | 查询超时时间（毫秒） |

## 处理范围与行为

- 在 VitePress 编译 Markdown 之前处理原始文本，主题和自定义布局都适用。
- **Markdown 图片**：`![alt](url)` 转换为带 `srcset` 的 `<img>` 标签。
- **内嵌 HTML 图片**：Markdown 里的 `<img src="...">` 直接补写属性。
- **代码块零改动**：围栏代码块和行内代码里出现的图片语法原样保留——示例代码不会被误改写。
- 已有 `srcset` 的图片跳过；已有的 `sizes` 不会被覆盖。
- 懒加载属性（`data-src`、`data-lazy-src`、`data-original`）优先于 `src`。
- 原图 URL 会作为 `srcset` 的最后一项保留；开启 `fallbackOnError` 时，衍生图加载失败会通过 `onerror` 撤下 `srcset`，图片始终能回退到原图。
- 只处理 `.md` 文件——Vue 组件里的 `<img>` 不在处理范围内。
- 查询结果在整个构建期间缓存：同一 URL 无论出现在多少个页面，只会查询一次。
- 服务端返回非 200 时（例如 ImgNest 默认每 IP 每分钟 60 次的限流），插件只警告一次并保留原图 URL；收到 `429` 后本次构建不再继续查询。站点较大时可在 ImgNest 服务端调高 `variant_lookup_per_minute`。
- 超过 2048 字符（服务端上限）的 URL 会被跳过，不会导致整批查询失败。

## 许可证

MIT
