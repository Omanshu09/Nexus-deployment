import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import * as Ably from 'ably'
import { z } from 'zod'
import { config } from './config.js'
import { getRoom, initialiseDatabase, saveRoom } from './db.js'
import { executePython } from './executor.js'

const app = express()
const ably = new Ably.Rest({ key: config.ablyApiKey })
const roomId = z.string().regex(/^[a-z0-9-]{3,64}$/)
const stateSchema = z.object({ state: z.string().min(1).max(1_000_000) })
const executeSchema = z.object({ code: z.string().min(1).max(20_000), roomId: roomId.optional(), clientId: z.string().uuid().optional() })
const tokenSchema = z.object({ roomId, clientId: z.string().uuid() })
app.disable('x-powered-by')
app.use(cors({ origin(origin, callback) { if (!origin || config.corsOrigins.includes(origin)) callback(null,true); else callback(new Error('Origin not allowed by CORS')) }, methods:['GET','POST','PUT'], allowedHeaders:['Content-Type'], maxAge:86400 }))
app.use(express.json({limit:'1mb'}))
app.use(rateLimit({windowMs:60_000,limit:120,standardHeaders:'draft-7',legacyHeaders:false}))
app.get('/api/health', async (_req,res) => { try { await getRoom('__health_probe__'); res.json({status:'ok',database:'ready'}) } catch { res.status(503).json({status:'degraded',database:'unavailable'}) } })
app.get('/api/rooms/:roomId', async (req,res,next) => { try { const id=roomId.parse(req.params.roomId); const room=await getRoom(id); res.json({state:room?.document_state || '',updatedAt:room?.updated_at || null}) } catch(e) { next(e) } })
app.put('/api/rooms/:roomId', async (req,res,next) => { try { const id=roomId.parse(req.params.roomId); const {state}=stateSchema.parse(req.body); await saveRoom(id,state); res.json({success:true}) } catch(e) { next(e) } })
app.post('/api/ably/token', async (req,res,next) => { try { const {roomId:id,clientId}=tokenSchema.parse(req.body); const capability=JSON.stringify({[`nexus:room:${id}`]:['subscribe','publish','presence']}); const tokenRequest=await ably.auth.createTokenRequest({clientId,capability,ttl:60*60*1000}); res.json(tokenRequest) } catch(e) { next(e) } })
app.post('/api/execute', async (req,res,next) => { try { const {code,roomId:id,clientId}=executeSchema.parse(req.body); const result=await executePython(code); if (id) await ably.channels.get(`nexus:room:${id}`).publish('execution',{status:result.success?'completed':result.kind==='timeout'?'timeout':result.kind==='service-error'?'service-error':'failed',output:result.output,error:result.error,by:clientId}); res.status(result.kind==='service-error'?502:200).json(result) } catch(e) { next(e) } })
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction) => { if (err instanceof z.ZodError) return res.status(400).json({success:false,error:'Invalid request body or room id.'}); console.error(err); return res.status(500).json({success:false,error:'Unexpected server error.'}) })
initialiseDatabase().then(()=>app.listen(config.port,()=>console.log(`Nexus API listening on ${config.port}`))).catch(error=>{console.error('Database initialisation failed',error);process.exit(1)})
