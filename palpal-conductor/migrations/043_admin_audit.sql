-- Migration 043: admin action audit log.
--
-- Every meaningful mutation records what changed and (where it is safe) enough
-- before-state to undo it. Deletes deliberately have no undo payload: episode
-- deletion also removes the transcript from B2, which cannot be reconstructed
-- from this table.

CREATE TABLE IF NOT EXISTS admin_audit (
    id          BIGSERIAL   PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    action      TEXT        NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    detail      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    undo        JSONB,
    undone_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created
    ON admin_audit (created_at DESC);

DROP TRIGGER IF EXISTS trg_admin_notify_audit ON admin_audit;
CREATE TRIGGER trg_admin_notify_audit
    AFTER INSERT OR UPDATE OR DELETE ON admin_audit
    FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change();
