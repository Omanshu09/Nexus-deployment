import 'dotenv/config'

const required = [
  'DATABASE_URL',
  'E2B_API_KEY',
  'ABLY_API_KEY'
] as const

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(
      `Missing required environment variable: ${name}`
    )
  }
}

const configuredCorsOrigins = (
  process.env.CORS_ORIGIN || ''
)
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)

const defaultCorsOrigins = [
  'https://nexus-deployment-frontend.vercel.app'
]

const corsOrigins = Array.from(
  new Set([
    ...defaultCorsOrigins,
    ...configuredCorsOrigins
  ])
)

export const config = {
  port: Number(
    process.env.PORT || 8787
  ),

  databaseUrl:
    process.env.DATABASE_URL!,

  e2bApiKey:
    process.env.E2B_API_KEY!,

  ablyApiKey:
    process.env.ABLY_API_KEY!,

  corsOrigins
}