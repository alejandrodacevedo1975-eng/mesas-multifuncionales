// Registro, ingreso y salida de vendedores.
const { getPool } = require('../lib/db');
const U = require('../lib/util');

const SESION_SEG = 60 * 60 * 24 * 30;

function iniciarSesion(res, v) {
  U.ponerCookie(res, 'mm_sess', U.firmar({ t: 'v', id: v.id, exp: Date.now() + SESION_SEG * 1000 }), SESION_SEG);
}

module.exports = async (req, res) => {
  try {
    const pool = getPool();

    if (req.method === 'GET') {
      const s = U.sesion(req, 'v');
      if (!s) return U.enviar(res, 401, { error: 'Sin sesión' });
      const r = await pool.query('select nombre, codigo from vendedores where id=$1', [s.id]);
      if (!r.rows.length) return U.enviar(res, 401, { error: 'Sin sesión' });
      return U.enviar(res, 200, { ok: true, vendedor: r.rows[0] });
    }

    if (req.method !== 'POST') return U.enviar(res, 405, { error: 'Método no permitido' });
    if (!U.exigirJSON(req, res)) return;
    const b = await U.leerJSON(req);
    if (!b) return U.enviar(res, 400, { error: 'Datos inválidos' });

    if (b.accion === 'logout') {
      U.ponerCookie(res, 'mm_sess', '', 0);
      return U.enviar(res, 200, { ok: true });
    }

    if (b.accion === 'registro') {
      const nombre = U.limpiar(b.nombre, 80);
      const email = U.limpiar(b.email, 120).toLowerCase();
      const celular = U.normalizarCelular(b.celular);
      const password = String(b.password || '');
      if (nombre.length < 3) return U.enviar(res, 400, { error: 'Escribe tu nombre completo' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return U.enviar(res, 400, { error: 'Correo no válido' });
      if (!celular) return U.enviar(res, 400, { error: 'Escribe un celular colombiano válido (10 dígitos)' });
      if (password.length < 8 || password.length > 100) return U.enviar(res, 400, { error: 'La contraseña debe tener mínimo 8 caracteres' });
      if (!b.acepto) return U.enviar(res, 400, { error: 'Debes aceptar las condiciones del programa' });

      const clave = 'registro:' + U.ip(req);
      if (!(await U.limitarIntentos(clave, 5, 60))) return U.enviar(res, 429, { error: 'Demasiados registros desde esta conexión. Intenta más tarde.' });
      await U.contarIntento(clave);

      const hash = U.hashPassword(password);
      for (let i = 0; i < 5; i++) {
        try {
          const r = await pool.query(
            'insert into vendedores (nombre,email,celular,password_hash,codigo) values ($1,$2,$3,$4,$5) returning id,nombre,codigo',
            [nombre, email, celular, hash, U.generarCodigo()]);
          iniciarSesion(res, r.rows[0]);
          return U.enviar(res, 200, { ok: true, vendedor: { nombre: r.rows[0].nombre, codigo: r.rows[0].codigo } });
        } catch (e) {
          if (e.code === '23505') {
            const c = String(e.constraint || '');
            if (c.includes('email')) return U.enviar(res, 409, { error: 'Ese correo ya está registrado. Ingresa con tu contraseña.' });
            if (c.includes('celular')) return U.enviar(res, 409, { error: 'Ese celular ya está registrado. Ingresa con tu contraseña.' });
            continue; // choque de código aleatorio: reintenta
          }
          throw e;
        }
      }
      return U.enviar(res, 500, { error: 'No pudimos crear tu cuenta. Intenta de nuevo.' });
    }

    if (b.accion === 'login') {
      const email = U.limpiar(b.email, 120).toLowerCase();
      const password = String(b.password || '');
      const clave = 'login:' + U.ip(req) + ':' + email;
      if (!(await U.limitarIntentos(clave, 8, 15))) return U.enviar(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
      const r = await pool.query('select id,nombre,codigo,password_hash from vendedores where lower(email)=$1', [email]);
      if (!r.rows.length || !U.checkPassword(password, r.rows[0].password_hash)) {
        await U.contarIntento(clave);
        return U.enviar(res, 401, { error: 'Correo o contraseña incorrectos' });
      }
      iniciarSesion(res, r.rows[0]);
      return U.enviar(res, 200, { ok: true, vendedor: { nombre: r.rows[0].nombre, codigo: r.rows[0].codigo } });
    }

    return U.enviar(res, 400, { error: 'Acción no válida' });
  } catch (e) {
    console.error('auth', e.message);
    return U.enviar(res, 500, { error: 'Error del servidor' });
  }
};
