# frozen_string_literal: true

# Run inside the project's Ruby container. Fixtures never enter the real _posts.
require 'fileutils'
require 'tmpdir'
require 'json'
require 'open3'
require 'nokogiri'

root = File.expand_path('..', __dir__)
qa_root = File.join(root, '.local', 'atlas-qa')
FileUtils.mkdir_p(qa_root)
run_dir = Dir.mktmpdir('run-', qa_root)
source = File.join(run_dir, 'source')
output = File.join(run_dir, 'site')
FileUtils.mkdir_p(source)
excluded = %w[.git .local _site .jekyll-cache .jekyll-metadata .bundle vendor node_modules Gemfile.lock]
Dir.children(root).each do |entry|
  next if excluded.include?(entry)
  FileUtils.cp_r(File.join(root, entry), source)
end

posts = File.join(source, '_posts')
FileUtils.mkdir_p(posts)
fixtures = {
  '2020-01-01-atlas-qa-pinned.md' => <<~POST,
    ---
    title: '测试样本：研究方法记录'
    description: '仅用于本地回归的研究摘要。'
    categories: [研究记录]
    tags: [复现]
    pin: true
    ---
    ## 问题
    这是隔离测试样本，不是作者成果。

    ## 验证
    ```python
    print("reproducible")
    ```

    | 输入 | 预期 |
    | --- | --- |
    | sample | sample |

    ![测试用现有头像](/assets/R-C.jpg)
  POST
  '2020-01-02-atlas-qa-agent.md' => <<~POST,
    ---
    title: '测试样本：Agent & "工具"'
    description: 'Alpha agent 的搜索验证，包含引号与 & 符号。'
    categories: [工程实践]
    tags: [Agent, 工具]
    ---
    ## 工程说明
    这是隔离的搜索与阅读测试。
  POST
  '2020-01-03-atlas-qa-hidden.md' => <<~POST,
    ---
    title: 'ATLAS_QA_HIDDEN_SENTINEL'
    hidden: true
    ---
    Hidden excludes the homepage only; this is not a privacy control.
  POST
  '2020-01-04-atlas-qa-unpublished.md' => <<~POST
    ---
    title: 'ATLAS_QA_UNPUBLISHED_SENTINEL'
    published: false
    ---
    This must not be built.
  POST
}
fixtures.each { |name, content| File.write(File.join(posts, name), content) }
log, result = Open3.capture2e({ 'JEKYLL_ENV' => 'production' }, 'bundle', 'exec', 'jekyll', 'build', '--source', source, '--destination', output, chdir: root)
File.write(File.join(run_dir, 'build.log'), log)
abort(log.lines.last(45).join) unless result.success?

checks = []
check = lambda do |name, &block|
  raise "FAIL: #{name}" unless block.call
  checks << name
end
home = Nokogiri::HTML(File.read(File.join(output, 'index.html')))
cards = home.css('.atlas-post')
fixture_cards = cards.select { |card| card.at_css('h3 a')['href'].include?('atlas-qa-') }
check.call('visible fixtures, hidden exclusion') { fixture_cards.size == 2 && !home.text.include?('ATLAS_QA_HIDDEN_SENTINEL') }
check.call('pin ordering') { fixture_cards.first.at_css('h3 a')['href'] == '/posts/atlas-qa-pinned/' }
check.call('attribute escaping') { fixture_cards.last['data-search'].include?('Agent & "工具"') }
check.call('category JSON') { JSON.parse(fixture_cards.last['data-categories']) == ['工程实践'] }
check.call('tab relationships') { home.css('[role=tab]').all? { |tab| home.at_css("##{tab['aria-controls']}") } }
check.call('unique IDs') { ids = home.css('[id]').map { |node| node['id'] }; ids.size == ids.uniq.size }
check.call('post, category, tag, archive routes') do
  %w[posts/atlas-qa-agent/index.html categories/index.html tags/index.html archives/index.html about/index.html feed.xml sitemap.xml].all? { |path| File.file?(File.join(output, path)) }
end
check.call('unpublished omitted') { !File.exist?(File.join(output, 'posts/atlas-qa-unpublished/index.html')) }
check.call('docs and local artifacts excluded') { %w[docs tools .local AGENTS.md README.md compose.yaml].none? { |path| File.exist?(File.join(output, path)) } }
article = Nokogiri::HTML(File.read(File.join(output, 'posts/atlas-qa-pinned/index.html')))
check.call('reading page keeps code, table and image') { article.at_css('pre') && article.at_css('table') && article.at_css('img[alt="测试用现有头像"]') }
check.call('RSS contains fixture') { File.read(File.join(output, 'feed.xml')).include?('atlas-qa-agent') }
check.call('no legacy pagination duplicates') { !File.directory?(File.join(output, 'page2')) }

# Local viewport harness: iframe width changes the real page's media queries.
# It is produced AFTER site checks and never copied into production sources.
proof, proof_result = Open3.capture2e('bundle', 'exec', 'htmlproofer', output, '--disable-external', chdir: root)
File.write(File.join(run_dir, 'links.log'), proof)
abort(proof) unless proof_result.success?
checks << 'htmlproofer internal links'
File.write(File.join(output, 'qa-viewports.html'), <<~HTML)
  <!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本地响应式验收</title>
  <style>body{margin:0;padding:20px;background:#e9e7e2;font:14px system-ui}nav{display:flex;gap:14px;margin-bottom:16px}a{color:#33452b}iframe{display:block;border:1px solid #bbb;background:white;height:1000px;max-width:100%}</style>
  <nav><a href="?width=375">375px 手机</a><a href="?width=768">768px 平板</a><a href="?width=1280">1280px 桌面</a><a href="?width=375&path=/posts/atlas-qa-pinned/">手机文章</a><a href="?width=375&path=/about/">手机关于</a></nav>
  <p id="label"></p><iframe title="响应式页面预览" id="preview"></iframe>
  <script>const p=new URLSearchParams(location.search);const width=[375,768,1280].includes(Number(p.get('width')))?Number(p.get('width')):375;const frame=document.querySelector('iframe');frame.style.width=width+'px';const path=p.get('path')||'/';frame.src=path.startsWith('/')&&!path.startsWith('//')?path:'/';frame.addEventListener('load',()=>{document.querySelector('#label').textContent='视口 '+frame.contentWindow.innerWidth+'px / 页面内容 '+frame.contentDocument.documentElement.scrollWidth+'px';});</script></html>
HTML
report = { checks: checks, source: source, output: output, run_dir: run_dir }
File.write(File.join(qa_root, 'latest.json'), JSON.pretty_generate(report))
puts JSON.pretty_generate(report)
