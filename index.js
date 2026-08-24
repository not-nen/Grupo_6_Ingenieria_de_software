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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

app.use(express.static(path.join(__dirname, "pagina")));
app.use("/uploads", express.static(uploadsDir));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ayudante (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      password VARCHAR(160) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
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
      ayudante_id INTEGER REFERENCES ayudante(id) ON DELETE SET NULL,
      nombre_estudiante VARCHAR(120) NOT NULL,
      email_estudiante VARCHAR(160) NOT NULL,
      motivacion TEXT NOT NULL,
      documentos TEXT NOT NULL,
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
      ayudante_id INTEGER REFERENCES ayudante(id) ON DELETE SET NULL,
      nombre_estudiante VARCHAR(120) NOT NULL,
      email_estudiante VARCHAR(160) NOT NULL,
      motivacion TEXT NOT NULL,
      documentos TEXT NOT NULL,
      estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente',
      respuesta VARCHAR(120) NOT NULL DEFAULT 'Pendiente',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      fecha_estado TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notificaciones_estudiante (
      id SERIAL PRIMARY KEY,
      ayudante_id INTEGER REFERENCES ayudante(id) ON DELETE SET NULL,
      nombre_estudiante VARCHAR(120) NOT NULL,
      email_estudiante VARCHAR(160) NOT NULL,
      mensaje TEXT NOT NULL,
      leida BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS registro_horas (
      id SERIAL PRIMARY KEY,
      ayudante_id INTEGER REFERENCES ayudante(id) ON DELETE SET NULL,
      nombre_ayudante VARCHAR(120) NOT NULL,
      email_ayudante VARCHAR(160) NOT NULL,
      semana_inicio DATE NOT NULL,
      horas NUMERIC(6,2) NOT NULL CHECK (horas >= 0),
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

  // Añadir columna ayudantia_descripcion si no existe (migración no destructiva)
  await pool.query(`
    ALTER TABLE registro_horas
    ADD COLUMN IF NOT EXISTS ayudantia_descripcion VARCHAR(200)
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
    return { table: "ayudante", redirect: "/estudiante" };
  }
  if (role === "profesor") {
    return { table: "profesor", redirect: "/profesor" };
  }
  if (role === "administrador") {
    return { table: "administrador", redirect: "/admin" };
  }
  return null;
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

app.get("/registro-horas", (req, res) => {
  res.sendFile(path.join(__dirname, "pagina", "registro-horas.html"));
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
  upload.single("archivos"),
  async (req, res) => {
    try {
      const { ayudantiaId, nombreEstudiante, emailEstudiante, motivacion } =
        req.body;

      if (
        !ayudantiaId ||
        !nombreEstudiante ||
        !emailEstudiante ||
        !motivacion
      ) {
        return res.status(400).json({ error: "Faltan campos obligatorios" });
      }

      const documentos = req.file ? req.file.filename : "Sin archivos adjuntos";

      const ayudantia = await pool.query(
        "SELECT id FROM ayudantias_docente WHERE id = $1",
        [ayudantiaId],
      );
      if (ayudantia.rowCount === 0) {
        return res.status(404).json({ error: "Ayudantía no encontrada" });
      }

      const ayudanteResult = await pool.query(
        "SELECT id FROM ayudante WHERE email = $1",
        [String(emailEstudiante).trim().toLowerCase()],
      );
      const ayudanteId =
        ayudanteResult.rowCount > 0 ? ayudanteResult.rows[0].id : null;

      await pool.query(
        `INSERT INTO postulaciones_docente
      (ayudantia_docente_id, ayudante_id, nombre_estudiante, email_estudiante, motivacion, documentos, estado, respuesta)
      VALUES ($1, $2, $3, $4, $5, $6, 'Pendiente', 'Pendiente')`,
        [
          Number(ayudantiaId),
          ayudanteId,
          String(nombreEstudiante).trim(),
          String(emailEstudiante).trim().toLowerCase(),
          String(motivacion).trim(),
          documentos,
        ],
      );

      return res.json({
        ok: true,
        message: "Postulación registrada con estado Pendiente",
      });
    } catch (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res
          .status(400)
          .json({ error: "Un archivo supera el límite de 15 MB" });
      }
      console.error(err);
      return res.status(500).json({ error: "Error de servidor" });
    }
  },
);

app.post(
  "/api/postulaciones/administrativa",
  upload.single("archivos"),
  async (req, res) => {
    try {
      const { ayudantiaId, nombreEstudiante, emailEstudiante, motivacion } =
        req.body;

      if (
        !ayudantiaId ||
        !nombreEstudiante ||
        !emailEstudiante ||
        !motivacion
      ) {
        return res.status(400).json({ error: "Faltan campos obligatorios" });
      }

      const documentos = req.file ? req.file.filename : "Sin archivos adjuntos";

      const ayudantia = await pool.query(
        "SELECT id FROM ayudantias_administrativas WHERE id = $1",
        [ayudantiaId],
      );
      if (ayudantia.rowCount === 0) {
        return res.status(404).json({ error: "Ayudantía no encontrada" });
      }

      const ayudanteResult = await pool.query(
        "SELECT id FROM ayudante WHERE email = $1",
        [String(emailEstudiante).trim().toLowerCase()],
      );
      const ayudanteId =
        ayudanteResult.rowCount > 0 ? ayudanteResult.rows[0].id : null;

      await pool.query(
        `INSERT INTO postulaciones_administrativas
      (ayudantia_administrativa_id, ayudante_id, nombre_estudiante, email_estudiante, motivacion, documentos, estado, respuesta)
      VALUES ($1, $2, $3, $4, $5, $6, 'Pendiente', 'Pendiente')`,
        [
          Number(ayudantiaId),
          ayudanteId,
          String(nombreEstudiante).trim(),
          String(emailEstudiante).trim().toLowerCase(),
          String(motivacion).trim(),
          documentos,
        ],
      );

      return res.json({
        ok: true,
        message: "Postulación registrada con estado Pendiente",
      });
    } catch (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res
          .status(400)
          .json({ error: "Un archivo supera el límite de 15 MB" });
      }
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
    const postulaciones = result.rows;

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
             p.estado,
             p.respuesta,
             p.created_at,
             p.fecha_estado
      FROM postulaciones_docente p
      INNER JOIN ayudantias_docente a ON a.id = p.ayudantia_docente_id
      ORDER BY ${orderClause}
    `;

    const result = await pool.query(query);
    const postulaciones = result.rows;

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
             p.estado,
             p.respuesta,
             p.created_at,
             p.fecha_estado
      FROM postulaciones_administrativas p
      INNER JOIN ayudantias_administrativas a ON a.id = p.ayudantia_administrativa_id
      ORDER BY ${orderClause}
    `;

      const result = await pool.query(query);
      const postulaciones = result.rows;

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
    const refreshed = refreshResult.rows[0];

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

app.post("/api/horas", async (req, res) => {
  try {
    const {
      nombreAyudante,
      emailAyudante,
      semanaInicio,
      horas,
      ayudantiaDescripcion,
    } = req.body;
    if (
      !nombreAyudante ||
      !emailAyudante ||
      !semanaInicio ||
      horas === undefined ||
      horas === null ||
      horas === ""
    ) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }

    const horasNumber = Number(horas);
    if (!Number.isFinite(horasNumber)) {
      return res
        .status(400)
        .json({ error: "Ingrese una cantidad de horas válida y numérica" });
    }

    if (horasNumber <= 0) {
      return res
        .status(400)
        .json({ error: "Las horas deben ser mayores a cero" });
    }

    const ayudanteResult = await pool.query(
      "SELECT id FROM ayudante WHERE email = $1",
      [String(emailAyudante).trim().toLowerCase()],
    );
    const ayudanteId =
      ayudanteResult.rowCount > 0 ? ayudanteResult.rows[0].id : null;

    await pool.query(
      `INSERT INTO registro_horas
      (ayudante_id, nombre_ayudante, email_ayudante, semana_inicio, horas, ayudantia_descripcion)
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        ayudanteId,
        String(nombreAyudante).trim(),
        String(emailAyudante).trim().toLowerCase(),
        semanaInicio,
        horasNumber,
        ayudantiaDescripcion ? String(ayudantiaDescripcion).trim() : null,
      ],
    );

    return res.json({ ok: true, message: "Horas registradas correctamente" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

app.get("/api/horas", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Debe indicar email" });
    }
    const result = await pool.query(
      `SELECT id, semana_inicio, horas, ayudantia_descripcion, created_at
       FROM registro_horas
       WHERE email_ayudante = $1
       ORDER BY semana_inicio DESC, created_at DESC`,
      [String(email).trim().toLowerCase()],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error de servidor" });
  }
});

app.get("/api/estudiante/ayudantias-activas", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Debe indicar email" });
    }
    const emailNorm = String(email).trim().toLowerCase();

    const docenteResult = await pool.query(
      `SELECT p.id AS postulacion_id, 'docente' AS fuente,
              a.asignatura || ' — Paralelo ' || a.paralelo AS descripcion
       FROM postulaciones_docente p
       INNER JOIN ayudantias_docente a ON a.id = p.ayudantia_docente_id
       WHERE p.email_estudiante = $1 AND p.estado = 'Seleccionado entrevista'`,
      [emailNorm],
    );

    const adminResult = await pool.query(
      `SELECT p.id AS postulacion_id, 'administrativa' AS fuente,
              a.glosa AS descripcion
       FROM postulaciones_administrativas p
       INNER JOIN ayudantias_administrativas a ON a.id = p.ayudantia_administrativa_id
       WHERE p.email_estudiante = $1 AND p.estado = 'Seleccionado entrevista'`,
      [emailNorm],
    );

    return res.json([...docenteResult.rows, ...adminResult.rows]);
  } catch (err) {
    console.error(err);
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
