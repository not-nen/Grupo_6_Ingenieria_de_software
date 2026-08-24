const fs = require("fs");
const path = require("path");
const pool = require("../../db");

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("-")) return null;
  return value;
}

function parseIntSafe(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractNumber(value) {
  const match = String(value ?? "").match(/\d+/);
  return match ? match[0] : "";
}

function resolveFirstExistingPath(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {
      // ignore
    }
  }
  return null;
}

function loadFromFormatoMd() {
  const explicitPath = getArgValue("--file");
  const formatoPath = resolveFirstExistingPath(
    explicitPath,
    path.join(__dirname, "ayudantias_administrativas_formato.md"),
  );

  if (!formatoPath) {
    throw new Error(
      "No se encontró ayudantias_administrativas_formato.md. Usa --file <ruta>.",
    );
  }

  const content = fs.readFileSync(formatoPath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const defaultDepartamento = getArgValue("--departamento") ?? "SIN INFORMACIÓN";
  const defaultTipo = getArgValue("--tipo") ?? "Administrativa";
  const defaultInicio = getArgValue("--inicio") ?? "2026-04-01";
  const defaultTermino = getArgValue("--termino") ?? "2026-07-30";

  const rows = [];
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

    const sigla = parts[0];
    const emplazamiento = parts[1];
    const paralelo = extractNumber(parts[2]);
    const horas = parseIntSafe(extractNumber(parts[3]), 6);

    if (!sigla || !emplazamiento || !paralelo) continue;

    let codigo = `${sigla}-${paralelo}`;
    if (codigo.length > 30) codigo = codigo.slice(0, 30);

    const key = codigo;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      codigo,
      glosa: `${sigla} — Paralelo ${paralelo}`,
      emplazamiento,
      departamento: defaultDepartamento,
      tipo_ayudantia: defaultTipo,
      inicio: defaultInicio,
      termino: defaultTermino,
      horas,
    });
  }

  return rows;
}

function chunkArray(items, chunkSize) {
  const result = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    result.push(items.slice(i, i + chunkSize));
  }
  return result;
}

async function insertChunk(client, rows) {
  const values = [];
  const placeholders = [];
  let index = 1;

  for (const row of rows) {
    placeholders.push(
      `($${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, 'Disponible')`,
    );
    values.push(
      row.codigo,
      row.glosa,
      row.emplazamiento,
      row.departamento,
      row.tipo_ayudantia,
      row.inicio,
      row.termino,
      row.horas,
    );
  }

  const sql = `
    INSERT INTO ayudantias_administrativas
      (codigo, glosa, emplazamiento, departamento, tipo_ayudantia, inicio, termino, horas, estado)
    VALUES
      ${placeholders.join(",\n      ")}
    ON CONFLICT (codigo) DO NOTHING
  `;

  await client.query(sql, values);
}

async function main() {
  const reset = hasFlag("--reset");
  let rows;
  try {
    rows = loadFromFormatoMd();
  } catch (err) {
    console.error(String(err?.message ?? err));
    process.exitCode = 1;
    return;
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    console.error(
      "No se encontraron filas en ayudantias_administrativas_formato.md",
    );
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (reset) {
      await client.query(
        "TRUNCATE ayudantias_administrativas RESTART IDENTITY CASCADE",
      );
      console.log("OK: ayudantias_administrativas truncada");
    }

    const chunks = chunkArray(rows, 100);
    for (const [i, chunk] of chunks.entries()) {
      await insertChunk(client, chunk);
      console.log(
        `Insert chunk ${i + 1}/${chunks.length} (${chunk.length} filas)`,
      );
    }

    await client.query("COMMIT");
    console.log(`OK: seeded ${rows.length} ayudantías administrativas`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERROR seed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
