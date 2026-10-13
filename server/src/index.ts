import './load-env'
import { createApp } from './app'
import { env } from './lib/env'
import { closePool } from './lib/db'

const port = env().PORT
const server = createApp().listen(port, () => {
  console.log(`[server] MetroLED Intelligence API listening on http://localhost:${port} (${env().APP_ENV})`)
})

function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down`)
  server.close(() => {
    closePool().finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
