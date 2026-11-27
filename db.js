const { Pool } = require("pg");

// Quita espacios/comillas que a veces se pegan al copiar en Railway.
function normalizarUrl(valor) {
  if (valor == null) return null;
  let url = String(valor).trim();
  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim();
  }
  return url || null;
}

function urlBaseDatos() {
  return (
    normalizarUrl(process.env.DATABASE_URL) ||
    normalizarUrl(process.env.DATABASE_PRIVATE_URL) ||
    normalizarUrl(process.env.POSTGRES_URL) ||
    normalizarUrl(process.env.POSTGRES_PRIVATE_URL)
  );
}

function urlEsquema() {
  return (
    normalizarUrl(process.env.DATABASE_URL_UNPOOLED) ||
    normalizarUrl(process.env.DATABASE_URL_DIRECT) ||
    urlBaseDatos()
  );
}

// Con DATABASE_URL (Neon) se conecta por SSL; sin ella usa el Postgres local de
// docker-compose. sslmode/channel_binding de la URL se reemplazan por `ssl: true`.
function configuracionConexion(url) {
  if (!url) {
    return {
      host: process.env.DB_HOST || "postgres_db",
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || "user",
      password: process.env.DB_PASSWORD || "password",
      database: process.env.DB_NAME || "mydb",
    };
  }
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("channel_binding");
  return { connectionString: parsed.toString(), ssl: true };
}

function crearPool(url, opciones = {}) {
  const pool = new Pool({
    ...configuracionConexion(url),
    connectionTimeoutMillis: 10000,
    ...opciones,
  });
  pool.on("error", (err) => {
    console.error("Conexión con la base de datos perdida:", err.message);
  });
  return pool;
}

const databaseUrl = urlBaseDatos();
if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) {
  if (!databaseUrl) {
    console.error(
      "Falta DATABASE_URL en Variables del servicio Railway. " +
        "Agrégala (Neon pooled, sin comillas) y redespliega.",
    );
    process.exit(1);
  }
  console.log("DATABASE_URL detectada en Railway (Neon).");
} else if (databaseUrl) {
  console.log("DATABASE_URL detectada (Neon).");
} else {
  console.log(
    "Sin DATABASE_URL: usando Postgres local (DB_HOST/postgres_db).",
  );
}

const pool = crearPool(databaseUrl);

function crearPoolEsquema() {
  return crearPool(urlEsquema(), { max: 1 });
}

module.exports = pool;
module.exports.crearPoolEsquema = crearPoolEsquema;
module.exports.urlBaseDatos = urlBaseDatos;
