// Registra que un cliente (navegador) llegó con el enlace de un vendedor.
const { getPool } = require('../lib/db');
const U = require('../lib/util');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return U.enviar(res, 405, { error: 'Método no permitido' });
    if (!U.exigirJSON(req, res)) return;
    const b = await U.leerJSON(req);
    if (!b) return U.enviar(res, 400, { error: 'Datos inválidos' });
    const ref = String(b.ref || '').toUpperCase();
    const vid = String(b.vid || '');
    if (!/^[A-Z0-9]{4,12}$/.test(ref) || !/^[A-Za-z0-9]{8,40}$/.test(vid)) return U.enviar(res, 200, { ok: true });

    const clave = 'visita:' + U.ip(req);
    if (!(await U.limitarIntentos(clave, 60, 60))) return U.enviar(res, 200, { ok: true });
    await U.contarIntento(clave);

    const v = await getPool().query('select id from vendedores where codigo=$1', [ref]);
    if (!v.rows.length) return U.enviar(res, 200, { ok: true });
    // Si la visita anterior ya venció (más de 30 días), se renueva; si no, se conserva la primera.
    await getPool().query(
      `insert into visitas (vendedor_id, visitor_id) values ($1,$2)
       on conflict (vendedor_id, visitor_id)
       do update set creado_en = now()
       where visitas.creado_en < now() - make_interval(days => $3)`,
      [v.rows[0].id, vid, U.ATRIBUCION_DIAS]);
    return U.enviar(res, 200, { ok: true });
  } catch (e) {
    console.error('visita', e.message);
    return U.enviar(res, 200, { ok: true });
  }
};
