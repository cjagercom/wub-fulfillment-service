import { neon, neonConfig } from '@neondatabase/serverless'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')

neonConfig.pipelineConnect = 'password'
neonConfig.pipelineTLS = true

export const sql = neon(process.env.DATABASE_URL)
