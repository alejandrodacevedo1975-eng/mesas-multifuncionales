const crypto = require('crypto');
const { getPool } = require('./db');

const COMISION_POR_MESA = 40000;
const PRECIOS = { 4: 290000, 6: 320000 };
const ATRIBUCION_DIAS = 30;
const COLORES = ['Negro', 'Verde', 'Azul oscuro', 'Azul rey', 'Rojo', 'Amarillo'];

function secreto() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET no configurada (mínimo 16 caracteres)');
  return s;
}

function firmar(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secreto()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verificar(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const esperado = crypto.createHmac('sha256', secreto()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch (_) { return null; }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return 's1$' + salt.toString('hex') + '$' + h.toString('hex');
}

function checkPassword(pw, guardado) {
  try {
    const [v, saltHex, hashHex] = String(guardado).split('$');
    if (v !== 's1') return false;
    const h = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
    const esperado = Buffer.from(hashHex, 'hex');
    return h.length === esperado.length && crypto.timingSafeEqual(h, esperado);
  } catch (_) { return false; }
}

function igualesSeguro(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function ponerCookie(res, nombre, valor, maxAgeSeg) {
  const seguro = process.env.VERCEL || process.env.COOKIE_SECURE === '1';
  const partes = [`${nombre}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeg}`];
  if (seguro) partes.push('Secure');
  const previas = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [].concat(previas, partes.join('; ')));
}

async function leerJSON(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return null; } }
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > 20000) return null;
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (_) { return null; }
}

function enviar(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function ip(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
}

// Los POST deben ser JSON (los formularios de otros sitios no pueden enviar esto sin permiso → protege de CSRF)
function exigirJSON(req, res) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    enviar(res, 415, { error: 'Solicitud no válida' });
    return false;
  }
  return true;
}

async function limitarIntentos(clave, max, minutos) {
  const pool = getPool();
  if (Math.random() < 0.02) pool.query("delete from intentos where creado_en < now() - interval '1 day'").catch(() => {});
  const r = await pool.query(
    "select count(*)::int c from intentos where clave=$1 and creado_en > now() - make_interval(mins => $2)", [clave, minutos]);
  return r.rows[0].c < max;
}
async function contarIntento(clave) {
  await getPool().query('insert into intentos(clave) values($1)', [clave]);
}

function normalizarCelular(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  return /^3\d{9}$/.test(d) ? d : null;
}

function limpiar(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sesion(req, tipo) {
  const tok = cookies(req)[tipo === 'a' ? 'mm_admin' : 'mm_sess'];
  const p = verificar(tok);
  return p && p.t === tipo ? p : null;
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generarCodigo() {
  const b = crypto.randomBytes(7);
  let s = '';
  for (let i = 0; i < 7; i++) s += ALFABETO[b[i] % ALFABETO.length];
  return s;
}

module.exports = {
  COMISION_POR_MESA, PRECIOS, ATRIBUCION_DIAS, COLORES,
  firmar, verificar, hashPassword, checkPassword, igualesSeguro,
  cookies, ponerCookie, leerJSON, enviar, ip, exigirJSON,
  limitarIntentos, contarIntento, normalizarCelular, limpiar, sesion, generarCodigo,
};
