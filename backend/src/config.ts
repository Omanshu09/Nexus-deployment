import 'dotenv/config'
const required = ['DATABASE_URL', 'E2B_API_KEY', 'ABLY_API_KEY', 'CORS_ORIGIN'] as const
for (const name of required) if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`)
export const config = { port: Number(process.env.PORT || 8787), databaseUrl: process.env.DATABASE_URL!, e2bApiKey: process.env.E2B_API_KEY!, ablyApiKey: process.env.ABLY_API_KEY!, corsOrigins: process.env.CORS_ORIGIN!.split(',').map(x=>x.trim()).filter(Boolean) }
