const DEFAULT_PLACEHOLDER_TEXT = "******";
const STUDENT_ROLE = "A";

function parseBoolean(value) {
    return String(value || "").trim().toLowerCase() === "true";
}

function parseKeyValueArgs(argv = []) {
    return argv.reduce((acc, arg) => {
        if (!arg.startsWith("--")) {
            return acc;
        }

        const [key, ...valueParts] = arg.slice(2).split("=");
        acc[key] = valueParts.length > 0 ? valueParts.join("=") : true;
        return acc;
    }, {});
}

function parseStudentAnonymizationOptions(argv = [], env = process.env) {
    const args = parseKeyValueArgs(argv);

    return {
        dryRun: args["dry-run"] === true || parseBoolean(env.STUDENT_ANONYMIZATION_DRY_RUN),
        placeholderText: String(
            args.placeholder ||
            env.STUDENT_ANONYMIZATION_PLACEHOLDER_TEXT ||
            DEFAULT_PLACEHOLDER_TEXT
        ),
        triggeredBy: String(args["triggered-by"] || env.STUDENT_ANONYMIZATION_TRIGGERED_BY || "").trim() || null,
        processName: String(args["process-name"] || env.STUDENT_ANONYMIZATION_PROCESS_NAME || "student-anonymization-job").trim(),
    };
}

function buildAnonymousStudentIdentity(userId) {
    const normalizedUserId = Number(userId);

    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
        throw new Error("A positive integer user id is required to build an anonymous identity.");
    }

    return {
        name: `Anonymous Student ${normalizedUserId}`,
        firstname: "Anonymous",
        lastname: `Student ${normalizedUserId}`,
        email: `anon-student-${normalizedUserId}@anonymous.invalid`,
        rut: `ANON-${normalizedUserId}`,
    };
}

function createDefaultLogger(logger = console) {
    return {
        info: logger.info ? logger.info.bind(logger) : console.log,
        error: logger.error ? logger.error.bind(logger) : console.error,
    };
}

async function withClient(pool, callback) {
    const client = await pool.connect();

    try {
        return await callback(client);
    } finally {
        client.release();
    }
}

async function selectCandidateStudents(client) {
    const result = await client.query(
        `
            SELECT id, mail
            FROM users
            WHERE role = $1
              AND anonymized_at IS NULL
            ORDER BY id
        `,
        [STUDENT_ROLE]
    );

    return result.rows;
}

async function createAnonymizationRun(client, options, totalAccounts) {
    const result = await client.query(
        `
            INSERT INTO student_anonymization_runs
                (status, dry_run, placeholder_text, target_role, total_accounts, triggered_by, process_name)
            VALUES
                ('running', $1, $2, $3, $4, $5, $6)
            RETURNING id
        `,
        [
            options.dryRun,
            options.placeholderText,
            STUDENT_ROLE,
            totalAccounts,
            options.triggeredBy,
            options.processName,
        ]
    );

    return Number(result.rows[0].id);
}

function resolveRunStatus({ total, failed }) {
    if (failed > 0 && failed >= total) {
        return "failed";
    }

    if (failed > 0) {
        return "completed_with_failures";
    }

    return "completed";
}

async function finalizeAnonymizationRun(client, runId, counters) {
    const status = resolveRunStatus(counters);

    await client.query(
        `
            UPDATE student_anonymization_runs
            SET status = $1,
                succeeded_accounts = $2,
                failed_accounts = $3,
                finished_at = NOW()
            WHERE id = $4
        `,
        [status, counters.succeeded, counters.failed, runId]
    );
}

async function recordDryRunEvent(pool, runId, user) {
    await withClient(pool, async (client) => {
        await client.query(
            `
                INSERT INTO student_anonymization_events
                    (run_id, user_id, status, message, finished_at)
                VALUES
                    ($1, $2, 'skipped', 'Dry run: account would be anonymized.', NOW())
            `,
            [runId, user.id]
        );
    });

    return { status: "skipped" };
}

async function recordFailedEvent(pool, runId, userId, error) {
    await withClient(pool, async (client) => {
        await client.query(
            `
                INSERT INTO student_anonymization_events
                    (run_id, user_id, status, message, error_code, error_detail, finished_at)
                VALUES
                    ($1, $2, 'failed', 'Account anonymization failed.', $3, $4, NOW())
                ON CONFLICT (run_id, user_id) DO UPDATE
                SET status = EXCLUDED.status,
                    message = EXCLUDED.message,
                    error_code = EXCLUDED.error_code,
                    error_detail = EXCLUDED.error_detail,
                    finished_at = EXCLUDED.finished_at
            `,
            [runId, userId, error.code || error.name || "ANONYMIZATION_FAILED", error.message || String(error)]
        );
    });
}

