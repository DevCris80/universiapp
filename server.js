require('dotenv').config()
const express = require('express')
const session = require('express-session')
const bcrypt = require('bcryptjs')
const path = require('path')
const db = require('./db')
const pgSession = require('connect-pg-simple')(session)

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.set('trust proxy', 1)

app.use(session({
  store: new pgSession({
    pool: db.pool,
    tableName: 'session',
    createTableIfMissing: true,
    errorLog: console.error
  }),
  secret: process.env.SESSION_SECRET || 'universi-app-secret-key-2024',
  resave: true,
  saveUninitialized: true,
  rolling: true,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}))

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login')
  next()
}

async function getUsuario(req) {
  if (!req.session.userId) return null
  const { rows } = await db.query('SELECT id, nombre, telefono, email, created_at FROM usuarios WHERE id = $1', [req.session.userId])
  return rows[0] || null
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function renderView(res, view, data = {}) {
  data.view = view
  res.render(view, data)
}

app.get('/', async (req, res) => {
  renderView(res, 'index', { usuario: await getUsuario(req) })
})

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/')
  renderView(res, 'login', { usuario: null })
})

app.post('/login', async (req, res) => {
  const { email, password } = req.body
  const { rows } = await db.query('SELECT * FROM usuarios WHERE email = $1', [email])
  const usuario = rows[0]
  if (!usuario || !bcrypt.compareSync(password, usuario.password_hash)) {
    return renderView(res, 'login', { usuario: null, error: 'Email o contraseña incorrectos' })
  }
  req.session.userId = usuario.id
  res.redirect('/')
})

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/')
  renderView(res, 'register', { usuario: null })
})

app.post('/register', async (req, res) => {
  const { nombre, email, telefono, password } = req.body
  if (!/^\d{10}$/.test(telefono)) {
    return renderView(res, 'register', { usuario: null, error: 'El teléfono debe tener exactamente 10 dígitos' })
  }
  const { rows: existing } = await db.query('SELECT id FROM usuarios WHERE email = $1', [email])
  if (existing.length > 0) {
    return renderView(res, 'register', { usuario: null, error: 'El email ya está registrado' })
  }
  const hash = bcrypt.hashSync(password, 10)
  const { rows } = await db.query(
    'INSERT INTO usuarios (nombre, telefono, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
    [nombre, telefono, email, hash]
  )
  req.session.userId = rows[0].id
  res.redirect('/')
})

app.get('/viaje/nuevo', requireAuth, async (req, res) => {
  renderView(res, 'crear-viaje', { usuario: await getUsuario(req) })
})

app.post('/viaje/nuevo', requireAuth, async (req, res) => {
  const { lat, lng, direccion, vehiculo, tarifa, hora_salida, tipo_servicio } = req.body
  const cupos = parseInt(req.body.cupos) || (vehiculo === 'moto' ? 1 : 3)
  const ts = ['universidad', 'destino'].includes(tipo_servicio) ? tipo_servicio : 'destino'
  await db.query(
    'INSERT INTO viajes (conductor_id, lat, lng, direccion, vehiculo, tarifa, hora_salida, cupos, tipo_servicio) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [req.session.userId, lat, lng, direccion, vehiculo, tarifa, hora_salida, cupos, ts]
  )
  res.redirect('/perfil')
})

app.get('/viaje/:id', requireAuth, async (req, res) => {
  const { rows } = await db.query(`
    SELECT v.*, u.nombre AS conductor_nombre, u.telefono AS conductor_telefono
    FROM viajes v JOIN usuarios u ON v.conductor_id = u.id
    WHERE v.id = $1
  `, [req.params.id])

  const viaje = rows[0]
  if (!viaje) return renderView(res, 'viaje', { usuario: await getUsuario(req), viaje: null })

  const usuario = await getUsuario(req)
  let telefono = null
  let solicitud_estado = null

  const { rows: solicitudes } = await db.query('SELECT * FROM solicitudes WHERE viaje_id = $1 AND pasajero_id = $2', [viaje.id, usuario.id])
  const solicitud = solicitudes[0]
  if (solicitud) solicitud_estado = solicitud.estado

  const { rows: aceptadas } = await db.query("SELECT * FROM solicitudes WHERE viaje_id = $1 AND estado = $2", [viaje.id, 'aceptada'])
  const solicitudAceptada = aceptadas[0]

  if (solicitudAceptada) {
    if (usuario.id === viaje.conductor_id) {
      const { rows: pasajero } = await db.query('SELECT telefono FROM usuarios WHERE id = $1', [solicitudAceptada.pasajero_id])
      telefono = pasajero[0]?.telefono
    } else if (usuario.id === solicitudAceptada.pasajero_id) {
      telefono = viaje.conductor_telefono
    }
  }

  let solicitudes_pendientes = 0
  if (usuario.id === viaje.conductor_id) {
    const { rows: count } = await db.query("SELECT COUNT(*) AS c FROM solicitudes WHERE viaje_id = $1 AND estado = 'pendiente'", [viaje.id])
    solicitudes_pendientes = parseInt(count[0].c)
  }

  const puede_editar = usuario.id === viaje.conductor_id && viaje.activo === true && !solicitudAceptada
  const puede_cancelar = solicitudAceptada && (usuario.id === viaje.conductor_id || usuario.id === solicitudAceptada.pasajero_id)
  const puede_eliminar = usuario.id === viaje.conductor_id && !solicitudAceptada

  renderView(res, 'viaje', { usuario, viaje, telefono, solicitud_estado, solicitudes_pendientes, puede_editar, puede_cancelar, puede_eliminar })
})

