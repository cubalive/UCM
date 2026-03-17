-- M-6: Add missing FK indexes for performance and tenant isolation
-- These indexes support the security audit findings

-- Core entity indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_company ON trips(company_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_driver ON trips(driver_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_scheduled ON trips(scheduled_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_patient ON trips(patient_id);

-- Audit log indexes (HIPAA compliance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- MFA indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mfa_backup_codes_user ON mfa_backup_codes(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mfa_audit_log_user ON mfa_audit_log(user_id);

-- Refresh token indexes (H-1)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family);

-- Feature flags indexes (M-1)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS feature_flags_company_key_idx ON feature_flags(company_id, flag_key);

-- User lookup indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);

-- Invoice indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_trip ON invoices(trip_id);

-- Session revocation index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_revocations_user ON session_revocations(user_id, revoked_after DESC);

-- C-7: Fix existing completed trips with NULL completedAt
UPDATE trips SET completed_at = updated_at WHERE status = 'COMPLETED' AND completed_at IS NULL;

-- C-9: Fix existing NULL userId in audit_log
UPDATE audit_log SET user_id = 0 WHERE user_id IS NULL;
