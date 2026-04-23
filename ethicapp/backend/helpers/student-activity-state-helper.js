import * as config from "../config/config.js"
import * as rpg2 from "../db/rest-pg-2.js"
import redisClient from "../db/redis.js";
import { responseFactories } from  "../../common/modules/design-types.js";
import * as DesignsHelper from "../helpers/designs-helper.js"
import * as ActivitiesHelper from "../helpers/activities-helper.js"

export const buildInitialPhaseState = async function (phaseId) {
    try {
        // Fetch tasks and design data for the phase
        const tasksObj = await getCachedPhaseTasks(phaseId);
        const phaseDesign = await DesignsHelper.getPhaseDesignByPhaseId(phaseId);
        const designType = await DesignsHelper.getDesignTypeByPhaseId(phaseId);
        const phaseNumber = await ActivitiesHelper.getPhaseNumberByPhaseId(phaseId);

        // Retrieve the response factory for the design type
        const responseFactory = responseFactories[designType];
        if (!responseFactory) {
            console.error("[buildInitialPhaseState] Error: Unsupported design type!");
            return null;
        }

        // Generate responses for each task
        const responses = tasksObj.tasks.map(task => responseFactory(task));

        return {
            phase: {
                id: phaseId,
                number: phaseNumber,
                features: {
                    chat: phaseDesign.chat,
                    anonymity: phaseDesign.anonymous,
                    previousResponses: phaseDesign.prevPhasesResponse || []
                },
                tasks: tasksObj.tasks,
                responses: responses,
                peerResponses: [],
                group: [],
                groupMessages: {}
            }
        };
    } catch (error) {
        console.error("[buildInitialPhaseState] Error building initial phase state:", error);
        throw error; // Re-throw the error for higher-level handling if necessary
    }
};

export async function getCachedStudentActivityDescriptor(sessionId, invalidate = false) {
    if (!sessionId || isNaN(Number(sessionId))) {
        throw new Error("Invalid sessionId");
    }

    const cacheKey = `descriptor:${sessionId}`;

    // Check if cache invalidation is requested
    if (invalidate) {
        await redisClient.del(cacheKey);
    } else {
        // Try to retrieve the descriptor from the cache
        const cachedDescriptor = await redisClient.get(cacheKey);
        if (cachedDescriptor) {
            return JSON.parse(cachedDescriptor);
        }
    }

    // Fetch the descriptor from the database
    const descriptor = await getStudentActivityDescriptor(sessionId);

    // Cache the descriptor with a TTL of one hour
    if (descriptor) {
        await redisClient.set(cacheKey, JSON.stringify(descriptor), 'EX', 3600); // TTL: 3600 seconds
    }

    return descriptor;
}

export async function getStudentActivityDescriptor(sessionId) {
    if (!sessionId || isNaN(Number(sessionId))) {
        console.error("Invalid sessionId:", sessionId);
        return { descriptor: {} };
    }

    try {
        const descriptorQuery = `
            SELECT 
                s.descr AS description,
                a.design AS design,
                st.number AS currentphasenumber,
                st.id AS currentphaseid
            FROM 
                sessions s
            JOIN 
                activity a ON s.id = a.session
            JOIN 
                stages st ON st.id = s.current_stage
            WHERE 
                s.id = $1;
        `;

        const descriptorResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: descriptorQuery,
            sqlParams: [rpg2.param('plain', Number(sessionId))], // Correct usage of rpg2.param
        });

        if (descriptorResult.length === 0) {
            console.warn(`No descriptor found for sessionId ${sessionId}.`);
            return { descriptor: {} };
        }

        const {
            description, 
            design, 
            currentphasenumber: currentPhaseNumber,
            currentphaseid: currentPhaseId
         } = descriptorResult[0];

        return {
            descriptor: {
                description,
                design,
                currentPhaseNumber,
                currentPhaseId
            },
        };
    } catch (error) {
        console.error(
            `Unable to load the activity descriptor for sessionId ${sessionId}:`,
            error
        );
        return { descriptor: {} };
    }
}

/**
 * Wrapper function to get student activity phases with Redis caching.
 * @param {number} sessionId - The session ID.
 * @returns {Promise<Object>} An object containing the phases.
 */
export async function getCachedStudentActivityPhases(sessionId, invalidate = false) {
    if (!sessionId || isNaN(Number(sessionId))) {
        console.error("Invalid sessionId:", sessionId);
        return { phases: [] };
    }

    const cacheKey = `session:${sessionId}:phases`;

    try {
        // Handle cache invalidation
        if (invalidate) {
            console.debug(`Invalidating cache for sessionId: ${sessionId}`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                console.debug(`Cache hit for sessionId: ${sessionId}`);
                return JSON.parse(cachedData);
            }
        }

        // Cache miss or invalidation: Fetch from database
        console.debug(`Cache miss for sessionId: ${sessionId}, querying database.`);
        const { phases } = await getStudentActivityPhases(sessionId);

        // Cache the result
        if (phases) {
            await redisClient.set(cacheKey, JSON.stringify({ phases }), 'EX', 300);
        }

        return { phases };
    } catch (error) {
        console.error(`Error in getCachedStudentActivityPhases for sessionId ${sessionId}:`, error);
        // Fallback to database if cache operation fails
        return await getStudentActivityPhases(sessionId);
    }
}

