const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function initDB() {
  try {
    const client = await pool.connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id SERIAL PRIMARY KEY,
          nombre VARCHAR(255) NOT NULL,
          telefono VARCHAR(50) NOT NULL,
          email VARCHAR(255) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)

      await client.query(`
        CREATE TABLE IF NOT EXISTS viajes (
          id SERIAL PRIMARY KEY,
          conductor_id INTEGER NOT NULL REFERENCES usuarios(id),
          lat DOUBLE PRECISION NOT NULL,
          lng DOUBLE PRECISION NOT NULL,
          direccion VARCHAR(500) NOT NULL,
          vehiculo VARCHAR(10) NOT NULL CHECK(vehiculo IN ('moto', 'carro')),
          tarifa DOUBLE PRECISION NOT NULL,
          hora_salida VARCHAR(20) NOT NULL,
          cupos INTEGER NOT NULL CHECK(cupos > 0),
          tipo_servicio VARCHAR(20) NOT NULL DEFAULT 'destino' CHECK(tipo_servicio IN ('universidad', 'destino')),
          activo BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)

      await client.query(`
        CREATE TABLE IF NOT EXISTS solicitudes (
          id SERIAL PRIMARY KEY,
          viaje_id INTEGER NOT NULL REFERENCES viajes(id),
          pasajero_id INTEGER NOT NULL REFERENCES usuarios(id),
          estado VARCHAR(15) NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'aceptada', 'rechazada', 'cancelada')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('Error al inicializar la base de datos:', err)
  }
}

initDB()

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params)
}
