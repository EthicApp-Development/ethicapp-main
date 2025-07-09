// helpers/groupingAlgorithms.js

const { Group, groupUser, User, SessionsUsers, ActivityUserRole } = require('../api/v2/models');
import { accumulateScoresByPhase, kendallTau, euclideanDistance } from './score-helper';

/**
 * Algoritmos de agrupación disponibles
 */
export const groupingAlgorithms = {
  random: createRandomGroups,
  preserve: preserveGroups,
  sameRole: createSameRoleGroups,
  distinctRole: createDistinctRoleGroups,
  similarResponses: createSimilarResponseGroups,
  diverseResponses: createDiverseResponseGroups
};


/**
 * Crea grupos “random” que tratan de respetar el tamaño ideal
 * pero permiten que algunos grupos excedan ese tamaño si así
 * minimiza la diferencia global entre grupos.
 *
 * @param {number} sessionId
 * @param {Phase[]} phases
 * @param {number} groupSize
 * @returns {Promise<number[][]>}
 */
async function createRandomGroups(sessionId, phases, groupSize) {
  const sessionUsers = await SessionsUsers.findAll({
    where: { session_id: sessionId },
    attributes: ['user_id'],
    raw: true
  });
  const userIds = sessionUsers.map(su => su.user_id);

  const users = await User.findAll({
    where: { id: userIds },
    attributes: ['id'],
    raw: true
  });
  const studentIds = users.map(u => u.id);

  if (studentIds.length === 0) {
    console.warn('No hay estudiantes para agrupar.');
    return [];
  }

  const shuffled = studentIds.sort(() => Math.random() - 0.5);

  // 4) Decide cuántos grupos crear
  const total = shuffled.length;
  let groupCount = Math.round(total / groupSize);
  if (groupCount < 1) groupCount = 1;

  // 5) Reparte round-robin
  const groups = Array.from({ length: groupCount }, () => []);
  shuffled.forEach((uid, i) => {
    groups[i % groupCount].push(uid);
  });

  return groups;
}

/**
 * Reutiliza los grupos de la fase anterior.
 * groupSize no se usa aquí, pues asumimos que ya vienen "correctos".
 *
 * @param {number} sessionId
 * @param {Phase[]} phases
 * @param {number} groupSize
 * @returns {Promise<number[][]>}
 */
async function preserveGroups(sessionId, phases, groupSize) {
  const activePhase = phases.reduce((a, b) => (a.number > b.number ? a : b));
  const prev = phases
    .filter(p => p.mode === 'group' && p.number < activePhase.number)
    .sort((a, b) => b.number - a.number)[0];

  if (!prev) throw new Error("No previous group phase found.");

  const rows = await Group.findAll({
    where: { session_id: sessionId },
    include: [{ model: groupUser, attributes: ['user_id'], raw: true }],
    raw: false
  });

  const byGroup = rows.map(g =>
    g.groupUsers.map(gu => gu.user_id)
  );
  return byGroup;
}


/**
 * Agrupa por roles similares, creando chunks de tamaño ideal
 * y luego redistribuyendo cualquier chunk muy pequeño (menos de la mitad)
 * al grupo de menor tamaño del mismo rol.
 *
 * @param {number} sessionId
 * @param {Phase[]} phases
 * @param {number} groupSize
 * @returns {Promise<number[][]>}
 */
