// Panel del vendedor: resumen de su enlace, clientes, pedidos y comisiones; solicitud de pago.
const { getPool, tx } = require('../lib/db');
const U = require('../lib/util');

const METODOS = ['Nequi', 'Daviplata', 'Bancolombia', 'Otro banco'];

module.exports = async (req, res) => {
  try {
    const s = U.sesion(req, 'v');
    if (!s) return U.enviar(res, 401, { error: 'Sin sesión' });
    const pool = getPool();

    if (req.method === 'GET') {
      const [v, vis, ped, com, lista, sol] = await Promise.all([
        pool.query('select nombre,email,celular,codigo,creado_en from vendedores where id=$1', [s.id]),
        pool.query('select count(*)::int c from visitas where vendedor_id=$1', [s.id]),
        pool.query(
          `select count(*)::int total,
                  count(*) filter (where estado='entregado')::int entregados,
                  count(*) filter (where estado='nuevo')::int en_proceso,
                  count(*) filter (where estado='cancelado')::int cancelados
           from pedidos where vendedor_id=$1`, [s.id]),
        pool.query(
          `select coalesce(sum(monto) filter (where estado='pendiente'),0)::int pendiente,
                  coalesce(sum(monto) filter (where estado='solicitada'),0)::int solicitada,
                  coalesce(sum(monto) filter (where estado='pagada'),0)::int pagada
           from comisiones where vendedor_id=$1`, [s.id]),
        pool.query(
          `select p.id, p.creado_en, p.cliente_nombre, p.ciudad, p.puestos, p.cantidad, p.estado,
                  c.monto as comision, c.estado as comision_estado
           from pedidos p left join comisiones c on c.pedido_id = p.id
           where p.vendedor_id=$1 order by p.id desc limit 100`, [s.id]),
        pool.query(
          `select id, monto, metodo, estado, nota_admin, referencia_pago, creado_en, pagado_en
           from solicitudes_pago where vendedor_id=$1 order by id desc limit 50`, [s.id]),
      ]);
      if (!v.rows.length) return U.enviar(res, 401, { error: 'Sin sesión' });
      return U.enviar(res, 200, {
        vendedor: v.rows[0],
        clientes: vis.rows[0].c,
        pedidos: ped.rows[0],
        comisiones: com.rows[0],
        lista: lista.rows.map(r => ({
          id: r.id, fecha: r.creado_en,
          cliente: String(r.cliente_nombre).split(' ')[0], // el vendedor solo ve el primer nombre
          ciudad: r.ciudad, puestos: r.puestos, cantidad: r.cantidad, estado: r.estado,
          comision: r.estado === 'cancelado' ? 0 : (r.comision != null ? r.comision : U.COMISION_POR_MESA * r.cantidad),
          comision_estado: r.comision_estado || null,
        })),
        solicitudes: sol.rows,
        comision_por_mesa: U.COMISION_POR_MESA,
      });
    }

    if (req.method !== 'POST') return U.enviar(res, 405, { error: 'Método no permitido' });
    if (!U.exigirJSON(req, res)) return;
    const b = await U.leerJSON(req);
    if (!b) return U.enviar(res, 400, { error: 'Datos inválidos' });

    if (b.accion === 'solicitar_pago') {
      const metodo = U.limpiar(b.metodo, 30);
      const cuenta = U.limpiar(b.cuenta, 40);
      if (!METODOS.includes(metodo)) return U.enviar(res, 400, { error: 'Elige el método de pago' });
      if (cuenta.length < 6) return U.enviar(res, 400, { error: 'Escribe el número donde quieres recibir el pago' });
      const out = await tx(async (c) => {
        const q = await c.query("select id, monto from comisiones where vendedor_id=$1 and estado='pendiente' for update", [s.id]);
        const monto = q.rows.reduce((a, r) => a + r.monto, 0);
        if (monto <= 0) return null;
        const sp = await c.query(
          'insert into solicitudes_pago (vendedor_id, monto, metodo, cuenta) values ($1,$2,$3,$4) returning id',
          [s.id, monto, metodo, cuenta]);
        await c.query("update comisiones set estado='solicitada', solicitud_id=$1 where id = any($2::int[])",
          [sp.rows[0].id, q.rows.map(r => r.id)]);
        return { id: sp.rows[0].id, monto };
      });
      if (!out) return U.enviar(res, 400, { error: 'No tienes comisiones pendientes para cobrar' });
      return U.enviar(res, 200, { ok: true, solicitud: out });
    }

    return U.enviar(res, 400, { error: 'Acción no válida' });
  } catch (e) {
    console.error('vendedor', e.message);
    return U.enviar(res, 500, { error: 'Error del servidor' });
  }
};
