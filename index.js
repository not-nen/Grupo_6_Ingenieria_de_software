const express = require("express");
const pool = require("./db"); // Importar la conexión
const { crearPoolEsquema } = require("./db");
const {
  enviarCorreoSeleccion,
  enviarCorreoAceptacion,
  enviarCorreoRechazo,
  enviarCorreoCierreAceptado,
} = require("./mailer");
const app = express();
const port = 3000;
const path = require("path");
const fs = require("fs");
const multer = require("multer");

// Solo se lee para migrar postulaciones antiguas que guardaban el archivo en disco.
const uploadsLegadoDir = path.join(__dirname, "pagina", "uploads");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Páginas HTML protegidas por rol (incluye las que servirían express.static).
const PAGINAS_CON_SESION = {
  "/estudiante": "estudiante",
  "/profesor": "profesor",
  "/admin": "administrador",
  "/postula-docente": "estudiante",
  "/postula-administrativa": "estudiante",
  "/ayudantias-disponibles.html": "estudiante",
  "/ayudantias-disponibles": "estudiante",
};

app.use((req, res, next) => {
  const role = PAGINAS_CON_SESION[req.path];
  if (!role) return next();
  if (!getCurrentUserFromRequest(req, role)) {
    return res.redirect("/");
  }
  return next();
});

app.use(express.static(path.join(__dirname, "pagina")));

async function initDb() {
  const db = crearPoolEsquema();
  try {
    await crearEsquema(db);
  } finally {
    await db.end();
  }
}

async function crearEsquema(db) {
  await db.query(`
    DO $$
    BEGIN
      IF to_regclass('public.ayudante') IS NOT NULL
         AND to_regclass('public.estudiante') IS NULL THEN
        ALTER TABLE ayudante RENAME TO estudiante;
      END IF;
    END $$;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS estudiante (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      password VARCHAR(160) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS profesor (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      password VARCHAR(160) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ayudantias_docente (
      id SERIAL PRIMARY KEY,
      codigo VARCHAR(30) UNIQUE NOT NULL,
      asignatura VARCHAR(120) NOT NULL,
      emplazamiento VARCHAR(120) NOT NULL,
      departamento VARCHAR(120) NOT NULL,
      paralelo VARCHAR(20),
      categoria VARCHAR(80) NOT NULL,
      tipo_ayudantia VARCHAR(60) NOT NULL DEFAULT 'Docente',
      inicio DATE NOT NULL,
      termino DATE NOT NULL,
      horas INTEGER NOT NULL,
      info VARCHAR(120) DEFAULT 'Ver',
      estado VARCHAR(40) NOT NULL DEFAULT 'Disponible',
      fecha_estado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ayudantias_administrativas (
      id SERIAL PRIMARY KEY,
      codigo VARCHAR(30) UNIQUE NOT NULL,
      modificado BOOLEAN DEFAULT false,
      glosa VARCHAR(140) NOT NULL,
      emplazamiento VARCHAR(120) NOT NULL,
      departamento VARCHAR(120) NOT NULL,
      tipo_ayudantia VARCHAR(60) NOT NULL,
      inicio DATE NOT NULL,
      termino DATE NOT NULL,
      horas INTEGER NOT NULL,
      info VARCHAR(120) DEFAULT 'Ver',
      estado VARCHAR(40) NOT NULL DEFAULT 'Disponible',
      fecha_estado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS postulaciones_docente (
      id SERIAL PRIMARY KEY,
      ayudantia_docente_id INTEGER NOT NULL REFERENCES ayudantias_docente(id) ON DELETE RESTRICT,
      ayudante_id INTEGER NOT NULL REFERENCES estudiante(id) ON DELETE RESTRICT,
      motivacion TEXT NOT NULL,
      archivos JSONB NOT NULL DEFAULT '[]'::jsonb,
      estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente',
      respuesta VARCHAR(120) NOT NULL DEFAULT 'Pendiente',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      fecha_estado TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS postulaciones_administrativas (
      id SERIAL PRIMARY KEY,
      ayudantia_administrativa_id INTEGER NOT NULL REFERENCES ayudantias_administrativas(id) ON DELETE RESTRICT,
      ayudante_id INTEGER NOT NULL REFERENCES estudiante(id) ON DELETE RESTRICT,
      motivacion TEXT NOT NULL,
      archivos JSONB NOT NULL DEFAULT '[]'::jsonb,
      estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente',
      respuesta VARCHAR(120) NOT NULL DEFAULT 'Pendiente',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      fecha_estado TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS notificaciones_estudiante (
      id SERIAL PRIMARY KEY,
      ayudante_id INTEGER NOT NULL REFERENCES estudiante(id) ON DELETE CASCADE,
      mensaje TEXT NOT NULL,
      leida BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS administrador (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      password VARCHAR(160) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    ALTER TABLE postulaciones_docente
      ADD COLUMN IF NOT EXISTS archivos JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await db.query(`
    ALTER TABLE postulaciones_administrativas
      ADD COLUMN IF NOT EXISTS archivos JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await db.query(`
    ALTER TABLE ayudantias_docente
      ADD COLUMN IF NOT EXISTS profesor_id INTEGER REFERENCES profesor(id) ON DELETE SET NULL
  `);
  await db.query(`
    ALTER TABLE ayudantias_administrativas
      ADD COLUMN IF NOT EXISTS profesor_id INTEGER REFERENCES profesor(id) ON DELETE SET NULL
  `);

  await migrarEsquema(db);

  // Nota: se removieron los inserts "semilla" de ayudantías.
  // La base queda vacía hasta que se creen ayudantías vía UI/SQL/import.
  await seedDocenteFromFormatoIfEmpty(db);
  await seedAdministrativaFromFormatoIfEmpty(db);
  await crearCuentasBase(db);
}

// Cuentas para entrar rápido a cada vista durante el desarrollo.
const PASSWORD_CUENTAS_BASE = "1234";
const CUENTAS_BASE = {
  estudiante: [
    ["Estudiante A", "estudiante1@gmail.com"],
    ["Estudiante B", "estudiante2@gmail.com"],
  ],
  profesor: [
    ["Profesor A", "profesor1@gmail.com"],
    ["Profesor B", "profesor2@gmail.com"],
  ],
  administrador: [["Admin A", "admin1@gmail.com"]],
};

async function crearCuentasBase(db) {
  for (const [role, cuentas] of Object.entries(CUENTAS_BASE)) {
    const { table } = getRoleConfig(role);
    for (const [nombre, email] of cuentas) {
      await db.query(
        `INSERT INTO ${table} (nombre, email, password) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING`,
        [nombre, email, PASSWORD_CUENTAS_BASE],
      );
    }
  }
}

const MIME_POR_EXTENSION = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

async function columnasDe(client, tabla) {
  const result = await client.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tabla],
  );
  return new Map(
    result.rows.map((col) => [col.column_name, col.is_nullable === "YES"]),
  );
}

async function importarArchivosDeUploads(client, tabla) {
  const pendientes = await client.query(
    `SELECT id, documentos FROM ${tabla}
     WHERE jsonb_array_length(archivos) = 0 AND documentos <> 'Sin archivos adjuntos'`,
  );
  for (const fila of pendientes.rows) {
    const nombre = path.basename(fila.documentos);
    const ruta = path.join(uploadsLegadoDir, nombre);
    if (!fs.existsSync(ruta)) {
      console.warn(
        `Migración: no existe ${ruta}; ${tabla} #${fila.id} queda sin archivo adjunto`,
      );
      continue;
    }
    const contenido = fs.readFileSync(ruta);
    const archivo = {
      nombre,
      mime:
        MIME_POR_EXTENSION[path.extname(nombre).toLowerCase()] ||
        "application/octet-stream",
      tamano: contenido.length,
      contenido: contenido.toString("base64"),
    };
    await client.query(`UPDATE ${tabla} SET archivos = $2::jsonb WHERE id = $1`, [
      fila.id,
      JSON.stringify([archivo]),
    ]);
  }
}

const CODIGO_ON_DELETE = { CASCADE: "c", RESTRICT: "r" };