app.post('/viaje/:id/solicitar', requireAuth, async (req, res) => {
  const viajeId = req.params.id
  const { rows } = await db.query('SELECT * FROM viajes WHERE id = $1 AND activo = TRUE', [viajeId])
  if (rows.length === 0) return res.redirect('/')

  const { rows: existing } = await db.query('SELECT id FROM solicitudes WHERE viaje_id = $1 AND pasajero_id = $2', [viajeId, req.session.userId])
  if (existing.length > 0) return res.redirect(`/viaje/${viajeId}`)

  await db.query('INSERT INTO solicitudes (viaje_id, pasajero_id) VALUES ($1, $2)', [viajeId, req.session.userId])
  res.redirect(`/viaje/${viajeId}`)
})

app.post('/viaje/:id/responder', requireAuth, async (req, res) => {
  const { solicitud_id, accion } = req.body
  const { rows } = await db.query(`
    SELECT s.* FROM solicitudes s
    JOIN viajes v ON s.viaje_id = v.id
    WHERE s.id = $1 AND v.conductor_id = $2 AND s.estado = 'pendiente'
  `, [solicitud_id, req.session.userId])

  if (rows.length === 0) return res.redirect('/perfil')
  const solicitud = rows[0]

  if (accion === 'aceptar') {
    await db.query('UPDATE solicitudes SET estado = $1 WHERE id = $2', ['aceptada', solicitud_id])
    await db.query('UPDATE solicitudes SET estado = $1 WHERE viaje_id = $2 AND id != $3 AND estado = $4', ['rechazada', solicitud.viaje_id, solicitud_id, 'pendiente'])
    await db.query('UPDATE viajes SET activo = FALSE WHERE id = $1', [solicitud.viaje_id])
  } else {
    await db.query('UPDATE solicitudes SET estado = $1 WHERE id = $2', ['rechazada', solicitud_id])
  }

  res.redirect('/perfil')
})

app.get('/viaje/:id/editar', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM viajes WHERE id = $1 AND conductor_id = $2 AND activo = TRUE', [req.params.id, req.session.userId])
  const viaje = rows[0]
  if (!viaje) return res.redirect('/perfil')
  renderView(res, 'editar-viaje', { usuario: await getUsuario(req), viaje })
})

app.post('/viaje/:id/editar', requireAuth, async (req, res) => {
  const { rows: viajes } = await db.query('SELECT * FROM viajes WHERE id = $1 AND conductor_id = $2 AND activo = TRUE', [req.params.id, req.session.userId])
  const viaje = viajes[0]
  if (!viaje) return res.redirect('/perfil')

  const { rows: aceptada } = await db.query("SELECT id FROM solicitudes WHERE viaje_id = $1 AND estado = 'aceptada'", [viaje.id])
  if (aceptada.length > 0) return res.redirect('/perfil')

  const { lat, lng, direccion, vehiculo, tarifa, hora_salida, cupos, tipo_servicio } = req.body
  const ts = ['universidad', 'destino'].includes(tipo_servicio) ? tipo_servicio : viaje.tipo_servicio
  await db.query(
    'UPDATE viajes SET lat = $1, lng = $2, direccion = $3, vehiculo = $4, tarifa = $5, hora_salida = $6, cupos = $7, tipo_servicio = $8 WHERE id = $9',
    [lat, lng, direccion, vehiculo, tarifa, hora_salida, cupos, ts, viaje.id]
  )
  res.redirect('/perfil')
})

