// Crea un pedido de cliente y lo asocia (una sola vez) al vendedor que lo recomendó.
const { getPool } = require('../lib/db');
const U = require('../lib/util');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return U.enviar(res, 405, { error: 'Método no permitido' });
    if (!U.exigirJSON(req, res)) return;
    const b = await U.leerJSON(req);
    if (!b) return U.enviar(res, 400, { error: 'Datos inválidos' });

    // Campo trampa para bots: un humano no lo ve ni lo llena.
    if (b.web) return U.enviar(res, 200, { ok: true, id: 0 });

    const nombre = U.limpiar(b.nombre, 80);
    const celular = U.normalizarCelular(b.celular);
    const ciudad = U.limpiar(b.ciudad, 60);
    const direccion = U.limpiar(b.direccion, 160);
    const notas = U.limpiar(b.notas, 200);
    const puestos = Number(b.puestos);
    const cantidad = Number(b.cantidad);
    const color = U.limpiar(b.color, 30);

    if (nombre.length < 3) return U.enviar(res, 400, { error: 'Escribe tu nombre completo' });
    if (!celular) return U.enviar(res, 400, { error: 'Escribe un celular colombiano válido (10 dígitos)' });
    if (ciudad.length < 2) return U.enviar(res, 400, { error: 'Escribe tu ciudad' });
    if (direccion.length < 5) return U.enviar(res, 400, { error: 'Escribe tu dirección de entrega' });
    if (!U.PRECIOS[puestos]) return U.enviar(res, 400, { error: 'Elige el modelo' });
    if (!U.COLORES.includes(color)) return U.enviar(res, 400, { error: 'Elige el color del paño' });
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10) return U.enviar(res, 400, { error: 'Cantidad no válida' });

    const clave = 'pedido:' + U.ip(req);
    if (!(await U.limitarIntentos(clave, 6, 60))) return U.enviar(res, 429, { error: 'Demasiados pedidos seguidos. Escríbenos por WhatsApp.' });
    await U.contarIntento(clave);

    const pool = getPool();
    // Atribución: manda la PRIMERA visita con enlace de vendedor dentro de los últimos 30 días.
    let vendedor = null;
    const vid = String(b.vid || '');
    if (/^[A-Za-z0-9]{8,40}$/.test(vid)) {
      const r = await pool.query(
        `select v.id, v.celular from visitas x join vendedores v on v.id = x.vendedor_id
         where x.visitor_id=$1 and x.creado_en > now() - make_interval(days => $2)
         order by x.creado_en asc limit 1`, [vid, U.ATRIBUCION_DIAS]);
      if (r.rows.length) vendedor = r.rows[0];
    }
    if (!vendedor) {
      const ref = String(b.ref || '').toUpperCase();
      if (/^[A-Z0-9]{4,12}$/.test(ref)) {
        const r = await pool.query('select id, celular from vendedores where codigo=$1', [ref]);
        if (r.rows.length) vendedor = r.rows[0];
      }
    }
    // Un vendedor no gana comisión por comprarse a sí mismo.
    if (vendedor && vendedor.celular === celular) vendedor = null;

    const unit = U.PRECIOS[puestos];
    const r = await pool.query(
      `insert into pedidos (cliente_nombre, cliente_celular, ciudad, direccion, puestos, color, cantidad, notas, precio_unitario, total, vendedor_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [nombre, celular, ciudad, direccion, puestos, color, cantidad, notas || null, unit, unit * cantidad, vendedor ? vendedor.id : null]);
    return U.enviar(res, 200, { ok: true, id: r.rows[0].id, total: unit * cantidad });
  } catch (e) {
    console.error('pedido', e.message);
    return U.enviar(res, 500, { error: 'No pudimos guardar el pedido. Escríbenos por WhatsApp.' });
  }
};
