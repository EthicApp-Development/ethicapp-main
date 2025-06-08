import { Question, Response, SessionsUsers } from '../api/v2/models';
//console.log('HELP → models.resolve:', require.resolve('../api/v2/models'));

export async function accumulateScoresByPhase(sessionId, phaseId) {
  // 1) Lista de alumnos activos en la sesión
  console.log(
    'API-level responses:',
    await Response.findAll({ where: { question_id: phaseId }, raw: true })
  );
  const sessionUsers = await SessionsUsers.findAll({
    where: { session_id: sessionId },
    attributes: ['user_id'],
    raw: true
  });
  console.log('Session users:', sessionUsers);
  const studentIds = sessionUsers.map(su => su.user_id);

  // 2) Preguntas de la fase
  const questions = await Question.findAll({
    where: { phase_id: phaseId },
    attributes: ['id', 'type'],
    raw: true
  });

  // 3) Inicializar map: userId → []
  const scoresByUser = {};
  studentIds.forEach(id => { scoresByUser[id] = []; });
  console.log('questions:', questions);
  // 4) Recorrer cada pregunta y sus respuestas
  for (const { id: qId } of questions) {
    const responses = await Response.findAll({
      where: { question_id: qId },
      attributes: ['user_id', 'score'],
      raw: true
    });
    console.log(`Responses for question ${qId}:`, responses);
    for (const { user_id, score } of responses) {
      // score ya es Array<Float>
      scoresByUser[user_id] = scoresByUser[user_id].concat(score);
    }
  }

  // ¿Todas las preguntas de ranking? (si sólo hay una ranking, se detecta por type)
  const isRanking = questions.length === 1 && questions[0].type === 'ranking';

  console.log('Scores by user:', scoresByUser);
  console.log('Is ranking:', isRanking);
  return { scoresByUser, isRanking };
}


// 1) Kendall Tau (versión simplificada: coeficiente de correlación)
export function kendallTau(a, b) {
  //console.log('Kendall Tau:', a, b);
  let concord = 0, discord = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const signA = Math.sign(a[i] - a[j]);
      const signB = Math.sign(b[i] - b[j]);
      if (signA * signB > 0) concord++;
      else if (signA * signB < 0) discord++;
    }
  }
  const denom = concord + discord;
  return denom === 0 ? 0 : (concord - discord) / denom;
}

// 2) Distancia Euclidiana
export function euclideanDistance(a, b) {
  const sumSq = a.reduce((acc, ai, i) => acc + (ai - (b[i] || 0))**2, 0);
  return Math.sqrt(sumSq);
}