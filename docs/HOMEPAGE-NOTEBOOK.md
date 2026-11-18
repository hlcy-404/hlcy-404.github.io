# 首页研究手记：素材与实现说明

2026-11-01，用户选择最新四张效果图中的第一张“研究手记”。本页记录概念插画的来源与实现，不将纸面草图称为真实科研资料。

## 网页素材

| 文件 | 尺寸 | 体积 | 用途 |
| --- | --- | --- | --- |
| [`research-notebook.webp`](../assets/img/home/research-notebook.webp) | 1254 × 1254 | 178,600 bytes | 桌面及高像素密度屏幕 |
| [`research-notebook-small.webp`](../assets/img/home/research-notebook-small.webp) | 640 × 640 | 54,570 bytes | 响应式小图候选 |

两档 WebP 保留 alpha。浏览器根据布局、设备像素密度和缓存选择，不保证每次在手机上都请求小图。主图预留宽高，优先加载；正文、标题、身份和链接由 HTML 输出，未把整张网页效果图铺成背景。

使用内置 Image Gen，从选定效果图提取一个独立透明对象，再用一次定向编辑补全被裁切的右侧纸边。最终原始 PNG 为 1254 × 1254、1,567,087 bytes；提示词要求的 1280 × 1280 不是工具的实际输出尺寸。原图保留在 `.local/homepage-notebook/source/research-notebook.png`，网页版本仅进行格式压缩与小图缩放，没有重画内容。

选定效果图标识：`exec-0319593f-a45d-47ec-ab82-b15aa49153e6.png`。独立素材首次输出：`exec-c87a7faf-34f3-47fc-9d5e-4def005d1cbf.png`；最终修正版：`exec-47bf867c-484b-43ea-aab2-a59f1aac3eb4.png`。均由本地会话中的内置 Image Gen 生成，未调用 CLI/API 密钥路径。

## 原始生成提示词

输入：选定“研究手记”效果图；`transparent_background: true`。

```text
Use case: background-extraction. Asset type: transparent hero illustration cutout for the selected personal research-notes website design. Derive ONLY the open notebook and its graphite pencil from the attached reference, preserving its tactile realistic uncoated off-white paper, dark binding, graphite exploratory sketches, and muted ultramarine handwritten annotations, natural perspective and lighting. Remove every bit of surrounding webpage, headline, personal introduction, hlcy, all interface labels, footer, colored dots and page background. Actual alpha transparency, not white or checkerboard painted background. Fit the entire open notebook silhouette and pencil inside a 1280 x 1280 square composition with 5-8 percent transparent breathing room, with notebook filling 85-90 percent of the frame. Preserve the oblique overhead angle with front lower edge tilted upward toward the right; left page should be the focal dominant page and the right page visible as a narrower perspective section. Show soft natural contact shadow on transparency. The left page contains delicate conceptual pencil sketches as in the reference with exactly four blue handwritten annotation words: 观察, 假设, 验证, 修正. Keep the annotations part of the physical paper image. Small simple curved connecting arrows are fine. Right page contains sparse abstract graphite observation sketches only. Do not invent equations, numbers, measurements, performance charts, data, papers, signatures, affiliations, achievements, logos, watermark or extra text. Keep paper edges complete and uncut. Preserve refined editorial photography, believable fine paper fibers, a slight blue-gray cool light, no saturated warm color cast. This is a single reusable object asset, not a screenshot or multiple options.
```

## 边缘修正提示词

输入：上一步的独立素材；`transparent_background: true`。

```text
Edit this single transparent notebook asset. One correction only: zoom out enough and complete the presently clipped RIGHT OUTER NOTEBOOK EDGE so the entire open notebook and graphite pencil are fully visible with approximately 80 pixels of genuine transparent margin on all four sides in a 1280 x 1280 canvas. No part of the notebook, pencil or shadow may touch a canvas edge. Preserve everything else: precise notebook angle, tactile off-white paper, black binding, graphite sketches, soft natural light, and exactly the four existing blue handwritten labels 观察、假设、验证、修正. Keep composition and illustration unchanged except proportional smaller fit and completing clipped outer paper/binding outline. Do not add UI, webpage text, captions, numbers, logos, extra objects or background. Actual transparent background; keep the naturally subtle shadow as translucent pixels.
```

## 页面与预览

- 首页模板：`_layouts/atlas.html`；文案：`_data/atlas.yml`；局部样式：`assets/css/atlas-notebook.css`。
- 原方向面板抽出为 `_includes/atlas-exploration.html`，键盘切换与真实文章检索继续沿用现有逻辑。
- 首页色彩仅作用于 `.atlas-notebook-home`，阅读内页未切换为新配色。
- 本轮临时静态预览为 `http://127.0.0.1:4173/`，仅在本机服务运行时可访问。常规后续编辑仍按 `docs/LOCAL-DEVELOPMENT.md` 使用 `preview.cmd`。
- 当前已通过的验证见项目根 `design-qa.md`；本地修改未提交、同步或发布。
