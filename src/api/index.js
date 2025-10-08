// ESM ok on Vercel Node runtime
import { buildServer } from '../dist/app.js'

const app = buildServer()

export default async function handler(req, res) {
  await app.ready()
  app.server.emit('request', req, res)
}