async function createSameRoleGroups(sessionId, phases, groupSize) {
  if (!phases.length) return [];
  const activityId = phases[0].activity_id;

  // 1) Lee todas las asignaciones usuario→rol
  const assignments = await ActivityUserRole.findAll({
    where: { activityId },
    attributes: ['RoleId', 'userId'],
    raw: true
  });

  // 2) Agrupa userIds por RoleId
  const byRole = assignments.reduce((acc, { RoleId, userId }) => {
    acc[RoleId] = acc[RoleId] || [];
    acc[RoleId].push(userId);
    return acc;
  }, {});

  const finalGroups = [];

  // 3) Para cada rol, parte en chunks y balancea sobrantes
  for (const members of Object.values(byRole)) {
    // a) Chunking básico
    const chunks = [];
    for (let i = 0; i < members.length; i += groupSize) {
      chunks.push(members.slice(i, i + groupSize));
    }

    // b) Redistribuir si el último chunk es muy pequeño
    if (chunks.length > 1) {
      const last = chunks[chunks.length - 1];
      const threshold = Math.floor(groupSize / 2);
      if (last.length > 0 && last.length < threshold) {
        chunks.pop();
        for (const u of last) {
          // Meter en el chunk con menos integrantes
          const target = chunks.reduce((a, b) =>
            a.length <= b.length ? a : b
          );
          target.push(u);
        }
      }
    }

    // c) Acumular resultados
    chunks.forEach(grp => finalGroups.push(grp));
  }

  return finalGroups;
}


/**
 * Crea grupos intentando meter en cada uno la máxima variedad de roles.
 * Si sobran usuarios, los reparte en los grupos más pequeños.
 *
 * @param {number} sessionId
 * @param {Phase[]} phases
 * @param {number} groupSize
 * @returns {Promise<number[][]>}
 */
async function createDistinctRoleGroups(sessionId, phases, groupSize) {
  if (!phases.length) return [];
  const activityId = phases[0].activity_id;

  // 1) Leer todas las asignaciones usuario→rol
  const assignments = await ActivityUserRole.findAll({
    where: { activityId },
    attributes: ['RoleId', 'userId'],
    raw: true
  });

  // 2) Agrupar userIds por RoleId
  const byRole = assignments.reduce((acc, { RoleId, userId }) => {
    if (!acc[RoleId]) acc[RoleId] = [];
    acc[RoleId].push(userId);
    return acc;
  }, {});

  const roles = Object.keys(byRole);
  const totalUsers = assignments.length;

  // 3) Calcular cuántos grupos necesitamos
  const floorCount = Math.floor(totalUsers / groupSize) || 1;
  const ceilCount  = Math.ceil (totalUsers / groupSize);

  // Ejemplo de política:  
  // - Si al usar ceil queda algún grupo de tamaño 1, 
  //   prefiero floorCount para evitar mini‐grupos.
  // - En caso contrario uso ceilCount.
  let groupCount = ceilCount;
  if (totalUsers % groupSize === 1) {
    groupCount = floorCount;
}

  if (groupCount < 1) groupCount = 1;

  // 4) Inicializar grupos vacíos
  const groups = Array.from({ length: groupCount }, () => []);

  // 5) Fase de “roles distintos”: a cada grupo, de uno en uno, un usuario de cada rol
  for (const role of roles) {
    const queue = byRole[role];
    for (let i = 0; i < groupCount && queue.length; i++) {
      if (groups[i].length < groupSize) {
        groups[i].push(queue.shift());
      }
    }
  }

  // 6) Recolectar los usuarios sobrantes (los que no cupieron en la fase 5)
  const leftovers = [];
  for (const role of roles) {
    leftovers.push(...byRole[role]);
  }

  // 7) Repartir los sobrantes en los grupos más pequeños
  leftovers.sort(() => Math.random() - 0.5); // opcional: barajar para menos sesgo
  for (const u of leftovers) {
    const idx = groups.reduce(
      (minIdx, grp, i, arr) => (grp.length < arr[minIdx].length ? i : minIdx),
      0
    );
    groups[idx].push(u);
  }

  return groups;
}


/**
 * Agrupa alumnos con respuestas más similares entre sí.
 */