async function asegurarFk(client, tabla, columna, tablaReferida, onDelete) {
  const deseado = CODIGO_ON_DELETE[onDelete];
  const fks = await client.query(
    `SELECT c.conname, c.confdeltype
     FROM pg_constraint c
     JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ANY (c.conkey)
     WHERE c.conrelid = $1::regclass AND c.contype = 'f' AND att.attname = $2`,
    [tabla, columna],
  );
  // Solo se considera lista si TODAS las FK de la columna ya tienen el ON DELETE pedido.
  if (
    fks.rowCount > 0 &&
    fks.rows.every((fk) => fk.confdeltype === deseado)
  ) {
    return;
  }
  for (const fk of fks.rows) {
    await client.query(`ALTER TABLE ${tabla} DROP CONSTRAINT "${fk.conname}"`);
  }
  await client.query(
    `ALTER TABLE ${tabla} ADD CONSTRAINT ${tabla}_${columna}_fkey
     FOREIGN KEY (${columna}) REFERENCES ${tablaReferida}(id) ON DELETE ${onDelete}`,
  );
  console.log(
    `Migración: FK ${tabla}.${columna} → ${tablaReferida}(id) ON DELETE ${onDelete}`,
  );
}

// Si hay filas antiguas que no cumplen la regla, la app igual arranca: la restricción
// queda NOT VALID (solo aplica a filas nuevas o modificadas) y se reintenta validar en cada arranque.
async function asegurarRestriccion(client, tabla, nombre, definicion) {
  const existente = await client.query(
    "SELECT convalidated FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass",
    [nombre, tabla],
  );
  if (existente.rows[0]?.convalidated) return;
  if (existente.rowCount === 0) {
    await client.query(
      `ALTER TABLE ${tabla} ADD CONSTRAINT ${nombre} ${definicion} NOT VALID`,
    );
  }
  await client.query("SAVEPOINT validar_restriccion");
  try {
    await client.query(`ALTER TABLE ${tabla} VALIDATE CONSTRAINT ${nombre}`);
    await client.query("RELEASE SAVEPOINT validar_restriccion");
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT validar_restriccion");
    console.warn(
      `Migración: hay filas de ${tabla} que no cumplen ${nombre}; la regla se aplicará solo a datos nuevos`,
    );
  }
}

// Nombre y email del estudiante se obtienen de `estudiante` vía ayudante_id.
async function vincularEstudiante(client, tabla, columnas, onDelete) {
  if (columnas.has("email_estudiante")) {
    await client.query(
      `UPDATE ${tabla} t SET ayudante_id = e.id
       FROM estudiante e
       WHERE t.ayudante_id IS NULL AND e.email = LOWER(TRIM(t.email_estudiante))`,
    );
  }
  if (columnas.get("ayudante_id")) {
    const huerfanas = await client.query(
      `DELETE FROM ${tabla} WHERE ayudante_id IS NULL`,
    );
    if (huerfanas.rowCount > 0) {
      console.warn(
        `Migración: se eliminaron ${huerfanas.rowCount} fila(s) de ${tabla} sin estudiante registrado`,
      );
    }
    await client.query(
      `ALTER TABLE ${tabla} ALTER COLUMN ayudante_id SET NOT NULL`,
    );
  }

  await asegurarFk(client, tabla, "ayudante_id", "estudiante", onDelete);

  if (columnas.has("email_estudiante")) {
    await client.query(
      `ALTER TABLE ${tabla}
       DROP COLUMN IF EXISTS nombre_estudiante,
       DROP COLUMN IF EXISTS email_estudiante`,
    );
  }
}

// Si un estudiante postuló más de una vez a la misma ayudantía, conserva la postulación
// más avanzada en el proceso (y entre iguales, la más reciente).
async function asegurarPostulacionUnica(client, tabla, columnaAyudantia) {
  const indice = `${tabla}_unica`;
  const existe = await client.query("SELECT to_regclass($1) AS oid", [indice]);
  if (existe.rows[0].oid) return;

  const duplicadas = await client.query(
    `DELETE FROM ${tabla} WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY ${columnaAyudantia}, ayudante_id
           ORDER BY CASE estado
                      WHEN 'Aceptado' THEN 0
                      WHEN 'Seleccionado entrevista' THEN 1
                      WHEN 'Pendiente' THEN 2
                      ELSE 3
                    END,
                    created_at DESC, id DESC
         ) AS orden
         FROM ${tabla}
       ) ranking
       WHERE orden > 1
     )`,
  );
  if (duplicadas.rowCount > 0) {
    console.warn(
      `Migración: se eliminaron ${duplicadas.rowCount} postulación(es) repetida(s) de ${tabla}`,
    );
  }
  await client.query(
    `CREATE UNIQUE INDEX ${indice} ON ${tabla} (${columnaAyudantia}, ayudante_id)`,
  );
}

// Combinaciones válidas de estado/respuesta según las transiciones de TRANSICIONES_POSTULACION.
const REGLA_ESTADO_POSTULACION = `CHECK (
  (estado = 'Pendiente' AND respuesta = 'Pendiente') OR
  (estado = 'Seleccionado entrevista' AND respuesta = 'Entrevista') OR
  (estado = 'Aceptado' AND respuesta = 'Aceptado') OR
  (estado = 'Rechazado' AND respuesta IN ('Pendiente', 'Entrevista', 'Rechazado'))
)`;

const INDICE_RAMO_ABIERTO = "ayudantias_docente_asignatura_paralelo_disponible";

async function asegurarReglasAyudantia(client, tabla) {
  if ((await columnasDe(client, tabla)).get("estado")) {
    await client.query(
      `UPDATE ${tabla} SET estado = 'Disponible' WHERE estado IS NULL`,
    );
    await client.query(`ALTER TABLE ${tabla} ALTER COLUMN estado SET NOT NULL`);
  }
  await asegurarRestriccion(
    client,
    tabla,
    `${tabla}_estado_valido`,
    "CHECK (estado IN ('Disponible', 'Cerrada'))",
  );
  await asegurarRestriccion(client, tabla, `${tabla}_horas_positivas`, "CHECK (horas > 0)");
  await asegurarRestriccion(
    client,
    tabla,
    `${tabla}_fechas_validas`,
    "CHECK (termino >= inicio)",
  );
}

async function asegurarRamoAbiertoUnico(client) {
  const existe = await client.query("SELECT to_regclass($1) AS oid", [
    INDICE_RAMO_ABIERTO,
  ]);
  if (existe.rows[0].oid) return;
  await client.query("SAVEPOINT indice_ramo_abierto");
  try {
    await client.query(
      `CREATE UNIQUE INDEX ${INDICE_RAMO_ABIERTO}
       ON ayudantias_docente (asignatura, paralelo) WHERE estado = 'Disponible'`,
    );
    await client.query("RELEASE SAVEPOINT indice_ramo_abierto");
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT indice_ramo_abierto");
    console.warn(
      "Migración: hay ayudantías docentes abiertas con la misma asignatura y paralelo; cierra o elimina las repetidas para activar la regla",
    );
  }
}

// Bloquear la fila del estudiante serializa postulaciones y aceptaciones concurrentes del
// mismo estudiante, así dos profesores que aceptan a la vez no lo dejan sobre el máximo.
// Solo revisa operaciones nuevas: no toca a quien ya estuviera sobre el máximo.
async function asegurarLimiteAyudantias(client) {
  await client.query(`
    CREATE OR REPLACE FUNCTION verificar_limite_ayudantias() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'UPDATE'
         AND NOT (NEW.estado = 'Aceptado' AND OLD.estado IS DISTINCT FROM 'Aceptado') THEN
        RETURN NEW;
      END IF;
      PERFORM 1 FROM estudiante WHERE id = NEW.ayudante_id FOR NO KEY UPDATE;
      IF ${sqlAyudantiasAceptadas("NEW.ayudante_id")} >= ${MAX_AYUDANTIAS_ACEPTADAS} THEN
        RAISE EXCEPTION 'El estudiante ya es ayudante en % ramos, el máximo permitido',
          ${MAX_AYUDANTIAS_ACEPTADAS}
          USING ERRCODE = 'check_violation', CONSTRAINT = '${RESTRICCION_LIMITE_AYUDANTIAS}';
      END IF;
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql
  `);
  for (const { tablaPostulaciones: tabla } of Object.values(FUENTES_POSTULACION)) {
    await client.query(
      `CREATE OR REPLACE TRIGGER ${tabla}_limite_ayudantias
       BEFORE INSERT OR UPDATE OF estado ON ${tabla}
       FOR EACH ROW EXECUTE FUNCTION verificar_limite_ayudantias()`,
    );
  }
}

