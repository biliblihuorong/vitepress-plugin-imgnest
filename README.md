# vitepress-plugin-imgnest

ImgNest 响应式图片的 VitePress 插件。构建时扫描 Markdown 中的图片，批量查询 ImgNest 的衍生版本接口，自动为 `<img>` 补上 `srcset` 和 `sizes`。

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

构建时向 `POST {endpoint}` 发送 `{"urls": [...]}` 批量查询，响应格式与 ImgNest `/api/variants` 一致。

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
| `writeDimensions` | `false` | 写入最大版本的 `width`/`height`，需主题设置 `height: auto` |
| `fallbackOnError` | `true` | 衍生图加载失败时撤下 `srcset`，回退到原图 |
| `timeout` | `5000` | 查询超时时间（毫秒） |

## 处理范围

- **Markdown 图片**：`![alt](url)` 转换为带 `srcset` 的 `<img>` 标签
- **HTML img 标签**：Markdown 中内嵌的 `<img src="...">` 直接补写属性
- 已有 `srcset` 的图片跳过，不改写
- 已有 `sizes` 的图片不覆盖
- 懒加载属性（`data-src`、`data-lazy-src`、`data-original`）优先于 `src`

## 许可证

MIT
