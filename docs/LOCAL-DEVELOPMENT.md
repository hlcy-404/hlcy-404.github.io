# 本地开发与 GitHub 同步

## 项目入口

- 仓库：https://github.com/hlcy-404/hlcy-404.github.io
- 网站：https://hlcy-404.github.io/
- 主分支：`main`
- 技术结构：Jekyll 静态网站生成器、Chirpy 主题、Markdown 文章、GitHub Actions 构建、GitHub Pages 托管。

## 日常使用

1. 在 Codex 或编辑器中打开本仓库目录。
2. 修改文章、介绍或网站配置。保存只改变本地文件。
3. 需要预览时启动 Docker Desktop，再双击 `preview.cmd`。首次运行下载 Ruby 镜像及依赖，出现 Jekyll 服务就绪信息后访问 http://127.0.0.1:4000 。修改文章后刷新浏览器；修改 `_config.yml` 后重启预览。
4. 准备发布时双击 `sync.cmd`，核对修改清单，输入 `y`，填写本次修改说明。直接按回车则使用时间作为说明。
5. 同步脚本提交并推送到 `origin/main`。打开 [Actions](https://github.com/hlcy-404/hlcy-404.github.io/actions)，等待 Build and Deploy 的构建和部署均成功，再检查线上网站。
6. 不再预览时双击 `stop-preview.cmd`。它只停止本项目的 Compose 服务，保留依赖缓存。

网站更新需要经过“本地修改 → Git 提交与推送 → Actions 构建和检查 → Pages 部署”。推送成功不等于网站已更新。脚本会检查远端版本；遇到分叉或本地改动与远端更新同时存在时停止，不自动覆盖、强推或清理文件。

`sync.cmd` 会提交列出的全部修改，包括已有暂存内容。希望分批提交时，使用编辑器的 Git 界面或手动选择文件提交，再运行同步脚本。文件名排除规则只提供基础防护，提交前仍应核对内容中是否含私人资料或凭据。

## 常用修改位置

| 目标 | 文件或目录 |
| --- | --- |
| 网站标题、副标题、语言、头像、社交资料 | `_config.yml` |
| 关于我 | `_tabs/about.md` |
| 朋友与共创者 | `_data/friends.yml`（资料）、`_tabs/friends.html`（页面） |
| 新文章 | `_posts/YYYY-MM-DD-英文短名称.md` |
| 图片与附件 | `assets/`，建议文章图片放 `assets/img/` |
| 首页文案与方向面板 | `_data/atlas.yml` |
| 首页布局 | `_layouts/atlas.html` |
| 共用导航与联系方式入口 | `_includes/atlas-navigation.html` |
| 首页和内页样式 | `assets/css/atlas.css` |
| 交互与昼夜模式 | `assets/js/atlas.js`、`atlas-theme.js` |
| 原主题联系方式配置 | `_data/contact.yml`（自定义导航不读取此列表） |
| 分享按钮 | `_data/share.yml` |
| 构建与发布流程 | `.github/workflows/pages-deploy.yml` |
| Windows 同步逻辑 | `tools/Sync-Blog.ps1` |
| 本地 Ruby 运行环境 | `compose.yaml` |

主题的大部分布局和样式来自 `jekyll-theme-chirpy` Ruby gem，所以仓库较小，不是缺少网页源码。需要自定义布局时再按主题规则覆盖对应文件。

## 新文章起点

在 `_posts/` 中创建文件，例如 `2026-10-26-first-post.md`：

```markdown
---
title: 文章标题
date: 2026-10-26 12:00:00 +0800
categories: [研究记录]
tags: [人工智能]
description: 文章简介
---

正文内容。
```

示例仅说明格式，实际标题、日期、分类和正文按用户内容填写。

## 命令行入口

在本仓库中执行：

```powershell
# 只核查，不暂存、提交或推送
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Sync-Blog.ps1 -CheckOnly

# 手动运行，仍显示清单并要求确认
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Sync-Blog.ps1 -Message "更新个人介绍"

# 启动 / 停止本地预览
docker compose up
docker compose down

# 先停止预览，避免两个进程同时写入 _site
docker compose stop blog

# 在相同环境中构建并检查站内链接
docker compose run --rm blog bash -lc "bundle install && bash tools/test.sh"

# 隔离样例回归，不往正式 _posts 写测试文章
docker compose run --rm blog bash -lc "bundle install && bundle exec ruby tools/verify-atlas.rb"

# 检查后重新启动本地预览
docker compose up -d
```

已明确授权的自动化调用可以使用 `-Yes -Message "说明"`；该参数仅省略确认，不跳过分支、远端、冲突或文件检查。推送失败时，本地提交保留，处理网络或权限问题后重新运行即可。

## Git 与环境配置

本地仓库设置 `main` 跟踪 `origin/main`，使用 HTTPS 和系统已有的 Git Credential Manager。作者使用 `hlcy-404` 及 GitHub noreply 邮箱。设置只作用于此仓库，凭据不写入项目文件。

项目使用 Docker Compose 将 Ruby 依赖存放在独立的 `hlcy-blog_gems` 卷中，预览端口只绑定 `127.0.0.1:4000`。未设置开机启动或后台自动上传。首次运行需要网络访问镜像仓库和 RubyGems；Docker 引擎不可用时需要先恢复 Docker Desktop。

主题固定为与现有 Starter 配置对应的 `7.1.1`，避免普通内容发布时隐式升级主题。后续升级应同步检查主题配置、布局、静态资源和浏览器缓存。网站启用了 PWA；发布后若出现“New content available”，点击 Update 刷新缓存。

`.gitignore` 排除依赖、构建产物、缓存、常见凭据文件和 `.local/`。`_config.yml` 排除开发说明、同步脚本、Compose 配置等，避免把辅助文件作为网站资源发布。原有 `assets/lib` 子模块保持仓库固定版本。

## 当前内容基线与后续完善

2026-10-26 本地改造：文章目录仍无正式文章；站点已使用中文、hlcy-404 身份和用户明确提供的工作方向，移除了虚构模板邮箱/社交资料。关于页和首页已替换模板展示，缺失履历继续留空。具体完成和验收状态见 [STATUS.md](STATUS.md)。

首页使用 Atlas 自定义布局，内页保留 Chirpy 的阅读结构并覆盖导航和样式。后续从 [PRD.md](PRD.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[TASKS.md](TASKS.md) 开始；优先发布真实文章和可核查项目案例。

## 隔离测试与浏览器验收

`tools/verify-atlas.rb` 会在 `.local/atlas-qa/run-*/` 建立独立源副本，加入临时测试文章，生产模式构建并检查链接。检查置顶、隐藏/未发布、特殊字符、正文结构、RSS 和开发文件排除；最新结果路径写入 `.local/atlas-qa/latest.json`。测试资料不属于正式博客内容，不要同步此目录。

浏览器验收至少覆盖：首页空态与有内容态、文章跳转、搜索/筛选/清除、方向键切换、主题切换及刷新持久化、375px 手机与桌面、长文代码和目录。自动化检查不替代这些可见交互。

## 参考

- [Chirpy 官方入门指南](https://chirpy.cotes.page/posts/getting-started/)
- [GitHub Pages 发布来源配置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