// Migra bases creadas con versiones anteriores (columnas que repetían datos, postulaciones
// repetidas, estados y fechas sin validar) y asegura las reglas de integridad.
async function migrarEsquema(db) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    for (const {
      tablaPostulaciones: tabla,
      tablaAyudantias,
      columnaAyudantia,
    } of Object.values(FUENTES_POSTULACION)) {
      const columnas = await columnasDe(client, tabla);
      if (columnas.has("archivo_contenido")) {
        await client.query(
          `UPDATE ${tabla}
           SET archivos = jsonb_build_array(jsonb_build_object(
             'nombre', archivo_nombre,
             'mime', COALESCE(archivo_mime, 'application/octet-stream'),
             'tamano', octet_length(archivo_contenido),
             'contenido', encode(archivo_contenido, 'base64')
           ))
           WHERE archivo_contenido IS NOT NULL AND jsonb_array_length(archivos) = 0`,
        );
        await client.query(
          `ALTER TABLE ${tabla}
           DROP COLUMN IF EXISTS archivo_nombre,
           DROP COLUMN IF EXISTS archivo_mime,
           DROP COLUMN archivo_contenido`,
        );
      }
      if (columnas.has("documentos")) {
        await importarArchivosDeUploads(client, tabla);
        await client.query(`ALTER TABLE ${tabla} DROP COLUMN documentos`);
      }
      await vincularEstudiante(client, tabla, columnas, "RESTRICT");
      await asegurarPostulacionUnica(client, tabla, columnaAyudantia);
      await asegurarFk(client, tabla, columnaAyudantia, tablaAyudantias, "RESTRICT");
      await asegurarRestriccion(
        client,
        tabla,
        `${tabla}_estado_valido`,
        REGLA_ESTADO_POSTULACION,
      );
      await asegurarReglasAyudantia(client, tablaAyudantias);
    }
    await asegurarRamoAbiertoUnico(client);
    await asegurarLimiteAyudantias(client);

    await vincularEstudiante(
      client,
      "notificaciones_estudiante",
      await columnasDe(client, "notificaciones_estudiante"),
      "CASCADE",
    );

    if ((await columnasDe(client, "estudiante")).has("archivos")) {
      await client.query("ALTER TABLE estudiante DROP COLUMN archivos");
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function seedDocenteFromFormatoIfEmpty(db) {
  const count = await db.query(
    "SELECT COUNT(*)::int AS total FROM ayudantias_docente",
  );
  if (count.rows[0].total > 0) return;

  const catalog = loadCatalogoAsignaturas();
  if (!catalog.length) {
    console.warn(
      "No se encontraron ayudantías en ayudantias_docentes_formato.md para cargar.",
    );
    return;
  }

  const defaultDepartamento = "SIN INFORMACIÓN";
  const defaultCategoria = "Docente";
  const defaultInicio = "2026-04-01";
  const defaultTermino = "2026-07-30";

  for (const item of catalog) {
    const codigo = `${item.asignatura}-${item.paralelo}`.slice(0, 30);
    await db.query(
      `INSERT INTO ayudantias_docente
       (codigo, asignatura, emplazamiento, departamento, paralelo, categoria, tipo_ayudantia, inicio, termino, horas, estado)
       VALUES ($1,$2,$3,$4,$5,$6,'Docente',$7,$8,$9,'Disponible')
       ON CONFLICT (codigo) DO NOTHING`,
      [
        codigo,
        item.asignatura,
        item.emplazamiento,
        defaultDepartamento,
        item.paralelo,
        defaultCategoria,
        defaultInicio,
        defaultTermino,
        item.horas,
      ],
    );
  }

  console.log(
    `Seed automático: ${catalog.length} ayudantías docentes desde ayudantias_docentes_formato.md`,
  );
}

function loadCatalogoFromFormatoMd(formatoPath) {
  if (!fs.existsSync(formatoPath)) return [];

  const content = fs.readFileSync(formatoPath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const catalog = [];
  const seen = new Set();

  for (const line of lines) {
    if (
      !line.includes("|") ||
      line.startsWith("Formato:") ||
      line.startsWith("#") ||
      line.startsWith("-")
    ) {
      continue;
    }

    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 4) continue;

    const asignatura = parts[0];
    const emplazamiento = parts[1];
    const paraleloMatch = String(parts[2] ?? "").match(/\d+/);
    const paralelo = paraleloMatch ? paraleloMatch[0] : parts[2];
    const horasMatch = String(parts[3] ?? "").match(/\d+/);
    const horas = horasMatch ? Number.parseInt(horasMatch[0], 10) : 6;
    const key = `${asignatura}::${paralelo}`;

    if (!asignatura || !paralelo || seen.has(key)) continue;
    seen.add(key);
    catalog.push({ asignatura, emplazamiento, paralelo, horas });
  }

  return catalog.sort((a, b) => {
    const byAsignatura = a.asignatura.localeCompare(b.asignatura, "es");
    if (byAsignatura !== 0) return byAsignatura;
    return Number(a.paralelo) - Number(b.paralelo);
  });
}

function loadCatalogoAsignaturas() {
  return loadCatalogoFromFormatoMd(
    path.join(
      __dirname,
      "pagina",
      "scriptFetcheoRamos",
      "ayudantias_docentes_formato.md",
    ),
  );
}

function loadCatalogoAdministrativas() {
  return loadCatalogoFromFormatoMd(
    path.join(
      __dirname,
      "pagina",
      "scriptFetcheoRamos",
      "ayudantias_administrativas_formato.md",
    ),
  );
}

async function seedAdministrativaFromFormatoIfEmpty(db) {
  const count = await db.query(
    "SELECT COUNT(*)::int AS total FROM ayudantias_administrativas",
  );
  if (count.rows[0].total > 0) return;

  const catalog = loadCatalogoAdministrativas();
  if (!catalog.length) {
    console.warn(
      "No se encontraron ayudantías en ayudantias_administrativas_formato.md para cargar.",
    );
    return;
  }

  const defaultDepartamento = "SIN INFORMACIÓN";
  const defaultTipo = "Administrativa";
  const defaultInicio = "2026-04-01";
  const defaultTermino = "2026-07-30";

  for (const item of catalog) {
    const codigo = `${item.asignatura}-${item.paralelo}`.slice(0, 30);
    const glosa = `${item.asignatura} — Paralelo ${item.paralelo}`;
    await db.query(
      `INSERT INTO ayudantias_administrativas
       (codigo, glosa, emplazamiento, departamento, tipo_ayudantia, inicio, termino, horas, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Disponible')
       ON CONFLICT (codigo) DO NOTHING`,
      [
        codigo,
        glosa,
        item.emplazamiento,
        defaultDepartamento,
        defaultTipo,
        defaultInicio,
        defaultTermino,
        item.horas,
      ],
    );
  }

  console.log(
    `Seed automático: ${catalog.length} ayudantías administrativas desde ayudantias_administrativas_formato.md`,
  );
}

function getRoleConfig(role) {
  if (role === "estudiante") {
    return { table: "estudiante", redirect: "/estudiante" };
  }
  if (role === "profesor") {
    return { table: "profesor", redirect: "/profesor" };
  }
  if (role === "administrador") {
    return { table: "administrador", redirect: "/admin" };
  }
  return null;
}

function conUrlArchivo(rows) {
  return rows.map((item) => {
    const nombres = Array.isArray(item.nombres_archivos)
      ? item.nombres_archivos
      : [];
    const archivos = nombres.map((nombre, indice) => ({
      nombre: nombre || `Archivo ${indice + 1}`,
      url: `/api/profesor/postulaciones/${item.fuente}/${item.postulacion_id}/archivo/${indice}`,
    }));
    return {
      ...item,
      archivos,
      archivo_url: archivos[0] ? archivos[0].url : null,
    };
  });
}

function idsAyudantiaDesdeBody(body) {
  const raw = body.ayudantiaId;
  const lista = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return [
    ...new Set(lista.map((id) => String(id).trim()).filter(Boolean)),
  ];
}

function listaArchivosRequest(req) {
  if (Array.isArray(req.files) && req.files.length > 0) return req.files;
  if (req.file) return [req.file];
  return [];
}

function responderErrorSubida(err, res) {
  if (err.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: "Un archivo supera el límite de 15 MB" });
    return true;
  }
  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    res.status(400).json({ error: "Puedes adjuntar hasta 10 archivos" });
    return true;
  }
  return false;
}

