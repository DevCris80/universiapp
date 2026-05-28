# Migración a PostgreSQL (NeonDB) + Deploy en Vercel

## Resumen de cambios

| Archivo | Cambio |
|---------|--------|
| `package.json` | `better-sqlite3` → `pg` + `connect-pg-simple` |
| `db.js` | Reesrito completo: `pg.Pool` con `DATABASE_URL`, sintaxis PostgreSQL |
| `server.js` | Queries asíncronas (`async/await`), placeholders `$1`, export para Vercel |
| `api/index.js` | **Nuevo** — entrypoint serverless que importa la app Express |
| `vercel.json` | **Nuevo** — configuración de rutas y build para Vercel |

---

## 1. NeonDB — Crear base de datos

1. Ve a [neon.tech](https://neon.tech) e inicia sesión
2. Crea un proyecto nuevo
3. Copia la **connection string** (se ve así):
   ```
   postgresql://usuario:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

---

## 2. Variables de entorno (Vercel)

En el dashboard de Vercel → Settings → Environment Variables, agrega:

| Variable | Valor |
|----------|-------|
| `DATABASE_URL` | Connection string de NeonDB |
| `SESSION_SECRET` | String aleatorio (ej: `openssl rand -hex 32`) |
| `NODE_ENV` | `production` |

---

## 3. Desplegar en Vercel

### Prerrequisitos
- Repositorio en GitHub/GitLab
- Cuenta en Vercel

### Pasos

```bash
# 1. Subir a GitHub
cd universi-app
git init
git add .
git commit -m "Migracion a PostgreSQL + Vercel"
git remote add origin https://github.com/tu-usuario/universi-app.git
git push -u origin main

# 2. En Vercel:
#    - Importar repositorio
#    - Framework: Other
#    - Root Directory: universi-app/
#    - Build Command: (dejar vacío)
#    - Output Directory: (dejar vacío)
#    - Agregar variables de entorno
#    - Deploy
```

### Estructura final del repo

```
universi-app/
├── api/
│   └── index.js          ← Entrypoint serverless
├── public/
├── views/
├── db.js
├── server.js
├── vercel.json
├── package.json
└── MIGRACION.md
```

---

## 4. Probar localmente

```bash
# Instalar dependencias
npm install

# Crear archivo .env (no lo subas a git)
DATABASE_URL=postgresql://...
SESSION_SECRET=un-secreto

# Iniciar
npm run dev
```

---

## 5. Notas técnicas

### Base de datos
- Las tablas se crean automáticamente al iniciar (`db.js:initDB`)
- Las sesiones Express se guardan en PostgreSQL (`connect-pg-simple`)
- Los placeholders cambian de `?` a `$1, $2, ...`
- Los IDs ahora son `SERIAL` (autoincremental de PostgreSQL)
- El tipo `BOOLEAN` reemplaza a `INTEGER` para `activo`
- Las fechas usan `TIMESTAMP` con `CURRENT_TIMESTAMP`

### Vercel Serverless
- `api/index.js` exporta la app Express
- `vercel.json` redirige todo el tráfico a `api/index.js`
- El serverless runtime de Vercel (Node.js) ejecuta Express sin modificaciones

### Sesiones
- Ya no funciona en memoria (Vercel es stateless)
- Se migra a `connect-pg-simple` que guarda sesiones en PostgreSQL
- La tabla `session` se crea automáticamente

### Seguridad
- `SESSION_SECRET` debe ser único en producción
- `DATABASE_URL` nunca debe exponerse en código
- SSL en PostgreSQL está habilitado para NeonDB

---

## 6. Rollback

Si algo sale mal, los archivos originales están en el historial de git:

```bash
git checkout HEAD~1 -- package.json db.js server.js
# Eliminar api/ y vercel.json si se crearon
rm -rf api vercel.json
# Reinstalar SQLite
npm install better-sqlite3
npm uninstall pg connect-pg-simple
```
