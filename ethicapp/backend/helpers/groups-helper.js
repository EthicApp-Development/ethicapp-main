//import { Group, groupUser, User, sessions_users } from '../api/v2/models';
const { Group, groupUser, User, SessionsUsers } = require('../api/v2/models');

/**
 * Algoritmos de agrupación disponibles
 */
export const groupingAlgorithms = {
  random: createRandomGroups,
  preserve: preserveGroups
};

/**
 * Crea grupos aleatorios usando Sequelize en vez de SQL plano
 */
async function createRandomGroups(sessionId, phases, groupSize) {

  const sessionUsers = await SessionsUsers.findAll({
    where: { session_id: sessionId },
    attributes: ['user_id']
  });

  const userIds = sessionUsers.map(su => su.user_id);

  // 2. Buscar esos usuarios con rol 'A'
  const users = await User.findAll({
    where: {
      id: userIds
    },
    attributes: ['id']
  });
  const studentIds = users.map(u => u.id);

  if (studentIds.length === 0) {
    console.warn('No hay estudiantes para agrupar.');
    return [];
  }

  // Barajar aleatoriamente
  const shuffled = studentIds.sort(() => Math.random() - 0.5);

  // Dividir en grupos
  const groups = [];
  let idx = 0;

  for (const uid of shuffled) {
    if (!groups[idx]) groups[idx] = [];
    groups[idx].push(uid);
    if (groups[idx].length >= groupSize) idx++;
  }

  return groups;
}

/**
 * Agrupa reutilizando los mismos grupos anteriores (versión básica)
 */
async function preserveGroups(sessionId, phases, groupSize) {
  const activePhase = phases.reduce((a, b) => (a.number > b.number ? a : b));
  const previousGroupPhase = phases
    .filter(p => p.type === 'group' && p.number < activePhase.number)
    .sort((a, b) => b.number - a.number)[0];

  if (!previousGroupPhase) {
    throw new Error("No previous group phase found.");
  }

  const rows = await Group.findAll({
    where: { session_id: sessionId },
    include: [{
      model: groupUser,
      attributes: ['user_id']
    }]
  });

  const grouped = {};
  for (const g of rows) {
    grouped[g.id] = g.groupUsers.map(gu => gu.user_id);
  }

  return Object.values(grouped);
}
