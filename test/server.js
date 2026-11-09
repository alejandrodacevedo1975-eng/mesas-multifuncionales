// Servidor local que imita a Vercel: monta /api/* y sirve los archivos estáticos.
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const tipos = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

function crear() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/api\/([a-z]+)$/);
    if (m && fs.existsSync(path.join(root, 'api', m[1] + '.js'))) {
      return require(path.join(root, 'api', m[1] + '.js'))(req, res);
    }
    let f = path.join(root, url.pathname);
    if (!f.startsWith(root)) { res.statusCode = 403; return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('no'); }
    res.setHeader('Content-Type', tipos[path.extname(f)] || 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  });
}
module.exports = { crear };
if (require.main === module) crear().listen(3999, () => console.log('http://localhost:3999'));
