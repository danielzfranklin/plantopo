const fs = require('fs');

const out = {};

fs.readdirSync(__dirname + '/svg').forEach((file) => {
  const fpath = __dirname + '/svg/' + file;
  const svg = fs.readFileSync(fpath, 'utf8');
  const name = fpath.split('/').pop().split('.')[0];
  out['feature:' + name] = svg;
});


fs.writeFileSync(__dirname + '/preview.json', JSON.stringify(out, null, 2));
