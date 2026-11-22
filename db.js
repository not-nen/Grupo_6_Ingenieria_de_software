const { Pool } = require('pg');

// Con DATABASE_URL (Neon) se conecta por SSL; sin ella usa el Postgres local de
// docker-compose. sslmode/channel_binding de la URL se reemplazan por `ssl: true`,
// que ya verifica el certificado del servidor.
function configuracionConexion(url) {
  if (!url) {
    return {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    };
  }
  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('channel_binding');
  return { connectionString: parsed.toString(), ssl: true };
}

function crearPool(url, opciones = {}) {
  const pool = new Pool({
    ...configuracionConexion(url),
    // Holgura para el arranque en frío de Neon tras suspenderse por inactividad.
    connectionTimeoutMillis: 10000,
    ...opciones,
  });
  // Sin este listener, una conexión inactiva que se corta (p. ej. la BD se detiene
  // o Neon suspende el cómputo) emite un 'error' no manejado y termina Node.
  pool.on('error', (err) => {
    console.error('Conexión con la base de datos perdida:', err.message);
  });
  return pool;
}

// Tráfico de la app: conexión con pooling de Neon (PgBouncer).
const pool = crearPool(process.env.DATABASE_URL);

// DDL y migraciones van por la conexión directa: PgBouncer en modo transacción
// no conserva estado de sesión entre consultas.
function crearPoolEsquema() {
  return crearPool(
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
    { max: 1 },
  );
}

module.exports = pool;
module.exports.crearPoolEsquema = crearPoolEsquema;
