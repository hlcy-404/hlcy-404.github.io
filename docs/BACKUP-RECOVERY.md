# 本地写作数据保护与离机恢复

适用：Windows 11、本地写作工具 1.3.1。更新日期：2026-11-01（北京时间）。本规程保护已保存的写作资料及重建工作环境所需的信息；它不是 Windows 整机镜像，也不承诺无网络时重装依赖。

保护集合由三部分组成：**工具完整 ZIP + 白名单外的补充资料 + 按需导出的 Git 历史**。GitHub 只保存实际提交并推送的内容。只保留 GitHub 仓库，不能恢复私人草稿、写作历史、未发布配图或本机发布记录。

## 1. 当前事实和验收边界

2026-10-31 通过 GitHub 接口及 `git ls-remote` 核对，远端 `main` 与本地 HEAD 均为 [`b018dcb4913bf564077f795c8fb67546812877a9`](https://github.com/hlcy-404/hlcy-404.github.io/commit/b018dcb4913bf564077f795c8fb67546812877a9)。备份实现、原使用指南和决策文件与该提交一致。已存在的本地 `STATUS.md`、`TASKS.md` 修改记录了 10 月 30 日成稿与文章包验证，不是新的完整环境或离机恢复验收。

上述为首次核查基线；用户随后授权范围修复、新建备份和本机独立恢复。本地 1.3.1 已补齐文章成稿和必要配置，34 项隔离回归通过，尚未同步 GitHub。新增真实备份与恢复结果以 [STATUS.md](STATUS.md) 及本机验收报告为准；离机转存仍等待设备确认。

2026-11-01 已补齐同一独立副本的 Docker/Jekyll 真实主题验收：专用 Compose 项目及依赖卷，正式源 15 个 HTML / 36 条内部链接、含图草稿 16 / 42、工程文章 22 / 66 均通过；桌面与 375px 浏览器完成图片、公式、代码、目录和表格检查。原项目及副本 403 个已有保护文件哈希不变。恢复副本新增的工程文章草稿和预览不在原 ZIP 内，仍须从副本另行保存所需新内容。

Docker 引擎故障与博客备份范围分别处理。后续日志核查更正了原记录：北京时间 11 月 1 日 12:02:57 确实发生恢复出厂设置，自定义存储位置由 E 盘切回 C 盘；12:03:29 创建新默认数据盘。命令侧记录的是停止 Docker，现有证据不能识别重置动作的触发者。当时确认旧活动盘仍在 E 盘原自定义项目数据目录，C 盘 `disk.pre-e-migration-20260907/` 仅是更早的迁移前快照；此前默认目录扫描并不完整。

本次证明博客可从 ZIP 加锁文件重新构建，**博客恢复预览已通过，原 Docker 环境尚未恢复**。旧活动盘及历史备份未由本次调查挂载或改写；内部容器、卷及业务数据尚未验收。发现类似空清单时，先检查上下文、实际存储位置和日志，不执行清理、重置、覆盖或盲目接回旧盘。用户最初选择等待设备后克隆，随后明确接受放弃三份旧盘及其中可能独有数据；三份文件已于 11 月 1 日 16:57 删除，原克隆计划取消。博客离机备份仍待设备确认。历史过程及最新退役结果见 [第 7 节](#7-docker-旧盘克隆核验与保留策略)。官方背景见 [Docker 数据备份与恢复](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/)。

首次只读核查正式目录 `.local/studio/archives/` 的历史结果如下；这不是修复后新包清单，也不据此推断其他磁盘或外部设备上没有副本。

| 生成时间（北京时间） | ZIP 字节数 | 清单文件数 | 报告草稿数 | 包内工具版本 | 本次校验 |
| --- | ---: | ---: | ---: | --- | --- |
| 2026-10-27 12:20:01 | 15,962,092 | 263 | 4 | 1.2.0 | 整包 SHA-256 与原记录一致；包内逐文件校验通过 |
| 2026-10-27 12:39:47 | 16,765,477 | 270 | 5 | 1.2.0 | 整包 SHA-256 与原记录一致；包内逐文件校验通过 |

这两份历史备份有效，但早于 1.3 更新及 10 月 30 日成稿，不能作为当前环境的最新恢复点。正式 `restores/` 中可见一个 10 月 27 日的独立副本。本次没有重新启动该副本，历史启动验收以 [STATUS.md](STATUS.md) 的原始记录为准。

首次规程编写阶段只读校验了旧包，未执行新建或恢复。随后授权的本机生成/恢复与外部设备转存是两个阶段；所有结果按实际执行时间单独记录。外部设备未指定和检查，离机/新电脑恢复结果仍待用户按本规程验收。

## 2. 保存内容与 Git 的关系

以下范围以 [`maintenance.mjs`](../tools/studio/lib/maintenance.mjs) 的 `SOURCE_ROOTS`、`DATA_ROOTS`、`ARTICLE_ROOT` 和共用排除规则为准。“完整”表示这些指定范围，不表示项目目录中的每个文件。1.3.1 新包继续使用 v1 容器，增加 `scopeVersion: 2`、`studioVersion`、采集根目录及成稿计数；旧包不要求这些新增字段，含新增路径的新包需要 1.3.1 或更新版本恢复器。

| 数据 | 实际位置或形式 | 工具完整 ZIP | GitHub 同步能保护什么 |
| --- | --- | --- | --- |
| 已保存草稿、元数据、源文章关联 | `.local/studio/drafts/<编号>/draft.json` | 包含 | 默认忽略，不能保护 |
| 草稿导入的原图与附件 | 同一草稿的 `media/` | 包含；检查当前草稿媒体记录的哈希 | 发布操作只将引用资源写入 `assets/` 并提交；未引用/未发布媒体不在远端 |
| 项目公共配图、封面和附件 | `assets/` | 包含符合规则的实存文件 | 只保护已经提交并推送的版本；不能恢复项目外原始设计稿或外链内容 |
| 编辑器版本历史、旧自动恢复记录 | `.local/studio/history/`、`backups/` | 包含 | 不在 Git；编辑器每次保存的历史不等于 Git 提交历史 |
| 成稿、文章包、说明及验证记录 | `.local/article-deliverables/`，含日志与嵌套写作资料 | 1.3.1 起包含，仍排除凭据、依赖及递归备份/恢复目录 | 默认忽略；纳入 ZIP 不等于允许公开 |
| 发布前原文件、任务与检查记录 | `.local/studio/releases/`、`jobs/`、`restored-records/` | 包含 | Git 提交/Actions 不能重建全部本机记录；记录中的成功状态只是当时的证据 |
| 正式文章、主题覆盖、配置与工具源码 | `_posts/`、`_tabs/`、`assets/`、`tools/`、`docs/` 等指定目录 | 包含当前磁盘内容，包括范围内未提交修改 | 只保护实际推送的内容；未提交修改不会因同步过旧版本而获保护 |
| Node 与 Ruby 依赖定义 | `tools/studio/package-lock.json`、`Gemfile`、存在时的 `Gemfile.lock`、`compose.yaml` | 包含 | Node 锁文件已跟踪；当前 `.gitignore` 忽略 `Gemfile.lock`，本机解析结果不能只靠 GitHub 保存 |
| Git 对象、分支、标签、本地未推送提交 | `.git/` | 不包含 | 只保护已推送引用可达的历史；本地独有历史需要额外 Git bundle |
| 单篇文章 ZIP | 导出位置由用户选择 | 仅在被选目录内且未被排除时才可能包含 | 不应提交私人文章包；文章 ZIP 不含完整编辑历史、其他草稿和发布记录 |

单篇文章包适合迁移可编辑内容。导入会生成新的草稿编号，并移除发布关联和固定地址；不要用它替代完整环境备份。迁回已发表文章时，先核对正式仓库中的原文、地址和版本，再选择修订原文章的方式，避免直接将独立草稿作为新文章发布。

### 必须另行核对的遗漏

1. **成稿目录已补齐，旧包不能倒补**：`.local/article-deliverables/20261030-local-writing-workbench/` 的 11 个文件，包括验证日志及嵌套写作资料，已纳入 1.3.1 范围。必须重新生成新包，旧 1.2/1.3 包不会自动获得这些文件。成稿目录之外的原图或附件仍需单独清点。
2. **独立恢复副本中的新编辑**：`.local/studio/restores/` 不被父项目的完整包收录。若在副本里继续写作，须从该副本生成新的完整包，或将所需内容导出并明确迁回。不要因父项目备份成功而认为副本中的新修改已受保护。
3. **已有完整 ZIP 与待恢复包**：`.local/studio/archives/`、`restore-inputs/` 不递归进入新包。这可避免无限嵌套；需要保留的历史恢复点应独立转存。“旧恢复副本”在原指南中专指 `backups/`，不代表以上目录。
4. **必要配置已补齐，扩展配置仍需清点**：1.3.1 纳入 `.gitmodules`、`.editorconfig`、`.nojekyll`、`.devcontainer/devcontainer.json`、`.devcontainer/post-create.sh`、`.vscode/settings.json`、`.vscode/extensions.json`、`.vscode/tasks.json` 和标准 `_drafts/`。配置目录里的其他文件、自定义集合及其他顶层文件不会自动纳入。`_drafts/` 的本地备份支持不改变 Git 规则，私人草稿仍不可提交公开仓库。
5. **子模块历史仍独立管理**：已检出的 `assets/lib/` 文件随 `assets/` 收录，顶层 `.gitmodules` 从 1.3.1 起包含；子模块 `.git` 不在包内。当前固定提交为 `a231bc7e2c67198e604950cb2be9147a0b2020c0`，重建 Git 工作流还需可取得的子模块对象。未检出的子模块不能靠目录备份补齐。
6. **浏览器输入和外部原件**：IndexedDB 中尚未保存的正文、合并结果和待上传图片不在包内。桌面/下载目录中的原图、图表源文件、论文附件，以及远程图片/嵌入内容也不会自动下载进入包中。
7. **有意排除的数据**：`.git/`、`node_modules/`、`vendor/`、`.bundle/`、`_site/`、`.jekyll-cache/`，以及匹配 `.env*`、密钥文件、`.tmp` 等规则的文件不会收录；`.log` 仅在明确的成稿目录中保留。任何深度的 `.local/runtime/` 和 `.local/studio/` 下构建、导入暂存、完整备份及恢复目录也排除。文件名规则不能识别正文中的所有秘密；成稿日志和配置文件仍按私人资料保管。`storage-pins.json` 等预览设置不在范围内。
8. **凭据与账户恢复**：Git Credential Manager、SSH 密钥、浏览器登录和加密恢复密钥不随包迁移。新电脑通过正规流程重新登录；密码管理器/账户恢复资料单独保管，不能写入博客、验收报告或普通明文 ZIP。

文件哈希只能证明包内已有文件未变化，不能证明所有需要的资料都已收录。完整包对当前草稿 `media` 列表有额外校验，但不等于扫描每一历史版本、外链和任意项目外附件的完整依赖；恢复时还要检查实际文章和图片。

例如，历史正文引用了 `assets/` 下的同名公共图片，而该文件后来被替换，历史 JSON 并不单独保存这张图的每个旧版本；完整包只能收录备份时实存的文件。要重现历史版式，需保留不可变的资源文件名/原件，或从相应 Git 提交、旧备份中取回旧图，不能仅凭“历史正文可恢复”承诺旧配图也完全一致。

## 3. 离机保存方案和频率

建议采用三份副本：工作电脑上的源数据、一份完成后断开的外置盘副本、一份放在不同地点的加密副本。GitHub 作为正式源码和公开文章的补充恢复来源，不计作私人写作资料的完整副本。

| 方式 | 优点 | 限制 | 适合本项目的用法 |
| --- | --- | --- | --- |
| 外置 SSD/HDD，完成后安全弹出 | 操作直接，可断开，恢复不依赖云账号 | 与电脑同处一地仍可能同时丢失 | 首选第一次离机验收；确认是不同物理设备，不能只看盘符不同 |
| 第二块轮换盘或另一台电脑，存放异地 | 同时降低整机故障和同地点事故的影响 | 需要定期人工转存 | 作为第三份副本，每周更新或重要修改后更新 |
| 经用户选择的私有云/对象存储 | 异地取回方便，可配置版本保留 | 隐私、账号、费用与网络依赖；同步删除可能传播 | 先在本地加密，再明确授权上传独立备份批次，并实际下载校验 |
| NAS | 局域网内恢复方便 | 长期可写挂载和同地点存放仍有共同风险 | 配合独立快照、版本保留及异地/离线副本使用 |

工具生成的是**未加密 ZIP**，SHA-256 不是加密或身份认证。Windows 11 专业版、企业版和教育版可按 [Microsoft 的 BitLocker 指南](https://support.microsoft.com/en-au/windows/security/encryption/bitlocker-drive-encryption) 使用 BitLocker To Go 保护可移动盘；家庭版不能照搬启用流程，应选择已验证可在新电脑解密的加密容器或备份工具。恢复密钥另存于受控位置，不能只放在同一加密盘里。云端若上传外层加密文件，下载后先核对外层文件哈希，再解密并核对原 ZIP 哈希。

建议目标而非已实现保证：重要写作日结束及大量导入图片后生成并离机保存一次，目标最多丢失 24 小时修改；每周补查白名单外资料和本地 Git 历史；每月及工具大版本变化后做一次恢复演练。首次演练测量“恢复可编辑”和“恢复真实预览”两段耗时，再确定能接受的恢复时间。

保留建议：至少 7 个近期写作日恢复点、4 个周恢复点、3 个月恢复点和最近一次实测成功版本。容量不足时先调整策略；本规程不自动删除旧包。多个备份仍留在同一物理盘，不能满足离机目标。

## 4. Windows 11 备份与转存

以下是**供用户确认后执行的操作**，不是本次已经执行的记录。外置盘盘符、保存目录和备份编号由操作者核对；不要把真实私人路径、草稿标题或密钥提交到公开文档。

### 4.1 生成最新恢复点并准备补充资料

1. 保存所有编辑窗口，确认“已保存到本机”；处理暂存/冲突和待上传图片。等待正在执行的保存、构建和发布结束，并暂时停止其他编辑器写入。生成按钮只会主动刷新当前页面，不能替其他标签保存。
2. 在当前项目的“备份与空间”点击“生成备份”，核对时间、草稿数和大小。不要将 10 月 27 日的旧包误选为当前备份。可点击下载；下方命令直接从工具的原存档目录复制同一 ZIP，便于配对原始报告。
3. 只读列出备份报告供选择：

   ```powershell
   $blogRoot = 'E:\AI-Projects\hlcy-404.github.io'
   Get-ChildItem -LiteralPath (Join-Path $blogRoot '.local\studio\archives') -Filter '*.json' -File |
     ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } |
     Sort-Object createdAt -Descending |
     Select-Object id, createdAt, bytes, files
   ```

4. 先核对新包工具版本、范围修订及成稿计数，确认成稿和必要配置已进入清单；使用旧包时仍须另行补存它们。另查白名单外配置、项目外原图及恢复副本中的新编辑，将选定补充资料复制到外部批次的全新 `supplemental/` 目录并保持相对关系。不要移动原件、覆盖旧批次或混入凭据。补充文件同样需要源/目标 SHA-256 对照，记录相对路径和字节数；只在目标端算一次哈希不能证明复制前后一致。
5. 若需要保留本地独有 Git 历史，按 4.3 创建 bundle，与上述文件一起转存。单篇文章包是便于使用的补充，不替代整套数据。

### 4.2 转存完整 ZIP 与报告，核对整包哈希

先在资源管理器确认外部盘身份、加密解锁状态和余量，建立专用目录，例如 `G:\Blog-Backups`（示例不代表设备已存在）。以下代码适用于 Windows PowerShell 5.1；它为每次操作建立新目录，拒绝覆盖同名文件，不删除源文件、不访问云端。`createdAt` 原报告使用 UTC，界面显示本地时间。

```powershell
$ErrorActionPreference = 'Stop'
$blogRoot = 'E:\AI-Projects\hlcy-404.github.io'
$backupId = (Read-Host '粘贴要转存的备份 id').Trim()
if ($backupId -notmatch '^[a-f0-9-]{16,40}$') { throw '备份编号不符合要求。' }
$archiveRoot = Join-Path $blogRoot '.local\studio\archives'
$sourceZip = Join-Path $archiveRoot ($backupId + '.zip')
$sourceReport = Join-Path $archiveRoot ($backupId + '.json')
$report = Get-Content -LiteralPath $sourceReport -Raw -Encoding UTF8 | ConvertFrom-Json
if ($report.id -ne $backupId -or $report.sha256 -notmatch '^[a-f0-9]{64}$') {
  throw '备份报告不匹配。'
}
$sourceHash = (Get-FileHash -LiteralPath $sourceZip -Algorithm SHA256).Hash
if ($sourceHash -ine $report.sha256 -or (Get-Item -LiteralPath $sourceZip).Length -ne $report.bytes) {
  throw '源 ZIP 与生成时的记录不一致，停止转存。'
}
$destinationRoot = (Read-Host '输入已确认的外部备份目录完整路径').Trim().Trim('"')
if (-not [IO.Path]::IsPathRooted($destinationRoot) -or
    -not (Test-Path -LiteralPath $destinationRoot -PathType Container)) {
  throw '请先确认并建立外部目录。'
}
$destinationRoot = (Resolve-Path -LiteralPath $destinationRoot).Path
$batchName = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N')
$batchPath = Join-Path $destinationRoot $batchName
if (Test-Path -LiteralPath $batchPath) { throw '批次目录已存在。' }
New-Item -ItemType Directory -Path $batchPath | Out-Null
$verifiedFiles = @()
foreach ($sourceFile in @($sourceZip, $sourceReport)) {
  $before = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
  $targetFile = Join-Path $batchPath ([IO.Path]::GetFileName($sourceFile))
  [IO.File]::Copy($sourceFile, $targetFile, $false)
  $after = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
  $copied = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash
  if ($before -ne $after -or $before -ne $copied -or
      ($sourceFile -eq $sourceZip -and $copied -ine $report.sha256)) {
    throw '文件发生变化或复制校验失败；保留现场，勿将本批次标为成功。'
  }
  $verifiedFiles += [pscustomobject]@{
    file = [IO.Path]::GetFileName($targetFile)
    bytes = (Get-Item -LiteralPath $targetFile).Length
    sha256 = $copied.ToLowerInvariant()
  }
}
[pscustomobject]@{
  backupId = $backupId
  checkedAt = [DateTimeOffset]::Now.ToString('o')
  files = $verifiedFiles
  transferHashCheck = 'passed'
  supplementalCheck = 'pending'
  restoreCheck = 'pending'
} | ConvertTo-Json -Depth 5 |
  Out-File -LiteralPath (Join-Path $batchPath 'transfer-check.json') -Encoding utf8 -NoClobber
Write-Host "ZIP 和报告复制校验通过：$batchPath"
Write-Host '仍需检查补充资料，并从外部副本完成恢复验收。'
```

命令采用 [Get-FileHash 的 SHA-256 校验](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/get-filehash?view=powershell-5.1)。成功仅表示所选文件复制一致，**不会自动证明目标是独立物理设备，也不会确认备份范围完整**。保留校验记录的另一份受控副本，避免 ZIP 与校验值同时丢失或被替换；普通哈希不能提供数字签名的来源认证。

补充资料复制时，可对每个重要文件按下式核对；目录较多时保存逐文件清单，不能仅比较目录总大小：

```powershell
$originalFile = (Read-Host '原文件完整路径').Trim('"')
$externalFile = (Read-Host '已复制的外部文件完整路径').Trim('"')
if ((Get-FileHash -LiteralPath $originalFile -Algorithm SHA256).Hash -ne
    (Get-FileHash -LiteralPath $externalFile -Algorithm SHA256).Hash) {
  throw '补充文件不一致。'
}
```

保存后安全弹出外置盘，重新连接并再次读取外部 ZIP 计算 SHA-256，与 `transfer-check.json` 比较。云端方案则实际下载到新位置，再校验和解密；上传完成标志、文件名及大小均不能代替取回校验。

重新连接后可用以下命令复核 ZIP 和报告（补充资料、bundle 使用各自保存的清单另查）：

```powershell
$ErrorActionPreference = 'Stop'
$retrievedBatch = (Read-Host '重新连接或下载后的批次目录完整路径').Trim('"')
$receipt = Get-Content -LiteralPath (Join-Path $retrievedBatch 'transfer-check.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (@($receipt.files).Count -ne 2) { throw '转存记录缺失或格式不符。' }
foreach ($item in $receipt.files) {
  if ($item.file -notmatch '^[a-f0-9-]{16,40}\.(zip|json)$' -or
      $item.sha256 -notmatch '^[a-f0-9]{64}$') { throw '文件记录不符合要求。' }
  $retrievedFile = Join-Path $retrievedBatch $item.file
  if ((Get-Item -LiteralPath $retrievedFile).Length -ne $item.bytes -or
      (Get-FileHash -LiteralPath $retrievedFile -Algorithm SHA256).Hash -ine $item.sha256) {
    throw '取回文件校验失败，停止恢复。'
  }
}
Write-Host '取回的 ZIP 和报告均与转存记录一致；可以进入恢复验收。'
```

### 4.3 按需保存 Git 历史

用户确认保存本地 Git 历史后，在上一节已创建的外部批次中执行以下命令；先结束其他 Git 操作。它只创建本地 bundle，不推送，不改变分支。历史也可能含私人信息，应与 ZIP 一样受控保管。

```powershell
# $blogRoot 与 $batchPath 沿用上一节，确认它们仍指向本次目录。
$gitBundle = Join-Path $batchPath 'blog-history.bundle'
if (Test-Path -LiteralPath $gitBundle) { throw 'bundle 已存在，换一个新批次。' }
git -C $blogRoot bundle create $gitBundle --all
if ($LASTEXITCODE -ne 0) { throw 'Git 历史导出失败。' }
git -C $blogRoot bundle verify $gitBundle
if ($LASTEXITCODE -ne 0) { throw 'Git bundle 校验失败。' }
Get-FileHash -LiteralPath $gitBundle -Algorithm SHA256
git -C $blogRoot submodule status --recursive
```

把 bundle 哈希、当前 HEAD、分支/标签清单和子模块固定提交记录在该批次的私有验收单中。[Git bundle](https://git-scm.com/docs/git-bundle) 保存所选引用可达的对象，不完整保留工作区、暂存状态、reflog/stash 历史、仓库配置或 hooks。有 stash、分离 HEAD、子模块本地提交或 Git LFS 时须另行清点；不能把 `--all` 理解成磁盘全部状态。本项目若需脱离远端恢复子模块历史，应对 `assets/lib` 再独立生成并核验 bundle，确保所记录的固定提交在其中。

取回后在全新目录执行 `git clone --mirror <bundle完整路径> <新的验证仓库.git目录>`，再执行 `git -C <新的验证仓库.git目录> fsck --full` 并核对引用；所有退出码必须为 0。该仓库用于检查历史，不自动连接正式 GitHub 远端，也不应把其中的 Git 元数据直接覆盖写作恢复副本。

## 5. 从外部副本验证独立恢复能力

### 5.1 选择验收环境

- 首选另一台 Windows 11 电脑或干净虚拟机：只带入外部备份批次和受控解密资料，不复制原电脑运行时/依赖缓存。记录网络是否可用。需要 Git、Docker Desktop 等基础软件时由用户在该设备准备，不修改其他项目的环境。
- 只有原电脑时：仍从外置盘读取 ZIP，在独立目录恢复，可以验证离机文件可读和逻辑恢复；结果必须标为“原电脑演练”。它不能证明新电脑安装、账户登录或原设备彻底损坏后的恢复能力。
- 另一盘符不一定是另一物理盘；同机第二块物理盘可降低单盘故障风险，但不能代替离机或异地保管。

### 5.2 有写作工具时的首选流程

1. 核对取回的 ZIP 哈希与转存记录一致。从外部批次选取该 ZIP，不使用原项目中另一份同名包。
2. 新电脑没有工具时，可将公开仓库克隆到一个此前不存在的引导目录，再运行其中 `studio.cmd`：

   ```powershell
   git clone --recurse-submodules https://github.com/hlcy-404/hlcy-404.github.io.git 'D:\Restore-Checks\studio-bootstrap'
   if ($LASTEXITCODE -ne 0) { throw '引导工具克隆失败。' }
   ```

   这是获取公开工具的联网步骤，不是从 GitHub 恢复私人草稿。路径按新电脑修改；已存在时换新路径，不覆盖或清空。引导工具首次启动联网安装固定 Node 和锁定依赖。
3. 在“备份与空间”选择外部 ZIP。工具将逐文件检查 SHA-256、大小、路径、格式及当前草稿配图，再显示数量、版本和目标位置。核对无误后点击“确认恢复独立副本”。默认目标是**运行该工具的目录下** `.local/studio/restores/<编号>/project/`，不是自动写入其他磁盘。
4. 记录工具返回的完整目标路径。停止引导/原有服务，确认保存完成；从恢复路径运行 `studio.cmd`。同时只运行一套 4010/4011 服务，避免误将原环境当成恢复环境。可只读确认服务根目录：

   ```powershell
   (Invoke-RestMethod 'http://127.0.0.1:4010/api/health').root
   ```

5. 保留恢复标记 `.local/studio/restored-records/RESTORED.json`。界面恢复会将旧 `jobs/` 移到 `restored-records/<编号>/jobs/`；它们可作为历史证据读取，不要求原“发布记录”卡片全部重新出现。旧发布确认、上传重试和跟踪应失效。记录原来的提交编号，不把历史 `live` 状态当作当前线上状态。
6. 检查草稿列表数量、标题和最新正文；抽查最重要/最近修改文章的中文、公式、代码、封面及图片。打开最早和最新历史版本，在**恢复副本**中恢复一版形成新版本，再重启工具验证新版本仍在。选一篇另导出文章 ZIP，以确认可继续迁移；不要点发布或将试验改动导回原稿。
7. 核对补充资料可以读取，与其清单哈希一致。它们默认不会自动导入编辑器；只在需要时导入为独立草稿，保留原包作为证据。

### 5.3 真实主题与依赖重建

Node 写作界面启动只证明可编辑，不能替代 Jekyll/Docker 预览。在恢复目录内先准备 Ruby 依赖，再验证真实主题。为避免借用原项目同名 Docker 卷或干扰原 Compose 服务，在同一个 PowerShell 窗口设置新的项目名，并从该窗口启动恢复工具：

```powershell
# 先停止已有写作服务；只在恢复副本安装依赖和生成输出。
$ErrorActionPreference = 'Stop'
$restoreRoot = (Read-Host '粘贴已核对的恢复 project 目录完整路径').Trim('"')
Set-Location -LiteralPath $restoreRoot
if (-not (Test-Path -LiteralPath '.local\studio\restored-records\RESTORED.json' -PathType Leaf)) {
  throw '此目录没有恢复标记，停止操作。'
}
$env:COMPOSE_PROJECT_NAME = 'hlcy-blog-recovery-' + (Get-Date -Format 'yyyyMMddHHmmss')
docker compose run --rm -T blog bash -lc 'bundle install && bash tools/test.sh'
if ($LASTEXITCODE -ne 0) { throw '依赖准备或站点检查失败，不能记为预览恢复成功。' }
.\studio.cmd
```

Compose 的项目名覆盖遵循 [Docker 项目名规则](https://docs.docker.com/compose/how-tos/project-name/)；新名称使依赖卷与原项目分开。`build.mjs` 的真实预览只执行 `bundle check`，所以全新环境不能省略上面的 `bundle install`。在编辑器重新生成一篇代表性草稿的“真实主题预览”，检查正文、图片、公式和代码显示；旧预览 URL 因没有 `builds/` 文件而失效是预期结果。

新电脑本地服务、依赖安装、真实主题构建、浏览器显示四项均通过，才记录为新环境恢复成功。GitHub 认证和真实发布另行授权验收；本规程不通过推送测试文章来证明恢复。

### 5.4 没有原项目时的备用流程

可信 ZIP 本身包含 `RESTORE.txt`、`manifest.json` 和 `project/`。可将**已核对整包哈希的自有备份**解压到全新空目录；使用现有工具的校验器或逐项按清单核对文件大小和 SHA-256，确认恢复标记存在后再运行 `project/studio.cmd`。不要对来源不明的包直接解压并执行代码，不删除恢复标记绕过发布限制。

手工解压时旧 `jobs/` 不会像界面恢复那样移走，但包内恢复标记用于禁止旧任务继续。已知 10 月 27 日两份原存档均有此标记。若哈希、清单、标记或版本兼容性有问题，保留原包并停止启动，不覆盖正式项目。

完全断网恢复还需事先准备经校验的 Node 安装包、npm 依赖、Docker 镜像、Ruby gems 和子模块资料，现有 ZIP 不提供这些内容。`ruby:3.3-bookworm` 是标签而非镜像摘要，锁文件也不代表依赖永远可下载；精确离线重建属于后续增强范围。

## 6. 验收记录和后续优化

详细记录放在外部备份批次中；公开 `STATUS.md` 只记录日期、范围、结果和未通过项，不记录私有设备路径、草稿内容、账号或密钥。建议使用以下空白模板，未做的项保留“待执行”：

| 记录项 | 填写内容 |
| --- | --- |
| 操作者、备份与验收时间 | 时间含时区 |
| 工具版本、源码 HEAD、未提交修改摘要 | 与 ZIP 内版本分别记录 |
| 备份文件名、字节数、SHA-256、清单格式 | 来源报告与实际计算一致/不一致 |
| 必须保护的数据及已知排除项 | 草稿/媒体/历史/发布记录数量；补充资料清单 |
| 介质身份、是否离机/异地、是否加密 | 只在私有记录保留设备位置；恢复密钥另存 |
| 转存后与重新连接/下载后的校验 | 待执行/通过/失败，分别记录 |
| 恢复设备、目录、工具返回的服务根目录 | 原电脑/新电脑；是否使用新依赖环境 |
| 内容、配图、历史、发布记录和补充资料 | 分项结果，不用“ZIP 能解压”统称通过 |
| 编辑保存、重启、真实预览与浏览器显示 | 分项结果；恢复任务应禁止旧发布 |
| Git bundle、子模块（如需要） | 哈希、独立导入、对象与引用核对结果 |
| 原项目是否有变化、恢复耗时、问题与复验日期 | 预期原稿无变化；故障保留证据，不删除旧副本 |

已实施的范围修复与剩余优化分别在 [TASKS.md](TASKS.md) 跟踪：

- 已实施：1.3.1 纳入成稿、标准 `_drafts/` 与必要配置；采集/恢复共用规则并补充回归，清单/报告记录工具版本、范围修订和成稿计数。
- P0：当前版本备份及本机恢复按最新状态记录验收；等待用户确认设备后，完成首次离机转存及新电脑验收。
- P1：界面摘要提供“已包含/已排除/另行保存”清单，提示自定义目录和恢复副本新编辑；维持主界面简洁，详细范围留在维护详情和指南。
- P1：补充源码 HEAD、未提交状态、依赖锁文件哈希和子模块固定提交，以及离机验收记录入口。
- P1：对历史引用资源增加语义检查；在归档达到 256 MiB、单文件 64 MiB 或最多 12000 个 ZIP 条目（含清单等元数据）限制前预警。不得为缩小备份擅自删历史、原图或绕过边界。
- P2：依据新电脑演练中的实际失败，决定是否准备可复现的离线依赖包、固定镜像摘要、分卷/增量备份或加密导出；这些选择要另记决策，不默认安装后台上传或清理任务。

## 7. Docker 旧盘克隆核验与保留策略

以下保留 2026-11-01 的历史调查与原克隆方案。**用户随后明确接受放弃三份旧盘及可能独有数据，三份文件已删除；克隆计划取消，旧盘克隆、挂载和原 Docker 环境恢复均未执行。** 最新删除及博客复验见 7.6，历史计划不再是当前待办。同日另经授权完成了既有数据库冷备的本机隔离恢复，见 7.4；它不替代旧盘核验。本节不授权清理其他项目的数据。具体源文件、首次盘点时的磁盘余量、头部指纹、日志摘录及更正前摘要存放在忽略目录 `.local/studio-qa/docker-storage-review-20261101-1238/`。

### 7.1 历史占用与重复判断（旧盘现已退役）

| 范围 | 本次已知占用 | 判断 |
| --- | ---: | --- |
| E 盘旧活动数据盘，最后修改于 10 月 28 日 | 删除前 275.50 GiB | 已按明确授权退役；内部数据未验收 |
| E 盘 9 月 7 日整盘备份 | 删除前 275.50 GiB | 已按明确授权退役；与旧活动盘头部不同 |
| C 盘 9 月 7 日迁移前快照 | 删除前 275.93 GiB | 已按明确授权退役；未证明与其他旧盘内容等价 |
| C 盘新活动数据盘及系统盘（首次盘点时） | 约 3.04 + 0.094 GiB | 当时的博客副本构建环境；后续已增加数据库验收副本，不是旧环境的另一个完整副本 |
| 已知应用备份目录，排除上述 VHDX（首次盘点时） | 当时约 74.56 GiB | 其中 38 个 Company-data 专用文件已按后续授权删除；整盘校验记录保留，见 7.4 |

删除前三份旧 VHDX 共约 826.93 GiB；首次盘点时含新数据盘和系统盘合计约 830.07 GiB，这些不是当前占用。主机占用按 Windows `GetCompressedFileSizeW` 查询，五个盘文件本次返回值均等于文件长度；不是 VHDX 的虚拟容量上限。目录盘点有明确范围，并非整机无遗漏扫描；运行通信端点无法按普通文件读取，不据此认定出现新的引擎故障。

首次只读盘点时（数据库冷备恢复前），`docker system df --verbose` 只报告新引擎：Ruby 镜像约 1.47 GB、恢复副本依赖卷约 59.14 MB，无容器或构建缓存。之后的数据库验收曾增加专用 PostgreSQL 镜像、容器和恢复卷，三者现已按用户后续指令移除，原博客资源保留；当前余量见最新状态。引擎统计是新数据盘**内部**的用量，不能与 VHDX 主机占用再次相加，也不能显示未接入的旧盘内容。其统计含义见 [Docker system df](https://docs.docker.com/reference/cli/docker/system/df/)。程序安装和辅助目录另计，详细数值保留在私有清单中。

已只读比较三份旧盘的 VHDX 头部，指纹均不同，足以排除“整个文件逐字节相同”，不足以判断业务内容差多少或数据库是否一致。没有重算三份整盘 SHA-256。9 月 7 日复制报告中的源/目标哈希相同只证明当时复制一致；不能据此删除后来继续写入的旧活动盘或历史恢复点。

### 7.2 原克隆核验步骤（已取消，留作参考）

以下计划没有执行，三份源文件现已删除，不能直接按原路径继续克隆。如果以后发现其他恢复来源，应重新核对来源、设备、容量和授权范围。

1. 确认设备身份、健康状态、文件系统的大文件支持及可用空间，核对绝对目标路径且目标文件不存在。最新旧盘约 275.50 GiB，单份克隆建议至少 350 GiB 空闲；若在目标设备同时保存校验母本和可写验收副本，建议至少 650 GiB，实际仍需为增长和导出预留空间。最初盘点时 C/D/E 均不足以放下完整克隆；这一余量判断现已过时，今后应按实际情况重新测量。
2. 先记录当前 Docker 配置、上下文及新数据盘的保护方式，检查源旧盘未接入。安排经确认的维护窗口，在相关 Docker 后台完全停止后复制，避免从正在变化的盘取得不一致副本；不全局关闭其他项目的 WSL。Docker 官方要求在备份虚拟机磁盘前完全停止 Docker，且自定义存储应使用实际配置位置，见 [官方备份说明](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/)。
3. 源旧盘仅以读取方式生成完整克隆；记录路径、大小、时间和源/副本 SHA-256。哈希必须相同，断开并重新连接目标设备后再次校验。失败时保留原件和失败记录，不覆盖原件、不把未完成克隆当作备份。
4. 优先在隔离环境以不回放日志的只读方式检查克隆，列出容器、镜像、命名卷、匿名卷和绑定目录。核对原项目配置与实际资源对应关系；绑定到 VHDX 之外的 Windows 文件和凭据须另行保护，不能以整盘克隆宣称全部应用数据齐全。
5. 需要挂载写入、日志回放、数据库检查修复或真实启动时，另备可写工作副本，母本与原盘保持不动。先核对容器重启策略、端口及网络隔离，避免旧服务自动启动或访问原项目。逐项验收数据库、文件及业务流程，不以容器清单出现或进程启动代替数据恢复成功。
6. 核验通过后再提交具体接回方案，由用户确认后执行。回退以未改动原盘、已校验母本及保存的当前配置为依据；失败只停止隔离工作副本，不把改动后的副本覆盖原盘。

### 7.3 退役依据与保留原则

删除前不能将三份旧盘认定为已证实的重复副本。用户最终选择接受其中可能存在独有数据，主动放弃全部三个已知旧 Docker 恢复点，因此按具体文件执行退役；本次没有完成克隆或业务等价性证明。历史两份 9 月恢复点合计约 551.43 GiB；此次三份全部删除约 826.93 GiB，实际空间变化见 7.6。

可以减少旧恢复点，但不建议最终仅留全局唯一一份数据。至少保留工作数据和一份经校验、可独立恢复的设备外备份。数据库冷备、逻辑导出与整盘镜像不是同一种保护，不因内容可能重叠就整体删除；名称带 `invalid-partial` 的产物也应先核对历史记录与替代备份，再列入待确认清单。

不运行全局 `docker system prune`、卷清理、Docker 重置或旧盘压缩来代替上述判断。当前专用依赖卷即使没有容器引用，也服务于已经验收的博客预览入口；删除会导致下次重新安装依赖。引擎内释放空间不等于 Windows 上 VHDX 文件立即缩小，压缩须另定方案，不能用于尚未恢复的旧盘。

### 7.4 数据库冷备历史验收与后续退役

2026-11-01 曾在新建专用卷和目录完成约 61.70 GiB PostgreSQL 16 冷备的独立恢复：2,397 个文件哈希及完整目录元数据对应，关键表和业务数据核对通过，相关表与 B-tree 完整性检查、正常停库和重启读取通过。私有历史报告在 `.local/studio-qa/cold-restore-20261101-1333/verification-summary.json`。随后用户要求删除已确认属于 Company-data 的备份，完整冷备及验收副本现已删除，历史报告不代表仍有可直接使用的恢复来源。当前状态及删除证据见最新 [项目状态](STATUS.md)。

这批数据库资料来自独立企业来源记录项目的 Excel 导入、标准化记录和导入过程管理，不属于博客缓存。冷备保护当时的整个 PostgreSQL 集群，不保护全部原始 Excel、Windows 项目文件或其他 Docker 卷；较新的逻辑导出具有不同时间和范围，不能因内容重叠而整体删除。Docker VHDX 是虚拟数据盘快照，不是整个 Windows C/E 分区备份，原内部核验计划后来因用户选择退役三份源盘而取消。

约 5.893 GiB 中断归档此前已满足“完整替代冷备实际恢复通过”的条件。六项差异为事务状态、索引、可见性映射和统计信息变化，未发现独有的权威业务行；但有部分旧统计与物理状态不同，不宣称两包逐字节相同。后续用户按项目归属授权清理，38 个专用备份及关联文件共约 74.56 GiB 已删除，包括冷备、中断归档及较新逻辑导出；约 61.70 GiB 的验收卷和对应容器、镜像亦已移除。此前“保留完整冷备”的候选清理条件已由这次项目备份退役授权取代。

在该数据库备份删除阶段，三份旧 VHDX 因可能混有其他项目而保留；三份旧盘后来另经明确授权退役，见 7.6。整盘校验记录、博客资料、项目源码和原始 Excel 均保留。该备份删除阶段没有执行全局卷清理、旧盘挂载、压缩或离机转存；后续单独授权的当前数据盘压缩见 7.5。仅为 Company-data 退役已确认的专用备份，不代表整个旧 Docker 环境已清除或恢复。

### 7.5 当前数据盘的空间回收（2026-11-01 已完成）

用户随后单独授权压缩当前 C 盘默认 Docker 数据盘，三份旧 VHDX 当时不在该次压缩范围。先导出并校验当前唯一的博客镜像与依赖卷作为本机回退资料；确认没有容器运行后正常退出 Docker。当前 Docker Desktop 的内置回收被跳过，因此仅针对当前数据文件系统执行空闲块回收，再在脱离使用状态调用 Windows 原生 `CompactVirtualDisk`，未缩小虚拟容量，也未挂载旧盘。

按句柄关闭及重启构建后的最终实测，当前数据盘由约 67.20 GiB 降至 3.11 GiB，文件占用减少约 64.09 GiB；Windows C 盘可用空间净增加约 63.98 GiB，最终约 208.91 GiB。镜像标识与层、依赖卷 4,043 个文件及完整元数据均对应，真实主题构建及内部链接检查通过。Docker 已恢复运行，回退包保留在本机私有证据目录；详见最新 [项目状态](STATUS.md)。

期间用户确认在启动错误窗口点击过应用重置；现存博客镜像和依赖卷经核对仍完整，没有从回退包覆盖导入。残留通信目录以原样改名保留的方式处理后，启动与本轮验收通过。此结果不证明所有 Docker 全局设置在重置后保持不变，也不替代其他项目旧盘恢复或 Windows 重启后的稳定性检查。

后续维护须重新盘点当时正在运行的项目、资源、当前数据盘和可用回退资料，不能直接套用本轮路径和旧清单。压缩前必须退出使用数据盘的 Docker 环境；仅使用已验证的原生接口处理当前文件，不删除全局镜像/卷来代替压缩。Microsoft 的 [CompactVirtualDisk 说明](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/nf-virtdisk-compactvirtualdisk)区分挂载与离线压缩方式；Docker 的[退出时自动回收说明](https://www.docker.com/blog/docker-desktop-4-34/)说明了内置机制，但是否执行及实际释放多少仍以本机日志和空间变化为准。

### 7.6 三份旧 VHDX 已按用户明确授权退役（2026-11-01）

用户明确接受删除 C 盘迁移前快照及其中可能独有数据；对同一消息中的 E 盘保留/删除冲突另行澄清后，又确认删除 E 盘旧活动盘与 E 盘历史备份，接受放弃全部三个已知旧 Docker 恢复点。此前等待设备后克隆的要求因此取消，不把未做的克隆或恢复标记为成功，也不把退役理由写成文件已证明重复或无用。

删除前逐一核对绝对路径、无重解析点、历史大小/修改时间、独占只读访问、WSL 注册引用和当前 Docker 配置。仅删除三份指定 VHDX，保留父目录、整盘历史校验报告、项目源码、原始 Excel、博客草稿和备份；未挂载旧盘、重置 Docker 或执行全局清理。

文件总计 887,912,136,704 字节，约 826.93 GiB。Windows 即时可用空间实测增加 C 盘 275.93 GiB、E 盘 551.00 GiB；博客验收后余量约为 486.74 / 822.45 GiB。当前 Docker 数据盘保留，构建后约 3.118 GiB，正常运行会产生少量变化。

博客镜像标识与层、依赖卷描述及全部 4,770 个条目 / 4,043 个文件哈希一致；回退包校验通过并保留。以独立恢复源和依赖卷只读挂载，在无网络容器完成真实主题构建，15 个 HTML / 36 条内部链接通过；临时回环预览的首页、文章导航、正文和配图已在浏览器验收，随后关闭临时页面及服务。开始时遇到 Resource Saver 休眠缓存返回镜像不存在，界面 Resume 后资源正常返回，未从回退包覆盖导入。

证据保存在 `.local/studio-qa/old-vhdx-retirement-20261101-165500/verification-summary.json` 及同目录日志、截图；原始历史报告保留并另加退役标记。原 Docker 环境仍未恢复，已删除三份旧盘不再是恢复来源。博客完整 ZIP、当前数据盘及博客镜像/依赖回退包继续保留，离机转存仍等待用户确认设备；未上传或发布。
