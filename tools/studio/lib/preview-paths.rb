# Loaded only inside an isolated local preview build.
require 'nokogiri'

Jekyll::Hooks.register [:pages, :documents], :post_render do |page|
  next unless page.output_ext == '.html' && page.site.config['studio_preview']
  prefix = page.site.baseurl
  origin = page.site.config['url']
  rewrite = lambda do |value|
    value = value.delete_prefix(origin) if value.start_with?(origin + '/')
    value = value.delete_prefix(prefix) while value.start_with?(prefix + prefix + '/')
    value.start_with?('/') && !value.start_with?('//', prefix + '/') ? prefix + value : value
  end
  html = Nokogiri::HTML(page.output)
  html.css('[href], [src], [poster], [srcset], [action]').each do |element|
    %w[href src poster action].each { |attr| element[attr] = rewrite.call(element[attr]) if element[attr] }
    if element['srcset'] && !element['srcset'].include?('data:')
      element['srcset'] = element['srcset'].split(',').map { |item|
        url, descriptor = item.strip.split(/\s+/, 2)
        [rewrite.call(url), descriptor].compact.join(' ')
      }.join(', ')
    end
  end
  page.output = html.to_html
end
