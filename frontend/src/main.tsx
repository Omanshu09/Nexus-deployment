import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as Ably from 'ably'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, Line, Stars } from '@react-three/drei'
import * as THREE from 'three'
import './styles.css'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '')
const MAX_CODE = 20_000
type Connection = 'connecting' | 'online' | 'offline' | 'error'
type Execution = { status: 'running' | 'completed' | 'failed' | 'timeout' | 'service-error'; output: string; error: string | null; by?: string }

const bytesToBase64 = (data: Uint8Array) => btoa(String.fromCharCode(...data))
const base64ToBytes = (data: string) => Uint8Array.from(atob(data), c => c.charCodeAt(0))
const clientId = (() => { const key = 'nexus-client-id'; let id = localStorage.getItem(key); if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id) }; return id })()

function slug() { const parts = ['blue', 'orbital', 'signal', 'quantum', 'vector', 'ember', 'lunar', 'neon']; return `${parts[Math.floor(Math.random()*parts.length)]}-${parts[Math.floor(Math.random()*parts.length)]}-${Math.random().toString(36).slice(2,6)}` }
function roomFromPath() { const m = location.pathname.match(/^\/nexus\/room\/([a-z0-9-]{3,64})$/i); return m?.[1]?.toLowerCase() || '' }

function Network() { const group = useRef<THREE.Group>(null); useFrame((_, d) => { if (group.current) group.current.rotation.y += d * .08 }); const points = useMemo(() => Array.from({length: 19}, (_, i) => new THREE.Vector3(Math.sin(i*2.1)*2.5, Math.cos(i*1.7)*1.5, Math.cos(i*.8)*1.8)), []); return <group ref={group}><Stars radius={30} depth={20} count={900} factor={2} saturation={0} fade speed={.4}/>{points.map((p,i) => <Float key={i} speed={1.2} rotationIntensity={.4}><mesh position={p}><sphereGeometry args={[.07,16,16]}/><meshBasicMaterial color={i%3 ? '#6ee7ff':'#a78bfa'}/></mesh></Float>)}{points.map((p,i) => i < points.length-1 && <Line key={`l${i}`} points={[p, points[(i*7+3)%points.length]]} color="#224b75" transparent opacity={.6} lineWidth={1}/>)}</group> }
function Hero3D() { return <Canvas camera={{position:[0,0,8],fov:48}}><color attach="background" args={['#050812']}/><ambientLight intensity={.7}/><Network/></Canvas> }

