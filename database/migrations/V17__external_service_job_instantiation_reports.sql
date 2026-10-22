-- What an AI service reported when EthicApp instantiated it for a job (#737).
--
-- When an adapter creates a room or session (Polyadic Agents, Argumentation
-- Tutor), the service reports its lifecycle verdicts on the configured
-- settings: deprecated values it still accepts, retired values it substituted,
-- unsupported fields that put it in degraded mode, or settings it rejected.
-- The adapter hands that report to the registry, which stores it on the job
-- that triggered the instantiation, for auditing and for showing to teachers
-- later. NULL means the job instantiated nothing.
--
-- Shape: { "warnings": [...], "degraded": bool, "configurationRejected": bool,
-- ...service-specific details }, where each warning is the service's
-- { field, verdict, suggested_value, [suggested_field], [message] }.

ALTER TABLE external_service_jobs ADD COLUMN IF NOT EXISTS instantiation_report jsonb NULL;
