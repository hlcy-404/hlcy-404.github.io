# hlcy-404 · 个人探索手册

关于人工智能、计算技术、大模型、Agent 与科研工程的个人博客。基于 Jekyll + Chirpy 7.1.1，使用 GitHub Pages 发布；首页采用暖纸色与鼠尾草绿的 Field Notes 设计。

## 快速开始

1. 启动 Docker Desktop，双击 `preview.cmd`。
2. 等待构建完成，打开 <http://127.0.0.1:4000>。
3. 修改并刷新；改 `_config.yml` 后重启预览。
4. 停止预览：`stop-preview.cmd`。
5. 只有决定发布时才运行 `sync.cmd`，核对变更清单后确认。保存文件不会上传。

## 从哪里读起

| 文档 | 用途 |
| --- | --- |
| [当前状态](docs/STATUS.md) | 已做什么、验证到哪一步、下一步 |
| [产品需求](docs/PRD.md) | 目标、范围、用户路径与验收条件 |
| [架构](docs/ARCHITECTURE.md) | 技术结构、修改位置、主题覆盖边界 |
| [设计规范](docs/DESIGN-SYSTEM.md) | 参考转译、颜色、字体、响应式、交互 |
| [任务与优化路线](docs/TASKS.md) | 已完成任务与按价值排序的后续功能 |
| [内容指南](docs/CONTENT-GUIDE.md) | 写文章、引用、草稿和发布检查 |
| [本地开发](docs/LOCAL-DEVELOPMENT.md) | Docker、构建、手动同步、部署确认 |
| [决策记录](docs/DECISIONS.md) | 方案对比及采用理由 |
| [AI 协作约定](AGENTS.md) | 让 AI 接手任务前先读 |

## 常用修改

- 站点身份：`_config.yml`；首页文案：`_data/atlas.yml`；关于页：`_tabs/about.md`。
- 正式文章：`_posts/YYYY-MM-DD-slug.md`；模板：[POST.md](docs/templates/POST.md)。
- 首页布局：`_layouts/atlas.html`；样式：`assets/css/atlas.css`；交互：`assets/js/atlas.js`。
- 每次新需求可复制 [TASK.md](docs/templates/TASK.md)，写清目标、范围和验收条件。

## 验证

```powershell
# 生产模式构建与站内链接检查；先停止预览，避免同时写 _site
# 验证后可再次运行 preview.cmd
docker compose stop blog
docker compose run --rm blog bash -lc "bundle install && bash tools/test.sh"

# 独立测试副本：生成样例内容，检查置顶、转义、链接、阅读结构等
# 测试源和产物只存入 .local/atlas-qa，不污染正式文章
docker compose run --rm blog bash -lc "bundle install && bundle exec ruby tools/verify-atlas.rb"
```

当前正式文章数量与验收结论以 [STATUS.md](docs/STATUS.md) 为准。构建成功、浏览器验收、Git 推送、Actions 部署是不同层次，不互相替代。

## 项目与许可

- [仓库](https://github.com/hlcy-404/hlcy-404.github.io) · [网站](https://hlcy-404.github.io/)
- 使用 [Chirpy](https://github.com/cotes2020/jekyll-theme-chirpy) 和 [Jekyll](https://jekyllrb.com/)；保留原始 [MIT LICENSE](LICENSE)。
- 私密材料、凭据、依赖、缓存和构建产物不得提交。未提供的个人经历和成果不做填充。
