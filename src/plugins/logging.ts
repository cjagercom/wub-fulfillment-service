import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'

const IGNORE: RegExp[] = [
  /^\/$/, // root
  /^\/favicon\.ico$/, // favicon
  /^\/docs(?:\/|$)/, // alles onder /docs (UI + /docs/json)
  /^\/docs\/static\/.*/ // expliciet static (overbodig door regel erboven, maar veilig)
]

export default fp(async function loggingPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    ;(req as any)._startAt = process.hrtime.bigint()
  })

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url || ''
    if (IGNORE.some(r => r.test(url))) return

    if (reply.statusCode === 304) return

    const start = (req as any)._startAt as bigint | undefined
    const elapsedMs = start ? Number((process.hrtime.bigint() - start) / 1_000_000n) : undefined

    app.log.info(`${req.method} ${url} -> ${reply.statusCode}${elapsedMs ? ` ${elapsedMs}ms` : ''}`)
  })
})
