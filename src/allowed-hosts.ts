const isDev = process.env.NODE_ENV !== 'production'

const allowedHosts = process.env.ALLOWED_HOSTNAMES?.split(',') || []

if (isDev) {
  allowedHosts.push('localhost')
}

export { allowedHosts }
