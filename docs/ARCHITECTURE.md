# 架构与修改地图

## 当前结构

2026-11-18 本地写作前端 2.0：在不改变 `server.mjs` 接口、CSP 与数据存储格式的前提下，重构 `tools/studio/public/index.html`、`style.css`、`app.js`，并新增纯前端辅助模块 `public/modules/editor-tools.js`（负责深浅色主题切换、CodeMirror 排版指令、LaTeX 公式防破坏实时预览渲染、实时章节大纲解析跳转、字数/阅读时长统计与双栏同步滚动）。

本地写作 1.3：`deployment.mjs` 只探测 GitHub 工作流/当前尝试的作业及公开文章版本；`tracker.mjs` 管理持久阶段、查询去重、退避和重启恢复，不执行 Git 推送。`server.mjs` 在上传成功后登记任务，维护备份期间等待现有探测结束并阻止新探测；恢复副本禁用跟踪。前端 `modules/publishing.js` 只读取本机记录，手动重新检查才调用探测接口。`GET /api/jobs` 返回轻量摘要，保留最近 50 项及仍需跟踪的旧任务，单条接口继续返回完整快照。新字段兼容既有 prepare 类型发布记录，不迁移私人正文。


分发边界：用户在 1.2 轮授权编辑器源码、测试、依赖锁文件及启动器进入公开仓库；解除先前源码排除规则。草稿、备份、依赖缓存和运行时仍只在本机。Jekyll 仍排除工具和文档目录，Pages 只部署静态产物；本机服务只监听回环地址。公开的 `studio-revision` 元数据仅供核验文章版本，不提供编辑权限。

本地写作 1.2：`archive.mjs` 封装 fflate ZIP、限额、路径和哈希校验；`references.mjs` 通过 marked 识别 Markdown/HTML 资源及静态 Liquid 路径；`portable.mjs` 负责单篇独立文章包；`maintenance.mjs` 管理完整环境备份、独立目录恢复、占用统计、保留和两阶段清理。前端 `modules/maintenance.js` 独立管理维护界面。维护操作与正在保存/构建/发布的任务互斥；来源目录在复制前后核对，外部修改导致重试。恢复副本带只读发布标记，旧发布任务归档，不续用确认。

2026-10-31 本地 1.3.1 修复：`SOURCE_ROOTS` 增加标准 `_drafts/`、`.gitmodules`、`.editorconfig`、`.nojekyll`、两项 Dev Container 和三项 VS Code 配置；另明确纳入 `.local/article-deliverables/`，含日志和嵌套写作验证资料。采集和恢复共用 `allowedProject` 规则，继续排除凭据、运行时、依赖、构建和递归备份/恢复目录，不整体放开 `.local/` 或配置目录。保留 v1 容器，清单与报告增加 `scopeVersion: 2`、`studioVersion`、成稿文件数，清单还列出采集根目录。新版兼容旧包，包含新增范围的新包需新版恢复器。归档未加密且不保存 Git 对象；独立 `restores/` 的新编辑仍需单独备份。完整范围及依赖恢复要求见 [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md)。

本地写作 1.1：存储层统一处理版本检查、历史快照和恢复，`revisions.mjs` 封装 diff3；备份导入先完整验证再将暂存目录原子移入草稿目录。浏览器以项目/草稿/窗口隔离 IndexedDB 暂存，历史、恢复、冲突和预览分别由前端模块处理。构建目录与 URL 均带 job ID，预览只读取该目录；源目录摘要值忽略 `.git` 和 `.DS_Store`，与复制规则一致。仅预览副本载入路径修正插件，正式站点与发布前构建不应用该插件。

Markdown / YAML → Jekyll + Liquid → HTML / CSS / JS → GitHub Pages。Ruby 3.3 运行于本项目 Compose 容器，Chirpy 固定 7.1.1；公开站点保持静态。作者本机增加 Node.js 写作服务，使用本地文件，不引入数据库。

主题源码主要位于 Ruby gem。项目内同名布局/片段会覆盖主题文件；这是 Jekyll 的主题机制，不是缺失源码。

| 层 | 入口 | 责任 |
| --- | --- | --- |
| 站点配置 | `_config.yml` | 身份、语言、URL、主题、内容默认值 |
| 首页内容 | `_data/atlas.yml` | 导语、方向面板、设计文案 |
| 文章内容 | `_posts/` | 正式文章及 front matter |
| 固定页面 | `_tabs/` | 关于、友链、分类、标签、归档 |
| 友链资料 | `_data/friends.yml` → `_tabs/friends.html` | 已确认的共创者与室友资料、轻量 Retina 肖像（保留原图备查）与主页链接 |
| 首页布局 | `_layouts/atlas.html` | 低密度书卷杂志风首页：留白意境首屏、原创细线标本图（`_includes/atlas-horizon-art.html`）、舒展文章阅读流与底部关注维度 |
| 通用页面覆盖 | `_layouts/page.html` | 保留主题 page 结构 |
| 索引体系覆盖 | `_layouts/archives.html`, `categories.html`, `tags.html`, `category.html`, `tag.html`, `_includes/atlas-index-header.html`, `atlas-taxonomy-detail.html` | 统一接管「全部文章 / 主题分类 / 标签索引」及分类标签二级详情页，提供双向检索切换栏、专题卷宗直览卡、书末术语索引表与书刊导读卡 |
| 导航 | `_includes/sidebar.html`, `atlas-navigation.html` | 全站共用的衬线字标 `h.`、等距导航与底部 GitHub/昼夜切换栏 |
| 资源注入 | `_includes/metadata-hook.html` | 注入 `Noto Serif SC` / `Cormorant Garamond` 字体及版本化 Atlas 样式与脚本 |
| 缓存兼容覆盖 | `assets/js/dist/sw.min.js` | 输出 `/sw.min.js`，沿用 Chirpy 7.1.1 更新流程，版本化导入配置并从网络刷新安装预缓存 |
| 视觉 | `assets/css/atlas.css` | 全站统一的温润画廊纸色与低饱和植物绿书刊设计系统（覆盖首页与全部 Chirpy 内页及夜间模式） |
| 行为 | `assets/js/atlas-theme.js`, `atlas.js` | 首屏主题同步、方向切换与标本微动联动（tablist）、首页即时搜索与分类筛选 |
| 方向面板 | `_includes/atlas-exploration.html` | 首页文章区下方的平静三视角卡片，保持 tab/tabpanel 无障碍契约 |
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
