const express = require("express");
const pool = require("./db"); // Importar la conexión
const { enviarCorreoSeleccion } = require("./mailer");
const app = express();
const port = 3000;
const path = require("path");
const fs = require("fs");
const multer = require("multer");

// Crear carpeta de uploads si no existe
const uploadsDir = path.join(__dirname, "pagina", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

app.use(express.static(path.join(__dirname, "pagina")));
app.use("/uploads", express.static(uploadsDir));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function initDb() {
  await pool.query(`DROP TABLE IF EXISTS registro_horas`);

  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('public.ayudante') IS NOT NULL
         AND to_regclass('public.estudiante') IS NULL THEN
        ALTER TABLE ayudante RENAME TO estudiante;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS estudiante (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      password VARCHAR(160) NOT NULL,
      archivos JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE estudiante
    ADD COLUMN IF NOT EXISTS archivos JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profesor (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      password VARCHAR(160) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
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
      estado VARCHAR(40) DEFAULT 'Disponible',
      fecha_estado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
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
      estado VARCHAR(40) DEFAULT 'Disponible',
      fecha_estado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS postulaciones_docente (
      id SERIAL PRIMARY KEY,
      ayudantia_docente_id INTEGER NOT NULL REFERENCES ayudantias_docente(id) ON DELETE CASCADE,
      ayudante_id INTEGER REFERENCES estudiante(id) ON DELETE SET NULL,
      nombre_estudiante VARCHAR(120) NOT NULL,
      email_estudiante VARCHAR(160) NOT NULL,
      motivacion TEXT NOT NULL,
      documentos TEXT NOT NULL,
      archivos JSONB NOT NULL DEFAULT '[]'::jsonb,
      archivo_nombre VARCHAR(255),
      archivo_mime VARCHAR(120),
      archivo_contenido BYTEA,
      estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente',
      respuesta VARCHAR(120) NOT NULL DEFAULT 'Pendiente',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      fecha_estado TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS postulaciones_administrativas (
      id SERIAL PRIMARY KEY,
      ayudantia_administrativa_id INTEGER NOT NULL REFERENCES ayudantias_administrativas(id) ON DELETE CASCADE,
      ayudante_id INTEGER REFERENCES estudiante(id) ON DELETE SET NULL,
      nombre_estudiante VARCHAR(120) NOT NULL,
      email_estudiante VARCHAR(160) NOT NULL,
      motivacion TEXT NOT NULL,
      documentos TEXT NOT NULL,
      archivos JSONB NOT NULL DEFAULT '[]'::jsonb,
      archivo_nombre VARCHAR(255),
      archivo_mime VARCHAR(120),
      archivo_contenido BYTEA,
      estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente',
      respuesta VARCHAR(120) NOT NULL DEFAULT 'Pendiente',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      fecha_estado TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notificaciones_estudiante (
      id SERIAL PRIMARY KEY,
      ayudante_id INTEGER REFERENCES estudiante(id) ON DELETE SET NULL,
      nombre_estudiante VARCHAR(120) NOT NULL,
      email_estudiante VARCHAR(160) NOT NULL,
      mensaje TEXT NOT NULL,
      leida BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS administrador (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      password VARCHAR(160) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE postulaciones_docente
      ADD COLUMN IF NOT EXISTS archivo_nombre VARCHAR(255),
      ADD COLUMN IF NOT EXISTS archivo_mime VARCHAR(120),
      ADD COLUMN IF NOT EXISTS archivo_contenido BYTEA
  `);
  await pool.query(`
    ALTER TABLE postulaciones_administrativas
      ADD COLUMN IF NOT EXISTS archivo_nombre VARCHAR(255),
      ADD COLUMN IF NOT EXISTS archivo_mime VARCHAR(120),
      ADD COLUMN IF NOT EXISTS archivo_contenido BYTEA
  `);
  await pool.query(`
    ALTER TABLE postulaciones_docente
      ADD COLUMN IF NOT EXISTS archivos JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await pool.query(`
    ALTER TABLE postulaciones_administrativas
      ADD COLUMN IF NOT EXISTS archivos JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await pool.query(`
    UPDATE postulaciones_docente
    SET archivos = jsonb_build_array(jsonb_build_object(
      'nombre', archivo_nombre,
      'mime', COALESCE(archivo_mime, 'application/octet-stream'),
      'contenido', encode(archivo_contenido, 'base64')
    ))
    WHERE archivo_contenido IS NOT NULL
      AND jsonb_array_length(COALESCE(archivos, '[]'::jsonb)) = 0
  `);
  await pool.query(`
    UPDATE postulaciones_administrativas
    SET archivos = jsonb_build_array(jsonb_build_object(
      'nombre', archivo_nombre,
      'mime', COALESCE(archivo_mime, 'application/octet-stream'),
      'contenido', encode(archivo_contenido, 'base64')
    ))
    WHERE archivo_contenido IS NOT NULL
      AND jsonb_array_length(COALESCE(archivos, '[]'::jsonb)) = 0
  `);

  // Nota: se removieron los inserts "semilla" de ayudantías.
  // La base queda vacía hasta que se creen ayudantías vía UI/SQL/import.
  await seedDocenteFromFormatoIfEmpty();
  await seedAdministrativaFromFormatoIfEmpty();
}

async function seedDocenteFromFormatoIfEmpty() {
  const count = await pool.query(
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
    await pool.query(
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

async function seedAdministrativaFromFormatoIfEmpty() {
  const count = await pool.query(
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
    await pool.query(
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
    let archivos = nombres.map((nombre, indice) => ({
      nombre: nombre || `Archivo ${indice + 1}`,
      url: `/api/profesor/postulaciones/${item.fuente}/${item.postulacion_id}/archivo/${indice}`,
    }));
    if (archivos.length === 0 && item.tiene_archivo) {
      archivos = [
        {
          nombre: item.documentos || "Archivo",
          url: `/api/profesor/postulaciones/${item.fuente}/${item.postulacion_id}/archivo/0`,
        },
      ];
    }
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

async function insertarPostulacionConArchivos({
  tabla,
  columnaAyudantia,
  ayudantiaId,
  estudianteId,
  nombreEstudiante,
  emailEstudiante,
  motivacion,
  files,
  fuente,
}) {
  const payload = files.map((file) => ({
    nombre: file.originalname,
    mime: file.mimetype || "application/octet-stream",
    tamano: file.size,
    contenido: file.buffer.toString("base64"),
  }));
  const documentos = payload.length
    ? payload.map((archivo) => archivo.nombre).join(", ")
    : "Sin archivos adjuntos";
  const primero = files[0];
  const insertResult = await pool.query(
    `INSERT INTO ${tabla}
     (${columnaAyudantia}, ayudante_id, nombre_estudiante, email_estudiante, motivacion, documentos, archivo_nombre, archivo_mime, archivo_contenido, archivos, estado, respuesta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'Pendiente', 'Pendiente')
     RETURNING id`,
    [
      Number(ayudantiaId),
      estudianteId,
      nombreEstudiante,
      emailEstudiante,
      motivacion,
      documentos,
      primero ? primero.originalname : null,
      primero ? primero.mimetype || "application/octet-stream" : null,
      primero ? primero.buffer : null,
      JSON.stringify(payload),
    ],
  );
  const postulacionId = insertResult.rows[0].id;
  for (const file of files) {
    await agregarArchivoEstudiante(estudianteId, file, {
      postulacionId,
      fuente,
    });
  }
  return postulacionId;
}

function getOrderClause(orderBy) {
  if (orderBy === "nombre") return "p.nombre_estudiante ASC";
  if (orderBy === "estado") return "p.estado ASC, p.created_at DESC";
  return "p.created_at DESC";
}

function buildCurrentUserCookie(currentUser) {
  return `currentUser=${encodeURIComponent(JSON.stringify(currentUser))}; Path=/; SameSite=Lax`;
}

function getCurrentUserFromRequest(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  const currentUserCookie = cookies.find((item) =>
    item.startsWith("currentUser="),
  );
  if (!currentUserCookie) {
    return null;
  }

  try {
    const encodedValue = currentUserCookie.substring("currentUser=".length);
    return JSON.parse(decodeURIComponent(encodedValue));
  } catch (error) {
    return null;
  }
}

async function agregarArchivoEstudiante(estudianteId, file, referencia = {}) {
  const entrada = {
    nombre: file.originalname,
    mime: file.mimetype || "application/octet-stream",
    tamano: file.size,
    contenido: file.buffer.toString("base64"),
    subido_en: new Date().toISOString(),
    postulacion_id: referencia.postulacionId || null,
    fuente: referencia.fuente || null,
  };

  await pool.query(
    `UPDATE estudiante
     SET archivos = COALESCE(archivos, '[]'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [estudianteId, JSON.stringify([entrada])],
  );
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
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
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
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
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
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
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
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

app.get("/api/estudiante/postulaciones", async (req, res) => {
  try {
    const currentUser = getCurrentUserFromRequest(req);
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
              p.estado,
              p.respuesta,
              p.fecha_estado,
              p.created_at
       FROM postulaciones_docente p
       INNER JOIN ayudantias_docente a ON a.id = p.ayudantia_docente_id
       WHERE p.email_estudiante = $1
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
              p.estado,
              p.respuesta,
              p.fecha_estado,
              p.created_at
       FROM postulaciones_administrativas p
       INNER JOIN ayudantias_administrativas a ON a.id = p.ayudantia_administrativa_id
       WHERE p.email_estudiante = $1
       ORDER BY p.created_at DESC`,
      [email],
    );

    return res.json({
      docente: docenteResult.rows,
      administrativa: administrativaResult.rows,
      currentUser,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

app.post(
  "/api/postulaciones/docente",
  upload.array("archivos", 10),
  async (req, res) => {
    try {
      const { nombreEstudiante, emailEstudiante, motivacion } = req.body;
      const ids = idsAyudantiaDesdeBody(req.body);
      const files = listaArchivosRequest(req);

      if (ids.length > 1) {
        return res
          .status(400)
          .json({ error: "Solo puedes postular a una ayudantía por envío" });
      }

      if (!ids.length || !nombreEstudiante || !emailEstudiante || !motivacion) {
        return res.status(400).json({ error: "Faltan campos obligatorios" });
      }

      const ayudantiaId = ids[0];
      const estudianteResult = await pool.query(
        "SELECT id FROM estudiante WHERE email = $1",
        [String(emailEstudiante).trim().toLowerCase()],
      );
      const estudianteId =
        estudianteResult.rowCount > 0 ? estudianteResult.rows[0].id : null;

      if (files.length && !estudianteId) {
        return res.status(400).json({
          error: "No se encontró al estudiante para guardar el archivo",
        });
      }

      const ayudantia = await pool.query(
        "SELECT id FROM ayudantias_docente WHERE id = $1",
        [ayudantiaId],
      );
      if (ayudantia.rowCount === 0) {
        return res.status(404).json({ error: "Ayudantía no encontrada" });
      }

      await insertarPostulacionConArchivos({
        tabla: "postulaciones_docente",
        columnaAyudantia: "ayudantia_docente_id",
        ayudantiaId,
        estudianteId,
        nombreEstudiante: String(nombreEstudiante).trim(),
        emailEstudiante: String(emailEstudiante).trim().toLowerCase(),
        motivacion: String(motivacion).trim(),
        files,
        fuente: "docente",
      });

      return res.json({
        ok: true,
        message: "Postulación registrada con estado Pendiente",
      });
    } catch (err) {
      if (responderErrorSubida(err, res)) return;
      console.error(err);
      return res.status(500).json({ error: "Error de servidor" });
    }
  },
);

app.post(
  "/api/postulaciones/administrativa",
  upload.array("archivos", 10),
  async (req, res) => {
    try {
      const { nombreEstudiante, emailEstudiante, motivacion } = req.body;
      const ids = idsAyudantiaDesdeBody(req.body);
      const files = listaArchivosRequest(req);

      if (ids.length > 1) {
        return res
          .status(400)
          .json({ error: "Solo puedes postular a una ayudantía por envío" });
      }

      if (!ids.length || !nombreEstudiante || !emailEstudiante || !motivacion) {
        return res.status(400).json({ error: "Faltan campos obligatorios" });
      }

      const ayudantiaId = ids[0];
      const estudianteResult = await pool.query(
        "SELECT id FROM estudiante WHERE email = $1",
        [String(emailEstudiante).trim().toLowerCase()],
      );
      const estudianteId =
        estudianteResult.rowCount > 0 ? estudianteResult.rows[0].id : null;

      if (files.length && !estudianteId) {
        return res.status(400).json({
          error: "No se encontró al estudiante para guardar el archivo",
        });
      }

      const ayudantia = await pool.query(
        "SELECT id FROM ayudantias_administrativas WHERE id = $1",
        [ayudantiaId],
      );
      if (ayudantia.rowCount === 0) {
        return res.status(404).json({ error: "Ayudantía no encontrada" });
      }

      await insertarPostulacionConArchivos({
        tabla: "postulaciones_administrativas",
        columnaAyudantia: "ayudantia_administrativa_id",
        ayudantiaId,
        estudianteId,
        nombreEstudiante: String(nombreEstudiante).trim(),
        emailEstudiante: String(emailEstudiante).trim().toLowerCase(),
        motivacion: String(motivacion).trim(),
        files,
        fuente: "administrativa",
      });

      return res.json({
        ok: true,
        message: "Postulación registrada con estado Pendiente",
      });
    } catch (err) {
      if (responderErrorSubida(err, res)) return;
      console.error(err);
      return res.status(500).json({ error: "Error de servidor" });
    }
  },
);

app.get("/api/profesor/ramos", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 'docente' AS fuente, id AS ayudantia_id, codigo, asignatura AS ramo, tipo_ayudantia
      FROM ayudantias_docente
      UNION ALL
      SELECT 'administrativa' AS fuente, id AS ayudantia_id, codigo, glosa AS ramo, tipo_ayudantia
      FROM ayudantias_administrativas
      ORDER BY ramo ASC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
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
      const tablas = {
        docente: "postulaciones_docente",
        administrativa: "postulaciones_administrativas",
      };
      const tabla = tablas[req.params.fuente];
      const id = Number(req.params.id);
      const indice =
        req.params.indice === undefined ? 0 : Number(req.params.indice);
      if (!tabla || !Number.isInteger(id) || id <= 0 || !Number.isInteger(indice) || indice < 0) {
        return res.status(400).json({ error: "Archivo no válido" });
      }

      const result = await pool.query(
        `SELECT archivos, archivo_nombre, archivo_mime, archivo_contenido
         FROM ${tabla}
         WHERE id = $1`,
        [id],
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
      if (indice === 0 && fila?.archivo_contenido) {
        return enviarArchivo(
          res,
          fila.archivo_nombre,
          fila.archivo_mime,
          fila.archivo_contenido,
        );
      }
      return res
        .status(404)
        .json({ error: "Esta postulación no tiene archivo" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error de servidor" });
    }
  },
);

app.get("/api/profesor/postulaciones", async (req, res) => {
  try {
    const { fuente, ayudantiaId, orderBy } = req.query;
    if (!fuente || !ayudantiaId) {
      return res.status(400).json({ error: "Debe indicar ayudantía y fuente" });
    }

    const orderClause = getOrderClause(orderBy);
    let query;
    if (fuente === "docente") {
      query = `
        SELECT p.id AS postulacion_id,
               'docente' AS fuente,
               'Ayudantía docente' AS tipo_ayudantia,
               a.asignatura AS ramo,
               p.nombre_estudiante,
               p.email_estudiante,
               p.motivacion,
               p.documentos,
               COALESCE((
                 SELECT jsonb_agg(elem->>'nombre' ORDER BY ord)
                 FROM jsonb_array_elements(COALESCE(p.archivos, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
               ), '[]'::jsonb) AS nombres_archivos,
               (jsonb_array_length(COALESCE(p.archivos, '[]'::jsonb)) > 0 OR p.archivo_contenido IS NOT NULL) AS tiene_archivo,
               p.estado,
               p.respuesta,
               p.created_at,
               p.fecha_estado
        FROM postulaciones_docente p
        INNER JOIN ayudantias_docente a ON a.id = p.ayudantia_docente_id
        WHERE a.id = $1
        ORDER BY ${orderClause}
      `;
    } else if (fuente === "administrativa") {
      query = `
        SELECT p.id AS postulacion_id,
               'administrativa' AS fuente,
               'Ayudantía administrativa' AS tipo_ayudantia,
               a.glosa AS ramo,
               p.nombre_estudiante,
               p.email_estudiante,
               p.motivacion,
               p.documentos,
               COALESCE((
                 SELECT jsonb_agg(elem->>'nombre' ORDER BY ord)
                 FROM jsonb_array_elements(COALESCE(p.archivos, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
               ), '[]'::jsonb) AS nombres_archivos,
               (jsonb_array_length(COALESCE(p.archivos, '[]'::jsonb)) > 0 OR p.archivo_contenido IS NOT NULL) AS tiene_archivo,
               p.estado,
               p.respuesta,
               p.created_at,
               p.fecha_estado
        FROM postulaciones_administrativas p
        INNER JOIN ayudantias_administrativas a ON a.id = p.ayudantia_administrativa_id
        WHERE a.id = $1
        ORDER BY ${orderClause}
      `;
    } else {
      return res.status(400).json({ error: "Fuente no válida" });
    }

    const result = await pool.query(query, [Number(ayudantiaId)]);
    const postulaciones = conUrlArchivo(result.rows);

    const agrupados = {};
    const seleccionados = [];

    postulaciones.forEach((item) => {
      if (item.estado === "Seleccionado entrevista") {
        seleccionados.push(item);
      } else {
        if (!agrupados[item.tipo_ayudantia]) {
          agrupados[item.tipo_ayudantia] = [];
        }
        agrupados[item.tipo_ayudantia].push(item);
      }
    });

    return res.json({ agrupados, seleccionados });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

app.get("/api/profesor/postulaciones/todas-docentes", async (req, res) => {
  try {
    const { orderBy } = req.query;
    const orderClause = getOrderClause(orderBy);

    const query = `
      SELECT p.id AS postulacion_id,
             'docente' AS fuente,
             'Ayudantía docente' AS tipo_ayudantia,
             a.asignatura,
             p.nombre_estudiante,
             p.email_estudiante,
             p.motivacion,
             p.documentos,
               COALESCE((
                 SELECT jsonb_agg(elem->>'nombre' ORDER BY ord)
                 FROM jsonb_array_elements(COALESCE(p.archivos, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
               ), '[]'::jsonb) AS nombres_archivos,
               (jsonb_array_length(COALESCE(p.archivos, '[]'::jsonb)) > 0 OR p.archivo_contenido IS NOT NULL) AS tiene_archivo,
             p.estado,
             p.respuesta,
             p.created_at,
             p.fecha_estado
      FROM postulaciones_docente p
      INNER JOIN ayudantias_docente a ON a.id = p.ayudantia_docente_id
      ORDER BY ${orderClause}
    `;

    const result = await pool.query(query);
    const postulaciones = conUrlArchivo(result.rows);

    const agrupados = {};
    const seleccionados = [];

    postulaciones.forEach((item) => {
      if (item.estado === "Seleccionado entrevista") {
        seleccionados.push(item);
      } else {
        if (!agrupados[item.asignatura]) {
          agrupados[item.asignatura] = [];
        }
        agrupados[item.asignatura].push(item);
      }
    });

    return res.json({ agrupados, seleccionados });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

app.get(
  "/api/profesor/postulaciones/todas-administrativas",
  async (req, res) => {
    try {
      const { orderBy } = req.query;
      const orderClause = getOrderClause(orderBy);

      const query = `
      SELECT p.id AS postulacion_id,
             'administrativa' AS fuente,
             'Ayudantía administrativa' AS tipo_ayudantia,
             a.glosa,
             p.nombre_estudiante,
             p.email_estudiante,
             p.motivacion,
             p.documentos,
               COALESCE((
                 SELECT jsonb_agg(elem->>'nombre' ORDER BY ord)
                 FROM jsonb_array_elements(COALESCE(p.archivos, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
               ), '[]'::jsonb) AS nombres_archivos,
               (jsonb_array_length(COALESCE(p.archivos, '[]'::jsonb)) > 0 OR p.archivo_contenido IS NOT NULL) AS tiene_archivo,
             p.estado,
             p.respuesta,
             p.created_at,
             p.fecha_estado
      FROM postulaciones_administrativas p
      INNER JOIN ayudantias_administrativas a ON a.id = p.ayudantia_administrativa_id
      ORDER BY ${orderClause}
    `;

      const result = await pool.query(query);
      const postulaciones = conUrlArchivo(result.rows);

      const agrupados = {};
      const seleccionados = [];

      postulaciones.forEach((item) => {
        if (item.estado === "Seleccionado entrevista") {
          seleccionados.push(item);
        } else {
          if (!agrupados[item.glosa]) {
            agrupados[item.glosa] = [];
          }
          agrupados[item.glosa].push(item);
        }
      });

      return res.json({ agrupados, seleccionados });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error de servidor" });
    }
  },
);

app.post("/api/profesor/postulaciones/seleccionar", async (req, res) => {
  try {
    const { fuente, postulacionId } = req.body;
    if (!fuente || !postulacionId) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const currentUser = getCurrentUserFromRequest(req);
    const nombreProfesor = currentUser?.nombre || "el profesor";

    let updateQuery = "";
    if (fuente === "docente") {
      updateQuery = `
        UPDATE postulaciones_docente p
        SET estado = 'Seleccionado entrevista',
            respuesta = 'Entrevista',
            fecha_estado = CURRENT_TIMESTAMP
        FROM ayudantias_docente a
        WHERE p.id = $1 AND a.id = p.ayudantia_docente_id
        RETURNING p.ayudante_id, p.nombre_estudiante, p.email_estudiante, a.asignatura
      `;
    } else if (fuente === "administrativa") {
      updateQuery = `
        UPDATE postulaciones_administrativas p
        SET estado = 'Seleccionado entrevista',
            respuesta = 'Entrevista',
            fecha_estado = CURRENT_TIMESTAMP
        FROM ayudantias_administrativas a
        WHERE p.id = $1 AND a.id = p.ayudantia_administrativa_id
        RETURNING p.ayudante_id, p.nombre_estudiante, p.email_estudiante, a.glosa AS asignatura
      `;
    } else {
      return res.status(400).json({ error: "Fuente no válida" });
    }

    const updateResult = await pool.query(updateQuery, [Number(postulacionId)]);
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: "Postulación no encontrada" });
    }

    const post = updateResult.rows[0];

    // Enviar correo al estudiante (no bloquea la respuesta si falla)
    enviarCorreoSeleccion({
      nombreEstudiante: post.nombre_estudiante,
      emailEstudiante: post.email_estudiante,
      asignatura: post.asignatura,
      nombreProfesor,
    }).catch((err) =>
      console.error("Error al enviar correo de selección:", err),
    );

    await pool.query(
      `INSERT INTO notificaciones_estudiante
      (ayudante_id, nombre_estudiante, email_estudiante, mensaje)
      VALUES ($1, $2, $3, $4)`,
      [
        post.ayudante_id,
        post.nombre_estudiante,
        post.email_estudiante,
        "Has sido seleccionado para pasar a entrevista.",
      ],
    );

    return res.json({
      ok: true,
      message: "Ayudante seleccionado y notificado",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

app.post("/api/profesor/postulaciones/deseleccionar", async (req, res) => {
  try {
    const { fuente, postulacionId } = req.body;
    const id = Number(postulacionId);

    if (!fuente || !postulacionId) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID de postulación no válido" });
    }

    const configByFuente = {
      docente: {
        updateQuery: `
          UPDATE postulaciones_docente
          SET estado = 'Pendiente',
              respuesta = 'Pendiente',
              fecha_estado = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING id, ayudante_id, nombre_estudiante, email_estudiante
        `,
        selectQuery: `
          SELECT p.id AS postulacion_id,
                 'docente' AS fuente,
                 'Ayudantía docente' AS tipo_ayudantia,
                 a.asignatura AS ramo,
                 p.nombre_estudiante,
                 p.email_estudiante,
                 p.motivacion,
                 p.documentos,
               COALESCE((
                 SELECT jsonb_agg(elem->>'nombre' ORDER BY ord)
                 FROM jsonb_array_elements(COALESCE(p.archivos, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
               ), '[]'::jsonb) AS nombres_archivos,
               (jsonb_array_length(COALESCE(p.archivos, '[]'::jsonb)) > 0 OR p.archivo_contenido IS NOT NULL) AS tiene_archivo,
                 p.estado,
                 p.respuesta,
                 p.created_at,
                 p.fecha_estado
          FROM postulaciones_docente p
          INNER JOIN ayudantias_docente a ON a.id = p.ayudantia_docente_id
          WHERE p.id = $1
        `,
      },
      administrativa: {
        updateQuery: `
          UPDATE postulaciones_administrativas
          SET estado = 'Pendiente',
              respuesta = 'Pendiente',
              fecha_estado = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING id, ayudante_id, nombre_estudiante, email_estudiante
        `,
        selectQuery: `
          SELECT p.id AS postulacion_id,
                 'administrativa' AS fuente,
                 'Ayudantía administrativa' AS tipo_ayudantia,
                 a.glosa AS ramo,
                 p.nombre_estudiante,
                 p.email_estudiante,
                 p.motivacion,
                 p.documentos,
               COALESCE((
                 SELECT jsonb_agg(elem->>'nombre' ORDER BY ord)
                 FROM jsonb_array_elements(COALESCE(p.archivos, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
               ), '[]'::jsonb) AS nombres_archivos,
               (jsonb_array_length(COALESCE(p.archivos, '[]'::jsonb)) > 0 OR p.archivo_contenido IS NOT NULL) AS tiene_archivo,
                 p.estado,
                 p.respuesta,
                 p.created_at,
                 p.fecha_estado
          FROM postulaciones_administrativas p
          INNER JOIN ayudantias_administrativas a ON a.id = p.ayudantia_administrativa_id
          WHERE p.id = $1
        `,
      },
    };

    const config = configByFuente[fuente];
    if (!config) {
      return res.status(400).json({ error: "Fuente no válida" });
    }

    const updateResult = await pool.query(config.updateQuery, [id]);
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: "Postulación no encontrada" });
    }

    const post = updateResult.rows[0];

    // Intentar enviar notificación (pero no fallar si no se puede)
    try {
      if (post.ayudante_id) {
        await pool.query(
          `INSERT INTO notificaciones_estudiante
          (ayudante_id, nombre_estudiante, email_estudiante, mensaje)
          VALUES ($1, $2, $3, $4)`,
          [
            post.ayudante_id,
            post.nombre_estudiante,
            post.email_estudiante,
            "Tu selección para entrevista ha sido revocada.",
          ],
        );
      }
    } catch (notifErr) {
      console.error("Error al insertar notificación:", notifErr);
      // Continuar de todas formas
    }

    // Obtener la fila actualizada
    const refreshResult = await pool.query(config.selectQuery, [post.id]);
    const refreshed = conUrlArchivo(refreshResult.rows)[0];

    return res.json({
      ok: true,
      message: "Selección revertida",
      postulacion: refreshed,
    });
  } catch (err) {
    console.error("Error en deseleccionar:", err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

app.get("/api/notificaciones", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Debe indicar email" });
    }

    const result = await pool.query(
      `SELECT id, mensaje, created_at, leida
       FROM notificaciones_estudiante
       WHERE email_estudiante = $1
       ORDER BY created_at DESC`,
      [String(email).trim().toLowerCase()],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
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
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

app.get("/api/admin/ayudantias/administrativa", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM ayudantias_administrativas ORDER BY created_at DESC",
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

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
      !horas
    ) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }

    // Verificar si ya existe una ayudantía activa para la misma asignatura y paralelo
    const duplicado = await pool.query(
      `SELECT id FROM ayudantias_docente
       WHERE asignatura = $1 AND paralelo = $2 AND estado = 'Disponible'`,
      [asignatura.trim(), paralelo.trim()],
    );
    if (duplicado.rowCount > 0) {
      return res.status(409).json({
        error: `Ya existe una ayudantía activa para la asignatura "${asignatura}" con el paralelo "${paralelo}"`,
      });
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
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ error: "El código de ayudantía ya existe" });
    }
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
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
      !horas
    ) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
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
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ error: "El código de ayudantía ya existe" });
    }
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

// ── API Admin: eliminar ayudantías ───────────────────────────────────────────
app.delete("/api/admin/ayudantias/docente/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM ayudantias_docente WHERE id = $1 RETURNING id",
      [Number(req.params.id)],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Ayudantía no encontrada" });
    }
    return res.json({ ok: true, message: "Ayudantía eliminada" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

app.delete("/api/admin/ayudantias/administrativa/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM ayudantias_administrativas WHERE id = $1 RETURNING id",
      [Number(req.params.id)],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Ayudantía no encontrada" });
    }
    return res.json({ ok: true, message: "Ayudantía eliminada" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`App corriendo en http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("No se pudo inicializar la base de datos", err);
    process.exit(1);
  });
