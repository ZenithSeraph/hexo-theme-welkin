# Welkin · 玻璃档案与纸页

Welkin 是一款 Hexo 主题，**视觉设计参考《明日方舟》的档案与界面风格**：以玻璃档案展示文章，用纸页呈现正文，搭配安静的光照、细边框和档案切换动效。

An Arknights-inspired Hexo theme with interactive glass archives and paper reading pages.

本项目是独立的社区主题。部分动效公式参考并改编自 RhineLabUI，已保留其 MIT 版权声明。主题包不包含游戏立绘、标志、音频或字体。

## 特性

- Three.js 玻璃档案首页，支持滚轮、触摸滑动与按钮切换。
- 文章正文静态生成，可直接打开，关闭 JavaScript 仍可阅读。
- 分类、标签、归档、分页、搜索、目录与深色阅读。
- 自动整理已发布文章的索引；本地封面直接使用，远程 HTTPS 封面在构建时准备受大小限制的 WebP 副本。
- 文章页和归档页不加载 WebGL；遵循系统减少动态效果偏好。
- 支持部署到根目录或子目录，所有主题资源随包提供。

## 安装

需要 Node.js **20.19.0 或更高版本**，推荐 Node.js 24。本主题已用 Hexo 8.1.2 验证。

在现有 Hexo 站点根目录执行：

```sh
git clone https://github.com/ZenithSeraph/hexo-theme-welkin.git themes/welkin
npm install hexo-renderer-ejs hexo-generator-index hexo-generator-archive hexo-generator-category hexo-generator-tag
npm install --prefix themes/welkin --omit=dev
```

也可以下载 Release 中的 ZIP，将其顶层文件夹解压并改名为 `themes/welkin`，再执行上面的两个 npm 安装命令。站点还需要可渲染 Markdown 的插件，例如 `hexo-renderer-marked`。

在**站点根目录**的 `_config.yml` 设置自己的信息：

```yaml
theme: welkin
title: My Site
subtitle: ''
author: Your Name
language: zh-CN
url: https://example.com
root: /
archive_dir: archives
category_dir: categories
tag_dir: tags
```

若部署到子目录，请将 `url` 和 `root` 设置为对应路径，例如 `https://example.com/blog` 与 `/blog/`。站点原有文章链接规则可继续使用。

## 分类与标签索引

分别创建 `source/categories/index.md` 和 `source/tags/index.md`：

```yaml
---
title: 分类
type: categories
layout: page
---
```

```yaml
---
title: 标签
type: tags
layout: page
---
```

## 文章配置

普通 Hexo 文章即可使用。以下为可选的 front matter 字段示例：

```yaml
title: Example
date: 2026-01-01 12:00:00
categories:
  - Notes
tags:
  - Example
cover: /images/cover.webp
description: A short description.
toc: true
```

`cover` 可使用本地图片或 HTTPS 地址；`mp3` 可指定文章页的音频地址；`toc: false` 可关闭单篇目录。主题目录的 `_config.yml` 可设置全局 `toc`。

远程封面会在构建时请求原地址，缓存位于**使用者站点**的 `.cache/welkin-covers/`。无封面或封面加载失败时，首页仍可显示和打开文章。正文图片继续使用文章中的原地址。

## 构建

在 Hexo 站点根目录运行：

```sh
npx hexo clean
npx hexo generate
npx hexo server
```

将生成的 `public/` 部署到静态托管平台即可。

## 开发与验证

在本主题仓库根目录执行 `npm install` 后运行 `npm test`。测试在 `work/tmp/` 临时生成空站点和虚构内容，覆盖根路径、子目录、静态正文、分页、草稿排除、资源链接、触摸和滚轮输入。

主题脚本、样式和 WebGL 资源位于 `source/assets/welkin/`，模板位于 `layout/`。该仓库仅提供主题及文档，不包含作者的网站文章、图片、站点配置、部署凭据或原站点的 Git 历史。

## 版权

Copyright (c) 2026 ZenithSeraph. 本主题代码使用 [MIT 许可证](LICENSE)。使用和分发时请保留许可证及相关版权声明。

第三方代码归属与《明日方舟》设计参考说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
