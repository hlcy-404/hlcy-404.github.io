---
# the default layout is 'page'
icon: fas fa-info-circle
order: 4
title: 关于我
---

<div class="editorial-about">
  <div class="about-masthead">
    <div class="about-masthead-left">
      <div class="about-avatar-wrap" style="max-width: 68px;">
        <img src="{{ site.avatar | relative_url }}" width="68" height="68" style="width: 68px; max-width: 68px; height: 68px;" alt="hlcy 头像">
      </div>
      <div class="about-identity">
        <div class="about-name-row">
          <strong>hlcy</strong>
          <span class="about-tag-pill">遥感视觉 · 大模型与 Agent</span>
        </div>
        <p class="about-affiliation">中国科学院大学杭州高等研究院 · 智能科学与技术学院 2024 级硕士</p>
      </div>
    </div>
    <div class="about-masthead-actions">
      <a class="about-action-pill" href="https://github.com/hlcy-404" target="_blank" rel="noopener noreferrer">
        {% include atlas-icon.html name='github' %}
        <span>GitHub · hlcy-404</span>
      </a>
      <a class="about-action-pill subtle" href="{{ '/friends/' | relative_url }}">
        <span>朋友与共创</span>
        {% include atlas-icon.html name='arrow' %}
      </a>
    </div>
  </div>

  <p class="about-lead">你好，我是 <strong>hlcy</strong>。2023 年本科毕业于郑州大学物联网工程专业，目前在国科大杭州高等研究院攻读计算机技术硕士学位，研究聚焦遥感图像篡改检测与解释，同时也持续探索大模型、Agent 与科研工程实践。</p>

  <p class="about-sub">这个博客是一本公开的个人探索手记，用来安放研究中的真实问题、系统实现里的取舍，以及值得在时间里回看的思考。</p>

  <section class="about-section">
    <span class="atlas-eyebrow">EDUCATION</span>
    <h2>求学经历</h2>
    <div class="about-timeline">
      <div class="about-timeline-item">
        <span class="about-year">2024 — 至今</span>
        <div class="about-timeline-dot" aria-hidden="true"></div>
        <div class="about-timeline-body">
          <strong>中国科学院大学杭州高等研究院</strong>
          <p class="timeline-major">智能科学与技术学院 · 计算机技术专业 · 硕士研究生</p>
          <p class="timeline-note">研究方向：遥感图像篡改检测与解释、频域先验与多专家融合建模。</p>
        </div>
      </div>
      <div class="about-timeline-item">
        <span class="about-year">2019 — 2023</span>
        <div class="about-timeline-dot" aria-hidden="true"></div>
        <div class="about-timeline-body">
          <strong>郑州大学</strong>
          <p class="timeline-major">物联网工程专业 · 工学学士</p>
        </div>
      </div>
    </div>
  </section>

  <section class="about-section">
    <span class="atlas-eyebrow">SELECTED RESEARCH &amp; PROJECTS</span>
    <h2>研究与项目</h2>

    <article class="about-featured-paper">
      <div class="featured-paper-copy">
        <div class="featured-paper-kicker">
          <span class="paper-venue">ICASSP 2026</span>
          <span class="paper-role">共同第一作者（署名列首）</span>
        </div>
        <h3>FG-MoE: Filter-Group Mixture-of-Experts Model for Remote Sensing Forged Target Perception</h3>
        <p>结合经典图像处理先验与深度学习，探索遥感影像中的伪造目标感知。通过构建 Sobel、Wavelet、Schmid、Gabor 等异构专家库与动态门控融合，增强退化条件下对细微篡改痕迹的敏感性，相关代码已开源。</p>
        <div class="about-work-links">
          <a class="paper-primary-link" href="{{ '/posts/fg-moe/' | relative_url }}">阅读研究介绍 →</a>
          <a href="https://ieeexplore.ieee.org/abstract/document/11464111" target="_blank" rel="noopener noreferrer">IEEE Xplore 论文 ↗</a>
          <a href="https://github.com/hlcy-404/FG-MoE" target="_blank" rel="noopener noreferrer">GitHub 开源代码 ↗</a>
        </div>
      </div>
      <div class="featured-paper-thumb" style="max-width: 168px;">
        <img src="{{ '/assets/img/fg-moe/paper-first-page.png' | relative_url }}" style="width: 100%; max-width: 168px; height: auto;" alt="FG-MoE 论文首页缩略图" loading="lazy">
        <small>点击可放大查看论文首页</small>
      </div>
    </article>

    <div class="about-project-pair">
      <article class="about-project-card">
        <span class="project-card-tag">个人开发 · 创意与视觉交互</span>
        <h3>Image Love</h3>
        <p>我开发的图像创作与灵感浏览项目，将图像示例、提示词和分类筛选组织在同一界面，帮助创作者从已有风格与场景出发，快速形成自己的创作想法。</p>
      </article>

      <article class="about-project-card">
        <span class="project-card-tag">参与研发 · AI for Science</span>
        <h3>BioClaw</h3>
        <p>我参与的生命科学科研资源智能匹配项目，探索从科研文献中提取结构化关键信息，为实验资源发现与精准匹配提供支持。</p>
      </article>
    </div>
  </section>

  <section class="about-section">
    <span class="atlas-eyebrow">FOCUS &amp; ETHOS</span>
    <h2>关注方向与记录原则</h2>
    <div class="about-focus-grid">
      <div class="about-focus-col">
        <span class="focus-num">01</span>
        <h3>人工智能与计算技术</h3>
        <p>关注真实问题、先验假设、方法设计与实验证据之间的内在联系。</p>
      </div>
      <div class="about-focus-col">
        <span class="focus-num">02</span>
        <h3>大模型与 Agent</h3>
        <p>关注模型推理能力与实际软件系统、科研协作流程的工程结合。</p>
      </div>
      <div class="about-focus-col">
        <span class="focus-num">03</span>
        <h3>科研工程</h3>
        <p>关注可复现、可核查、可长期维护的研究工具与系统构建过程。</p>
      </div>
    </div>

    <blockquote class="about-ethos-quote">
      <p>这里的记录不只包含最终结论，也保留问题、边界和取舍。文章中的客观事实、实验结果与个人判断会尽量区分，尚未验证的内容会明确注明。</p>
    </blockquote>
  </section>
</div>
