# 架构与修改地图

## 当前结构

分发边界：用户在 1.2 轮授权编辑器源码、测试、依赖锁文件及启动器进入公开仓库；解除先前源码排除规则。草稿、备份、依赖缓存和运行时仍只在本机。Jekyll 仍排除工具和文档目录，Pages 只部署静态产物；本机服务只监听回环地址。公开的 `studio-revision` 元数据仅供核验文章版本，不提供编辑权限。

本地写作 1.2：`archive.mjs` 封装 fflate ZIP、限额、路径和哈希校验；`references.mjs` 通过 marked 识别 Markdown/HTML 资源及静态 Liquid 路径；`portable.mjs` 负责单篇独立文章包；`maintenance.mjs` 管理完整环境备份、独立目录恢复、占用统计、保留和两阶段清理。前端 `modules/maintenance.js` 独立管理维护界面。维护操作与正在保存/构建/发布的任务互斥；来源目录在复制前后核对，外部修改导致重试。恢复副本带只读发布标记，旧发布任务归档，不续用确认。

本地写作 1.1：存储层统一处理版本检查、历史快照和恢复，`revisions.mjs` 封装 diff3；备份导入先完整验证再将暂存目录原子移入草稿目录。浏览器以项目/草稿/窗口隔离 IndexedDB 暂存，历史、恢复、冲突和预览分别由前端模块处理。构建目录与 URL 均带 job ID，预览只读取该目录；源目录摘要值忽略 `.git` 和 `.DS_Store`，与复制规则一致。仅预览副本载入路径修正插件，正式站点与发布前构建不应用该插件。

Markdown / YAML → Jekyll + Liquid → HTML / CSS / JS → GitHub Pages。Ruby 3.3 运行于本项目 Compose 容器，Chirpy 固定 7.1.1；公开站点保持静态。作者本机增加 Node.js 写作服务，使用本地文件，不引入数据库。

主题源码主要位于 Ruby gem。项目内同名布局/片段会覆盖主题文件；这是 Jekyll 的主题机制，不是缺失源码。

| 层 | 入口 | 责任 |
| --- | --- | --- |
| 站点配置 | `_config.yml` | 身份、语言、URL、主题、内容默认值 |
| 首页内容 | `_data/atlas.yml` | 导语、方向面板、设计文案 |
| 文章内容 | `_posts/` | 正式文章及 front matter |
| 固定页面 | `_tabs/` | 关于、友链、分类、标签、归档 |
| 友链资料 | `_data/friends.yml` → `_tabs/friends.html` | 已确认的共创者资料、主页与合作文章链接 |
| 首页布局 | `_layouts/atlas.html` | 读取真实内容，输出首页与搜索数据 |
| 通用页面覆盖 | `_layouts/page.html` | 保留主题 page 结构，增加索引空态 |
| 导航 | `_includes/sidebar.html`, `atlas-navigation.html` | 共用导航与主题切换入口 |
| 资源注入 | `_includes/metadata-hook.html` | 在主题允许的扩展点载入资源 |
| 缓存兼容覆盖 | `assets/js/dist/sw.min.js` | 输出 `/sw.min.js`，沿用 Chirpy 7.1.1 更新流程，版本化导入配置并从网络刷新安装预缓存 |
| 视觉 | `assets/css/atlas.css` | 设计变量、首页、主题内页覆盖、响应式 |
| 行为 | `assets/js/atlas-theme.js`, `atlas.js` | 首屏主题、方向切换、搜索/筛选 |
| 插图 | `_includes/atlas-sculpture.svg` | 本地概念曲面，无网络和 WebGL 依赖 |
| 验证与预览 | `compose.yaml`, `tools/`, `*.cmd` | 隔离环境、本地构建、手动同步 |
| 本地写作 | `tools/studio/server.mjs`, `public/`, `lib/` | 草稿、图片、独立预览、精确发布和部署跟踪 |
| 写作启动 | `studio.cmd`, `stop-studio.cmd`, `tools/Start-Studio.ps1` | 项目专用运行时、依赖校验、手动启动与关闭 |

## 内容与交互契约

- 首页读取 `site.posts`，`hidden: true` 仅排除首页列表；这是展示开关，**不是隐私控制**。不公开的内容使用 `_drafts/` 或 `published: false`，且不要把私密材料提交到公开仓库。
- `pin: true` 文章在前，各组内沿用 Jekyll 的日期倒序。
- 首页搜索覆盖标题、显式 description、分类与标签；不做全文检索。内页保留 Chirpy 原搜索。没有 JS 时正文、导航、文章链接和第一个方向面板仍可阅读。
- 首页将全部可见文章渲染到 HTML 后筛选；移除旧 `paginate` 配置，避免生成重复首页。超过约 100 篇时应测量 HTML 体积与交互延迟，再决定分页/检索索引方案。
- 方向面板只表达关注范围，不将其解释成已经完成的成果。
- JS 使用 `hidden`、`textContent`、DOM 属性，不把搜索输入拼接成 HTML。
- 主题模式以 `atlas-mode` 写入 localStorage。Chirpy 自带模式按钮停用，保留兼容的模式变化通知。
- 内页保留主题结构与 PWA 设置；首页未新增 service worker 注册逻辑。发布后仍应检查旧缓存更新行为。

## 主题升级注意点

升级时重点比较 `_includes/sidebar.html`、`_includes/metadata-hook.html`、`_layouts/page.html` 和 `assets/js/dist/sw.min.js` 与新版主题契约，回归移动导航、搜索、TOC、代码复制、PWA。Atlas 资源版本与 Worker 导入配置版本均来自 `site.time`。`atlas.css` 中末段依赖 Chirpy CSS 变量/ID，应同步验证。不要直接修改容器中的 gem 文件。

## 来源与边界

- [Jekyll 目录和 gem 主题机制](https://jekyllrb.com/docs/structure/)
- [Jekyll 文章与 front matter](https://jekyllrb.com/docs/posts/)
- [Chirpy 入门及样式覆盖](https://chirpy.cotes.page/posts/getting-started/)

以上资料于 2026-10-26 查阅。实际兼容性以本项目锁定的 Chirpy 7.1.1 源码及本地验证为准，不直接套用最新主题的接口。
