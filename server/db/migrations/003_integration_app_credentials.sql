-- Intuit app registration (Client ID / Client Secret / environment) for the
-- QuickBooks Online integration, entered from the Data Health page instead of
-- the environment. Stored as the same AES-256-GCM envelope as "credentials",
-- which continues to hold the OAuth tokens for the connected company.
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "appCredentials" JSONB;