export async function getStudentActivityPhases(sessionId) {
    if (!sessionId || isNaN(Number(sessionId))) {
        console.error("Invalid sessionId:", sessionId);
        return { phases: [] };
    }

    try {
        // Query to get the phases
        const phasesQuery = `
            SELECT
                st.id
                st.number, 
                st.type AS mode, 
                st.anon, 
                st.chat
            FROM 
                stages st
            WHERE 
                st.sesid = $1;
        `;

        const phasesResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: phasesQuery,
            sqlParams: [rpg2.param('plain', Number(sessionId))],
        });

        // Transform phases into the desired format
        const phases = phasesResult.map(phase => ({
            id: phase.id,
            number: phase.number,
            features: {
                mode: phase.mode,
                chat: phase.chat,
                anonymity: phase.anon,
            },
            tasks: [], // Placeholder: Add query to retrieve tasks
            responses: [], // Placeholder: Add query to retrieve responses
            peerResponses: [], // Placeholder: Add query to retrieve peer responses
            group: {}, // Placeholder: Add query to retrieve group info
            groupMessages: [], // Placeholder: Add query to retrieve group messages
        }));

        return { phases };
    } catch (error) {
        console.error(`Unable to load the phases for sessionId ${sessionId}:`, error);
        return { phases: [] };
    }
}

/**
 * Wrapper function to cache the result of getStudentActivityGroups.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to integrate group data into.
 * @returns {Promise<Array>} The updated phases with group data.
 */
export async function getCachedStudentActivityGroups(sessionId, userId, phases, invalidate = false) {
    if (!sessionId || isNaN(Number(sessionId)) || !userId || isNaN(Number(userId))) {
        console.error("Invalid sessionId or userId:", { sessionId, userId });
        return phases;
    }

    const cacheKey = `session:${sessionId}:user:${userId}:groups`;

    try {
        // Handle cache invalidation
        if (invalidate) {
            console.debug(`Invalidating cache for groups: sessionId=${sessionId}, userId=${userId}`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                console.debug(`Cache hit for groups: sessionId=${sessionId}, userId=${userId}`);
                const cachedGroups = JSON.parse(cachedData);

                // Attach cached group data to the corresponding phases
                phases.forEach(phase => {
                    const phaseNumber = phase.number;
                    phase.group = cachedGroups[phaseNumber] || { groupId: null, peers: [] };
                });

                return phases;
            }
        }

        // Cache miss or invalidation: Call the original function
        console.debug(`Cache miss for groups: sessionId=${sessionId}, userId=${userId}`);
        const updatedPhases = await getStudentActivityGroups(sessionId, userId, phases);

        // Extract group data from updated phases and cache it
        const groupsByPhase = {};
        updatedPhases.forEach(phase => {
            if (phase.group) {
                groupsByPhase[phase.number] = phase.group;
            }
        });

        // Cache the result in Redis
        await redisClient.set(cacheKey, JSON.stringify(groupsByPhase), 'EX', 3600); // Expiration: 1 hour

        return updatedPhases;
    } catch (error) {
        console.error(`Error in getCachedStudentActivityGroups: sessionId=${sessionId}, userId=${userId}`, error);
        return phases;
    }
}

export async function getStudentActivityGroups(sessionId, userId, phases) {
    if (!sessionId || isNaN(Number(sessionId)) || !userId || isNaN(Number(userId))) {
        console.error("Invalid sessionId or userId:", { sessionId, userId });
        return phases;
    }

    try {
        const groupsQuery = `
            SELECT 
                st.number AS phase_number,
                t.id AS group_id,
                u.id AS user_id,
                u.name AS user_name,
                tu.anon_mask AS anonymity_mask
            FROM 
                teamusers tu
            JOIN 
                users u ON tu.uid = u.id
            JOIN 
                teams t ON tu.tmid = t.id
            JOIN 
                stages st ON t.stageid = st.id
            WHERE 
                st.sesid = $1 AND u.id = $2
            ORDER BY 
                st.number, t.id, u.id;
        `;

        const groupsResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: groupsQuery,
            sqlParams: [
                rpg2.param('plain', Number(sessionId)),
                rpg2.param('plain', Number(userId))
            ],
        });

        const groupsByPhase = {};
        groupsResult.forEach(row => {
            if (!groupsByPhase[row.phase_number]) {
                groupsByPhase[row.phase_number] = [];
            }

            let group = groupsByPhase[row.phase_number].find(g => g.groupId === row.group_id);
            if (!group) {
                group = { groupId: row.group_id, peers: [] };
                groupsByPhase[row.phase_number].push(group);
            }

            group.peers.push({
                id: row.user_id,
                name: row.user_name,
                anonMask: row.anonymity_mask,
            });
        });

        // Integrate group data into phases
        phases.forEach(phase => {
            const phaseNumber = phase.number;
            phase.group = groupsByPhase[phaseNumber] || { groupId: null, peers: [] };
        });

        return phases;
    } catch (error) {
        console.error("Failed to gather groups and integrate them into the phases:", error);
        return phases;
    }
}

const studentActivityTaskGetters = {
    semantic_differential: getStudentActivityTasks_semanticDifferential,
    ranking: getStudentActivityTasks_ranking
}

