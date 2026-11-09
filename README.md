# Acreditaciones del Salón

Sistema de acreditación de ingreso para los eventos del salón.
Sitio estático (HTML + JS) alojado en Vercel, con base de datos, login y tiempo real en Supabase.

**Dirección:** https://acreditaciones.carolinacobas.com

## Qué hace

- Eventos con fecha, hora y sala.
- Registro de invitados por link, con confirmación de la admin y QR por email.
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
| `registro.html` | Página pública de registro |
| `supabase/*.sql` | Tablas, permisos y funciones (en orden: schema, roles, registro, confirmacion) |
| `supabase/functions/` | Funciones: usuarios y enviar-credencial |
| `vercel.json` | Configuración del hosting |

## Configuración

### 1. Supabase

1. Creá un proyecto en https://supabase.com (región São Paulo, la más cercana).
2. **SQL Editor → New query**: pegá `supabase/schema.sql` y tocá **Run**.
3. **Authentication → Sign In / Providers → Email**: desactivá **Allow new users to sign up**, así solo entra el personal que vos des de alta.
4. **Authentication → Users → Add user → Create new user**: creá un usuario (email + contraseña) para cada persona que acredite. Marcá **Auto Confirm User**.
5. **Authentication → URL Configuration**: en **Site URL** poné `https://acreditaciones.carolinacobas.com`.
6. **Project Settings → API**: copiá **Project URL** y la **Publishable key** (`sb_publishable_...`) en `config.js`. Subí el cambio a GitHub.

> La publishable key es pública por diseño. Nunca pongas la secret key (`sb_secret_...`) en `config.js`.

### 1b. Roles

Ejecutá `supabase/roles.sql` en el SQL Editor (después de `schema.sql`).

- **admin** (carovcobas@gmail.com): crea eventos, carga invitados, asigna personal y exporta.
- **puerta** (todo usuario nuevo): al entrar se abre la cámara. Ve solo los eventos de hoy (y de ayer, para los que pasan la medianoche) y acredita. No puede ver la lista de invitados ni modificar nada.

**Asignar personal a un evento:** en el evento, abrí *Personal de puerta asignado* y marcá a las personas.
Sin nadie marcado, el evento lo ve todo el personal de puerta. Con alguien marcado, solo esas personas.

**Gestionar el personal desde la web:** botón **Personal** (solo admin). Permite crear usuarios, cambiar el rol,
cambiar la contraseña y eliminar. Usa la Edge Function `supabase/functions/usuarios`, que verifica que quien
llama sea admin antes de usar la clave secreta del proyecto (la clave nunca llega al navegador).

### 1c. Registro por link y confirmación

Ejecutá `supabase/registro.sql` y después `supabase/confirmacion.sql`.

- Cada evento tiene un link de registro (`/registro?e=...`). Se abre o cierra desde el panel, con cupo opcional.
- Quien se registra queda **por confirmar**. La admin confirma o rechaza; al confirmar le llega el QR por email.
- En la puerta solo pasan los confirmados. El cupo cuenta solo confirmados.
- "Generar link nuevo" invalida el link anterior (por si se filtró).

### 1d. Emails (Resend)

La Edge Function `supabase/functions/enviar-credencial` manda el QR con [Resend](https://resend.com):

1. Creá una cuenta en Resend y agregá el dominio `carolinacobas.com` (Domains → Add domain).
2. Cargá en el DNS del dominio (Squarespace) los registros que te muestra Resend y esperá que figure **Verified**.
3. Creá una API key (API Keys → Create, permiso *Sending access*).
4. Guardala en Supabase: Edge Functions → Secrets → `RESEND_API_KEY`.
5. Opcional: `EMAIL_FROM` para cambiar el remitente (por defecto `Acreditaciones <acreditaciones@carolinacobas.com>`).

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
