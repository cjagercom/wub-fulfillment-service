// src/index.ts
import { buildServer } from './app.js'

const app = buildServer()
const port = Number(process.env.PORT ?? 3000)

await app.listen({ port, host: '0.0.0.0' })
app.log.info(`ready on http://localhost:${port}`)