const CODIGOS_SIN_CONEXION_BD = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "57P01",
  "57P02",
  "57P03",
]);

function esErrorDeConexionBD(err) {
  if (!err) return false;
  if (CODIGOS_SIN_CONEXION_BD.has(err.code)) return true;
  if (typeof err.code === "string" && err.code.startsWith("08")) return true;
  return /Connection terminated|timeout exceeded when trying to connect/i.test(
    err.message || "",
  );
}

function responderErrorServidor(res, err, contexto = "Error de servidor") {
  if (esErrorDeConexionBD(err)) {
    console.error(`${contexto}: sin conexión con la base de datos (${err.code || err.message})`);
    return res.status(503).json({
      error:
        "No se pudo conectar con la base de datos. Intenta nuevamente en unos minutos.",
    });
  }
  console.error(`${contexto}:`, err);
  return res.status(500).json({ error: "Error de servidor" });
}

// Devuelve null si la ayudantía ya no está disponible. El FOR SHARE hace que una postulación
// concurrente con el cierre del ramo espere y vuelva a evaluar el estado.
async function insertarPostulacionConArchivos({
  tabla,
  tablaAyudantias,
  columnaAyudantia,
  ayudantiaId,
  estudianteId,
  motivacion,
  files,
}) {
  const payload = files.map((file) => ({
    nombre: file.originalname,
    mime: file.mimetype || "application/octet-stream",
    tamano: file.size,
    contenido: file.buffer.toString("base64"),
  }));
  // Transacción: FOR SHARE solo vale dentro de un BEGIN; si falla, no queda fila parcial.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const insertResult = await client.query(
      `INSERT INTO ${tabla}
       (${columnaAyudantia}, ayudante_id, motivacion, archivos, estado, respuesta)
       SELECT a.id, $2, $3, $4::jsonb, 'Pendiente', 'Pendiente'
       FROM ${tablaAyudantias} a
       WHERE a.id = $1 AND a.estado = 'Disponible'
       FOR SHARE
       RETURNING id`,
      [Number(ayudantiaId), estudianteId, motivacion, JSON.stringify(payload)],
    );
    const id = insertResult.rows[0]?.id ?? null;
    if (id === null) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function getOrderClause(orderBy) {
  if (orderBy === "nombre") return "e.nombre ASC";
  if (orderBy === "estado") return "p.estado ASC, p.created_at DESC";
  return "p.created_at DESC";
}

// Una cookie por rol, para poder tener abiertas a la vez las vistas de estudiante,
// profesor y administrador en el mismo navegador.
function nombreCookieSesion(role) {
  return `sesion_${role}`;
}

function buildCurrentUserCookie(currentUser) {
  return `${nombreCookieSesion(currentUser.role)}=${encodeURIComponent(JSON.stringify(currentUser))}; Path=/; SameSite=Lax`;
}

function getCurrentUserFromRequest(req, role) {
  const prefijo = `${nombreCookieSesion(role)}=`;
  const sesionCookie = (req.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefijo));
  if (!sesionCookie) {
    return null;
  }

  try {
    const currentUser = JSON.parse(
      decodeURIComponent(sesionCookie.substring(prefijo.length)),
    );
    return currentUser?.role === role ? currentUser : null;
  } catch (error) {
    return null;
  }
}

const FUENTES_POSTULACION = {
  docente: {
    tablaPostulaciones: "postulaciones_docente",
    tablaAyudantias: "ayudantias_docente",
    columnaAyudantia: "ayudantia_docente_id",
    columnaNombre: "asignatura",
  },
  administrativa: {
    tablaPostulaciones: "postulaciones_administrativas",
    tablaAyudantias: "ayudantias_administrativas",
    columnaAyudantia: "ayudantia_administrativa_id",
    columnaNombre: "glosa",
  },
};

const ESTADOS_SELECCIONADOS = ["Seleccionado entrevista", "Aceptado"];

// Un estudiante puede ser ayudante (postulación Aceptada) en a lo más 2 ramos, sumando
// docentes y administrativas; con ese máximo ya no puede postular ni ser aceptado.
const MAX_AYUDANTIAS_ACEPTADAS = 2;
const RESTRICCION_LIMITE_AYUDANTIAS = "limite_ayudantias_aceptadas";

function sqlAyudantiasAceptadas(columnaEstudiante) {
  return `((SELECT COUNT(*) FROM postulaciones_docente
            WHERE ayudante_id = ${columnaEstudiante} AND estado = 'Aceptado')
         + (SELECT COUNT(*) FROM postulaciones_administrativas
            WHERE ayudante_id = ${columnaEstudiante} AND estado = 'Aceptado'))::int`;
}

function esErrorLimiteAyudantias(err) {
  return (
    (err.code === "23514" && err.constraint === RESTRICCION_LIMITE_AYUDANTIAS) ||
    /ya es ayudante en \d+ ramos/i.test(err.message || "")
  );
}

async function contarAyudantiasAceptadas(estudianteId) {
  const result = await pool.query(
    `SELECT ${sqlAyudantiasAceptadas("$1")} AS total`,
    [estudianteId],
  );
  return Number(result.rows[0]?.total) || 0;
}

// El rechazo no se informa al estudiante hasta que se cierran las postulaciones del ramo;
// mientras tanto `respuesta` conserva la etapa previa al rechazo.
const SQL_ESTADO_VISIBLE_ESTUDIANTE = `
  CASE
    WHEN p.estado = 'Rechazado' AND a.estado = 'Disponible' THEN
      CASE WHEN p.respuesta = 'Entrevista' THEN 'Seleccionado entrevista' ELSE 'Pendiente' END
    ELSE p.estado
  END AS estado`;

async function obtenerUsuarioConRol(req, role) {
  const currentUser = getCurrentUserFromRequest(req, role);
  const roleConfig = getRoleConfig(role);
  if (!roleConfig || !currentUser || !currentUser.email) {
    return null;
  }
  const result = await pool.query(
    `SELECT id, nombre, email FROM ${roleConfig.table} WHERE email = $1`,
    [String(currentUser.email).trim().toLowerCase()],
  );
  return result.rows[0] || null;
}

async function insertarNotificacion(post, mensaje) {
  try {
    await pool.query(
      `INSERT INTO notificaciones_estudiante (ayudante_id, mensaje) VALUES ($1, $2)`,
      [post.ayudante_id, mensaje],
    );
  } catch (err) {
    console.error("Error al insertar notificación:", err);
  }
}

