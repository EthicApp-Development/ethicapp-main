const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const auth = require('../v2/middleware/authenticateToken');
const checkAbility = require('../v2/middleware/checkAbility');
const { Activity, Session,SessionsUsers, User, Phase, Question, Response } = require('../../api/v2/models');

// Configuración de caché
const CACHE_TTL = 30; // 30 segundos
const TEACHER_CACHE_PREFIX = 'teacher_activity_state:';
const STUDENT_CACHE_PREFIX = 'student_activity_state:';

router.use(bodyParser.json());

/**
 * Endpoint para obtener el estado completo de una actividad para el profesor
 * Incluye caché con Redis
 */
router.get('/teacher/activities/:activityId/state', auth, checkAbility('read', 'Activity'), async (req, res) => {
    const redis = req.app.locals.redisClient;
    try {
        const { activityId } = req.params;
        const { id: userId } = req.user;

        // Intentar obtener del caché
        const cacheKey = `${TEACHER_CACHE_PREFIX}${activityId}_${userId}`;
        const cachedData = await redis.get(cacheKey);
        
        if (cachedData) {
            return res.status(200).json(JSON.parse(cachedData));
        }

        // 1. Obtener actividad
        const activity = await Activity.findByPk(activityId);
        if (!activity) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'Actividad no encontrada' 
            });
        }

        // 2. Obtener sesión
        const session = await Session.findByPk(activity.session);
        if (!session) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'Sesión no encontrada' 
            });
        }

        // 3. Verificar permisos
        if (session.creator !== userId) {
            return res.status(403).json({ 
                status: 'error', 
                message: 'No tienes permiso para ver esta actividad' 
            });
        }

        // 4. Obtener usuarios de la sesión usando la tabla intermedia
        const sessionUsers = await SessionsUsers.findAll({
            where: { session_id: session.id }
        });
        const users = await User.findAll({
            where: { id: sessionUsers.map(user => user.user_id) }
        });
        // 5. Obtener fases
        const phases = await Phase.findAll({
            where: { activity_id: activityId }
        });

        // 6. Para cada fase, obtener sus preguntas
        const phasesWithDetails = await Promise.all(phases.map(async (phase) => {
            const questions = await Question.findAll({
                where: { phase_id: phase.id }
            });

            const questionsWithResponses = await Promise.all(questions.map(async (question) => {
                const responses = await Response.findAll({
                    where: { question_id: question.id }
                });

                const responsesWithUsers = await Promise.all(responses.map(async (response) => {
                    const user = await User.findByPk(response.user_id, {
                        attributes: ['id', 'name', 'mail']
                    });

                    return {
                        id: response.id,
                        content: response.content,
                        type: response.type,
                        user: user,
                        created_at: response.createdAt
                    };
                }));

                return {
                    id: question.id,
                    text: question.text,
                    type: question.type,
                    responses: responsesWithUsers
                };
            }));

            return {
                id: phase.id,
                number: phase.number,
                type: phase.type,
                status: phase.status,
                questions: questionsWithResponses
            };
        }));

        const formattedResponse = {
            status: 'success',
            data: {
                activity: {
                    id: activity.id,
                    status: activity.status,
                    created_at: activity.createdAt,
                    updated_at: activity.updatedAt
                },
                session: {
                    id: session.id,
                    name: session.name,
                    creator: session.creator,
                    users: sessionUsers
                },
                phases: phasesWithDetails
            }
        };

        // Guardar en caché solo si la respuesta fue exitosa
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(formattedResponse));

        return res.status(200).json(formattedResponse);

    } catch (error) {
        return res.status(500).json({ 
            status: 'error', 
            message: 'Error interno del servidor',
            error: error.message 
        });
    }
});

/**
 * Endpoint para obtener el estado de una actividad para el alumno
 * Incluye caché con Redis
 */
router.get('/student/activities/:activityId/state', auth, async (req, res) => {
    const redis = req.app.locals.redisClient;
    const { activityId } = req.params;
    const { id: userId } = req.user;

    try {
        // Intentar obtener del caché
        const cacheKey = `${STUDENT_CACHE_PREFIX}${activityId}_${userId}`;
        const cachedData = await redis.get(cacheKey);
        
        if (cachedData) {
            return res.status(200).json(JSON.parse(cachedData));
        }

        // 1. Obtener actividad con sus fases
        const activity = await Activity.findByPk(activityId, {
            include: [
                {
                    model: Phase,
                    as: 'Phases',
                    include: [
                        {
                            model: Question,
                            as: 'questions'
                        }
                    ]
                }
            ]
        });
        if (!activity) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'Actividad no encontrada' 
            });
        }

        // 2. Obtener sesión
        const session = await Session.findByPk(activity.session);
        if (!session) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'Sesión no encontrada' 
            });
        }

        // 3. Verificar si el estudiante está en la sesión
        const studentInSession = await SessionsUsers.findOne({
            where: { 
                session_id: session.id,
                user_id: userId
            }
        });

        if (!studentInSession) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'No tienes acceso a esta actividad' 
            });
        }

        // 4. Obtener respuestas del estudiante para todas las preguntas
        const questions = activity.Phases.flatMap(phase => phase.questions);
        const questionIds = questions.map(q => q.id);
        
        const responses = await Response.findAll({
            where: {
                question_id: questionIds,
                user_id: userId
            }
        });

        // 5. Formatear la respuesta
        const currentPhase = activity.Phases.find(phase => phase.status === 'active') || null;
        
        const formattedResponse = {
            status: 'success',
            data: {
                activity: {
                    id: activity.id,
                    status: activity.status
                },
                current_phase: currentPhase ? {
                    id: currentPhase.id,
                    number: currentPhase.number,
                    type: currentPhase.type,
                    status: currentPhase.status
                } : null,
                my_responses: responses.map(response => ({
                    question_id: response.question_id,
                    content: response.content,
                    created_at: response.createdAt
                }))
            }
        };

        // Guardar en caché solo si la respuesta fue exitosa
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(formattedResponse));

        return res.status(200).json(formattedResponse);

    } catch (error) {
        return res.status(500).json({ 
            status: 'error', 
            message: 'Error interno del servidor' 
        });
    }
});

// Exporta el router
module.exports = router; 