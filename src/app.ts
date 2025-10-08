// src/app.ts
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

export function buildServer() {
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

  // plugins
  app.register(loggingPlugin)

  // swagger
  app.register(swagger, {
    openapi: {
      info: { title: 'WUB Fulfillment API', version: '1.0.0' },
      servers: [{ url: '/api/v1' }]
    }
  })

  app.register(swaggerUI, {
    routePrefix: '/docs',
    logLevel: 'warn'
  })

  // public
  app.register(async scope => {
    await scope.register(Autoload, {
      dir: path.join(__dirname, 'routes', 'public'),
      matchFilter: file => /route\.(ts|js)$/i.test(file),
      ignorePattern: /schema\./i,
      forceESM: true,
      maxDepth: 5
    })
  })

  // API v1 (prefix: /api/v1)
  app.register(
    async scope => {
      // Let op: whitelist niet te streng op Vercel (zie tip onderaan)
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

  return app
}