export async function createSimilarResponseGroups(sessionId, phases, groupSize, heteroQuestionIndex) {
  //console.log('Creating similar response groups...');
  // 1) Ordenar fases por número y tomar la fase previa a la activa
  const sortedPhases = [...phases].sort((a, b) => a.number - b.number);
  if (sortedPhases.length < 2) {
    throw new Error('No hay fase anterior de la cual acumular respuestas');
  }
  const prevPhase = sortedPhases[sortedPhases.length - 2];

  // 2) Acumular scores de la fase previa
  const { scoresByUser, isRanking } = await accumulateScoresByPhase(sessionId, prevPhase.id);

  // 3) Convertir a array de { userId, vector }
  const students = Object.entries(scoresByUser)
    .map(([userId, vector]) => ({ userId: +userId, vector }));

  // 4) Ordenar según el tipo
  if (isRanking) {
    console.log('Agrupando por respuestas idénticas (ranking)');

    // 1) Bucketizar por vector serializado
    const buckets = {};
    students.forEach(({ userId, vector }) => {
      const key = JSON.stringify(vector); 
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(userId);
    });

    // 2) Formar grupos a partir de cada bucket
    const groups = [];
    for (const ids of Object.values(buckets)) {
      for (let i = 0; i < ids.length; i += groupSize) {
        groups.push(ids.slice(i, i + groupSize));
      }
    }

    //console.log('Groups created (identical ranking):', groups);
    return groups;
  } else {
    // NO-RANKING: distancia media al resto, no al cero
    const distSums = {};
    for (const s of students) {
      distSums[s.userId] = students
        .filter(t => t.userId !== s.userId)
        .reduce((sum, t) => sum + euclideanDistance(s.vector, t.vector), 0)
        / (students.length - 1);
    }
    // ordenar por distancia media ascendente (más parecido primero)
    students.sort((a, b) => distSums[a.userId] - distSums[b.userId]);
  }

  // 5) Reparto en grupos evitando sobrantes con round-robin
  const groupCount = Math.ceil(students.length / groupSize);
  const groups = Array.from({ length: groupCount }, () => []);
  students.forEach((s, idx) => {
    groups[idx % groupCount].push(s.userId);
  });
  //console.log('Groups created en algoritmo:', groups);

  return groups;
}

/**
 * Agrupa buscando máxima diversidad de respuestas.
 */
export async function createDiverseResponseGroups(sessionId, phases, groupSize) {
  //console.log('Creating diverse response groups...');
  // 1) Ordenar fases y tomar la fase previa
  const sortedPhases = [...phases].sort((a, b) => a.number - b.number);
  if (sortedPhases.length < 2) {
    throw new Error('No hay fase anterior de la cual acumular respuestas');
  }
  const prevPhase = sortedPhases[sortedPhases.length - 2];

  // 2) Acumular scores de la fase previa
  const { scoresByUser, isRanking } = await accumulateScoresByPhase(sessionId, prevPhase.id);

  // 3) Convertir a array de { userId, vector }
  const students = Object.entries(scoresByUser)
    .map(([userId, vector]) => ({ userId: +userId, vector }));

  // 4) Crear secuencia zig-zag según métrica
  let seq = [];
  if (isRanking) {
    console.log('Agrupando por respuestas diversas (ranking)');
    // ranking → coeficiente medio de Kendall Tau
    const tauSums = {};
    for (const s of students) {
      tauSums[s.userId] = students
        .filter(t => t.userId !== s.userId)
        .reduce((sum, t) => sum + kendallTau(s.vector, t.vector), 0)
        / (students.length - 1);
    }
    const byTau = students.slice().sort((a, b) => tauSums[b.userId] - tauSums[a.userId]);
    let i = 0, j = byTau.length - 1;
    while (i <= j) {
      if (i === j) seq.push(byTau[i]);
      else {
        seq.push(byTau[i], byTau[j]);
      }
      i++; j--;
    }
  } else {
    // no-ranking → norma euclidiana
    const byNorm = students.slice().sort((a, b) =>
      euclideanDistance(a.vector, []) - euclideanDistance(b.vector, [])
    );
    let i = 0, j = byNorm.length - 1;
    while (i <= j) {
      if (i === j) seq.push(byNorm[i]);
      else {
        seq.push(byNorm[i], byNorm[j]);
      }
      i++; j--;
    }
  }

  // 5) Reparto round-robin en N grupos
  const total = seq.length;
  const groupCount = Math.max(1, Math.round(total / groupSize));
  const groups = Array.from({ length: groupCount }, () => []);
  seq.forEach((s, idx) => {
    groups[idx % groupCount].push(s.userId);
  });

  return groups;
}