// `destino(post)` devuelve { estado, respuesta, actualizarFecha } para la postulación actual.
async function cambiarEstadoPostulacion(req, estadosOrigen, destino) {
  const { fuente, postulacionId } = req.body;
  const config = FUENTES_POSTULACION[fuente];
  const id = Number(postulacionId);
  if (!config || !Number.isInteger(id) || id <= 0) {
    return { status: 400, error: "Datos incompletos o no válidos" };
  }

  const profesor = await obtenerUsuarioConRol(req, "profesor");
  if (!profesor) {
    return { status: 401, error: "Debe iniciar sesión como profesor" };
  }

  const actual = await pool.query(
    `SELECT p.id, p.estado, p.respuesta, p.ayudante_id,
            e.nombre AS nombre_estudiante, e.email AS email_estudiante,
            a.${config.columnaNombre} AS asignatura, a.profesor_id, a.estado AS estado_ayudantia
     FROM ${config.tablaPostulaciones} p
     INNER JOIN ${config.tablaAyudantias} a ON a.id = p.${config.columnaAyudantia}
     INNER JOIN estudiante e ON e.id = p.ayudante_id
     WHERE p.id = $1`,
    [id],
  );
  const post = actual.rows[0];
  if (!post) {
    return { status: 404, error: "Postulación no encontrada" };
  }
  if (post.profesor_id !== profesor.id) {
    return {
      status: 403,
      error: "No puedes modificar postulaciones de un ramo que no dictas",
    };
  }
  if (post.estado_ayudantia !== "Disponible") {
    return {
      status: 409,
      error: "Las postulaciones de este ramo ya están cerradas",
    };
  }
  if (!estadosOrigen.includes(post.estado)) {
    return {
      status: 409,
      error: `No se puede realizar esta acción sobre una postulación en estado "${post.estado}"`,
    };
  }

  const { estado, respuesta, actualizarFecha = true } = destino(post);
  if (estado === "Aceptado") {
    const aceptadas = await contarAyudantiasAceptadas(post.ayudante_id);
    if (aceptadas >= MAX_AYUDANTIAS_ACEPTADAS) {
      return {
        status: 409,
        error: `${post.nombre_estudiante} ya es ayudante en ${MAX_AYUDANTIAS_ACEPTADAS} ramos, el máximo permitido`,
      };
    }
  }
  let update;
  try {
    update = await pool.query(
      `UPDATE ${config.tablaPostulaciones}
       SET estado = $2, respuesta = $3${actualizarFecha ? ", fecha_estado = CURRENT_TIMESTAMP" : ""}
       WHERE id = $1 AND estado = $4`,
      [id, estado, respuesta, post.estado],
    );
  } catch (err) {
    if (!esErrorLimiteAyudantias(err)) throw err;
    return {
      status: 409,
      error: `${post.nombre_estudiante} ya es ayudante en ${MAX_AYUDANTIAS_ACEPTADAS} ramos, el máximo permitido`,
    };
  }
  if (update.rowCount === 0) {
    return {
      status: 409,
      error: "La postulación cambió mientras se procesaba, recarga la lista",
    };
  }

  return { post, profesor };
}

// Ruta principal: login
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "pagina", "login.html"));
});

app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "pagina", "registro.html"));
});

app.get("/registro", (req, res) => {
  res.redirect("/register");
});

app.get("/estudiante", (req, res) => {
  res.sendFile(path.join(__dirname, "pagina", "estudiante.html"));
});

app.get("/profesor", (req, res) => {
  res.sendFile(path.join(__dirname, "pagina", "profesor.html"));
});

app.post("/api/register", async (req, res) => {
  try {
    const { role, nombre, email, password } = req.body;
    const roleConfig = getRoleConfig(role);

    if (!roleConfig || !nombre || !email || !password) {
      return res
        .status(400)
        .json({ error: "Datos incompletos o rol no valido" });
    }

    const query = `INSERT INTO ${roleConfig.table} (nombre, email, password) VALUES ($1, $2, $3) RETURNING id`;
    await pool.query(query, [
      nombre.trim(),
      email.trim().toLowerCase(),
      password,
    ]);

    res.setHeader(
      "Set-Cookie",
      buildCurrentUserCookie({
        role,
        nombre: nombre.trim(),
        email: email.trim().toLowerCase(),
      }),
    );

    return res.json({
      ok: true,
      redirect: roleConfig.redirect,
      currentUser: {
        role,
        nombre: nombre.trim(),
        email: email.trim().toLowerCase(),
      },
    });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ error: "El email ya existe para este rol" });
    }
    return responderErrorServidor(res, err);
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { role, email, password } = req.body;
    const roleConfig = getRoleConfig(role);

    if (!roleConfig || !email || !password) {
      return res
        .status(400)
        .json({ error: "Datos incompletos o rol no valido" });
    }

    const query = `SELECT id, nombre, email FROM ${roleConfig.table} WHERE email = $1 AND password = $2`;
    const result = await pool.query(query, [
      email.trim().toLowerCase(),
      password,
    ]);

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Credenciales invalidas" });
    }

    res.setHeader(
      "Set-Cookie",
      buildCurrentUserCookie({
        role,
        nombre: result.rows[0].nombre,
        email: result.rows[0].email,
      }),
    );

    return res.json({
      ok: true,
      redirect: roleConfig.redirect,
      currentUser: {
        role,
        nombre: result.rows[0].nombre,
        email: result.rows[0].email,
      },
    });
  } catch (err) {
    return responderErrorServidor(res, err);
  }
});

app.get("/api/ayudantias/docente", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, codigo, asignatura, emplazamiento, departamento, paralelo, categoria, inicio, termino, horas
      FROM ayudantias_docente
      WHERE estado = 'Disponible'
      ORDER BY asignatura ASC, paralelo ASC
    `);
    return res.json(result.rows);
  } catch (err) {
    return responderErrorServidor(res, err);
  }
});

app.get("/api/ayudantias/administrativa", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, codigo, modificado, glosa, emplazamiento, departamento, tipo_ayudantia, inicio, termino, horas
      FROM ayudantias_administrativas
      WHERE estado = 'Disponible'
      ORDER BY glosa ASC
    `);
    return res.json(result.rows);
  } catch (err) {
    return responderErrorServidor(res, err);
  }
});

app.get("/api/estudiante/postulaciones", async (req, res) => {
  try {
    const currentUser = getCurrentUserFromRequest(req, "estudiante");
    if (!currentUser || !currentUser.email) {
      return res
        .status(401)
        .json({ error: "Debe iniciar sesión para ver sus postulaciones" });
    }

    const email = String(currentUser.email).trim().toLowerCase();

    const docenteResult = await pool.query(
      `SELECT p.id AS postulacion_id,
              'docente' AS fuente,
              'Ayudantía docente' AS tipo_ayudantia,
              a.codigo,
              a.asignatura,
              a.emplazamiento,
              a.departamento,
              a.paralelo,
              a.categoria,
              a.inicio,
              a.termino,
              a.horas,
              a.info,
              ${SQL_ESTADO_VISIBLE_ESTUDIANTE},
              p.respuesta,
              p.fecha_estado,
              p.created_at
       FROM postulaciones_docente p
       INNER JOIN ayudantias_docente a ON a.id = p.ayudantia_docente_id
       INNER JOIN estudiante e ON e.id = p.ayudante_id
       WHERE e.email = $1
       ORDER BY p.created_at DESC`,
      [email],
    );

    const administrativaResult = await pool.query(
      `SELECT p.id AS postulacion_id,
              'administrativa' AS fuente,
              'Ayudantía administrativa' AS tipo_ayudantia,
              a.codigo,
              a.glosa,
              a.modificado,
              a.emplazamiento,
              a.departamento,
              'Ayudantía administrativa' AS tipo_ayudantia,
              a.inicio,
              a.termino,
              a.horas,
              a.info,
              ${SQL_ESTADO_VISIBLE_ESTUDIANTE},
              p.respuesta,
              p.fecha_estado,
              p.created_at
       FROM postulaciones_administrativas p
       INNER JOIN ayudantias_administrativas a ON a.id = p.ayudantia_administrativa_id
       INNER JOIN estudiante e ON e.id = p.ayudante_id
       WHERE e.email = $1
       ORDER BY p.created_at DESC`,
      [email],
    );

    const ayudantiasAceptadas = [
      ...docenteResult.rows,
      ...administrativaResult.rows,
    ].filter((p) => p.estado === "Aceptado").length;

    return res.json({
      docente: docenteResult.rows,
      administrativa: administrativaResult.rows,
      ayudantiasAceptadas,
      maxAyudantiasAceptadas: MAX_AYUDANTIAS_ACEPTADAS,
      currentUser,
    });
  } catch (err) {
    return responderErrorServidor(res, err);
  }
});

