// Panel privado del propietario. Acceso con ADMIN_PASSWORD (variable de entorno en Vercel).
const { getPool, tx } = require('../lib/db');
const U = require('../lib/util');

const SESION_SEG = 60 * 60 * 12;

module.exports = async (req, res) => {
  try {
    const pool = getPool();

    if (req.method === 'POST') {
      if (!U.exigirJSON(req, res)) return;
      const b = await U.leerJSON(req);
      if (!b) return U.enviar(res, 400, { error: 'Datos inválidos' });

      if (b.accion === 'login') {
        const esperado = process.env.ADMIN_PASSWORD;
        if (!esperado || esperado.length < 8) return U.enviar(res, 500, { error: 'ADMIN_PASSWORD no está configurada en el servidor' });
        const clave = 'admin:' + U.ip(req);
        if (!(await U.limitarIntentos(clave, 6, 15))) return U.enviar(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
        if (!U.igualesSeguro(b.password || '', esperado)) {
          await U.contarIntento(clave);
          return U.enviar(res, 401, { error: 'Contraseña incorrecta' });
        }
        U.ponerCookie(res, 'mm_admin', U.firmar({ t: 'a', exp: Date.now() + SESION_SEG * 1000 }), SESION_SEG);
        return U.enviar(res, 200, { ok: true });
      }
      if (b.accion === 'logout') {
        U.ponerCookie(res, 'mm_admin', '', 0);
        return U.enviar(res, 200, { ok: true });
      }

      if (!U.sesion(req, 'a')) return U.enviar(res, 401, { error: 'Sin sesión' });

      // ---- Cambiar estado de un pedido ----
      if (b.accion === 'pedido_estado') {
        const id = Number(b.id), nuevo = String(b.estado);
        if (!Number.isInteger(id) || !['nuevo', 'entregado', 'cancelado'].includes(nuevo)) return U.enviar(res, 400, { error: 'Datos inválidos' });
        const out = await tx(async (c) => {
          const q = await c.query('select * from pedidos where id=$1 for update', [id]);
          if (!q.rows.length) return { status: 404, error: 'Pedido no encontrado' };
          const p = q.rows[0];
          if (p.estado === nuevo) return { status: 200, ok: true };
          const permitido = {
            nuevo: ['entregado', 'cancelado'],
            cancelado: ['nuevo'],
            entregado: ['cancelado'],
          };
          if (!permitido[p.estado].includes(nuevo)) return { status: 400, error: `No se puede pasar de "${p.estado}" a "${nuevo}"` };

          if (nuevo === 'entregado') {
            await c.query("update pedidos set estado='entregado', entregado_en=now() where id=$1", [id]);
            if (p.vendedor_id) {
              // UNIQUE(pedido_id) garantiza una sola comisión por pedido, aunque se confirme dos veces.
              await c.query(
                `insert into comisiones (pedido_id, vendedor_id, monto) values ($1,$2,$3)
                 on conflict (pedido_id) do nothing`,
                [id, p.vendedor_id, U.COMISION_POR_MESA * p.cantidad]);
            }
          } else if (nuevo === 'cancelado') {
            if (p.estado === 'entregado') {
              const cm = await c.query('select id, estado from comisiones where pedido_id=$1 for update', [id]);
              if (cm.rows.length && cm.rows[0].estado !== 'pendiente' && cm.rows[0].estado !== 'cancelada') {
                return { status: 400, error: 'La comisión de este pedido ya fue solicitada o pagada. Resuélvela primero en Pagos.' };
              }
              await c.query("update comisiones set estado='cancelada' where pedido_id=$1", [id]);
            }
            await c.query("update pedidos set estado='cancelado', entregado_en=null where id=$1", [id]);
          } else { // cancelado -> nuevo
            await c.query("update pedidos set estado='nuevo' where id=$1", [id]);
          }
          return { status: 200, ok: true };
        });
        return U.enviar(res, out.status, out.error ? { error: out.error } : { ok: true });
      }

      // ---- Aprobar / rechazar solicitud de pago ----
      if (b.accion === 'solicitud_resolver') {
        const id = Number(b.id);
        const decision = String(b.decision);
        const nota = U.limpiar(b.nota, 200);
        if (!Number.isInteger(id) || !['aprobar', 'rechazar'].includes(decision)) return U.enviar(res, 400, { error: 'Datos inválidos' });
        const out = await tx(async (c) => {
          const q = await c.query('select * from solicitudes_pago where id=$1 for update', [id]);
          if (!q.rows.length) return { status: 404, error: 'Solicitud no encontrada' };
          if (q.rows[0].estado !== 'pendiente') return { status: 400, error: 'Esta solicitud ya fue resuelta' };
          if (decision === 'aprobar') {
            await c.query("update solicitudes_pago set estado='aprobada', resuelto_en=now(), nota_admin=nullif($2,'') where id=$1", [id, nota]);
          } else {
            await c.query("update solicitudes_pago set estado='rechazada', resuelto_en=now(), nota_admin=nullif($2,'') where id=$1", [id, nota]);
            // Las comisiones vuelven a estar disponibles para el vendedor.
            await c.query("update comisiones set estado='pendiente', solicitud_id=null where solicitud_id=$1 and estado='solicitada'", [id]);
          }
          return { status: 200 };
        });
        return U.enviar(res, out.status, out.error ? { error: out.error } : { ok: true });
      }

      // ---- Registrar pago realizado ----
      if (b.accion === 'solicitud_pagar') {
        const id = Number(b.id);
        const ref = U.limpiar(b.referencia, 80);
        if (!Number.isInteger(id)) return U.enviar(res, 400, { error: 'Datos inválidos' });
        const out = await tx(async (c) => {
          const q = await c.query('select * from solicitudes_pago where id=$1 for update', [id]);
          if (!q.rows.length) return { status: 404, error: 'Solicitud no encontrada' };
          if (q.rows[0].estado !== 'aprobada') return { status: 400, error: 'Primero debes aprobar la solicitud' };
          await c.query("update solicitudes_pago set estado='pagada', pagado_en=now(), referencia_pago=nullif($2,'') where id=$1", [id, ref]);
          await c.query("update comisiones set estado='pagada' where solicitud_id=$1 and estado='solicitada'", [id]);
          return { status: 200 };
        });
        return U.enviar(res, out.status, out.error ? { error: out.error } : { ok: true });
      }

      return U.enviar(res, 400, { error: 'Acción no válida' });
    }

    if (req.method !== 'GET') return U.enviar(res, 405, { error: 'Método no permitido' });
    if (!U.sesion(req, 'a')) return U.enviar(res, 401, { error: 'Sin sesión' });

    const [tot, com, vend, ped, sol] = await Promise.all([
      pool.query(
        `select count(*)::int pedidos,
                count(*) filter (where estado='nuevo')::int nuevos,
                count(*) filter (where estado='entregado')::int entregados,
                coalesce(sum(total) filter (where estado='entregado'),0)::int vendido,
                count(*) filter (where vendedor_id is not null)::int por_vendedores
         from pedidos`),
      pool.query(
        `select coalesce(sum(monto) filter (where estado='pendiente'),0)::int pendiente,
                coalesce(sum(monto) filter (where estado='solicitada'),0)::int solicitada,
                coalesce(sum(monto) filter (where estado='pagada'),0)::int pagada
         from comisiones`),
      pool.query(
        `select v.id, v.nombre, v.email, v.celular, v.codigo, v.creado_en,
                (select count(*)::int from visitas x where x.vendedor_id=v.id) clientes,
                (select count(*)::int from pedidos p where p.vendedor_id=v.id) pedidos,
                (select count(*)::int from pedidos p where p.vendedor_id=v.id and p.estado='entregado') entregados,
                coalesce((select sum(monto) from comisiones c where c.vendedor_id=v.id and c.estado='pendiente'),0)::int pendiente,
                coalesce((select sum(monto) from comisiones c where c.vendedor_id=v.id and c.estado='solicitada'),0)::int solicitada,
                coalesce((select sum(monto) from comisiones c where c.vendedor_id=v.id and c.estado='pagada'),0)::int pagada
         from vendedores v order by v.id desc`),
      pool.query(
        `select p.*, v.nombre as vendedor_nombre, v.codigo as vendedor_codigo,
                c.monto as comision, c.estado as comision_estado
         from pedidos p
         left join vendedores v on v.id = p.vendedor_id
         left join comisiones c on c.pedido_id = p.id
         order by p.id desc limit 300`),
      pool.query(
        `select s.*, v.nombre as vendedor_nombre, v.celular as vendedor_celular, v.codigo as vendedor_codigo
         from solicitudes_pago s join vendedores v on v.id = s.vendedor_id
         order by (s.estado in ('pendiente','aprobada')) desc, s.id desc limit 200`),
    ]);
    return U.enviar(res, 200, {
      totales: tot.rows[0], comisiones: com.rows[0],
      vendedores: vend.rows, pedidos: ped.rows, solicitudes: sol.rows,
      comision_por_mesa: U.COMISION_POR_MESA,
    });
  } catch (e) {
    console.error('admin', e.message);
    return U.enviar(res, 500, { error: 'Error del servidor' });
  }
};
