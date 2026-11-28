const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const srv = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(8765);
(async () => {
  const views = JSON.parse(fs.readFileSync(process.argv[2]));
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const pg = await b.newPage();
  pg.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await pg.goto('http://localhost:8765/render.html');
  await pg.waitForFunction('window.ready === true', null, { timeout: 120000 });
  for (const v of views) {
    const t0 = Date.now();
    const url = await pg.evaluate((o) => window.renderView(o), v);
    fs.writeFileSync(path.join(root, 'renders', v.name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    console.log(v.name, Date.now() - t0, 'ms');
  }
  await b.close(); srv.close();
})();
