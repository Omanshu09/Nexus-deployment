
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
const MAX_NOTES = 20_000

type Connection = 'connecting' | 'online' | 'offline' | 'error'

type Execution = {
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'service-error'
  output: string
  error: string | null
  by?: string
}

type Theme = 'dark' | 'light'

const bytesToBase64 = (data: Uint8Array) =>
  btoa(String.fromCharCode(...data))

const base64ToBytes = (data: string) =>
  Uint8Array.from(atob(data), c => c.charCodeAt(0))

const clientId = (() => {
  const key = 'nexus-client-id'
  let id = localStorage.getItem(key)

  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }

  return id
})()

function slug() {
  const parts = [
    'blue',
    'orbital',
    'signal',
    'quantum',
    'vector',
    'ember',
    'lunar',
    'neon'
  ]

  return `${parts[Math.floor(Math.random() * parts.length)]}-${
    parts[Math.floor(Math.random() * parts.length)]
  }-${Math.random().toString(36).slice(2, 6)}`
}

function roomFromPath() {
  const m = location.pathname.match(
    /^\/nexus\/room\/([a-z0-9-]{3,64})$/i
  )

  return m?.[1]?.toLowerCase() || ''
}

function Network() {
  const group = useRef<THREE.Group>(null)

  useFrame((_, d) => {
    if (group.current) {
      group.current.rotation.y += d * 0.08
    }
  })

  const points = useMemo(
    () =>
      Array.from(
        { length: 19 },
        (_, i) =>
          new THREE.Vector3(
            Math.sin(i * 2.1) * 2.5,
            Math.cos(i * 1.7) * 1.5,
            Math.cos(i * 0.8) * 1.8
          )
      ),
    []
  )

  return (
    <group ref={group}>
      <Stars
        radius={30}
        depth={20}
        count={900}
        factor={2}
        saturation={0}
        fade
        speed={0.4}
      />

      {points.map((p, i) => (
        <Float key={i} speed={1.2} rotationIntensity={0.4}>
          <mesh position={p}>
            <sphereGeometry args={[0.07, 16, 16]} />
            <meshBasicMaterial
              color={i % 3 ? '#6ee7ff' : '#a78bfa'}
            />
          </mesh>
        </Float>
      ))}

      {points.map(
        (p, i) =>
          i < points.length - 1 && (
            <Line
              key={`l${i}`}
              points={[p, points[(i * 7 + 3) % points.length]]}
              color="#224b75"
              transparent
              opacity={0.6}
              lineWidth={1}
            />
          )
      )}
    </group>
  )
}

function Hero3D() {
  return (
    <Canvas camera={{ position: [0, 0, 8], fov: 48 }}>
      <color attach="background" args={['#050505']} />
      <ambientLight intensity={0.7} />
      <Network />
    </Canvas>
  )
}

