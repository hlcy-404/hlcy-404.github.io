# 第三方组件

本地写作界面使用以下组件。安装目录保留各包原始许可证；锁文件记录精确的依赖树与完整性校验。本文不是许可证替代文本。

| 组件 | 版本 | 许可 | 来源 |
| --- | --- | --- | --- |
| EasyMDE | 2.21.0 | MIT | https://github.com/Ionaru/easy-markdown-editor |
| DOMPurify | 3.4.17 | Apache-2.0 或 MPL-2.0 | https://github.com/cure53/DOMPurify |
| yaml | 2.9.1 | ISC | https://github.com/eemeli/yaml |
| node-diff3 | 3.2.1 | MIT | https://github.com/bhousel/node-diff3 |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| marked（服务端文章资源识别） | 18.1.2 | MIT | https://marked.js.org/ |
| Node.js | 24.22.1 | MIT 及内含组件许可 | https://nodejs.org/dist/v24.22.1/ |

EasyMDE 使用的 CodeMirror、marked 等间接依赖见 `package-lock.json` 及 `node_modules` 中的各包许可证。已有 Jekyll、Chirpy、Ruby 和 Git 的许可沿用原项目与发行包。

本地编辑器没有启用 EasyMDE 的远程拼写词典或 Font Awesome 自动下载；由本地文件服务负责正式草稿保存，浏览器 IndexedDB 仅负责未保存输入与待上传图片的恢复。node-diff3 使用 npm 发布包内的 ESM 构建，已在本项目 Node.js 24 运行和测试，不需要安装 Bun。预览路径处理复用既有 Ruby 依赖 Nokogiri，不增加全局运行环境。
