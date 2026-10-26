import hydrateLegacySession from "../middleware/hydrateLegacySession.js";

/**
 * Runs hydrateLegacySession on a raw Engine.IO request. Engine.IO passes Node
 * IncomingMessage objects, which lack Express's req.get().
 */
export function hydrateEngineRequest(req, res, next) {
    if (typeof req.get !== "function") {
        req.get = name => req.headers[String(name).toLowerCase()];
    }

    hydrateLegacySession(req, res, next);
}

/**
 * Namespace middleware that admits only authenticated sockets whose session
 * role is allowed, and stores the effective identity in socket.data.
 * @param {string | string[]} allowedRoles
 */
export function requireSocketRole(allowedRoles) {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    return (socket, next) => {
        const session = socket.request.session;
        const uid = Number(session?.uid);

        if (!Number.isInteger(uid) || uid <= 0) {
            return next(new Error("unauthorized"));
        }

        if (!roles.includes(session.role)) {
            return next(new Error("forbidden"));
        }

        socket.data.uid = uid;
        socket.data.role = session.role;
        return next();
    };
}
