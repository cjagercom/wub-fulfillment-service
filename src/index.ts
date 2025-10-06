import 'dotenv/config'
import path from 'path'
import { fileURLToPath } from 'url'
import Autoload from '@fastify/autoload'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import Fastify from 'fastify'
import { allowedHosts } from './allowed-hosts.js'
import hostWhitelist from './plugins/host-whitelist.js'
import loggingPlugin from './plugins/logging.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = process.env.NODE_ENV !== 'production'

const app = Fastify({
  logger: isDev
    ? {
        base: undefined,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            translateTime: 'HH:MM:ss.l',
            messageFormat: '{msg}',
            ignore: 'pid,hostname,reqId'
          }
        }
      }
    : { level: 'info' },
  disableRequestLogging: true
})

// Eigen logging plugin
await app.register(loggingPlugin)

// Swagger
await app.register(swagger, {
  openapi: { info: { title: 'WUB Fulfillment API', version: '1.0.0' } }
})
await app.register(swaggerUI, { routePrefix: '/docs', logLevel: 'warn' })

// Public
await app.register(async scope => {
  await scope.register(Autoload, {
    dir: path.join(__dirname, 'routes', 'public'),
    matchFilter: file => /route\.(ts|js)$/i.test(file),
    ignorePattern: /schema\./i,
    forceESM: true,
    maxDepth: 5
  })
})

// API v1 (prefix: /api/v1)
await app.register(
  async scope => {
    await scope.register(hostWhitelist, {
      allowed: allowedHosts
    })

    await scope.register(Autoload, {
      dir: path.join(__dirname, 'routes', 'v1'),
      matchFilter: file => /route\.(ts|js)$/i.test(file),
      ignorePattern: /schema\./i,
      forceESM: true,
      maxDepth: 5
    })
  },
  { prefix: '/api/v1' }
)

// Start server
const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
app.log.info(`ready on http://localhost:${port}`)
