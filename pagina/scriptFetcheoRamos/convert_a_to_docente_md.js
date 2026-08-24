const fs = require('fs');
const path = require('path');

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('-')) return null;
  return value;
}

function getArgInt(flag, fallback) {
  const raw = getArgValue(flag);
  if (raw == null) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
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

function normalizeField(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function extractParalelo(value) {
  const raw = normalizeField(value);
  if (!raw) return '';
  const match = raw.match(/\d+/);
  return match ? match[0] : raw;
}

function parseLines(fileContent) {
  const lines = fileContent
    .split(/\r?\n/)
    .map((l) => l.replace(/\r/g, ''))
    .filter((l) => l.trim().length > 0);

  // Se espera header tipo: Sigla\tAsignatura\tDepartamento\tParalelo\tProfesor\tCupos\tHorario
  // Hay filas “continuación” donde Sigla/Asignatura/Departamento vienen vacíos.
  let currentSigla = '';
  let currentAsignatura = '';
  let currentDepartamento = '';

  const entries = [];
  const seen = new Set();

  for (const line of lines) {
    if (/^\s*Sigla\s*\t/i.test(line)) {
      continue;
    }

    // Split por tabs preservando campos vacíos.
    const parts = line.split('\t');

    // Heurística:
    // - Fila completa: sigla no vacía (normalmente 7 columnas).
    // - Fila continuación: sigla vacía, y puede venir “comprimida” (5 cols) o “padded” (7 cols con vacíos).
    const normalized = parts.map((p) => normalizeField(p));

    let sigla = normalized[0] ?? '';
    let asignatura = '';
    let departamento = '';
    let paralelo = '';

    if (sigla) {
      // Fila completa.
      asignatura = normalized[1] ?? '';
      departamento = normalized[2] ?? '';
      paralelo = normalized[3] ?? '';

      currentSigla = sigla;
      if (asignatura) currentAsignatura = asignatura;
      if (departamento) currentDepartamento = departamento;
    } else {
      // Fila continuación: NO sobreescribir el contexto.
      sigla = currentSigla;
      asignatura = currentAsignatura;
      departamento = currentDepartamento;

      // Caso “padded” (7 cols): ['', '', '', '201', 'PROF', '50', 'Ver horario']
      // Caso “comprimido” (5 cols): ['', '201', 'PROF', '50', 'Ver horario']
      if (normalized.length >= 7 && !normalized[1] && !normalized[2]) {
        paralelo = normalized[3] ?? '';
      } else {
        paralelo = normalized[1] ?? '';
      }
    }

    paralelo = extractParalelo(paralelo);

    if (!sigla || !paralelo) {
      continue;
    }

    const key = `${sigla}::${paralelo}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({ sigla, asignatura, departamento, paralelo });
  }

  return entries;
}

function toMarkdown(entries, { sourceLabel, emplazamiento, horas }) {
  const header = [
    '# Ayudantías docentes (formato resumido)',
    '',
    `- Fuente: ${sourceLabel}`,
    `- Emplazamiento (default): ${emplazamiento}`,
    `- Horas (default): ${horas}`,
    '',
    'Formato: `SIGLA | Emplazamiento | Paralelo N | X horas`',
    '',
  ].join('\n');

  const body = entries
    .map((e) => `${e.sigla} | ${emplazamiento} | Paralelo ${e.paralelo} | ${horas} horas`)
    .join('\n');

  return `${header}${body}\n`;
}

function main() {
  const explicitInput = getArgValue('--input');
  const explicitOutput = getArgValue('--output');

  const inputPath = resolveFirstExistingPath(
    explicitInput,
    path.join(__dirname, 'a.md'),
  );

  if (!inputPath) {
    console.error('No se encontró el archivo de entrada. Usa --input <ruta>.');
    process.exitCode = 1;
    return;
  }

  const outputPath = explicitOutput
    ? explicitOutput
    : path.join(__dirname, 'ayudantias_docentes_formato.md');

  const emplazamiento = getArgValue('--emplazamiento') ?? 'San Joaquin';
  const horas = getArgInt('--horas', 6);

  const content = fs.readFileSync(inputPath, 'utf8');
  const entries = parseLines(content);

  const md = toMarkdown(entries, { sourceLabel: path.basename(inputPath), emplazamiento, horas });
  fs.writeFileSync(outputPath, md, 'utf8');

  console.log(`OK: ${entries.length} filas -> ${outputPath}`);
}

main();
