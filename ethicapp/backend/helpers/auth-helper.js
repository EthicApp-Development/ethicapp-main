"use strict";

/**
 * Validates if the request has an authenticated user and one of the allowed roles.
 * Sends the HTTP error response when validation fails.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {string|string[]} allowedRoles - Single role or list of roles.
 * @returns {boolean} true when access is allowed, false otherwise.
 */
export function requireRole(req, res, allowedRoles) {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    if (!req.session?.uid) {
        res.status(401).json({ status: "err", message: "Unauthorized" });
        return false;
    }

    if (!roles.includes(req.session.role)) {
        res.status(403).json({ status: "err", message: "Forbidden" });
        return false;
    }

    return true;
}

/**
 * Allows access if the requester owns the user resource or has one of the allowed roles.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {number|string} targetUserId - Target user id from route parameter.
 * @param {string|string[]} allowedRoles - Roles that bypass ownership check.
 * @returns {boolean} true when access is allowed, false otherwise.
 */
export function requireOwnershipOrRole(req, res, targetUserId, allowedRoles) {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    if (!req.session?.uid) {
        res.status(401).json({ status: "err", message: "Unauthorized" });
        return false;
    }

    const sameUser = Number(req.session.uid) === Number(targetUserId);
    const hasRole = roles.includes(req.session.role);

    if (!sameUser && !hasRole) {
        res.status(403).json({ status: "err", message: "Forbidden" });
        return false;
    }

    return true;
}
