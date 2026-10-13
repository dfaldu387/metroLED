import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

/**
 * Loads environment variables for the API, worker and scripts.
 *
 * The project keeps one `.env` at the repository root (shared with the client
 * build); a `server/.env` takes precedence when present. Real environment
 * variables always win over both.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(here, '../.env'), quiet: true })
config({ path: path.resolve(here, '../../.env'), quiet: true })
