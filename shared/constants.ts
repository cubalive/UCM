/**
 * System actor ID used for audit log entries from automated actions.
 * This avoids NULL userId in audit logs, ensuring HIPAA compliance.
 * Must match the sentinel user row in the database (if one exists).
 */
export const SYSTEM_ACTOR_ID = 0;