app.post('/viaje/:id/cancelar', requireAuth, async (req, res) => {
  const viajeId = req.params.id
  const usuarioId = req.session.userId

  const { rows } = await db.query(`
    SELECT s.*, v.conductor_id FROM solicitudes s
    JOIN viajes v ON s.viaje_id = v.id
    WHERE s.viaje_id = $1 AND s.estado = 'aceptada'
  `, [viajeId])

  const solicitud = rows[0]
  if (!solicitud) return res.redirect(`/viaje/${viajeId}`)

  const esConductor = solicitud.conductor_id === usuarioId
  const esPasajero = solicitud.pasajero_id === usuarioId
  if (!esConductor && !esPasajero) return res.redirect(`/viaje/${viajeId}`)

  await db.query("UPDATE solicitudes SET estado = 'cancelada' WHERE id = $1", [solicitud.id])
  await db.query('UPDATE viajes SET activo = TRUE, cupos = cupos + 1 WHERE id = $1', [viajeId])

  res.redirect('/perfil')
})

app.post('/viaje/:id/eliminar', requireAuth, async (req, res) => {
  const { rows: viajes } = await db.query('SELECT * FROM viajes WHERE id = $1 AND conductor_id = $2', [req.params.id, req.session.userId])
  if (viajes.length === 0) return res.redirect('/perfil')

  const { rows: aceptada } = await db.query("SELECT id FROM solicitudes WHERE viaje_id = $1 AND estado = 'aceptada'", [req.params.id])
  if (aceptada.length > 0) return res.redirect('/perfil')

  await db.query('DELETE FROM solicitudes WHERE viaje_id = $1', [req.params.id])
  await db.query('DELETE FROM viajes WHERE id = $1', [req.params.id])

  res.redirect('/perfil')
})

app.get('/api/geocode', async (req, res) => {
  const { lat, lng } = req.query
  if (!lat || !lng) return res.json({ error: 'lat y lng requeridos' })
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es`, {
      headers: { 'User-Agent': 'UniversiApp/1.0' }
    })
    if (!response.ok) return res.json({ error: 'Nominatim no disponible', display_name: `${lat}, ${lng}` })
    const data = await response.json()
    res.json(data)
  } catch {
    res.json({ error: 'Error de geocodificación', display_name: `${lat}, ${lng}` })
  }
})

app.get('/api/viajes', async (req, res) => {
  const { lat, lng } = req.query
  const { rows: viajes } = await db.query(`
    SELECT v.*, u.nombre AS conductor_nombre, u.telefono AS conductor_telefono,
      (SELECT COUNT(*) FROM solicitudes WHERE viaje_id = v.id AND estado = 'aceptada') AS aceptadas_count
    FROM viajes v JOIN usuarios u ON v.conductor_id = u.id
    WHERE v.activo = TRUE
    ORDER BY v.created_at DESC
  `)

  let filtered = viajes
  if (lat && lng) {
    const latNum = parseFloat(lat)
    const lngNum = parseFloat(lng)
    filtered = viajes.filter(v => haversine(latNum, lngNum, v.lat, v.lng) <= 100)
  }

  const viajesConCupos = filtered.filter(v => parseInt(v.aceptadas_count) < v.cupos)
  res.json(viajesConCupos)
})

app.get('/perfil', requireAuth, async (req, res) => {
  const usuario = await getUsuario(req)

  const { rows: viajesCreados } = await db.query(`
    SELECT v.*,
      (SELECT COUNT(*) FROM solicitudes WHERE viaje_id = v.id) AS solicitudes_count
    FROM viajes v WHERE v.conductor_id = $1 ORDER BY v.created_at DESC
  `, [usuario.id])

  const { rows: solicitudesRecibidas } = await db.query(`
    SELECT s.*, u.nombre AS pasajero_nombre, u.telefono AS pasajero_telefono, v.direccion, v.conductor_id
    FROM solicitudes s
    JOIN viajes v ON s.viaje_id = v.id
    JOIN usuarios u ON s.pasajero_id = u.id
    WHERE v.conductor_id = $1
    ORDER BY s.created_at DESC
  `, [usuario.id])

  const { rows: solicitudesEnviadas } = await db.query(`
    SELECT s.*, u.nombre AS conductor_nombre, u.telefono AS conductor_telefono, v.direccion
    FROM solicitudes s
    JOIN viajes v ON s.viaje_id = v.id
    JOIN usuarios u ON v.conductor_id = u.id
    WHERE s.pasajero_id = $1
    ORDER BY s.created_at DESC
  `, [usuario.id])

  renderView(res, 'perfil', { usuario, viajesCreados, solicitudesRecibidas, solicitudesEnviadas })
})

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'))
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`UniversiApp corriendo en http://localhost:${PORT}`)
  })
}

module.exports = app