async function anonymizeStudentAccount(pool, runId, user, options) {
    return withClient(pool, async (client) => {
        await client.query("BEGIN");

        try {
            await client.query(
                `
                    INSERT INTO student_anonymization_events
                        (run_id, user_id, status, message)
                    VALUES
                        ($1, $2, 'started', 'Account anonymization started.')
                `,
                [runId, user.id]
            );

            const currentUserResult = await client.query(
                `
                    SELECT id, mail
                    FROM users
                    WHERE id = $1
                      AND role = $2
                      AND anonymized_at IS NULL
                    FOR UPDATE
                `,
                [user.id, STUDENT_ROLE]
            );

            if (currentUserResult.rowCount === 0) {
                await client.query(
                    `
                        UPDATE student_anonymization_events
                        SET status = 'skipped',
                            message = 'Account was already anonymized or is no longer a student.',
                            finished_at = NOW()
                        WHERE run_id = $1
                          AND user_id = $2
                    `,
                    [runId, user.id]
                );
                await client.query("COMMIT");
                return { status: "skipped" };
            }

            const currentUser = currentUserResult.rows[0];
            const identity = buildAnonymousStudentIdentity(user.id);

            const differentialSelectionResult = await client.query(
                `
                    UPDATE differential_selection
                    SET comment = $1
                    WHERE uid = $2
                      AND comment IS NOT NULL
                `,
                [options.placeholderText, user.id]
            );

            const differentialChatResult = await client.query(
                `
                    UPDATE differential_chat
                    SET content = $1
                    WHERE uid = $2
                      AND content IS NOT NULL
                `,
                [options.placeholderText, user.id]
            );

            const passwordResetResult = await client.query(
                `
                    DELETE FROM pass_reset
                    WHERE lower(mail) = lower($1)
                `,
                [currentUser.mail]
            );

            await client.query(
                `
                    UPDATE users
                    SET name = $1,
                        firstname = $2,
                        lastname = $3,
                        mail = $4,
                        rut = $5,
                        pass = '',
                        password_bcrypt = NULL,
                        active = false,
                        email_confirmed = false,
                        profile_image_path = NULL,
                        profile_image_topbar_path = NULL,
                        session_version = session_version + 1,
                        anonymized_at = NOW(),
                        anonymization_run_id = $6
                    WHERE id = $7
                `,
                [
                    identity.name,
                    identity.firstname,
                    identity.lastname,
                    identity.email,
                    identity.rut,
                    runId,
                    user.id,
                ]
            );

            const message = [
                "Account anonymized.",
                `differential_selection comments updated: ${differentialSelectionResult.rowCount || 0}.`,
                `differential_chat messages updated: ${differentialChatResult.rowCount || 0}.`,
                `password reset tokens deleted: ${passwordResetResult.rowCount || 0}.`,
            ].join(" ");

            await client.query(
                `
                    UPDATE student_anonymization_events
                    SET status = 'succeeded',
                        message = $1,
                        finished_at = NOW()
                    WHERE run_id = $2
                      AND user_id = $3
                `,
                [message, runId, user.id]
            );

            await client.query("COMMIT");

            return { status: "succeeded" };
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
    });
}

async function runStudentAnonymization({ pool, options, logger = console }) {
    const normalizedLogger = createDefaultLogger(logger);
    const runOptions = {
        dryRun: Boolean(options?.dryRun),
        placeholderText: String(options?.placeholderText || DEFAULT_PLACEHOLDER_TEXT),
        triggeredBy: options?.triggeredBy || null,
        processName: options?.processName || "student-anonymization-job",
    };

    const candidates = await withClient(pool, selectCandidateStudents);
    const runId = await withClient(pool, client => createAnonymizationRun(client, runOptions, candidates.length));
    const counters = {
        total: candidates.length,
        succeeded: 0,
        skipped: 0,
        failed: 0,
    };

    normalizedLogger.info(
        `[student-anonymization] run ${runId} started; candidates=${candidates.length}; dryRun=${runOptions.dryRun}`
    );

    for (const [index, user] of candidates.entries()) {
        normalizedLogger.info(
            `[student-anonymization] anonymizing account ${index + 1} of ${candidates.length}: user ${user.id}`
        );

        try {
            const result = runOptions.dryRun
                ? await recordDryRunEvent(pool, runId, user)
                : await anonymizeStudentAccount(pool, runId, user, runOptions);

            if (result.status === "succeeded") {
                counters.succeeded += 1;
                normalizedLogger.info(`[student-anonymization] user ${user.id} anonymized successfully`);
            } else {
                counters.skipped += 1;
                normalizedLogger.info(`[student-anonymization] user ${user.id} skipped: ${result.status}`);
            }
        } catch (error) {
            counters.failed += 1;
            normalizedLogger.error(
                `[student-anonymization] user ${user.id} failed: ${error.message || error}`
            );
            await recordFailedEvent(pool, runId, user.id, error);
        }
    }

    await withClient(pool, client => finalizeAnonymizationRun(client, runId, counters));

    normalizedLogger.info(
        `[student-anonymization] run ${runId} finished; total=${counters.total}; succeeded=${counters.succeeded}; skipped=${counters.skipped}; failed=${counters.failed}`
    );

    return {
        runId,
        ...counters,
        dryRun: runOptions.dryRun,
        status: resolveRunStatus(counters),
    };
}

export {
    DEFAULT_PLACEHOLDER_TEXT,
    STUDENT_ROLE,
    anonymizeStudentAccount,
    buildAnonymousStudentIdentity,
    parseStudentAnonymizationOptions,
    resolveRunStatus,
    runStudentAnonymization,
};
