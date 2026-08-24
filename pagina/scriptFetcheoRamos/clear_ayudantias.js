const pool = require('../../db');

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function clearAyudantias({ docente, administrativa }) {
  // En este esquema, postulaciones_* referencian ayudantias_* con ON DELETE CASCADE.
  // TRUNCATE ... CASCADE limpia también postulaciones relacionadas y reinicia IDs.
  const truncateTargets = [];
  if (docente) truncateTargets.push('ayudantias_docente');
  if (administrativa) truncateTargets.push('ayudantias_administrativas');
  if (truncateTargets.length === 0) return;

  const sql = `TRUNCATE ${truncateTargets.join(', ')} RESTART IDENTITY CASCADE`;

  try {
    await pool.query(sql);
  } catch (err) {
    // 42P01 = undefined_table
    if (err && err.code === '42P01') {
      console.log('AVISO: tablas aún no existen; levanta la app una vez para crear el esquema.');
      return;
    }
    throw err;
  }
}

async function main() {
  const all = hasFlag('--all') || (!hasFlag('--docente') && !hasFlag('--administrativa'));
  const docente = all || hasFlag('--docente');
  const administrativa = all || hasFlag('--administrativa');

  try {
    await clearAyudantias({ docente, administrativa });
    console.log(`OK: ayudantías borradas (docente=${docente}, administrativa=${administrativa})`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('ERROR borrando ayudantías:', err);
  process.exitCode = 1;
});