export async function getCachedStudentActivityTasks(designType, sessionId, phases, invalidate = false) {
    if (!Array.isArray(phases) || phases.length === 0) {
        console.error(`Invalid or empty phases array:`, phases);
        return phases;
    }

    // Create a unique cache key using concatenated phase numbers
    const phaseNumbers = phases.map(phase => phase.number).sort().join(',');
    const cacheKey = `tasks:${sessionId}:phases:${phaseNumbers}`;

    try {
        // Handle cache invalidation
        if (invalidate) {
            console.debug(`Invalidating cache for tasks: sessionId=${sessionId}, phases=[${phaseNumbers}]`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                console.debug(`Cache hit for tasks: sessionId=${sessionId}, phases=[${phaseNumbers}]`);
                const tasksByPhase = JSON.parse(cachedData);

                // Attach cached tasks to the corresponding phases
                phases.forEach(phase => {
                    phase.tasks = tasksByPhase[phase.number] || [];
                });

                return phases;
            }
        }

        // Cache miss or invalidation: Fetch tasks from the database
        console.debug(`Cache miss for tasks: sessionId=${sessionId}, phases=[${phaseNumbers}]`);
        const updatedPhases = await getStudentActivityTasks(designType, sessionId, phases);

        // Extract tasks for caching
        const tasksByPhase = updatedPhases.reduce((acc, phase) => {
            acc[phase.number] = phase.tasks || [];
            return acc;
        }, {});

        // Cache the result in Redis
        await redisClient.set(cacheKey, JSON.stringify(tasksByPhase), {
            EX: 300, // Expiration: 5 minutes
        });

        return updatedPhases;
    } catch (error) {
        console.error(`Error in getCachedStudentActivityTasks: sessionId=${sessionId}, phases=[${phaseNumbers}]`, error);

        // Fallback to empty tasks in the phases in case of error
        phases.forEach(phase => {
            phase.tasks = [];
        });

        return phases;
    }
}

/**
 * Get tasks for a given session and design type.
 * @param {string} designType - The type of instructional design.
 * @param {number} sessionId - The session ID.
 * @param {Array} phases - The phases to attach tasks to.
 * @returns {Promise<Array>} The updated phases with tasks.
 */
export async function getStudentActivityTasks(designType, sessionId, phases) {
    const taskGetter = studentActivityTaskGetters[designType];
    if (!taskGetter) {
        console.error(`No task getter defined for design type: ${designType}`);
        return phases;
    }

    try {
        return await taskGetter(sessionId, phases);
    } catch (error) {
        console.error(`Failed to get tasks for design type ${designType}:`, error);
        return phases;
    }
}

/**
 * Retrieve tasks for a specific phase (stage) by its ID.
 * Determines the design type and fetches tasks accordingly.
 *
 * @param {number} phaseId - The ID of the phase (stage).
 * @returns {Promise<Object>} - The phase object with its associated tasks.
 * @throws {Error} If there is an issue with retrieving tasks or the phase.
 */
export async function getStudentActivityTasksForPhase(phaseId) {
    try {
        // Step 1: Fetch the session ID, stage number, and design type
        const phaseResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT
                    st.sesid AS session_id,
                    st.number AS phase_number,
                    d.design AS design_json
                FROM stages st
                JOIN activity a ON a.session = st.sesid
                JOIN designs d ON d.id = a.design
                WHERE st.id = $1
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        if (!phaseResult) {
            throw new Error(`No phase found for ID: ${phaseId}`);
        }

        const { session_id: sessionId, phase_number: phaseNumber, design_json: designJson } = phaseResult;

        // Parse the design JSON
        const design = typeof designJson === "string" ? JSON.parse(designJson) : designJson;
        const { type: designType, phases } = design;

        if (!designType || !phases || !Array.isArray(phases)) {
            throw new Error(`Invalid design structure for phase ID: ${phaseId}`);
        }

        // Step 2: Retrieve tasks for the specific phase based on its design type
        const mockPhaseObject = {};
        mockPhaseObject.number = phaseNumber;

        const taskGetter = studentActivityTaskGetters[designType];
        if (!taskGetter) {
            throw new Error(`No task getter defined for design type: ${designType}`);
        }

        const phasesWithTasks = await taskGetter(sessionId, [mockPhaseObject]);
        const phaseWithTasks = phasesWithTasks.find(phase => phase.number === phaseNumber);

        if (!phaseWithTasks) {
            throw new Error(`Tasks not found for phase number: ${phaseNumber}`);
        }

        // Step 3: Return the list of tasks
        return phaseWithTasks.tasks;
    } catch (error) {
        console.error("Error in getStudentActivityTasksForPhase:", error);
        throw new Error(`Unable to fetch tasks for phase ID: ${phaseId}`);
    }
}

/**
 * Retrieve tasks for "semantic_differential" design type.
 * @param {number} sessionId - The session ID.
 * @param {Array} phases - The phases to attach tasks to.
 * @returns {Promise<Array>} The updated phases with tasks.
 */
