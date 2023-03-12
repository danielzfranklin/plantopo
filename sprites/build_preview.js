const fs = require('fs');
const cheerio = require('cheerio');

const out = {};

fs.readdirSync(__dirname + '/svg').forEach((file) => {
  const fpath = __dirname + '/svg/' + file;
  const raw = fs.readFileSync(fpath, 'utf8');
  const name = fpath.split('/').pop().split('.')[0];
  const $ = cheerio.load(raw, { xml: true }, false);

  $('*').each((_i, _elem) => {
    const elem = $(_elem);
    const opacity = elem.css('opacity');
    if (opacity) {
      if (parseFloat(opacity) < 0.7) {
        elem.remove();
        return;
      } else {
        elem.attr('opacity', null);
      }
    }

    for (const prop of ['fill', 'stroke', 'color']) {
      elem.css(prop, '');
      elem.attr(prop, null);
    }

    if (elem.attr('style') === '') {
      elem.attr('style', null)
    }
  });

  const svg = $('svg');
  if (!svg.attr('viewBox')) {
    svg.attr('viewBox', '0 0 24 24')
  }

  svg.css('width', '100%');
  svg.css('height', '100%');

  out['feature:' + name] = $.root().html()
});


fs.writeFileSync(__dirname + '/preview.json', JSON.stringify(out, null, 2));
