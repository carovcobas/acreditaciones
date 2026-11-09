# Acreditaciones del Salón

Sistema de acreditación de ingreso para los eventos del salón.
Sitio estático (HTML + JS) alojado en Vercel, con base de datos, login y tiempo real en Supabase.

**Dirección:** https://acreditaciones.carolinacobas.com

## Qué hace

- Eventos con fecha, hora y sala.
- Lista de invitados (carga manual o pegada desde Excel: `Nombre; DNI; Empresa; Categoría`).
- Credencial con código y QR por invitado.
- Acreditación en puerta: cámara del celular, lector QR USB/Bluetooth, o búsqueda por código, DNI o nombre.
- Varias puertas a la vez en tiempo real; si dos escanean el mismo QR, solo uno lo acredita.
- Contador en vivo por categoría y exportación a CSV.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Página y estilos |
| `app.js` | Lógica de la app |
| `config.js` | URL y clave pública de Supabase |
| `supabase/schema.sql` | Tablas, permisos y tiempo real |
| `vercel.json` | Configuración del hosting |

## Configuración

### 1. Supabase

1. Creá un proyecto en https://supabase.com (región São Paulo, la más cercana).
2. **SQL Editor → New query**: pegá `supabase/schema.sql` y tocá **Run**.
3. **Authentication → Sign In / Providers → Email**: desactivá **Allow new users to sign up**, así solo entra el personal que vos des de alta.
4. **Authentication → Users → Add user → Create new user**: creá un usuario (email + contraseña) para cada persona que acredite. Marcá **Auto Confirm User**.
5. **Authentication → URL Configuration**: en **Site URL** poné `https://acreditaciones.carolinacobas.com`.
6. **Project Settings → API**: copiá **Project URL** y la clave **anon public** en `config.js`. Subí el cambio a GitHub.

> La clave `anon` es pública por diseño. Nunca pongas la `service_role` en `config.js`.

### 2. Vercel

1. Entrá a https://vercel.com con tu cuenta de GitHub.
2. **Add New → Project** → importá `carovcobas/acreditaciones`.
3. Framework Preset: **Other**. No hace falta comando de build. Tocá **Deploy**.
4. Cada push a `main` publica automáticamente.

### 3. Dominio `acreditaciones.carolinacobas.com`

1. En Vercel: proyecto → **Settings → Domains** → agregá `acreditaciones.carolinacobas.com`.
2. En el panel donde administrás el DNS de `carolinacobas.com`, creá este registro:

   | Tipo | Nombre | Valor |
   |---|---|---|
   | CNAME | `acreditaciones` | el valor que muestra Vercel (por ejemplo `cname.vercel-dns.com`) |

3. Esperá que Vercel muestre **Valid Configuration** (minutos, a veces hasta unas horas). El certificado HTTPS se genera solo.

La cámara del celular solo funciona con HTTPS, así que usá siempre la dirección con `https://`.

## Desarrollo local

Abrí la carpeta en VS Code y usá la extensión **Live Server** sobre `index.html`.
Con `config.js` completo, la versión local usa la misma base de datos que la publicada.