for (const [fuente, config] of Object.entries(FUENTES_POSTULACION)) {
  app.post(
    `/api/postulaciones/${fuente}`,
    upload.array("archivos", 10),
    async (req, res) => {
      try {
        const { motivacion } = req.body;
        const ids = idsAyudantiaDesdeBody(req.body);
        const files = listaArchivosRequest(req);

        if (ids.length > 1) {
          return res
            .status(400)
            .json({ error: "Solo puedes postular a una ayudantía por envío" });
        }

        if (!ids.length || !motivacion) {
          return res.status(400).json({ error: "Faltan campos obligatorios" });
        }

        const estudiante = await obtenerUsuarioConRol(req, "estudiante");
        if (!estudiante) {
          return res
            .status(401)
            .json({ error: "Debe iniciar sesión como estudiante para postular" });
        }

        const ayudantiaId = ids[0];
        const ayudantia = await pool.query(
          `SELECT id, estado FROM ${config.tablaAyudantias} WHERE id = $1`,
          [ayudantiaId],
        );
        if (ayudantia.rowCount === 0) {
          return res.status(404).json({ error: "Ayudantía no encontrada" });
        }
        if (ayudantia.rows[0].estado !== "Disponible") {
          return res
            .status(409)
            .json({ error: "Las postulaciones a esta ayudantía están cerradas" });
        }

        const aceptadas = await contarAyudantiasAceptadas(estudiante.id);
        if (aceptadas >= MAX_AYUDANTIAS_ACEPTADAS) {
          return res.status(409).json({
            error: "No puedes postular a más ayudantías",
          });
        }

        const postulacionId = await insertarPostulacionConArchivos({
          tabla: config.tablaPostulaciones,
          tablaAyudantias: config.tablaAyudantias,
          columnaAyudantia: config.columnaAyudantia,
          ayudantiaId,
          estudianteId: estudiante.id,
          motivacion: String(motivacion).trim(),
          files,
        });
        if (postulacionId === null) {
          return res
            .status(409)
            .json({ error: "Las postulaciones a esta ayudantía están cerradas" });
        }

        return res.json({
          ok: true,
          message: "Postulación registrada con estado Pendiente",
        });
      } catch (err) {
        if (responderErrorSubida(err, res)) return;
        if (err.code === "23505") {
          return res
            .status(409)
            .json({ error: "Ya postulaste a esta ayudantía" });
        }
        if (esErrorLimiteAyudantias(err)) {
          return res.status(409).json({
            error: "No puedes postular a más ayudantías",
          });
        }
        return responderErrorServidor(res, err);
      }
    },
  );
}

app.get("/api/profesor/ramos", async (req, res) => {
  try {
    const profesor = await obtenerUsuarioConRol(req, "profesor");
    if (!profesor) {
      return res.status(401).json({ error: "Debe iniciar sesión como profesor" });
    }
    const result = await pool.query(
      `SELECT 'docente' AS fuente, id AS ayudantia_id, codigo, asignatura AS ramo, tipo_ayudantia, estado
       FROM ayudantias_docente
       WHERE profesor_id = $1
       UNION ALL
       SELECT 'administrativa' AS fuente, id AS ayudantia_id, codigo, glosa AS ramo, tipo_ayudantia, estado
       FROM ayudantias_administrativas
       WHERE profesor_id = $1
       ORDER BY ramo ASC`,
      [profesor.id],
    );
    return res.json(result.rows);
  } catch (err) {
    return responderErrorServidor(res, err);
  }
});

