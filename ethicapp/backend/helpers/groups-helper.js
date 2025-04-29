import * as config from "../api/v2/config/config.json"; 
import * as rpg2 from "../db/rest-pg-2.js";

export const groupingAlgorithms = {
  random: createRandomGroups,
  preserve: preserveGroups
};

/**
 * Crea grupos de tamaño `groupSize` mezclando aleatoriamente
 * los estudiantes con rol 'A' en la sesión.
 */
async function createRandomGroups(sessionId, phases, groupSize) {
  // 1) Traer alumnos de la sesión
  const rows = await rpg2.execSQL({
    dbcon: config.dbconnString,
    sql: `
      SELECT u.id AS uid
      FROM sessions_users su
      JOIN users u ON su.user_id = u.id
      WHERE su.session_id = $1
        AND u.role = 'A'
    `,
    sqlParams: [rpg2.param('plain', sessionId)]
  });

  const studentIds = rows.map(r => r.uid);
  if (studentIds.length === 0) {
    console.warn("No students available in the session to form groups.");
    return [];
  }

  // 2) Barajar aleatoriamente
  const shuffled = studentIds.sort(() => Math.random() - 0.5);

  // 3) Repartir en grupos
  const groups = [];
  if (shuffled.length < groupSize) {
    groups.push(shuffled);
  } else {
    const fullGroups = Math.floor(shuffled.length / groupSize);
    const remainder = shuffled.length % groupSize;
    let index = 0;

    // Crear grupos completos
    for (let i = 0; i < fullGroups; i++) {
      groups.push(shuffled.slice(index, index + groupSize));
      index += groupSize;
    }

    // Distribuir sobrantes
    const leftovers = shuffled.slice(index);
    leftovers.forEach((uid, i) => {
      groups[i % groups.length].push(uid);
    });
  }

  return groups;
}

/**
 * Reproduce los grupos formados en la fase de grupo anterior
 * (para mantener a los mismos usuarios juntos).
 */
async function preserveGroups(sessionId, phases, groupSize) {
  if (!Array.isArray(phases) || phases.length === 0) {
    throw new Error("No phases provided for preserveGroups.");
  }

  // 1) Identificar la fase activa (la de mayor número)
  const activePhase = phases.reduce((prev, curr) =>
    curr.number > prev.number ? curr : prev, phases[0]);

  // 2) Buscar la fase grupal previa a la activa
  const prevGroupPhases = phases
    .filter(p => p.mode === "group")
    .filter(p => p.number < activePhase.number);

  if (prevGroupPhases.length === 0) {
    throw new Error("No previous group phase found for preserving groups.");
  }

  const previousPhase = prevGroupPhases.reduce((prev, curr) =>
    curr.number > prev.number ? curr : prev, prevGroupPhases[0]);

  // 3) Obtener los miembros de cada grupo de esa fase
  const rows = await rpg2.execSQL({
    dbcon: config.dbconnString,
    sql: `
      SELECT t.id AS team_id, tu.uid AS user_id
      FROM teams t
      JOIN teamusers tu ON t.id = tu.tmid
      WHERE t.sesid = $1
        AND t.stageid = $2
    `,
    sqlParams: [
      rpg2.param('plain', sessionId),
      rpg2.param('plain', previousPhase.id)
    ]
  });

  if (rows.length === 0) {
    console.warn("No groups found in the previous phase.");
    return [];
  }

  // 4) Agrupar por team_id
  const grouped = {};
  rows.forEach(row => {
    if (!grouped[row.team_id]) grouped[row.team_id] = [];
    grouped[row.team_id].push(row.user_id);
  });

  return Object.values(grouped);
}