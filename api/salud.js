// Diagnóstico de conexión. No muestra contraseñas ni claves, solo si cada cosa está bien o mal.
const { getPool } = require('../lib/db');
const U = require('../lib/util');

function explicar(e) {
  const c = String(e.code || '');
  const m = String(e.message || '');
  if (c === 'ENOTFOUND') return 'El servidor que aparece en la URL no existe. La URL está mal armada (revisa que no tenga corchetes, espacios ni más de una @).';
  if (c === '28P01') return 'La contraseña de la URL es incorrecta.';
  if (/tenant or user not found/i.test(m)) return 'El usuario o el proyecto de la URL no son los correctos. Copia otra vez la URL de Transaction pooler.';
  if (c === 'ECONNREFUSED' || c === 'ETIMEDOUT' || /timeout/i.test(m)) return 'No hay conexión con ese servidor o puerto. Debe ser el pooler (puerto 6543).';
  if (c === '3D000') return 'La base de datos que nombra la URL no existe (al final debe terminar en /postgres).';
  if (/ssl|certificate/i.test(m)) return 'Problema de conexión segura (SSL).';
  return 'Error de conexión sin clasificar.';
}

module.exports = async (req, res) => {
  const out = { env: {}, url: null, db: null };
  const u = process.env.DATABASE_URL || '';
  out.env.DATABASE_URL = u ? 'presente' : 'FALTA';
  out.env.SESSION_SECRET = (process.env.SESSION_SECRET || '').length >= 16 ? 'ok' : 'FALTA o muy corta';
  out.env.ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').length >= 8 ? 'ok' : 'FALTA o muy corta';
  try {
    const p = new URL(u);
    out.url = {
      protocolo: p.protocol, servidor: p.hostname, puerto: p.port || '(ninguno)', base: p.pathname,
      tiene_usuario: !!p.username, tiene_clave: !!p.password,
      parametros_extra: p.search ? 'SI (deberia ser NO)' : 'no',
    };
  } catch (_) { out.url = 'La DATABASE_URL no se puede leer como URL (mal formada)'; }
  if (!u) { out.db = { conecta: false, detalle: 'Falta DATABASE_URL' }; return U.enviar(res, 200, out); }
  try {
    const r = await getPool().query(
      "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('vendedores','visitas','pedidos','solicitudes_pago','comisiones','intentos')");
    out.db = { conecta: true, tablas_de_mesas: r.rows[0].n + ' de 6' };
  } catch (e) {
    out.db = { conecta: false, codigo: e.code || null, detalle: explicar(e) };
  }
  return U.enviar(res, 200, out);
};