function useRoom(roomId: string) {
 const [state,setState] = useState<Connection>('connecting'); const [execution,setExecution] = useState<Execution | null>(null); const doc = useMemo(() => new Y.Doc(), [roomId]); const text = useMemo(() => doc.getText('code'), [doc]);
 useEffect(() => {
  let cancelled=false, realtime: Ably.Realtime | undefined, channel: Ably.RealtimeChannel | undefined; let persist: IndexeddbPersistence | undefined;
  const start = async () => { try {
   const response = await fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}`); if (!response.ok) throw new Error('API unavailable'); const saved = await response.json() as {state?:string}; if (saved.state) Y.applyUpdate(doc, base64ToBytes(saved.state), 'server');
   persist = new IndexeddbPersistence(`nexus-${roomId}`, doc);
   realtime = new Ably.Realtime({ authCallback: async (_params, callback) => { try { const r=await fetch(`${API_URL}/api/ably/token`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,clientId})}); if (!r.ok) throw new Error('Token request failed'); callback(null, await r.json()) } catch (e) { callback({ name: 'AuthError', message: e instanceof Error ? e.message : 'Token request failed', code: 401, statusCode: 401 }, null) } } });
   channel = realtime.channels.get(`nexus:room:${roomId}`);
   channel.subscribe('y-update', (message) => { if (message.clientId === clientId) return; try { Y.applyUpdate(doc, base64ToBytes(message.data as string), 'ably') } catch {} });
   // A newly joined peer asks currently connected peers for their state. This fills the small
   // gap before the debounced Neon snapshot is written, without polling or a central broker.
   channel.subscribe('sync-request', (message) => { const target=(message.data as {clientId?:string})?.clientId; if (target && target !== clientId) channel?.publish('sync-response', {clientId:target,state:bytesToBase64(Y.encodeStateAsUpdate(doc))}).catch(()=>undefined) });
   channel.subscribe('sync-response', (message) => { const payload=message.data as {clientId?:string;state?:string}; if (payload.clientId===clientId && payload.state) try { Y.applyUpdate(doc,base64ToBytes(payload.state),'ably') } catch {} });
   channel.subscribe('execution', (message) => setExecution(message.data as Execution));
   const publish = (update: Uint8Array, origin: unknown) => { if (origin !== 'ably' && origin !== 'server') channel?.publish('y-update', bytesToBase64(update)).catch(() => setState('offline')) }; doc.on('update', publish);
   realtime.connection.on('connected', () => { if (!cancelled) { setState('online'); channel?.publish('sync-request',{clientId}).catch(()=>undefined) } }); realtime.connection.on('disconnected', () => !cancelled && setState('offline')); realtime.connection.on('suspended', () => !cancelled && setState('offline')); realtime.connection.on('failed', () => !cancelled && setState('error'));
   let saveTimer: number | undefined; const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = window.setTimeout(() => fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:bytesToBase64(Y.encodeStateAsUpdate(doc))})}).catch(()=>setState('offline')), 1200) }; text.observe(scheduleSave);
   return () => { doc.off('update',publish); text.unobserve(scheduleSave); clearTimeout(saveTimer) }
  } catch { if (!cancelled) setState('offline') } };
  let cleanup: undefined | (()=>void); start().then(x => cleanup=x); return () => { cancelled=true; cleanup?.(); channel?.detach(); realtime?.close(); persist?.destroy(); doc.destroy() }
 }, [roomId, doc, text]);
 return {doc,text,state,execution,setExecution}
}

function Workspace({roomId}:{roomId:string}) { const {text,state,execution,setExecution}=useRoom(roomId); const [code,setCode]=useState('print("Hello Nexus")'); const [running,setRunning]=useState(false); const editorRef=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{ const refresh=()=>setCode(text.toString()); text.observe(refresh); refresh(); return()=>text.unobserve(refresh) },[text]);
 const edit=(value:string)=>{ const current=text.toString(); text.doc?.transact(()=>{ text.delete(0,current.length); text.insert(0,value) }); setCode(value) };
 const run=async()=>{ if (code.length>MAX_CODE) { setExecution({status:'failed',output:'',error:`Source is limited to ${MAX_CODE.toLocaleString()} characters.`}); return }; setRunning(true); setExecution({status:'running',output:'',error:null,by:clientId}); try { const r=await fetch(`${API_URL}/api/execute`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,roomId,clientId})}); const result=await r.json() as {success:boolean;output:string;error:string|null;kind?:Execution['status']}; if (!r.ok && r.status!==422) throw new Error(result.error||'Execution service unavailable'); setExecution({status:result.success?'completed':result.kind==='timeout'?'timeout':'failed',output:result.output||'',error:result.error||null,by:clientId}) } catch(e) { setExecution({status:'service-error',output:'',error:e instanceof Error?e.message:'Execution request failed',by:clientId}) } finally { setRunning(false) } };
 const newRoom=()=>{ const id=slug(); history.pushState({},'',`/nexus/room/${id}`); location.reload() };
 return <main className="workspace"><header><div className="brand"><i/>NEXUS <span>3D</span></div><div className={`status ${state}`}>{state==='online'?'● Synced':state==='connecting'?'◌ Connecting…':state==='offline'?'◌ Offline — local work retained':'! Connection needs attention'}</div><button className="ghost" onClick={newRoom}>New room</button></header><section className="roombar"><div><small>SHARED ENGINEERING ROOM</small><strong>{roomId}</strong></div><button onClick={()=>navigator.clipboard.writeText(location.href)}>Copy invite</button></section><section className="panes"><div className="editor"><div className="pane-title">PYTHON <span>Collaborative CRDT editor</span></div><textarea ref={editorRef} value={code} spellCheck="false" onChange={e=>edit(e.target.value)} aria-label="Python editor"/><div className="editor-footer"><span>{code.length.toLocaleString()} / {MAX_CODE.toLocaleString()} chars</span><button className="run" disabled={running} onClick={run}>{running?'Running…':'▶ Run Python'}</button></div></div><div className="terminal"><div className="pane-title">TERMINAL <span>{execution?.status||'Ready'}</span></div><pre>{execution?.status==='running'?'Running Python in isolated E2B sandbox…\n':execution ? `${execution.output}${execution.error ? (execution.output?'\n':'')+execution.error : ''}` : 'Ready. Run Python to see shared output.'}</pre><div className="terminal-note">Execution results are broadcast to everyone in this room.</div></div></section></main> }
function App(){ const [room,setRoom]=useState(roomFromPath()); const [entered,setEntered]=useState(false); const enter=()=>{const id=room||slug(); history.pushState({},'',`/nexus/room/${id}`); setRoom(id);setEntered(true)}; if (room && (entered || location.pathname.includes('/nexus/room/'))) return <Workspace roomId={room}/>; return <div className="landing"><div className="canvas"><Hero3D/></div><div className="landing-content"><div className="brand"><i/>NEXUS <span>3D</span></div><p className="eyebrow">COLLABORATIVE ENGINEERING WORKSPACE</p><h1>Build in the<br/><em>connected</em> layer.</h1><p className="intro">Realtime Python collaboration with durable rooms, isolated execution, and a live systems view.</p><div className="enter"><input value={room} onChange={e=>setRoom(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''))} placeholder="room name (optional)"/><button onClick={enter}>Enter Nexus →</button></div><p className="hint">Python only · E2B-isolated execution · Ably CRDT sync</p></div></div> }
createRoot(document.getElementById('root')!).render(<App/>)
