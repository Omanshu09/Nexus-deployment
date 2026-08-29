import { Sandbox } from '@e2b/code-interpreter'
import { config } from './config.js'
const MAX_OUTPUT = 64_000
const TIMEOUT_MS = 15_000
const MAX_CONCURRENT = 4
let active = 0
export type ExecuteResult = { success:boolean; output:string; error:string|null; kind?:'timeout'|'service-error' }
const clipped = (value:string) => value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}\n[output truncated]` : value
export async function executePython(code:string):Promise<ExecuteResult> {
 if (active >= MAX_CONCURRENT) return {success:false,output:'',error:'Execution capacity is busy. Please retry shortly.',kind:'service-error'}
 active++
 let sandbox: Sandbox | undefined
 try {
  sandbox = await Sandbox.create({ apiKey: config.e2bApiKey, timeoutMs: TIMEOUT_MS + 10_000, requestTimeoutMs: TIMEOUT_MS + 15_000 })
  const result = await sandbox.runCode(code, { timeoutMs: TIMEOUT_MS, requestTimeoutMs: TIMEOUT_MS + 5_000 })
  // E2B returns structured logs and execution errors; Python failures are intentionally HTTP-successful application results.
  const output = clipped((result.logs?.stdout || []).join(''))
  const stderr = clipped((result.logs?.stderr || []).join(''))
  const error = result.error ? clipped(`${result.error.name || 'PythonError'}: ${result.error.value || result.error.traceback || ''}`.trim()) : (stderr || null)
  return { success: !result.error, output, error }
 } catch (error) {
  const message = error instanceof Error ? error.message : 'E2B execution service failed'
  const timeout = /timeout|timed out/i.test(message)
  return {success:false,output:'',error: timeout ? `Execution timed out after ${TIMEOUT_MS/1000} seconds.` : `Execution service error: ${message}`,kind:timeout?'timeout':'service-error'}
 } finally { active--; if (sandbox) await sandbox.kill().catch(()=>undefined) }
}
