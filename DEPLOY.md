# Mesas Multifuncionales · Tienda + programa de vendedores

## Qué hay
- `index.html` — tienda (misma de siempre) + formulario de pedido + sección "GANA DINERO VENDIENDO MESAS".
- `/vendedor/` — registro, ingreso y panel del vendedor.
- `/admin/` — panel privado del propietario.
- `api/` — funciones de Vercel (visita, pedido, auth, vendedor, admin). `lib/` — utilidades. `db/schema.sql` — tablas.
- `test/` — pruebas automáticas (no se despliegan).

## Puesta en marcha (una sola vez)
1. **Supabase**: crear proyecto → SQL Editor → pegar todo `db/schema.sql` → Run.
2. **Supabase → Connect → Transaction pooler**: copiar la cadena de conexión (`postgresql://postgres.xxxx:CLAVE@...:6543/postgres`).
3. **Vercel → variables de entorno** (Production), con la CLI desde Ubuntu, dentro de la carpeta del proyecto:
   ```
   vercel env add DATABASE_URL production      # pegar la cadena del paso 2
   vercel env add SESSION_SECRET production    # pegar el resultado de: openssl rand -hex 32
   vercel env add ADMIN_PASSWORD production    # tu contraseña de administrador (mínimo 8 caracteres, larga)
   vercel --prod                               # volver a desplegar
   ```
4. Entrar a `https://TU-DOMINIO/admin/` con `ADMIN_PASSWORD`.

## Reglas del sistema
- Comisión: $40.000 por mesa, se genera cuando el administrador confirma la **entrega**.
- Atribución: gana el primer enlace de vendedor visto en los últimos 30 días; una venta nunca tiene dos vendedores.
- Un vendedor no gana comisión por un pedido hecho con su propio celular.
- Pagos 100 % manuales: el vendedor solicita, el admin aprueba y registra el pago.
- Precios en `lib/util.js` (servidor) y en `index.html` (visual): 4 puestos $290.000, 6 puestos $300.000.