function enviarArchivo(res, nombre, mime, contenido) {
  const seguro = nombre || "archivo";
  const ascii = seguro.replace(/[^\w.\- ]+/g, "_") || "archivo";
  res.setHeader("Content-Type", mime || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(seguro)}`,
  );
  return res.send(contenido);
}

app.get(
  "/api/profesor/postulaciones/:fuente/:id/archivo/:indice?",
  async (req, res) => {
    try {
      const config = FUENTES_POSTULACION[req.params.fuente];
      const id = Number(req.params.id);
      const indice =
        req.params.indice === undefined ? 0 : Number(req.params.indice);
      if (!config || !Number.isInteger(id) || id <= 0 || !Number.isInteger(indice) || indice < 0) {
        return res.status(400).json({ error: "Archivo no válido" });
      }

      const profesor = await obtenerUsuarioConRol(req, "profesor");
      if (!profesor) {
        return res.status(401).json({ error: "Debe iniciar sesión como profesor" });
      }

      const result = await pool.query(
        `SELECT p.archivos
         FROM ${config.tablaPostulaciones} p
         INNER JOIN ${config.tablaAyudantias} a ON a.id = p.${config.columnaAyudantia}
         WHERE p.id = $1 AND a.profesor_id = $2`,
        [id, profesor.id],
      );
      const fila = result.rows[0];
      const lista = Array.isArray(fila?.archivos) ? fila.archivos : [];
      const elegido = lista[indice];
      if (elegido?.contenido) {
        return enviarArchivo(
          res,
          elegido.nombre,
          elegido.mime,
          Buffer.from(elegido.contenido, "base64"),
        );
      }
      return res
        .status(404)
        .json({ error: "Esta postulación no tiene archivo" });
    } catch (err) {
      return responderErrorServidor(res, err);
    }
  },
);

async function listarPostulacionesProfesor({ fuente, filtro, params, orderBy, agruparPor }) {
  const config = FUENTES_POSTULACION[fuente];
  const tipoAyudantia =
    fuente === "docente" ? "Ayudantía docente" : "Ayudantía administrativa";
  const result = await pool.query(
    `SELECT p.id AS postulacion_id,
            '${fuente}' AS fuente,
            '${tipoAyudantia}' AS tipo_ayudantia,
            a.id AS ayudantia_id,
            a.codigo,
            a.${config.columnaNombre} AS ramo,
            a.estado AS estado_ayudantia,
            e.nombre AS nombre_estudiante,
            e.email AS email_estudiante,
            ${sqlAyudantiasAceptadas("e.id")} AS ayudantias_aceptadas_estudiante,
            ${MAX_AYUDANTIAS_ACEPTADAS} AS max_ayudantias_aceptadas,
            p.motivacion,
            COALESCE((
              SELECT jsonb_agg(elem->>'nombre' ORDER BY ord)
              FROM jsonb_array_elements(p.archivos) WITH ORDINALITY AS t(elem, ord)
            ), '[]'::jsonb) AS nombres_archivos,
            p.estado,
            p.respuesta,
            p.created_at,
            p.fecha_estado
     FROM ${config.tablaPostulaciones} p
     INNER JOIN ${config.tablaAyudantias} a ON a.id = p.${config.columnaAyudantia}
     INNER JOIN estudiante e ON e.id = p.ayudante_id
     WHERE ${filtro}
     ORDER BY ${getOrderClause(orderBy)}`,
    params,
  );

  const agrupados = {};
  const seleccionados = [];
  conUrlArchivo(result.rows).forEach((item) => {
    if (ESTADOS_SELECCIONADOS.includes(item.estado)) {
      seleccionados.push(item);
      return;
    }
    const clave = agruparPor(item);
    if (!agrupados[clave]) agrupados[clave] = [];
    agrupados[clave].push(item);
  });
  return { agrupados, seleccionados };
}

app.get("/api/profesor/postulaciones", async (req, res) => {
  try {
    const { fuente, ayudantiaId, orderBy } = req.query;
    const config = FUENTES_POSTULACION[fuente];
    const id = Number(ayudantiaId);
    if (!config || !Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Debe indicar ayudantía y fuente" });
    }

    const profesor = await obtenerUsuarioConRol(req, "profesor");
    if (!profesor) {
      return res.status(401).json({ error: "Debe iniciar sesión como profesor" });
    }

    const ayudantiaResult = await pool.query(
      `SELECT id, estado, profesor_id FROM ${config.tablaAyudantias} WHERE id = $1`,
      [id],
    );
    const ayudantia = ayudantiaResult.rows[0];
    if (!ayudantia || ayudantia.profesor_id !== profesor.id) {
      return res
        .status(403)
        .json({ error: "No tienes acceso a las postulaciones de este ramo" });
    }

    const data = await listarPostulacionesProfesor({
      fuente,
      filtro: "a.id = $1",
      params: [id],
      orderBy,
      agruparPor: (item) => item.tipo_ayudantia,
    });
    return res.json({
      ...data,
      ayudantia: { id: ayudantia.id, fuente, estado: ayudantia.estado },
    });
  } catch (err) {
    return responderErrorServidor(res, err);
  }
});

for (const fuente of Object.keys(FUENTES_POSTULACION)) {
  const ruta =
    fuente === "docente" ? "todas-docentes" : "todas-administrativas";
  app.get(`/api/profesor/postulaciones/${ruta}`, async (req, res) => {
    try {
      const profesor = await obtenerUsuarioConRol(req, "profesor");
      if (!profesor) {
        return res
          .status(401)
          .json({ error: "Debe iniciar sesión como profesor" });
      }
      const data = await listarPostulacionesProfesor({
        fuente,
        filtro: "a.profesor_id = $1",
        params: [profesor.id],
        orderBy: req.query.orderBy,
        agruparPor: (item) => `${item.codigo} - ${item.ramo}`,
      });
      return res.json(data);
    } catch (err) {
      return responderErrorServidor(res, err);
    }
  });
}

// Etapas: Pendiente -> Seleccionado entrevista -> Aceptado.
// Rechazado se puede marcar desde Pendiente o Seleccionado entrevista, pero solo se
// notifica al estudiante cuando el profesor cierra las postulaciones del ramo.
const TRANSICIONES_POSTULACION = {
  seleccionar: {
    origen: ["Pendiente"],
    destino: () => ({ estado: "Seleccionado entrevista", respuesta: "Entrevista" }),
    mensaje: "Ayudante seleccionado para entrevista y notificado",
    alCompletar: ({ post, profesor }) => {
      enviarCorreoSeleccion({
        nombreEstudiante: post.nombre_estudiante,
        emailEstudiante: post.email_estudiante,
        asignatura: post.asignatura,
        nombreProfesor: profesor.nombre,
      }).catch((err) =>
        console.error("Error al enviar correo de selección:", err),
      );
      return insertarNotificacion(
        post,
        "Has sido seleccionado para pasar a entrevista.",
      );
    },
  },
  deseleccionar: {
    origen: ["Seleccionado entrevista"],
    destino: () => ({ estado: "Pendiente", respuesta: "Pendiente" }),
    mensaje: "Selección revertida",
    alCompletar: ({ post }) =>
      insertarNotificacion(
        post,
        "Tu selección para entrevista ha sido revocada.",
      ),
  },
  aceptar: {
    origen: ["Pendiente", "Seleccionado entrevista"],
    destino: () => ({ estado: "Aceptado", respuesta: "Aceptado" }),
    mensaje: "Ayudante aceptado y notificado",
    alCompletar: ({ post, profesor }) => {
      enviarCorreoAceptacion({
        nombreEstudiante: post.nombre_estudiante,
        emailEstudiante: post.email_estudiante,
        asignatura: post.asignatura,
        nombreProfesor: profesor.nombre,
      }).catch((err) =>
        console.error("Error al enviar correo de aceptación:", err),
      );
      return insertarNotificacion(
        post,
        `Has sido aceptado como ayudante de ${post.asignatura}.`,
      );
    },
  },
  rechazar: {
    origen: ["Pendiente", "Seleccionado entrevista"],
    // `respuesta` y `fecha_estado` no cambian para no revelar el rechazo antes del cierre.
    destino: (post) => ({
      estado: "Rechazado",
      respuesta: post.respuesta,
      actualizarFecha: false,
    }),
    mensaje:
      "Postulación rechazada. El estudiante será notificado al cerrar las postulaciones",
  },
  "revertir-rechazo": {
    origen: ["Rechazado"],
    destino: (post) => ({
      estado:
        post.respuesta === "Entrevista" ? "Seleccionado entrevista" : "Pendiente",
      respuesta: post.respuesta,
      actualizarFecha: false,
    }),
    mensaje: "Rechazo revertido",
  },
};

for (const [accion, transicion] of Object.entries(TRANSICIONES_POSTULACION)) {
  app.post(`/api/profesor/postulaciones/${accion}`, async (req, res) => {
    try {
      const resultado = await cambiarEstadoPostulacion(
        req,
        transicion.origen,
        transicion.destino,
      );
      if (resultado.error) {
        return res.status(resultado.status).json({ error: resultado.error });
      }
      if (transicion.alCompletar) await transicion.alCompletar(resultado);
      return res.json({ ok: true, message: transicion.mensaje });
    } catch (err) {
      return responderErrorServidor(res, err, `Error en ${accion}`);
    }
  });
}

app.post("/api/profesor/ayudantias/cerrar", async (req, res) => {
  const { fuente, ayudantiaId } = req.body;
  const config = FUENTES_POSTULACION[fuente];
  const id = Number(ayudantiaId);
  if (!config || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Datos incompletos o no válidos" });
  }

  const client = await pool.connect();
  try {
    const profesor = await obtenerUsuarioConRol(req, "profesor");
    if (!profesor) {
      return res.status(401).json({ error: "Debe iniciar sesión como profesor" });
    }

    await client.query("BEGIN");
    const ayudantiaResult = await client.query(
      `SELECT id, estado, profesor_id, ${config.columnaNombre} AS nombre
       FROM ${config.tablaAyudantias}
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );
    const ayudantia = ayudantiaResult.rows[0];
    if (!ayudantia) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Ayudantía no encontrada" });
    }
    if (ayudantia.profesor_id !== profesor.id) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ error: "No puedes cerrar las postulaciones de un ramo que no dictas" });
    }
    if (ayudantia.estado !== "Disponible") {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "Las postulaciones de este ramo ya están cerradas" });
    }

    await client.query(
      `UPDATE ${config.tablaAyudantias}
       SET estado = 'Cerrada', fecha_estado = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id],
    );
    const rechazados = await client.query(
      `WITH actualizadas AS (
         UPDATE ${config.tablaPostulaciones}
         SET estado = 'Rechazado', respuesta = 'Rechazado', fecha_estado = CURRENT_TIMESTAMP
         WHERE ${config.columnaAyudantia} = $1 AND estado <> 'Aceptado'
         RETURNING ayudante_id
       )
       SELECT u.ayudante_id, e.nombre AS nombre_estudiante, e.email AS email_estudiante
       FROM actualizadas u
       INNER JOIN estudiante e ON e.id = u.ayudante_id`,
      [id],
    );
    const aceptados = await client.query(
      `SELECT p.ayudante_id, e.nombre AS nombre_estudiante, e.email AS email_estudiante
       FROM ${config.tablaPostulaciones} p
       INNER JOIN estudiante e ON e.id = p.ayudante_id
       WHERE p.${config.columnaAyudantia} = $1 AND p.estado = 'Aceptado'`,
      [id],
    );
    await client.query("COMMIT");

    for (const post of aceptados.rows) {
      enviarCorreoCierreAceptado({
        nombreEstudiante: post.nombre_estudiante,
        emailEstudiante: post.email_estudiante,
        asignatura: ayudantia.nombre,
      }).catch((err) =>
        console.error("Error al enviar correo de cierre:", err),
      );
      await insertarNotificacion(
        post,
        `El proceso de selección de ${ayudantia.nombre} terminó y quedaste confirmado/a como ayudante.`,
      );
    }

    for (const post of rechazados.rows) {
      enviarCorreoRechazo({
        nombreEstudiante: post.nombre_estudiante,
        emailEstudiante: post.email_estudiante,
        asignatura: ayudantia.nombre,
      }).catch((err) =>
        console.error("Error al enviar correo de rechazo:", err),
      );
      await insertarNotificacion(
        post,
        `El proceso de selección de ${ayudantia.nombre} terminó y tu postulación no fue seleccionada.`,
      );
    }

    return res.json({
      ok: true,
      message: `Postulaciones cerradas. Se notificó el resultado a ${aceptados.rowCount} ayudante(s) aceptado(s) y ${rechazados.rowCount} postulante(s) no seleccionado(s)`,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return responderErrorServidor(res, err, "Error al cerrar postulaciones");
  } finally {
    client.release();
  }
});

app.get("/api/notificaciones", async (req, res) => {
  try {
    const estudiante = await obtenerUsuarioConRol(req, "estudiante");
    if (!estudiante) {
      return res
        .status(401)
        .json({ error: "Debe iniciar sesión como estudiante" });
    }

    const result = await pool.query(
      `SELECT id, mensaje, created_at, leida
       FROM notificaciones_estudiante
       WHERE ayudante_id = $1
       ORDER BY created_at DESC`,
      [estudiante.id],
    );

    return res.json(result.rows);
  } catch (err) {
    return responderErrorServidor(res, err);
  }
});

app.get("/postula-docente", (req, res) => {
  res.sendFile(path.join(__dirname, "pagina", "postula-docente.html"));
});

app.get("/postula-administrativa", (req, res) => {
  res.sendFile(path.join(__dirname, "pagina", "postula-administrativa.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "pagina", "admin.html"));
});

app.get("/api/admin/catalogo-asignaturas", (req, res) => {
  try {
    return res.json(loadCatalogoAsignaturas());
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error al cargar catálogo de asignaturas" });
  }
});

// ── API Admin: listar ayudantías ─────────────────────────────────────────────
app.get("/api/admin/ayudantias/docente", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM ayudantias_docente ORDER BY created_at DESC",
    );
    return res.json(result.rows);
  } catch (err) {
    return responderErrorServidor(res, err);
  }
});

app.get("/api/admin/ayudantias/administrativa", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM ayudantias_administrativas ORDER BY created_at DESC",
    );
    return res.json(result.rows);
  } catch (err) {
    return responderErrorServidor(res, err);
  }
});

// ── API Admin: asignación de profesores ──────────────────────────────────────
app.get("/api/admin/profesores", async (req, res) => {
  try {
    const admin = await obtenerUsuarioConRol(req, "administrador");
    if (!admin) {
      return res
        .status(401)
        .json({ error: "Debe iniciar sesión como administrador" });
    }
    const result = await pool.query(
      "SELECT id, nombre, email FROM profesor ORDER BY nombre ASC",
    );
    return res.json(result.rows);
  } catch (err) {
    return responderErrorServidor(res, err);
  }
});

app.put("/api/admin/ayudantias/:fuente/:id/profesor", async (req, res) => {
  try {
    const admin = await obtenerUsuarioConRol(req, "administrador");
    if (!admin) {
      return res
        .status(401)
        .json({ error: "Debe iniciar sesión como administrador" });
    }

    const config = FUENTES_POSTULACION[req.params.fuente];
    const id = Number(req.params.id);
    const { profesorId } = req.body;
    const nuevoProfesorId =
      profesorId === null || profesorId === "" || profesorId === undefined
        ? null
        : Number(profesorId);
    if (
      !config ||
      !Number.isInteger(id) ||
      id <= 0 ||
      (nuevoProfesorId !== null && !Number.isInteger(nuevoProfesorId))
    ) {
      return res.status(400).json({ error: "Datos incompletos o no válidos" });
    }

    const result = await pool.query(
      `UPDATE ${config.tablaAyudantias} SET profesor_id = $2 WHERE id = $1 RETURNING id`,
      [id, nuevoProfesorId],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Ayudantía no encontrada" });
    }
    return res.json({
      ok: true,
      message: nuevoProfesorId
        ? "Profesor asignado correctamente"
        : "Se quitó el profesor de la ayudantía",
    });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(400).json({ error: "El profesor indicado no existe" });
    }
    return responderErrorServidor(res, err);
  }
});

function esFechaValida(valor) {
  const texto = String(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(texto);
}

function validarPeriodoYHoras({ inicio, termino, horas }) {
  if (!esFechaValida(inicio) || !esFechaValida(termino)) {
    return "Las fechas de inicio y término no son válidas";
  }
  if (String(termino) < String(inicio)) {
    return "La fecha de término no puede ser anterior a la de inicio";
  }
  const horasNumero = Number(horas);
  if (!Number.isInteger(horasNumero) || horasNumero <= 0) {
    return "Las horas deben ser un número entero mayor a 0";
  }
  return null;
}

function responderErrorAyudantia(res, err) {
  if (err.code === "23505") {
    return res.status(409).json({
      error:
        err.constraint === INDICE_RAMO_ABIERTO
          ? "Ya existe una ayudantía activa para esa asignatura y paralelo"
          : "El código de ayudantía ya existe",
    });
  }
  if (["22007", "22008", "23514"].includes(err.code)) {
    return res.status(400).json({ error: "Datos de la ayudantía no válidos" });
  }
  return responderErrorServidor(res, err);
}

// ── API Admin: crear ayudantía docente ───────────────────────────────────────
app.post("/api/admin/ayudantias/docente", async (req, res) => {
  try {
    const {
      codigo,
      asignatura,
      paralelo,
      emplazamiento,
      departamento,
      categoria,
      tipo_ayudantia,
      inicio,
      termino,
      horas,
    } = req.body;
    if (
      !codigo ||
      !asignatura ||
      !paralelo ||
      !emplazamiento ||
      !departamento ||
      !categoria ||
      !tipo_ayudantia ||
      !inicio ||
      !termino ||
      horas === undefined ||
      horas === ""
    ) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    const errorDatos = validarPeriodoYHoras({ inicio, termino, horas });
    if (errorDatos) {
      return res.status(400).json({ error: errorDatos });
    }

    await pool.query(
      `INSERT INTO ayudantias_docente
       (codigo, asignatura, emplazamiento, departamento, paralelo, categoria, tipo_ayudantia, inicio, termino, horas, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Disponible')`,
      [
        codigo.trim(),
        asignatura.trim(),
        emplazamiento.trim(),
        departamento.trim(),
        paralelo.trim(),
        categoria.trim(),
        tipo_ayudantia.trim(),
        inicio,
        termino,
        Number(horas),
      ],
    );
    return res.json({
      ok: true,
      message: "Ayudantía creada con estado Disponible",
    });
  } catch (err) {
    return responderErrorAyudantia(res, err);
  }
});

