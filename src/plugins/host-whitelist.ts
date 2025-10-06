import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'

type Opts = { allowed: string[] }

function stripPort(h = '') {
  return h.split(':')[0].toLowerCase()
}
function matches(host: string, pattern: string) {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1).toLowerCase()
    return host.endsWith(suffix) && host !== suffix.slice(1)
  }
  return host === pattern.toLowerCase()
}

export default fp<Opts>(async function hostWhitelist(app: FastifyInstance, opts: Opts) {
  const allowed = opts.allowed.map(s => s.toLowerCase())
  const allowedSet = new Set(allowed)

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const hostHeader = (req.headers['x-forwarded-host'] as string) ?? (req.headers['host'] as string) ?? ''
    const host = stripPort(hostHeader)

    const ok = allowedSet.has(host) || allowed.some(p => p.startsWith('*.') && matches(host, p))

    if (!ok) {
      req.log.warn({ host }, 'blocked host')
      return reply.code(403).send({ error: 'Host not allowed' })
    }

    const origin = (req.headers['origin'] as string | undefined) ?? undefined
    if (origin) {
      try {
        const oHost = new URL(origin).hostname.toLowerCase()
        const originOk = allowedSet.has(oHost) || allowed.some(p => p.startsWith('*.') && matches(oHost, p))
        if (!originOk) {
          return reply.code(403).send({ error: 'Origin not allowed' })
        }
      } catch (e) {
        console.error('Error:', e)
        req.log.warn({ host }, 'blocked host')
        return reply.code(403).send({ error: 'Host not allowed' })
      }
    }
  })
})