export async function getStudentActivityTasks_semanticDifferential(sessionId, phases) {
    const query = `
        SELECT
            st.number as phase_number, 
            d.stageid AS phase_id,
            d.id AS task_id,
            d.title AS task_title,
            d.tleft AS left_pole,
            d.tright AS right_pole,
            d.orden AS order,
            d.justify AS requires_justification,
            d.num AS num_values,
            d.word_count AS min_word_count
        FROM 
            differential d
        JOIN
            stages st
        ON
            d.stageid = st.id
        WHERE 
            d.sesid = $1;
    `;

    try {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [rpg2.param("plain", Number(sessionId))],
        });

        const tasksByPhase = {};
        results.forEach(task => {
            if (!tasksByPhase[task.phase_number]) {
                tasksByPhase[task.phase_number] = [];
            }

            tasksByPhase[task.phase_number].push({
                id: task.task_id,
                title: task.task_title,
                leftPole: task.left_pole,
                rightPole: task.right_pole,
                order: task.order,
                requiresJustification: task.requires_justification,
                numValues: task.num_values,
                minWordCount: task.min_word_count,
            });
        });

        phases.forEach(phase => {
            phase.tasks = tasksByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve semantic differential tasks:", error);
        return phases;
    }
}

/**
 * Retrieve tasks for "ranking" design type.
 * @param {number} sessionId - The session ID.
 * @param {Array} phases - The phases to attach tasks to.
 * @returns {Promise<Array>} The updated phases with tasks.
 */
export async function getStudentActivityTasks_ranking(sessionId, phases) {
    const query = `
                    SELECT
                        st.number AS phase_number,
                        a.stageid AS phase_id,
                        a.id AS item_id,
                        a.name AS item_name,
                        a.jorder AS justify_order,
                        a.justified AS justify_item,
                        a.word_count AS min_word_count
                    FROM 
                        actors a
                    JOIN
                        stages st
                    ON
                        st.id = a.stageid
                    WHERE 
                        st.sesid = $1;
                    `;

    try {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [rpg2.param("plain", Number(sessionId))],
        });

        const tasksByPhase = {};
        results.forEach(actor => {
            if (!tasksByPhase[actor.phase_number]) {
                tasksByPhase[actor.phase_number] = [];
            }

            tasksByPhase[actor.phase_number].push({
                id: actor.actor_id,
                name: actor.actor_name,
                isOrdered: actor.is_ordered,
                requiresJustification: actor.requires_justification,
                minWordCount: actor.min_word_count,
            });
        });

        phases.forEach(phase => {
            phase.tasks = tasksByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve ranking tasks:", error);
        return phases;
    }
}

const studentActivityResponseGetters = {
    semantic_differential: getStudentActivityResponses_semanticDifferential,
    ranking: getStudentActivityResponses_ranking,
};

