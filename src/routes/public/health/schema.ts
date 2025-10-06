export const healthSchema = {
  tags: ['public'],
  response: {
    200: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        ts: { type: 'number' }
      },
      required: ['ok', 'ts']
    }
  }
} as const