// ── API Admin: crear ayudantía administrativa ────────────────────────────────
app.post("/api/admin/ayudantias/administrativa", async (req, res) => {
  try {
    const {
      codigo,
      glosa,
      emplazamiento,
      departamento,
      tipo_ayudantia,
      inicio,
      termino,
      horas,
    } = req.body;
    if (
      !codigo ||
      !glosa ||
      !emplazamiento ||
      !departamento ||
      !tipo_ayudantia ||
      !inicio ||
      !termino ||
      horas === undefined ||
      horas === ""
    ) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    const errorDatos = validarPeriodoYHoras({ inicio, termino, horas });
    if (errorDatos) {
      return res.status(400).json({ error: errorDatos });
    }

    await pool.query(
      `INSERT INTO ayudantias_administrativas
       (codigo, glosa, emplazamiento, departamento, tipo_ayudantia, inicio, termino, horas, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Disponible')`,
      [
        codigo.trim(),
        glosa.trim(),
        emplazamiento.trim(),
        departamento.trim(),
        tipo_ayudantia.trim(),
        inicio,
        termino,
        Number(horas),
      ],
    );
    return res.json({
      ok: true,
      message: "Ayudantía administrativa creada con estado Disponible",
    });
  } catch (err) {
    return responderErrorAyudantia(res, err);
  }
});

// ── API Admin: eliminar ayudantías ───────────────────────────────────────────
for (const [fuente, config] of Object.entries(FUENTES_POSTULACION)) {
  app.delete(`/api/admin/ayudantias/${fuente}/:id`, async (req, res) => {
    try {
      const result = await pool.query(
        `DELETE FROM ${config.tablaAyudantias} WHERE id = $1 RETURNING id`,
        [Number(req.params.id)],
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Ayudantía no encontrada" });
      }
      return res.json({ ok: true, message: "Ayudantía eliminada" });
    } catch (err) {
      // 23001: la FK es ON DELETE RESTRICT; 23503: violación de FK genérica.
      if (err.code === "23001" || err.code === "23503") {
        return res.status(409).json({
          error:
            "No se puede eliminar: la ayudantía tiene postulaciones registradas. Para conservar ese historial, el profesor a cargo debe cerrar las postulaciones.",
        });
      }
      return responderErrorServidor(res, err);
    }
  });
}

const INTENTOS_INIT_DB = 10;
const ESPERA_INIT_DB_MS = 3000;

async function iniciar() {
  for (let intento = 1; intento <= INTENTOS_INIT_DB; intento++) {
    try {
      await initDb();
      app.listen(port, () => {
        console.log(`App corriendo en http://localhost:${port}`);
      });
      return;
    } catch (err) {
      console.error(
        `No se pudo inicializar la base de datos (intento ${intento}/${INTENTOS_INIT_DB}): ${err.message}`,
      );
      if (intento < INTENTOS_INIT_DB) {
        await new Promise((resolve) => setTimeout(resolve, ESPERA_INIT_DB_MS));
      }
    }
  }
  process.exit(1);
}

iniciar();