export async function getCachedStudentActivityResponses(designType, sessionId, userId, phases, invalidate = false) {
    if (!sessionId || isNaN(Number(sessionId)) || !userId || isNaN(Number(userId))) {
        console.error("Invalid sessionId or userId:", { sessionId, userId });
        return phases;
    }

    const cacheKey = `responses:${sessionId}:${userId}:${phases.map(phase => phase.number).join(",")}`;

    try {
        // Handle cache invalidation
        if (invalidate) {
            console.debug(`Invalidating cache for responses: sessionId=${sessionId}, userId=${userId}`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                console.debug(`Cache hit for responses: sessionId=${sessionId}, userId=${userId}`);
                const responsesByPhase = JSON.parse(cachedData);

                // Attach cached responses to the corresponding phases
                phases.forEach(phase => {
                    phase.responses = responsesByPhase[phase.number] || [];
                });

                return phases;
            }
        }

        // Cache miss or invalidation: Fetch responses from the database
        console.debug(`Cache miss for responses: sessionId=${sessionId}, userId=${userId}`);
        const responsesByPhase = await studentActivityResponseGetters[designType](sessionId, userId, phases);

        // Cache the result
        await redisClient.set(cacheKey, JSON.stringify(responsesByPhase), {
            EX: 300, // Expiration: 5 minutes
        });

        // Attach responses to the corresponding phases
        phases.forEach(phase => {
            phase.responses = responsesByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error(`Error in getCachedStudentActivityResponses: sessionId=${sessionId}, userId=${userId}, designType=${designType}`, error);

        // Fallback to empty responses if an error occurs
        phases.forEach(phase => {
            phase.responses = [];
        });

        return phases;
    }
}

/**
 * Retrieve student responses based on the design type.
 * @param {string} designType - The type of instructional design.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach responses to.
 * @returns {Promise<Array>} The updated phases with responses.
 */
async function getStudentActivityResponses(designType, sessionId, userId, phases) {
    const responseGetter = studentActivityResponseGetters[designType];
    if (!responseGetter) {
        console.error(`No response getter defined for design type: ${designType}`);
        return phases;
    }

    try {
        return await responseGetter(sessionId, userId, phases);
    } catch (error) {
        console.error(`Failed to get responses for design type ${designType}:`, error);
        return phases;
    }
}

/**
 * Retrieve student responses for "semantic_differential" design type.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach responses to.
 * @returns {Promise<Array>} The updated phases with responses.
 */
export async function getStudentActivityResponses_semanticDifferential(sessionId, userId, phases) {
    const query = `
        SELECT
            st.number AS phase_number,
            ds.did AS task_id,
            ds.sel AS selection,
            ds.comment AS justification,
            ds.stime AS timestamp,
            d.stageid AS phase_id
        FROM 
            differential_selection ds
        JOIN 
            differential d ON ds.did = d.id
        JOIN
            stages st ON st.id = d.stageid
        WHERE 
            ds.uid = $1
            AND d.sesid = $2;
    `;

    try {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [
                rpg2.param("plain", Number(userId)),
                rpg2.param("plain", Number(sessionId)),
            ],
        });

        const responsesByPhase = {};
        results.forEach(response => {
            if (!responsesByPhase[response.phase_number]) {
                responsesByPhase[response.phase_number] = [];
            }

            responsesByPhase[response.phase_number].push({
                taskId: response.task_id,
                selection: response.selection,
                justification: response.justification,
                timestamp: response.timestamp,
            });
        });

        phases.forEach(phase => {
            phase.responses = responsesByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve semantic differential responses:", error);
        return phases;
    }
}

/**
 * Retrieve student responses for "ranking" design type.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach responses to.
 * @returns {Promise<Array>} The updated phases with responses.
 */
export async function getStudentActivityResponses_ranking(sessionId, userId, phases) {
    const query = `
        SELECT 
            st.number AS phase_number,
            asel.actorid AS actor_id,
            asel.orden AS order,
            asel.description AS description,
            asel.stime AS timestamp,
            a.stageid AS phase_id
        FROM 
            actor_selection asel
        JOIN 
            actors a ON asel.actorid = a.id
        JOIN
            stages st ON st.id = a.stageid
        WHERE 
            asel.uid = $1
            AND a.stageid IN (
                SELECT id FROM stages WHERE sesid = $2
            );
    `;

    try {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [
                rpg2.param("plain", Number(userId)),
                rpg2.param("plain", Number(sessionId)),
            ],
        });

        const responsesByPhase = {};
        results.forEach(response => {
            if (!responsesByPhase[response.phase_number]) {
                responsesByPhase[response.phase_number] = [];
            }

            responsesByPhase[response.phase_number].push({
                actorId: response.actor_id,
                order: response.order,
                description: response.description,
                timestamp: response.timestamp,
            });
        });

        phases.forEach(phase => {
            phase.responses = responsesByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve ranking responses:", error);
        return phases;
    }
}

const studentActivityPeerResponseGetters = {
    semantic_differential: getStudentActivityPeerResponses_semanticDifferential,
    ranking: getStudentActivityPeerResponses_ranking,
};

/**
 * Wrapper function to get student activity peer responses with Redis caching.
 * @param {string} designType - The type of instructional design.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach peer responses to.
 * @returns {Promise<Array>} The updated phases with peer responses.
 */
export async function getCachedStudentActivityPeerResponses(designType, sessionId, userId, phases, invalidate = false) {
    if (!sessionId || isNaN(Number(sessionId)) || !userId || isNaN(Number(userId))) {
        console.error("Invalid sessionId or userId:", { sessionId, userId });
        return phases;
    }

    const cacheKey = `session:${sessionId}:user:${userId}:peer_responses:${designType}`;

    try {
        // Handle cache invalidation
        if (invalidate) {
            console.debug(`Invalidating cache for peer responses: sessionId=${sessionId}, userId=${userId}, designType=${designType}`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                console.debug(`Cache hit for peer responses: sessionId=${sessionId}, userId=${userId}, designType=${designType}`);
                const peerResponsesByPhase = JSON.parse(cachedData);

                // Attach cached responses to the corresponding phases
                phases.forEach(phase => {
                    phase.peerResponses = peerResponsesByPhase[phase.number] || [];
                });

                return phases;
            }
        }

        // Fetch peer responses from the database
        console.debug(`Cache miss for peer responses: sessionId=${sessionId}, userId=${userId}, designType=${designType}`);
        const peerResponsesByPhase = await studentActivityPeerResponseGetters[designType](sessionId, userId);

        // Cache the result
        await redisClient.set(cacheKey, JSON.stringify(peerResponsesByPhase), {
            EX: 300,
        });

        // Attach responses to the corresponding phases
        phases.forEach(phase => {
            phase.peerResponses = peerResponsesByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error(`Error in getCachedStudentActivityPeerResponses: sessionId=${sessionId}, userId=${userId}, designType=${designType}`, error);
        // Fallback to no peer responses if caching or database fails
        phases.forEach(phase => {
            phase.peerResponses = [];
        });
        return phases;
    }
}

/**
 * Retrieve peer responses based on the design type.
 * @param {string} designType - The type of instructional design.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach peer responses to.
 * @returns {Promise<Array>} The updated phases with peer responses.
 */
export async function getStudentActivityPeerResponses(designType, sessionId, userId, phases) {
    const peerResponseGetter = studentActivityPeerResponseGetters[designType];
    if (!peerResponseGetter) {
        console.error(`No peer response getter defined for design type: ${designType}`);
        return phases;
    }

    try {
        const peerResponsesByPhase = await peerResponseGetter(sessionId, userId);

        // Attach peer responses to the corresponding phases
        phases.forEach(phase => {
            phase.peerResponses = peerResponsesByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error(`Failed to get peer responses for design type ${designType}:`, error);
        return phases;
    }
}

/**
 * Retrieve peer responses for "semantic_differential" design.
 */
export async function getStudentActivityPeerResponses_semanticDifferential(sessionId, userId) {
    try {
        const query = `
            SELECT 
                st.number AS phase_number,
                ds.did AS task_id,
                ds.sel AS selection,
                ds.comment AS justification,
                ds.stime AS timestamp,
                d.stageid AS phase_id,
                tu.uid AS peer_id,
                u.name AS peer_name,
                tu.anon_mask AS peer_anonymity
            FROM 
                teamusers tu
            JOIN 
                users u ON tu.uid = u.id
            JOIN 
                teams t ON tu.tmid = t.id
            JOIN 
                stages st ON t.stageid = st.id
            JOIN 
                differential_selection ds ON ds.uid = tu.uid
            JOIN 
                differential d ON ds.did = d.id
            WHERE 
                st.sesid = $1
                AND ds.uid != $2
                AND tu.tmid IN (
                    SELECT tmid 
                    FROM teamusers 
                    WHERE uid = $2
                )
            ORDER BY 
                st.number, ds.did;
        `;

        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [
                rpg2.param('plain', Number(sessionId)),
                rpg2.param('plain', Number(userId)),
            ],
        });

        const peerResponsesByPhase = {};
        results.forEach(row => {
            if (!peerResponsesByPhase[row.phase_number]) {
                peerResponsesByPhase[row.phase_number] = [];
            }

            peerResponsesByPhase[row.phase_number].push({
                taskId: row.task_id,
                selection: row.selection,
                justification: row.justification,
                timestamp: row.timestamp,
                peer: {
                    id: row.peer_id,
                    name: row.peer_name,
                    anonMask: row.peer_anonymity,
                },
            });
        });

        return peerResponsesByPhase;
    } catch (error) {
        console.error("Failed to retrieve peer responses for semantic_differential:", error);
        return {};
    }
}

/**
 * Retrieve peer responses for "ranking" design.
 */
export async function getStudentActivityPeerResponses_ranking(sessionId, userId) {
    try {
        const query = `
            SELECT
                st.number AS phase_number,
                asel.actorid AS task_id,
                asel.orden AS rank_order,
                asel.description AS justification,
                asel.stime AS timestamp,
                asel.stageid AS phase_id,
                tu.uid AS peer_id,
                u.name AS peer_name,
                tu.anon_mask AS peer_anonymity
            FROM 
                teamusers tu
            JOIN 
                users u ON tu.uid = u.id
            JOIN 
                teams t ON tu.tmid = t.id
            JOIN 
                stages st ON t.stageid = st.id
            JOIN 
                actor_selection asel ON asel.uid = tu.uid
            WHERE 
                st.sesid = $1
                AND asel.uid != $2
                AND tu.tmid IN (
                    SELECT tmid 
                    FROM teamusers 
                    WHERE uid = $2
                )
            ORDER BY 
                st.number, asel.actorid;
        `;

        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [
                rpg2.param('plain', Number(sessionId)),
                rpg2.param('plain', Number(userId)),
            ],
        });

        const peerResponsesByPhase = {};
        results.forEach(row => {
            if (!peerResponsesByPhase[row.phase_number]) {
                peerResponsesByPhase[row.phase_number] = [];
            }

            peerResponsesByPhase[row.phase_number].push({
                taskId: row.task_id,
                rankOrder: row.rank_order,
                justification: row.justification,
                timestamp: row.timestamp,
                peer: {
                    id: row.peer_id,
                    name: row.peer_name,
                    anonMask: row.peer_anonymity,
                },
            });
        });

        return peerResponsesByPhase;
    } catch (error) {
        console.error("Failed to retrieve peer responses for ranking:", error);
        return {};
    }
}

const studentActivityGroupMessageGetters = {
    semantic_differential: getStudentActivityGroupMessages_semanticDifferential,
    ranking: getStudentActivityGroupMessages_ranking
};

/**
 * Retrieve cached group messages for the specified phases and group.
 * @param {string} designType - The type of instructional design.
 * @param {number} sessionId - The session ID.
 * @param {Array} phases - The list of phases (each with a number).
 * @param {number} groupId - The group ID.
 * @param {boolean} invalidate - Whether to invalidate the cache.
 * @returns {Promise<Array>} The updated phases with group messages.
 */
export async function getCachedStudentActivityGroupMessages(designType, sessionId, userId, phases, invalidate = false) {
    if (!sessionId || isNaN(Number(sessionId)) || !userId || isNaN(Number(userId))) {
        console.error("Invalid sessionId or userId:", { sessionId, userId });
        return phases;
    }

    const cacheKey = `chatMessages:${sessionId}:${userId}`;
    
    try {
        // Invalidate cache if necessary
        if (invalidate) {
            console.debug(`Invalidating cache for chat messages: sessionId=${sessionId}, userId=${userId}`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                console.debug(`Cache hit for chat messages: sessionId=${sessionId}, userId=${userId}`);
                const messagesByPhase = JSON.parse(cachedData);
                phases.forEach(phase => {
                    phase.groupMessages = messagesByPhase[phase.number] || [];
                });
                return phases;
            }
        }

        // Fetch messages from the database
        console.debug(`Cache miss for chat messages: sessionId=${sessionId}, userId=${userId}`);
        const messagesByPhase = await studentActivityGroupMessageGetters[designType](sessionId, userId, phases);

        // Cache the result
        await redisClient.set(cacheKey, JSON.stringify(messagesByPhase), { EX: 300 });

        // Attach messages to phases
        phases.forEach(phase => {
            phase.groupMessages = messagesByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error(`Error in getCachedStudentActivityGroupMessages: sessionId=${sessionId}, userId=${userId}, designType=${designType}`, error);
        return phases;
    }
}

/**
 * Retrieve group messages for the specified phases and design type.
 * @param {string} designType - The type of instructional design.
 * @param {number} sessionId - The session ID.
 * @param {number} groupId - The group ID.
 * @param {Array} phases - The list of phases (each with a number).
 * @returns {Promise<Array>} The updated phases with group messages.
 */
export async function getStudentActivityGroupMessages(designType, sessionId, groupId, phases) {
    const groupMessageGetter = studentActivityGroupMessageGetters[designType];
    if (!groupMessageGetter) {
        console.error(`No group message getter defined for design type: ${designType}`);
        return phases;
    }

    try {
        // Attach messages to each phase
        return await groupMessageGetter(sessionId, groupId, phases);
    } catch (error) {
        console.error(`Failed to get group messages for design type ${designType}:`, error);
        return phases;
    }
}

/**
 * Retrieve group messages for semantic differential design based on user ID.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach messages to.
 * @returns {Promise<Array>} The updated phases with group messages.
 */
export async function getStudentActivityGroupMessages_semanticDifferential(sessionId, userId, phases) {
    try {
        const messagesQuery = `
            SELECT
                st.number AS phase_number,
                dc.did AS task_id,
                dc.id AS message_id,
                dc.uid AS peer_id,
                dc.content AS message,
                dc.parent_id
            FROM 
                differential_chat dc
            JOIN 
                differential d ON dc.did = d.id
            JOIN 
                stages st ON d.stageid = st.id
            JOIN 
                teams t ON st.id = t.stageid
            JOIN 
                teamusers tu ON t.id = tu.tmid
            WHERE 
                st.sesid = $1
                AND tu.uid = $2
            ORDER BY 
                st.number, dc.did, dc.id;
        `;

        const messagesResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: messagesQuery,
            sqlParams: [
                rpg2.param('plain', Number(sessionId)),
                rpg2.param('plain', Number(userId))
            ],
        });

        // Group messages by phase and task
        const messagesByPhaseAndTask = {};
        messagesResult.forEach(row => {
            if (!messagesByPhaseAndTask[row.phase_number]) {
                messagesByPhaseAndTask[row.phase_number] = {};
            }
            if (!messagesByPhaseAndTask[row.phase_number][row.task_id]) {
                messagesByPhaseAndTask[row.phase_number][row.task_id] = [];
            }
            messagesByPhaseAndTask[row.phase_number][row.task_id].push({
                peerId: row.peer_id,
                messageId: row.message_id,
                message: row.message,
                parentId: row.parent_id
            });
        });

        // Attach messages to corresponding phases
        phases.forEach(phase => {
            phase.groupMessages = [];
            const phaseMessages = messagesByPhaseAndTask[phase.number] || {};
            phase.tasks.forEach(task => {
                const taskMessages = phaseMessages[task.id] || [];
                phase.groupMessages.push({
                    taskId: task.id,
                    messages: taskMessages
                });
            });
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve semantic differential group messages:", error);
        return phases;
    }
}

/**
 * Retrieve group messages for ranking design based on user ID.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach messages to.
 * @returns {Promise<Array>} The updated phases with group messages.
 */
export async function getStudentActivityGroupMessages_ranking(sessionId, userId, phases) {
    try {
        const messagesQuery = `
            SELECT 
                st.number AS phase_number,
                c.stageid AS phase_id,
                c.id AS message_id,
                c.uid AS peer_id,
                c.content AS message,
                c.parent_id
            FROM 
                chat c
            JOIN 
                stages st ON c.stageid = st.id
            JOIN 
                teams t ON st.id = t.stageid
            JOIN 
                teamusers tu ON t.id = tu.tmid
            WHERE 
                st.sesid = $1
                AND tu.uid = $2
            ORDER BY 
                st.number, c.stageid, c.id;
        `;

        const messagesResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: messagesQuery,
            sqlParams: [
                rpg2.param('plain', Number(sessionId)),
                rpg2.param('plain', Number(userId))
            ],
        });

        // Group messages by phase and task
        const messagesByPhaseAndTask = {};
        messagesResult.forEach(row => {
            if (!messagesByPhaseAndTask[row.phase_number]) {
                messagesByPhaseAndTask[row.phase_number] = {};
            }
            if (!messagesByPhaseAndTask[row.phase_number][row.phase_id]) {
                messagesByPhaseAndTask[row.phase_number][row.phase_id] = [];
            }
            messagesByPhaseAndTask[row.phase_number][row.phase_id].push({
                peerId: row.peer_id,
                messageId: row.message_id,
                message: row.message,
                parentId: row.parent_id
            });
        });

        // Attach messages to corresponding phases
        phases.forEach(phase => {
            phase.groupMessages = [];
            const phaseMessages = messagesByPhaseAndTask[phase.number] || {};
            phase.tasks.forEach(task => {
                const taskMessages = phaseMessages[task.id] || [];
                phase.groupMessages.push({
                    taskId: task.id,
                    messages: taskMessages
                });
            });
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve ranking group messages:", error);
        return phases;
    }
};

export const getPhaseTaskGetters = {
    semantic_differential: getTasksForPhase_semanticDifferential,
    ranking: getTasksForPhase_ranking
}

/**
 * Retrieve tasks for a specific phase with caching, deducing the design type from the phaseId.
 * @param {number} phaseId - The ID of the phase.
 * @param {boolean} [invalidate=false] - Whether to invalidate the cache.
 * @returns {Promise<Object>} An object containing the list of tasks.
 */
export async function getCachedPhaseTasks(phaseId, invalidate = false) {
    if (!phaseId || isNaN(Number(phaseId))) {
        console.error(`Invalid phaseId: ${phaseId}`);
        return { tasks: [] };
    }

    try {
        // Step 1: Retrieve the design type and sessionId associated with the phaseId
        const phaseResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT
                    st.sesid AS session_id,
                    d.design AS design_json
                FROM stages st
                JOIN activity a ON a.session = st.sesid
                JOIN designs d ON d.id = a.design
                WHERE st.id = $1
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        if (!phaseResult) {
            throw new Error(`No design or session found for phase ID: ${phaseId}`);
        }

        const { session_id: sessionId, design_json: designJson } = phaseResult[0];

        // Parse the design JSON to extract the design type
        const design = typeof designJson === "string" ? JSON.parse(designJson) : designJson;
        const designType = design.type;

        if (!designType) {
            throw new Error(`Design type not found for phase ID: ${phaseId}`);
        }

        const cacheKey = `phase:${phaseId}:tasks:${designType}`;

        // Step 2: Handle caching
        if (invalidate) {
            console.debug(`Invalidating cache for tasks: phaseId=${phaseId}, designType=${designType}`);
            await redisClient.del(cacheKey);
        } else {
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                console.debug(`Cache hit for tasks: phaseId=${phaseId}, designType=${designType}`);
                return JSON.parse(cachedData);
            }
        }

        // Step 3: Fetch tasks using the appropriate task getter
        const taskGetter = getPhaseTaskGetters[designType];
        if (!taskGetter) {
            console.error(`No task getter defined for design type: ${designType}`);
            return { tasks: [] };
        }

        console.debug(`Cache miss for tasks: phaseId=${phaseId}, designType=${designType}`);
        const result = await taskGetter(phaseId);

        // Cache the result in Redis
        await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 300);

        return result;
    } catch (error) {
        console.error(`Error in getCachedPhaseTasks: phaseId=${phaseId}`, error);
        return { tasks: [] }; // Fallback to an empty tasks list in case of error
    }
}

/**
 * Retrieve tasks for a specific phase based on the design type.
 * @param {string} designType - The type of instructional design.
 * @param {number} phaseId - The ID of the phase.
 * @returns {Promise<Object>} An object containing the list of tasks.
 */
export async function getPhaseTasks(designType, phaseId) {
    const taskGetter = getPhaseTaskGetters[designType];
    if (!taskGetter) {
        console.error(`No task getter defined for design type: ${designType}`);
        return { tasks: [] };
    }

    try {
        return await taskGetter(phaseId);
    } catch (error) {
        console.error(`Failed to get tasks for phase ID ${phaseId} and design type ${designType}:`, error);
        return { tasks: [] };
    }
}

/**
 * Retrieve tasks for a specific phase in "semantic_differential" design type.
 * @param {number} phaseId - The ID of the phase.
 * @returns {Promise<Object>} An object containing the list of tasks.
 */
export async function getTasksForPhase_semanticDifferential(phaseId) {
    const query = `
        SELECT
            d.id AS task_id,
            d.title AS task_title,
            d.tleft AS left_pole,
            d.tright AS right_pole,
            d.orden AS task_order,
            d.justify AS requires_justification,
            d.num AS num_values,
            d.word_count AS min_word_count
        FROM 
            differential d
        WHERE 
            d.stageid = $1;
    `;

    try {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [rpg2.param("plain", Number(phaseId))],
        });

        // Transform the results into a list of tasks
        const tasks = results.map(task => ({
            id: task.task_id,
            title: task.task_title,
            leftPole: task.left_pole,
            rightPole: task.right_pole,
            order: task.task_order,
            requiresJustification: task.requires_justification,
            numValues: task.num_values,
            minWordCount: task.min_word_count,
        }));

        return { tasks };
    } catch (error) {
        console.error(`Failed to retrieve tasks for phase ID ${phaseId}:`, error);
        return { tasks: [] };
    }
}

/**
 * Retrieve tasks for a specific phase in "ranking" design type.
 * @param {number} phaseId - The ID of the phase.
 * @returns {Promise<Object>} An object containing the list of tasks.
 */
export async function getTasksForPhase_ranking(phaseId) {
    const query = `
        SELECT
            a.id AS actor_id,
            a.name AS actor_name,
            a.jorder AS is_ordered,
            a.justified AS requires_justification,
            a.word_count AS min_word_count
        FROM 
            actors a
        WHERE 
            a.stageid = $1;
    `;

    try {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [rpg2.param("plain", Number(phaseId))],
        });

        // Transform the results into a list of tasks
        const tasks = results.map(actor => ({
            id: actor.actor_id,
            name: actor.actor_name,
            isOrdered: actor.is_ordered,
            requiresJustification: actor.requires_justification,
            minWordCount: actor.min_word_count,
        }));

        return { tasks };
    } catch (error) {
        console.error(`Failed to retrieve tasks for phase ID ${phaseId}:`, error);
        return { tasks: [] };
    }
}
