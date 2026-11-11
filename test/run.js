process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres@localhost:5433/mesas_test';
process.env.SESSION_SECRET = 'secreto-de-prueba-0123456789abcdef';
process.env.ADMIN_PASSWORD = 'admin-prueba-123';
const { crear } = require('./server');
const { getPool } = require('../lib/db');

let ok = 0, fail = 0;
const fallos = [];
function t(nombre, cond, extra) {
  if (cond) { ok++; console.log('  ✔', nombre); }
  else { fail++; fallos.push(nombre); console.log('  ✘', nombre, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

class Cliente {
  constructor(base, ip) { this.base = base; this.cookies = {}; this.ip = ip || '10.0.0.' + Math.floor(Math.random() * 250); }
  async req(metodo, ruta, body, extra = {}) {
    const headers = { 'x-forwarded-for': this.ip, ...extra.headers };
    if (body !== undefined && !extra.sinJSON) headers['Content-Type'] = 'application/json';
    if (extra.sinJSON) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const ck = Object.entries(this.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    if (ck) headers.cookie = ck;
    const r = await fetch(this.base + ruta, { method: metodo, headers, body: body === undefined ? undefined : (extra.sinJSON ? 'a=1' : JSON.stringify(body)) });
    for (const sc of r.headers.getSetCookie()) {
      const [par] = sc.split(';'); const i = par.indexOf('=');
      const k = par.slice(0, i), v = decodeURIComponent(par.slice(i + 1));
      if (/Max-Age=0/i.test(sc)) delete this.cookies[k]; else this.cookies[k] = v;
    }
    let j = {}; try { j = await r.json(); } catch (_) {}
    return { s: r.status, j, h: r.headers, sc: r.headers.getSetCookie() };
  }
  get(r) { return this.req('GET', r); }
  post(r, b, e) { return this.req('POST', r, b, e); }
}

const pedidoBase = (o = {}) => ({ nombre: 'Cliente Prueba', celular: '3105550000', ciudad: 'Cúcuta', direccion: 'Calle 1 # 2-3', puestos: 4, color: 'Verde', cantidad: 1, ...o });

(async () => {
  const srv = crear();
  await new Promise(r => srv.listen(0, r));
  const base = 'http://localhost:' + srv.address().port;
  const pool = getPool();
  await pool.query('truncate comisiones, solicitudes_pago, pedidos, visitas, intentos, vendedores restart identity cascade');

  console.log('\n[1] Registro y sesión de vendedores');
  const A = new Cliente(base, '1.1.1.1'), B = new Cliente(base, '1.1.1.2');
  let r = await A.post('/api/auth', { accion: 'registro', nombre: 'Ana Gómez', celular: '3001112233', email: 'ana@test.co', password: 'clave12345', acepto: true });
  t('registro de Ana OK y entrega código', r.s === 200 && /^[A-Z0-9]{7}$/.test(r.j.vendedor?.codigo), r);
  const codA = r.j.vendedor.codigo;
  t('cookie de sesión HttpOnly + SameSite', r.sc.some(c => /mm_sess=/.test(c) && /HttpOnly/.test(c) && /SameSite=Lax/.test(c)), r.sc);
  r = await B.post('/api/auth', { accion: 'registro', nombre: 'Beto Ruiz', celular: '+57 300 222 3344', email: 'beto@test.co', password: 'otraclave99', acepto: true });
  t('registro de Beto OK (celular con +57 se normaliza)', r.s === 200, r);
  const codB = r.j.vendedor.codigo;
  t('códigos distintos', codA !== codB);
  const dup = new Cliente(base, '1.1.1.3');
  r = await dup.post('/api/auth', { accion: 'registro', nombre: 'Ana Otra', celular: '3009998877', email: 'ANA@test.co', password: 'clave12345', acepto: true });
  t('correo duplicado (aunque cambie mayúsculas) rechazado 409', r.s === 409, r);
  r = await dup.post('/api/auth', { accion: 'registro', nombre: 'Ana Otra', celular: '3001112233', email: 'otra@test.co', password: 'clave12345', acepto: true });
  t('celular duplicado rechazado 409', r.s === 409, r);
  r = await dup.post('/api/auth', { accion: 'registro', nombre: 'X Y Z', celular: '3009998877', email: 'x@test.co', password: 'corta', acepto: true });
  t('contraseña corta rechazada', r.s === 400, r);
  r = await dup.post('/api/auth', { accion: 'registro', nombre: 'X Y Z', celular: '3009998877', email: 'x@test.co', password: 'clave12345', acepto: false });
  t('sin aceptar condiciones rechazado', r.s === 400, r);
  r = await dup.post('/api/auth', { accion: 'registro', nombre: 'X Y Z', celular: '12345', email: 'x@test.co', password: 'clave12345', acepto: true });
  t('celular inválido rechazado', r.s === 400, r);
  const h = (await pool.query('select password_hash from vendedores where email=$1', ['ana@test.co'])).rows[0].password_hash;
  t('contraseña guardada con hash (no en texto plano)', h.startsWith('s1$') && !h.includes('clave12345'));
  r = await new Cliente(base).post('/api/auth', { accion: 'login', email: 'ana@test.co', password: 'mala-clave' });
  t('login con clave incorrecta 401', r.s === 401, r);
  const A2 = new Cliente(base, '1.1.1.9');
  r = await A2.post('/api/auth', { accion: 'login', email: 'Ana@Test.co', password: 'clave12345' });
  t('login correcto', r.s === 200, r);
  r = await A2.get('/api/auth');
  t('GET /api/auth devuelve la sesión', r.s === 200 && r.j.vendedor.codigo === codA, r);
  r = await new Cliente(base).get('/api/auth');
  t('sin cookie → 401', r.s === 401);
  const fuerza = new Cliente(base, '7.7.7.7'); let ult;
  for (let i = 0; i < 9; i++) ult = await fuerza.post('/api/auth', { accion: 'login', email: 'ana@test.co', password: 'x' + i });
  t('bloqueo tras muchos intentos fallidos (429)', ult.s === 429, ult);
  r = await fuerza.post('/api/auth', { accion: 'login', email: 'ana@test.co', password: 'clave12345' });
  t('…y bloquea incluso con la clave correcta mientras dura el bloqueo', r.s === 429, r);

  console.log('\n[2] Visitas y atribución');
  const web = new Cliente(base, '2.2.2.2');
  r = await web.post('/api/visita', { ref: codA, vid: 'visitanteuno1' });
  t('visita con enlace de Ana registrada', r.s === 200);
  await web.post('/api/visita', { ref: codA, vid: 'visitanteuno1' });
  let c = (await pool.query('select count(*)::int c from visitas where vendedor_id=1')).rows[0].c;
  t('misma visita repetida cuenta una sola vez', c === 1, c);
  await web.post('/api/visita', { ref: 'NOEXISTE', vid: 'visitanteuno1' });
  c = (await pool.query('select count(*)::int c from visitas')).rows[0].c;
  t('código inexistente no crea visita', c === 1, c);

  r = await web.post('/api/pedido', pedidoBase({ vid: 'visitanteuno1', ref: codA }));
  t('pedido de cliente que llegó por Ana OK', r.s === 200 && r.j.id === 1 && r.j.total === 290000, r);
  let p = (await pool.query('select * from pedidos where id=1')).rows[0];
  t('pedido asociado a Ana', p.vendedor_id === 1);
  t('precio del servidor: 4 puestos $290.000', p.precio_unitario === 290000 && p.total === 290000);

  // Primero gana: visita a Ana y luego a Beto → Ana
  await web.post('/api/visita', { ref: codA, vid: 'visitantedos2' });
  await new Promise(r => setTimeout(r, 30));
  await web.post('/api/visita', { ref: codB, vid: 'visitantedos2' });
  r = await web.post('/api/pedido', pedidoBase({ vid: 'visitantedos2', ref: codB, celular: '3105550001', puestos: 6, cantidad: 2 }));
  p = (await pool.query('select * from pedidos where id=$1', [r.j.id])).rows[0];
  t('visita a Ana y luego Beto → la venta es de Ana (primero gana, nunca dos)', p.vendedor_id === 1, p);
  t('6 puestos ×2 = $640.000', p.total === 640000, p.total);

  // Venta directa
  r = await web.post('/api/pedido', pedidoBase({ vid: 'sinenlace0001', celular: '3105550002' }));
  p = (await pool.query('select * from pedidos where id=$1', [r.j.id])).rows[0];
  t('cliente sin enlace → venta directa (sin vendedor)', p.vendedor_id === null);
  const idDirecto = r.j.id;

  // Respaldo por ref si no hubo registro de visita
  r = await web.post('/api/pedido', pedidoBase({ vid: 'visitantetres3', ref: codB, celular: '3105550003' }));
  p = (await pool.query('select * from pedidos where id=$1', [r.j.id])).rows[0];
  t('respaldo: si solo llega ref válido, se asigna a ese vendedor', p.vendedor_id === 2, p);

  // Ventana de 30 días
  await web.post('/api/visita', { ref: codB, vid: 'visitantecuatro4' });
  await pool.query("update visitas set creado_en = now() - interval '31 days' where visitor_id='visitantecuatro4'");
  r = await web.post('/api/pedido', pedidoBase({ vid: 'visitantecuatro4', celular: '3105550004' }));
  p = (await pool.query('select * from pedidos where id=$1', [r.j.id])).rows[0];
  t('visita de hace 31 días ya NO cuenta (sin vendedor)', p.vendedor_id === null, p);
  await pool.query("update visitas set creado_en = now() - interval '29 days' where visitor_id='visitantecuatro4'");
  r = await web.post('/api/pedido', pedidoBase({ vid: 'visitantecuatro4', celular: '3105550005' }));
  p = (await pool.query('select * from pedidos where id=$1', [r.j.id])).rows[0];
  t('visita de hace 29 días SÍ cuenta (vuelve otro día)', p.vendedor_id === 2, p);
  await pool.query("update visitas set creado_en = now() - interval '31 days' where visitor_id='visitantecuatro4'");
  await web.post('/api/visita', { ref: codB, vid: 'visitantecuatro4' });
  const vv = (await pool.query("select creado_en > now() - interval '1 day' as nueva from visitas where visitor_id='visitantecuatro4'")).rows[0];
  t('al volver después de vencida, la atribución se renueva', vv.nueva === true, vv);

  web.ip = '2.2.2.20'; // el límite de pedidos por conexión es 6/hora: cambiamos de conexión simulada
  // Autoventa
  r = await web.post('/api/pedido', pedidoBase({ vid: 'visitantecinco5', ref: codA, celular: '3001112233' }));
  p = (await pool.query('select * from pedidos where id=$1', [r.j.id])).rows[0];
  t('un vendedor no gana comisión por comprarse a sí mismo', p.vendedor_id === null, p);

  console.log('\n[3] Validaciones y seguridad del pedido');
  const v = new Cliente(base, '3.3.3.3');
  r = await v.post('/api/pedido', pedidoBase({ nombre: 'A' })); t('nombre corto rechazado', r.s === 400);
  r = await v.post('/api/pedido', pedidoBase({ celular: '123' })); t('celular inválido rechazado', r.s === 400);
  r = await v.post('/api/pedido', pedidoBase({ puestos: 5 })); t('modelo inexistente rechazado', r.s === 400);
  r = await v.post('/api/pedido', pedidoBase({ color: 'Dorado' })); t('color inexistente rechazado', r.s === 400);
  r = await v.post('/api/pedido', pedidoBase({ cantidad: 0 })); t('cantidad 0 rechazada', r.s === 400);
  r = await v.post('/api/pedido', pedidoBase({ precio: 1, total: 1, precio_unitario: 1 }));
  p = (await pool.query('select * from pedidos where id=$1', [r.j.id])).rows[0];
  t('el cliente no puede imponer el precio', p.total === 290000, p);
  const antes = (await pool.query('select count(*)::int c from pedidos')).rows[0].c;
  r = await v.post('/api/pedido', pedidoBase({ web: 'soy-bot' }));
  const desp = (await pool.query('select count(*)::int c from pedidos')).rows[0].c;
  t('campo trampa (bots) no guarda pedido', antes === desp && r.s === 200);
  r = await v.post('/api/pedido', 'a=1', { sinJSON: true }); t('POST sin JSON rechazado 415 (anti-CSRF)', r.s === 415, r.s);
  const xss = await v.post('/api/pedido', pedidoBase({ nombre: '<script>alert(1)</script>', celular: '3105550077' }));
  t('nombre con HTML se guarda como texto', xss.s === 200);
  const spam = new Cliente(base, '4.4.4.4'); let ls;
  for (let i = 0; i < 8; i++) ls = await spam.post('/api/pedido', pedidoBase());
  t('límite de pedidos por conexión (429)', ls.s === 429, ls.s);

  console.log('\n[4] Seguridad del administrador');
  const Z = new Cliente(base, '5.5.5.5');
  r = await Z.get('/api/admin'); t('GET admin sin sesión 401', r.s === 401);
  r = await Z.post('/api/admin', { accion: 'pedido_estado', id: 1, estado: 'entregado' }); t('acción admin sin sesión 401', r.s === 401);
  r = await A.get('/api/admin'); t('sesión de vendedor NO sirve como admin', r.s === 401);
  r = await Z.post('/api/admin', { accion: 'login', password: 'incorrecta' }); t('admin con clave incorrecta 401', r.s === 401);
  r = await Z.post('/api/admin', { accion: 'login', password: 'admin-prueba-123' }); t('admin con clave correcta', r.s === 200, r);
  r = await Z.get('/api/admin');
  t('panel admin lista vendedores y pedidos', r.s === 200 && r.j.vendedores.length === 2 && r.j.pedidos.length >= 8, r.s);
  t('admin ve quién consiguió cada venta', r.j.pedidos.find(x => x.id === 1).vendedor_codigo === codA);
  const fa = new Cliente(base, '6.6.6.6'); let la;
  for (let i = 0; i < 7; i++) la = await fa.post('/api/admin', { accion: 'login', password: 'x' + i });
  t('bloqueo de fuerza bruta en admin (429)', la.s === 429, la.s);
  r = await A.get('/api/vendedor'); t('vendedor accede a su panel', r.s === 200);
  r = await new Cliente(base).get('/api/vendedor'); t('panel vendedor sin sesión 401', r.s === 401);
  r = await A.get('/api/vendedor');
  const serial = JSON.stringify(r.j);
  t('vendedor no ve celular, dirección ni apellido del cliente', !serial.includes('3105550000') && !serial.includes('Calle 1') && !serial.includes('Prueba'), r.j.lista[0]);

  console.log('\n[5] Entrega y comisiones');
  r = await Z.post('/api/admin', { accion: 'pedido_estado', id: 1, estado: 'entregado' });
  t('admin confirma entrega del pedido 1', r.s === 200, r);
  let com = (await pool.query('select * from comisiones where pedido_id=1')).rows;
  t('se genera comisión $40.000 para Ana', com.length === 1 && com[0].monto === 40000 && com[0].vendedor_id === 1 && com[0].estado === 'pendiente', com);
  r = await Z.post('/api/admin', { accion: 'pedido_estado', id: 1, estado: 'entregado' });
  com = (await pool.query('select * from comisiones where pedido_id=1')).rows;
  t('confirmar dos veces NO duplica la comisión', com.length === 1);
  let pid2 = (await pool.query("select id from pedidos where total=640000")).rows[0].id;
  r = await Z.post('/api/admin', { accion: 'pedido_estado', id: pid2, estado: 'entregado' });
  com = (await pool.query('select * from comisiones where pedido_id=$1', [pid2])).rows;
  t('2 mesas entregadas → comisión $80.000 ($40.000 por mesa)', com.length === 1 && com[0].monto === 80000, com);
  r = await Z.post('/api/admin', { accion: 'pedido_estado', id: idDirecto, estado: 'entregado' });
  com = (await pool.query('select * from comisiones where pedido_id=$1', [idDirecto])).rows;
  t('venta directa entregada NO genera comisión', com.length === 0);
  let pedB = (await pool.query("select id from pedidos where vendedor_id=2 order by id limit 1")).rows[0].id;
  r = await Z.post('/api/admin', { accion: 'pedido_estado', id: pedB, estado: 'cancelado' });
  com = (await pool.query('select * from comisiones where pedido_id=$1', [pedB])).rows;
  t('pedido cancelado NO genera comisión', r.s === 200 && com.length === 0);
  r = await Z.post('/api/admin', { accion: 'pedido_estado', id: pedB, estado: 'entregado' });
  t('cancelado no pasa directo a entregado', r.s === 400, r);
  r = await Z.post('/api/admin', { accion: 'pedido_estado', id: 9999, estado: 'entregado' }); t('pedido inexistente 404', r.s === 404);

  r = await A.get('/api/vendedor');
  t('panel de Ana: clientes llegados = 2', r.j.clientes === 2, r.j.clientes);
  t('panel de Ana: pedidos totales = 2, entregados = 2', r.j.pedidos.total === 2 && r.j.pedidos.entregados === 2, r.j.pedidos);
  t('panel de Ana: pendiente $120.000', r.j.comisiones.pendiente === 120000, r.j.comisiones);

  console.log('\n[6] Solicitud y pago de comisiones');
  r = await B.post('/api/vendedor', { accion: 'solicitar_pago', metodo: 'Nequi', cuenta: '3002223344' });
  t('Beto sin comisiones no puede solicitar pago', r.s === 400, r);
  r = await A.post('/api/vendedor', { accion: 'solicitar_pago', metodo: 'Bitcoin', cuenta: '3001112233' }); t('método de pago inválido rechazado', r.s === 400);
  r = await A.post('/api/vendedor', { accion: 'solicitar_pago', metodo: 'Nequi', cuenta: '3001112233' });
  t('Ana solicita pago de $120.000', r.s === 200 && r.j.solicitud.monto === 120000, r);
  const sid = r.j.solicitud.id;
  r = await A.post('/api/vendedor', { accion: 'solicitar_pago', metodo: 'Nequi', cuenta: '3001112233' });
  t('segunda solicitud inmediata rechazada (nada pendiente)', r.s === 400, r);
  r = await A.get('/api/vendedor');
  t('comisión pasa de pendiente a solicitada', r.j.comisiones.pendiente === 0 && r.j.comisiones.solicitada === 120000, r.j.comisiones);
  r = await Z.get('/api/admin');
  t('admin ve comisiones por pagar $120.000', r.j.comisiones.solicitada === 120000);
  r = await Z.post('/api/admin', { accion: 'solicitud_pagar', id: sid, referencia: 'X' });
  t('no se puede pagar sin aprobar antes', r.s === 400, r);
  r = await Z.post('/api/admin', { accion: 'pedido_estado', id: 1, estado: 'cancelado' });
  t('no se cancela un pedido cuya comisión ya fue solicitada', r.s === 400, r);
  r = await Z.post('/api/admin', { accion: 'solicitud_resolver', id: sid, decision: 'rechazar', nota: 'Falta confirmar datos' });
  t('admin rechaza la solicitud', r.s === 200);
  r = await A.get('/api/vendedor');
  t('al rechazar, las comisiones vuelven a pendiente', r.j.comisiones.pendiente === 120000 && r.j.comisiones.solicitada === 0, r.j.comisiones);
  t('Ana ve la nota del rechazo', r.j.solicitudes[0].estado === 'rechazada' && r.j.solicitudes[0].nota_admin === 'Falta confirmar datos');
  r = await Z.post('/api/admin', { accion: 'solicitud_resolver', id: sid, decision: 'aprobar' });
  t('una solicitud ya resuelta no se puede resolver otra vez', r.s === 400, r);
  r = await A.post('/api/vendedor', { accion: 'solicitar_pago', metodo: 'Bancolombia', cuenta: '12345678901' });
  const sid2 = r.j.solicitud.id;
  t('Ana vuelve a solicitar y funciona', r.s === 200 && r.j.solicitud.monto === 120000, r);
  r = await Z.post('/api/admin', { accion: 'solicitud_resolver', id: sid2, decision: 'aprobar', nota: 'Ok' });
  t('admin aprueba', r.s === 200);
  r = await Z.post('/api/admin', { accion: 'solicitud_pagar', id: sid2, referencia: 'NEQUI-ABC123' });
  t('admin registra el pago realizado', r.s === 200, r);
  r = await A.get('/api/vendedor');
  t('Ana: pagada $120.000, pendiente $0', r.j.comisiones.pagada === 120000 && r.j.comisiones.pendiente === 0 && r.j.comisiones.solicitada === 0, r.j.comisiones);
  t('Ana ve la referencia del pago', r.j.solicitudes[0].estado === 'pagada' && r.j.solicitudes[0].referencia_pago === 'NEQUI-ABC123');
  r = await Z.post('/api/admin', { accion: 'pedido_estado', id: 1, estado: 'cancelado' });
  t('un pedido con comisión ya pagada no se puede cancelar', r.s === 400, r);

  // Cancelar entregado con comisión pendiente
  web.ip = '2.2.2.30';
  r = await web.post('/api/pedido', pedidoBase({ vid: 'visitanteseis6', ref: codA, celular: '3105550088' }));
  const pidX = r.j.id;
  await Z.post('/api/admin', { accion: 'pedido_estado', id: pidX, estado: 'entregado' });
  r = await Z.post('/api/admin', { accion: 'pedido_estado', id: pidX, estado: 'cancelado' });
  com = (await pool.query('select * from comisiones where pedido_id=$1', [pidX])).rows;
  t('devolución: cancelar entregado con comisión pendiente anula la comisión', r.s === 200 && com[0].estado === 'cancelada', com);
  r = await A.get('/api/vendedor');
  t('la comisión anulada no suma al pendiente', r.j.comisiones.pendiente === 0, r.j.comisiones);

  console.log('\n[7] Totales del admin');
  r = await Z.get('/api/admin');
  t('total vendedores en admin', r.j.vendedores.length === 2);
  const va = r.j.vendedores.find(x => x.codigo === codA);
  t('admin: Ana pagada $120.000', va.pagada === 120000, va);

  console.log('\n[8] Archivos estáticos');
  for (const ruta of ['/', '/vendedor/', '/admin/', '/assets/app.css']) {
    const x = await fetch(base + ruta); t('GET ' + ruta + ' → 200', x.status === 200, x.status);
  }

  console.log(`\nRESULTADO: ${ok} pruebas OK, ${fail} fallidas`);
  if (fail) console.log('Fallidas:', fallos);
  srv.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR en el test:', e); process.exit(2); });