function useRoom(roomId: string) {
  const [state, setState] =
    useState<Connection>('connecting')

  const [execution, setExecution] =
    useState<Execution | null>(null)

  const doc = useMemo(() => new Y.Doc(), [roomId])

  // IMPORTANT:
  // These are TWO completely independent Yjs shared texts.
  const code = useMemo(
    () => doc.getText('code'),
    [doc]
  )

  const notes = useMemo(
    () => doc.getText('notes'),
    [doc]
  )

  useEffect(() => {
    let cancelled = false
    let realtime: Ably.Realtime | undefined
    let channel: Ably.RealtimeChannel | undefined
    let persist: IndexeddbPersistence | undefined

    const start = async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/rooms/${encodeURIComponent(roomId)}`
        )

        if (!response.ok) {
          throw new Error('API unavailable')
        }

        const saved = await response.json() as {
          state?: string
        }

        if (saved.state) {
          Y.applyUpdate(
            doc,
            base64ToBytes(saved.state),
            'server'
          )
        }

        persist = new IndexeddbPersistence(
          `nexus-${roomId}`,
          doc
        )

        realtime = new Ably.Realtime({
          authCallback: async (_params, callback) => {
            try {
              const r = await fetch(
                `${API_URL}/api/ably/token`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    roomId,
                    clientId
                  })
                }
              )

              if (!r.ok) {
                throw new Error('Token request failed')
              }

              callback(null, await r.json())
            } catch (e) {
              callback(
                {
                  name: 'AuthError',
                  message:
                    e instanceof Error
                      ? e.message
                      : 'Token request failed',
                  code: 401,
                  statusCode: 401
                },
                null
              )
            }
          }
        })

        channel = realtime.channels.get(
          `nexus:room:${roomId}`
        )

        channel.subscribe(
          'y-update',
          message => {
            if (message.clientId === clientId) return

            try {
              Y.applyUpdate(
                doc,
                base64ToBytes(message.data as string),
                'ably'
              )
            } catch {}
          }
        )

        channel.subscribe(
          'sync-request',
          message => {
            const target = (
              message.data as {
                clientId?: string
              }
            )?.clientId

            if (
              target &&
              target !== clientId
            ) {
              channel
                ?.publish(
                  'sync-response',
                  {
                    clientId: target,
                    state: bytesToBase64(
                      Y.encodeStateAsUpdate(doc)
                    )
                  }
                )
                .catch(() => undefined)
            }
          }
        )

        channel.subscribe(
          'sync-response',
          message => {
            const payload = message.data as {
              clientId?: string
              state?: string
            }

            if (
              payload.clientId === clientId &&
              payload.state
            ) {
              try {
                Y.applyUpdate(
                  doc,
                  base64ToBytes(payload.state),
                  'ably'
                )
              } catch {}
            }
          }
        )

        channel.subscribe(
          'execution',
          message =>
            setExecution(message.data as Execution)
        )

        const publish = (
          update: Uint8Array,
          origin: unknown
        ) => {
          if (
            origin !== 'ably' &&
            origin !== 'server'
          ) {
            channel
              ?.publish(
                'y-update',
                bytesToBase64(update)
              )
              .catch(() =>
                setState('offline')
              )
          }
        }

        doc.on('update', publish)

        realtime.connection.on(
          'connected',
          () => {
            if (!cancelled) {
              setState('online')

              channel
                ?.publish(
                  'sync-request',
                  { clientId }
                )
                .catch(() => undefined)
            }
          }
        )

        realtime.connection.on(
          'disconnected',
          () =>
            !cancelled &&
            setState('offline')
        )

        realtime.connection.on(
          'suspended',
          () =>
            !cancelled &&
            setState('offline')
        )

        realtime.connection.on(
          'failed',
          () =>
            !cancelled &&
            setState('error')
        )

        let saveTimer: number | undefined

        const scheduleSave = () => {
          clearTimeout(saveTimer)

          saveTimer = window.setTimeout(
            () =>
              fetch(
                `${API_URL}/api/rooms/${encodeURIComponent(roomId)}`,
                {
                  method: 'PUT',
                  headers: {
                    'Content-Type':
                      'application/json'
                  },
                  body: JSON.stringify({
                    state: bytesToBase64(
                      Y.encodeStateAsUpdate(doc)
                    )
                  })
                }
              ).catch(() =>
                setState('offline')
              ),
            1200
          )
        }

        // Both the Notepad and Python Runner are persisted.
        code.observe(scheduleSave)
        notes.observe(scheduleSave)

        return () => {
          doc.off('update', publish)
          code.unobserve(scheduleSave)
          notes.unobserve(scheduleSave)
          clearTimeout(saveTimer)
        }
      } catch {
        if (!cancelled) {
          setState('offline')
        }
      }
    }

    let cleanup: undefined | (() => void)

    start().then(x => {
      cleanup = x
    })

    return () => {
      cancelled = true
      cleanup?.()
      channel?.detach()
      realtime?.close()
      persist?.destroy()
      doc.destroy()
    }
  }, [roomId, doc, code, notes])

  return {
    doc,
    code,
    notes,
    state,
    execution,
    setExecution
  }
}

function ThemeToggle({
  theme,
  setTheme
}: {
  theme: Theme
  setTheme: (theme: Theme) => void
}) {
  return (
    <div
      className="theme-toggle"
      role="group"
      aria-label="Theme"
    >
      <span className="theme-icon">☀</span>

      <button
        className={`theme-switch ${
          theme === 'dark' ? 'is-dark' : ''
        }`}
        onClick={() =>
          setTheme(
            theme === 'dark'
              ? 'light'
              : 'dark'
          )
        }
        aria-label={`Switch to ${
          theme === 'dark'
            ? 'light'
            : 'dark'
        } mode`}
      >
        <span />
      </button>

      <span className="theme-icon moon">
        ☾
      </span>
    </div>
  )
}

function Workspace({
  roomId
}: {
  roomId: string
}) {
  const {
    code: sharedCode,
    notes: sharedNotes,
    state,
    execution,
    setExecution
  } = useRoom(roomId)

  const [code, setCode] = useState(
    'print("Hello Nexus")'
  )

  const [notes, setNotes] = useState('')

  const [running, setRunning] =
    useState(false)

  const [theme, setTheme] =
    useState<Theme>(() => {
      const saved =
        localStorage.getItem(
          'nexus-theme'
        )

      return saved === 'light'
        ? 'light'
        : 'dark'
    })

  const codeEditorRef =
    useRef<HTMLTextAreaElement>(null)

  const notesEditorRef =
    useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    document.documentElement.dataset.theme =
      theme

    localStorage.setItem(
      'nexus-theme',
      theme
    )
  }, [theme])

  // Keep Python Runner synchronized with Yjs "code".
  useEffect(() => {
    const refresh = () => {
      const value = sharedCode.toString()

      // Preserve the starter Python code for a brand-new room.
      if (!value) {
        if (sharedCode.length === 0) {
          sharedCode.insert(
            0,
            'print("Hello Nexus")'
          )
        }

        return
      }

      setCode(value)
    }

    sharedCode.observe(refresh)
    refresh()

    return () =>
      sharedCode.unobserve(refresh)
  }, [sharedCode])

  // Keep Notepad synchronized with Yjs "notes".
  useEffect(() => {
    const refresh = () => {
      setNotes(sharedNotes.toString())
    }

    sharedNotes.observe(refresh)
    refresh()

    return () =>
      sharedNotes.unobserve(refresh)
  }, [sharedNotes])

  const editCode = (value: string) => {
    if (value.length > MAX_CODE) {
      value = value.slice(0, MAX_CODE)
    }

    const current = sharedCode.toString()

    sharedCode.doc?.transact(() => {
      sharedCode.delete(
        0,
        current.length
      )

      sharedCode.insert(
        0,
        value
      )
    })

    setCode(value)
  }

  const editNotes = (value: string) => {
    if (value.length > MAX_NOTES) {
      value = value.slice(0, MAX_NOTES)
    }

    const current = sharedNotes.toString()

    sharedNotes.doc?.transact(() => {
      sharedNotes.delete(
        0,
        current.length
      )

      sharedNotes.insert(
        0,
        value
      )
    })

    setNotes(value)
  }

  const run = async () => {
    if (code.length > MAX_CODE) {
      setExecution({
        status: 'failed',
        output: '',
        error: `Source is limited to ${MAX_CODE.toLocaleString()} characters.`
      })

      return
    }

    setRunning(true)

    setExecution({
      status: 'running',
      output: '',
      error: null,
      by: clientId
    })

    try {
      const r = await fetch(
        `${API_URL}/api/execute`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            code,
            roomId,
            clientId
          })
        }
      )

      const result =
        await r.json() as {
          success: boolean
          output: string
          error: string | null
          kind?: Execution['status']
        }

      if (!r.ok && r.status !== 422) {
        throw new Error(
          result.error ||
            'Execution service unavailable'
        )
      }

      setExecution({
        status: result.success
          ? 'completed'
          : result.kind === 'timeout'
          ? 'timeout'
          : 'failed',
        output: result.output || '',
        error: result.error || null,
        by: clientId
      })
    } catch (e) {
      setExecution({
        status: 'service-error',
        output: '',
        error:
          e instanceof Error
            ? e.message
            : 'Execution request failed',
        by: clientId
      })
    } finally {
      setRunning(false)
    }
  }

  const newRoom = () => {
    const id = slug()

    history.pushState(
      {},
      '',
      `/nexus/room/${id}`
    )

    location.reload()
  }

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(
        location.href
      )
    } catch {
      const input =
        document.createElement('input')

      input.value = location.href
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      input.remove()
    }
  }

  const shareInvite = async () => {
    const shareData = {
      title: 'Join my Nexus room',
      text: 'Join me in this Nexus collaborative workspace.',
      url: location.href
    }

    if (navigator.share) {
      try {
        await navigator.share(
          shareData
        )
      } catch {}
    } else {
      await copyInvite()
    }
  }

  const executionText =
    execution?.status === 'running'
      ? 'Running Python in isolated E2B sandbox…\n'
      : execution
      ? `${execution.output}${
          execution.error
            ? (execution.output
                ? '\n'
                : '') +
              execution.error
            : ''
        }`
      : 'Ready. Run Python to see shared output.'

  return (
    <main className="workspace">
      <header className="workspace-header">
        <div className="brand">
          <i />
          NEXUS <span>3D</span>
        </div>

        <div
          className={`status ${state}`}
        >
          {state === 'online'
            ? '● Synced'
            : state === 'connecting'
            ? '◌ Connecting…'
            : state === 'offline'
            ? '◌ Offline — local work retained'
            : '! Connection needs attention'}
        </div>

        <button
          className="ghost"
          onClick={newRoom}
        >
          New room
        </button>
      </header>

      <section className="roombar">
        <div>
          <small>
            SHARED ENGINEERING ROOM
          </small>

          <strong>
            {roomId}
          </strong>
        </div>

        <div className="room-actions">
          <button
            className="secondary-button"
            onClick={copyInvite}
          >
            Copy invite
          </button>

          <button
            className="primary-button"
            onClick={shareInvite}
          >
            Share
          </button>
        </div>
      </section>

      <section className="workspace-grid">

        {/* =====================================================
            LEFT: INDEPENDENT COLLABORATIVE NOTEPAD
            ===================================================== */}
        <section className="notepad-panel">
          <div className="pane-header">
            <div>
              <div className="pane-kicker">
                COLLABORATIVE SPACE
              </div>

              <div className="pane-name">
                Notepad
              </div>
            </div>

            <div className="pane-badge">
              CRDT
            </div>
          </div>

          <textarea
            ref={notesEditorRef}
            value={notes}
            spellCheck="true"
            onChange={e =>
              editNotes(e.target.value)
            }
            placeholder="Write notes, ideas, documentation, TODOs..."
            aria-label="Collaborative Nexus notepad"
            className="notepad"
          />

          <div className="notepad-footer">
            <span>
              {notes.length.toLocaleString()} /{' '}
              {MAX_NOTES.toLocaleString()} chars
            </span>

            <span>
              {state === 'online'
                ? 'Live collaboration enabled'
                : 'Local editing enabled'}
            </span>
          </div>
        </section>

        {/* =====================================================
            RIGHT: PYTHON RUNNER + TERMINAL
            ===================================================== */}
        <section className="right-column">

          {/* PYTHON RUNNER */}
          <section className="runner-panel">
            <div className="pane-header">
              <div>
                <div className="pane-kicker">
                  EXECUTION
                </div>

                <div className="pane-name">
                  Python Runner
                </div>
              </div>

              <div className="python-badge">
                PY
              </div>
            </div>

            <div className="runner-content">

              <textarea
                ref={codeEditorRef}
                value={code}
                spellCheck="false"
                onChange={e =>
                  editCode(e.target.value)
                }
                aria-label="Python code editor"
                className="python-editor"
                placeholder='print("Hello Nexus")'
              />

              <div className="runner-controls">
                <div className="runner-info">
                  <span className="dot" />
                  Python · E2B sandbox
                </div>

                <button
                  className="run"
                  disabled={running}
                  onClick={run}
                >
                  {running
                    ? 'Running…'
                    : '▶ Run Python'}
                </button>
              </div>
            </div>

            <div className="runner-footer">
              <span>
                {code.length.toLocaleString()} /{' '}
                {MAX_CODE.toLocaleString()} chars
              </span>

              <span>
                Python source is independent from Notepad
              </span>
            </div>
          </section>

          {/* TERMINAL */}
          <section className="terminal-panel">
            <div className="pane-header">
              <div>
                <div className="pane-kicker">
                  OUTPUT
                </div>

                <div className="pane-name">
                  Execution Terminal
                </div>
              </div>

              <span
                className={`terminal-status ${
                  execution?.status || 'ready'
                }`}
              >
                {execution?.status ||
                  'Ready'}
              </span>
            </div>

            <pre className="terminal-output">
              {executionText}
            </pre>

            <div className="terminal-note">
              Execution results are broadcast
              to everyone in this room.
            </div>
          </section>
        </section>
      </section>

      <ThemeToggle
        theme={theme}
        setTheme={setTheme}
      />
    </main>
  )
}

function App() {
  const [room, setRoom] =
    useState(roomFromPath())

  const [entered, setEntered] =
    useState(false)

  const enter = () => {
    const id = room || slug()

    history.pushState(
      {},
      '',
      `/nexus/room/${id}`
    )

    setRoom(id)
    setEntered(true)
  }

  if (
    room &&
    (
      entered ||
      location.pathname.includes(
        '/nexus/room/'
      )
    )
  ) {
    return (
      <Workspace
        roomId={room}
      />
    )
  }

  return (
    <div className="landing">
      <div className="canvas">
        <Hero3D />
      </div>

      <div className="landing-content">
        <div className="brand">
          <i />
          NEXUS <span>3D</span>
        </div>

        <p className="eyebrow">
          COLLABORATIVE ENGINEERING WORKSPACE
        </p>

        <h1>
          Build in the
          <br />
          <em>connected</em> layer.
        </h1>

        <p className="intro">
          Realtime Python collaboration with
          durable rooms, isolated execution,
          and a live systems view.
        </p>

        <div className="enter">
          <input
            value={room}
            onChange={e =>
              setRoom(
                e.target.value
                  .toLowerCase()
                  .replace(
                    /[^a-z0-9-]/g,
                    ''
                  )
              )
            }
            placeholder="room name (optional)"
          />

          <button onClick={enter}>
            Enter Nexus →
          </button>
        </div>

        <p className="hint">
          Python only · E2B-isolated execution ·
          Ably CRDT sync
        </p>
      </div>
    </div>
  )
}

createRoot(
  document.getElementById('root')!
).render(<App />)
```
