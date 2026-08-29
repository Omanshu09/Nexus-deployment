import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as Ably from 'ably'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, Line, Stars } from '@react-three/drei'
import * as THREE from 'three'
import './styles.css'

const API_URL = (
  import.meta.env.VITE_API_URL ||
  'http://localhost:8787'
).replace(/\/$/, '')

const MAX_CODE = 20_000
const MAX_NOTES = 20_000

type Connection =
  | 'connecting'
  | 'online'
  | 'offline'
  | 'error'

type Execution = {
  status:
    | 'running'
    | 'completed'
    | 'failed'
    | 'timeout'
    | 'service-error'
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

/*
 * Room IDs are URL-safe.
 * The displayed room name is generated from the same ID.
 */
const adjectives = [
  'lunar',
  'neon',
  'orbital',
  'quantum',
  'vector',
  'ember',
  'stellar',
  'cyber',
  'nova',
  'signal'
]

const nouns = [
  'orbital',
  'signal',
  'forge',
  'lab',
  'matrix',
  'bridge',
  'circuit',
  'station',
  'engine',
  'grid'
]

function randomItem<T>(items: T[]) {
  return items[
    Math.floor(Math.random() * items.length)
  ]
}

function slug() {
  const first = randomItem(adjectives)
  const second = randomItem(nouns)
  const suffix = Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()

  return `${first}-${second}-${suffix.toLowerCase()}`
}

function roomDisplayName(roomId: string) {
  const parts = roomId.split('-')

  if (parts.length < 3) {
    return roomId
  }

  const suffix = parts.pop()!.toUpperCase()

  return `${parts
    .map(
      part =>
        part.charAt(0).toUpperCase() +
        part.slice(1)
    )
    .join(' ')} ${suffix}`
}

function roomFromPath() {
  const match = location.pathname.match(
    /^\/nexus\/room\/([a-z0-9-]{3,64})$/i
  )

  return match?.[1]?.toLowerCase() || ''
}

function Network() {
  const group = React.useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * 0.08
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

      {points.map((point, index) => (
        <Float
          key={index}
          speed={1.2}
          rotationIntensity={0.4}
        >
          <mesh position={point}>
            <sphereGeometry
              args={[0.07, 16, 16]}
            />

            <meshBasicMaterial
              color={
                index % 3
                  ? '#6ee7ff'
                  : '#a78bfa'
              }
            />
          </mesh>
        </Float>
      ))}

      {points.map(
        (point, index) =>
          index < points.length - 1 && (
            <Line
              key={`line-${index}`}
              points={[
                point,
                points[
                  (index * 7 + 3) %
                    points.length
                ]
              ]}
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
    <Canvas
      camera={{
        position: [0, 0, 8],
        fov: 48
      }}
    >
      <color
        attach="background"
        args={['#050505']}
      />

      <ambientLight intensity={0.7} />

      <Network />
    </Canvas>
  )
}

/*
 * IMPORTANT ARCHITECTURE:
 *
 * Yjs contains ONLY the collaborative Notepad.
 *
 * Python code is deliberately NOT inside Yjs.
 * Therefore each browser has its own Python editor.
 *
 * Execution results remain shared through Ably.
 */
function useRoom(roomId: string) {
  const [state, setState] =
    useState<Connection>('connecting')

  const [execution, setExecution] =
    useState<Execution | null>(null)

  const doc = useMemo(
    () => new Y.Doc(),
    [roomId]
  )

  const notes = useMemo(
    () => doc.getText('notes'),
    [doc]
  )

  useEffect(() => {
    let cancelled = false

    let realtime:
      | Ably.Realtime
      | undefined

    let channel:
      | Ably.RealtimeChannel
      | undefined

    let persistence:
      | IndexeddbPersistence
      | undefined

    let saveTimer:
      | number
      | undefined

    const start = async () => {
      try {
        /*
         * Load saved collaborative Notepad state.
         */
        const response = await fetch(
          `${API_URL}/api/rooms/${encodeURIComponent(
            roomId
          )}`
        )

        if (!response.ok) {
          throw new Error(
            'Room API unavailable'
          )
        }

        const saved =
          (await response.json()) as {
            state?: string
          }

        if (saved.state) {
          Y.applyUpdate(
            doc,
            base64ToBytes(saved.state),
            'server'
          )
        }

        /*
         * Local IndexedDB persistence applies
         * to the shared Notepad document only.
         */
        persistence =
          new IndexeddbPersistence(
            `nexus-${roomId}`,
            doc
          )

        /*
         * Ably authentication.
         */
        realtime =
          new Ably.Realtime({
            authCallback: async (
              _params,
              callback
            ) => {
              try {
                const tokenResponse =
                  await fetch(
                    `${API_URL}/api/ably/token`,
                    {
                      method: 'POST',
                      headers: {
                        'Content-Type':
                          'application/json'
                      },
                      body: JSON.stringify({
                        roomId,
                        clientId
                      })
                    }
                  )

                if (!tokenResponse.ok) {
                  throw new Error(
                    'Token request failed'
                  )
                }

                callback(
                  null,
                  await tokenResponse.json()
                )
              } catch (error) {
                callback(
                  {
                    name: 'AuthError',
                    message:
                      error instanceof Error
                        ? error.message
                        : 'Token request failed',
                    code: 401,
                    statusCode: 401
                  },
                  null
                )
              }
            }
          })

        channel =
          realtime.channels.get(
            `nexus:room:${roomId}`
          )

        /*
         * Collaborative Notepad updates.
         */
        channel.subscribe(
          'y-update',
          message => {
            if (
              message.clientId ===
              clientId
            ) {
              return
            }

            try {
              Y.applyUpdate(
                doc,
                base64ToBytes(
                  message.data as string
                ),
                'ably'
              )
            } catch {
              // Ignore malformed remote updates.
            }
          }
        )

        /*
         * Initial room synchronization.
         */
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
                    state:
                      bytesToBase64(
                        Y.encodeStateAsUpdate(
                          doc
                        )
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
            const payload =
              message.data as {
                clientId?: string
                state?: string
              }

            if (
              payload.clientId ===
                clientId &&
              payload.state
            ) {
              try {
                Y.applyUpdate(
                  doc,
                  base64ToBytes(
                    payload.state
                  ),
                  'ably'
                )
              } catch {
                // Ignore malformed state.
              }
            }
          }
        )

        /*
         * Execution results are shared.
         *
         * The Python SOURCE is not shared.
         * Only the RESULT is shared.
         */
        channel.subscribe(
          'execution',
          message => {
            setExecution(
              message.data as Execution
            )
          }
        )

        /*
         * Publish only collaborative Notepad updates.
         */
        const publishUpdate = (
          update: Uint8Array,
          origin: unknown
        ) => {
          if (
            origin === 'ably' ||
            origin === 'server'
          ) {
            return
          }

          channel
            ?.publish(
              'y-update',
              bytesToBase64(update)
            )
            .catch(() =>
              setState('offline')
            )
        }

        doc.on(
          'update',
          publishUpdate
        )

        realtime.connection.on(
          'connected',
          () => {
            if (cancelled) {
              return
            }

            setState('online')

            channel
              ?.publish(
                'sync-request',
                { clientId }
              )
              .catch(() => undefined)
          }
        )

        realtime.connection.on(
          'disconnected',
          () => {
            if (!cancelled) {
              setState('offline')
            }
          }
        )

        realtime.connection.on(
          'suspended',
          () => {
            if (!cancelled) {
              setState('offline')
            }
          }
        )

        realtime.connection.on(
          'failed',
          () => {
            if (!cancelled) {
              setState('error')
            }
          }
        )

        /*
         * Persist ONLY the collaborative Notepad.
         */
        const scheduleSave = () => {
          window.clearTimeout(
            saveTimer
          )

          saveTimer = window.setTimeout(
            async () => {
              try {
                await fetch(
                  `${API_URL}/api/rooms/${encodeURIComponent(
                    roomId
                  )}`,
                  {
                    method: 'PUT',
                    headers: {
                      'Content-Type':
                        'application/json'
                    },
                    body: JSON.stringify({
                      state:
                        bytesToBase64(
                          Y.encodeStateAsUpdate(
                            doc
                          )
                        )
                    })
                  }
                )
              } catch {
                if (!cancelled) {
                  setState('offline')
                }
              }
            },
            1000
          )
        }

        notes.observe(
          scheduleSave
        )

        return () => {
          doc.off(
            'update',
            publishUpdate
          )

          notes.unobserve(
            scheduleSave
          )

          window.clearTimeout(
            saveTimer
          )
        }
      } catch {
        if (!cancelled) {
          setState('offline')
        }
      }
    }

    let cleanup:
      | (() => void)
      | undefined

    start().then(result => {
      cleanup = result
    })

    return () => {
      cancelled = true

      cleanup?.()

      channel?.detach()

      realtime?.close()

      persistence?.destroy()

      doc.destroy()
    }
  }, [roomId, doc, notes])

  return {
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
      <span className="theme-icon">
        ☀
      </span>

      <button
        className={`theme-switch ${
          theme === 'dark'
            ? 'is-dark'
            : ''
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
    notes: sharedNotes,
    state,
    execution,
    setExecution
  } = useRoom(roomId)

  /*
   * Python is LOCAL to this browser.
   *
   * It deliberately does not come from Yjs.
   */
  const [code, setCode] =
    useState(
      'print("Hello Nexus")'
    )

  /*
   * Notepad is collaborative.
   */
  const [notes, setNotes] =
    useState('')

  const [running, setRunning] =
    useState(false)

  const [copied, setCopied] =
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

  const roomName =
    roomDisplayName(roomId)

  useEffect(() => {
    document.documentElement.dataset.theme =
      theme

    localStorage.setItem(
      'nexus-theme',
      theme
    )
  }, [theme])

  /*
   * Receive shared Notepad updates.
   */
  useEffect(() => {
    const refreshNotes = () => {
      setNotes(
        sharedNotes.toString()
      )
    }

    sharedNotes.observe(
      refreshNotes
    )

    refreshNotes()

    return () =>
      sharedNotes.unobserve(
        refreshNotes
      )
  }, [sharedNotes])

  /*
   * Local Python editor.
   */
  const editCode = (
    value: string
  ) => {
    if (value.length > MAX_CODE) {
      value =
        value.slice(0, MAX_CODE)
    }

    setCode(value)
  }

  /*
   * Collaborative Notepad editor.
   */
  const editNotes = (
    value: string
  ) => {
    if (value.length > MAX_NOTES) {
      value =
        value.slice(0, MAX_NOTES)
    }

    const current =
      sharedNotes.toString()

    sharedNotes.doc?.transact(
      () => {
        sharedNotes.delete(
          0,
          current.length
        )

        if (value.length > 0) {
          sharedNotes.insert(
            0,
            value
          )
        }
      },
      'local-notes'
    )

    setNotes(value)
  }

  /*
   * Execute THIS user's local Python code.
   *
   * The backend publishes only the result
   * to the room.
   */
  const run = async () => {
    if (!code.trim()) {
      setExecution({
        status: 'failed',
        output: '',
        error:
          'Python source cannot be empty.',
        by: clientId
      })

      return
    }

    if (code.length > MAX_CODE) {
      setExecution({
        status: 'failed',
        output: '',
        error:
          `Source is limited to ${MAX_CODE.toLocaleString()} characters.`,
        by: clientId
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
      const response =
        await fetch(
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
        (await response.json()) as {
          success: boolean
          output: string
          error: string | null
          kind?: Execution['status']
        }

      if (
        !response.ok &&
        response.status !== 422
      ) {
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
          : result.kind ===
            'service-error'
          ? 'service-error'
          : 'failed',
        output:
          result.output || '',
        error:
          result.error || null,
        by: clientId
      })
    } catch (error) {
      setExecution({
        status: 'service-error',
        output: '',
        error:
          error instanceof Error
            ? error.message
            : 'Execution request failed',
        by: clientId
      })
    } finally {
      setRunning(false)
    }
  }

  /*
   * New room no longer reloads the browser.
   *
   * This prevents the button itself from triggering
   * a Vercel navigation/404.
   */
  const newRoom = () => {
    const id = slug()

    history.pushState(
      {},
      '',
      `/nexus/room/${id}`
    )

    window.dispatchEvent(
      new PopStateEvent(
        'popstate'
      )
    )
  }

  /*
   * Robust clipboard function.
   */
  const copyText = async (
    text: string
  ) => {
    if (
      navigator.clipboard &&
      window.isSecureContext
    ) {
      await navigator.clipboard.writeText(
        text
      )

      return true
    }

    const textarea =
      document.createElement(
        'textarea'
      )

    textarea.value = text
    textarea.setAttribute(
      'readonly',
      ''
    )

    textarea.style.position =
      'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'

    document.body.appendChild(
      textarea
    )

    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(
      0,
      textarea.value.length
    )

    const successful =
      document.execCommand(
        'copy'
      )

    document.body.removeChild(
      textarea
    )

    if (!successful) {
      throw new Error(
        'Clipboard access was blocked by the browser.'
      )
    }

    return true
  }

  const copyInvite = async () => {
    try {
      await copyText(
        location.href
      )

      setCopied(true)

      window.setTimeout(
        () => setCopied(false),
        1800
      )
    } catch {
      /*
       * Last-resort visible fallback.
       * The user can still copy the selected URL.
       */
      window.prompt(
        'Copy this Nexus invite:',
        location.href
      )
    }
  }

  const shareInvite = async () => {
    const shareData = {
      title:
        'Join my Nexus room',
      text:
        'Join me in this Nexus collaborative workspace.',
      url: location.href
    }

    if (
      typeof navigator.share ===
      'function'
    ) {
      try {
        await navigator.share(
          shareData
        )

        return
      } catch {
        /*
         * User cancellation or unsupported
         * native share should not break anything.
         */
      }
    }

    await copyInvite()
  }

  const executionText =
    execution?.status ===
    'running'
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
      : 'Ready. Run Python to see the shared execution result.'

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
            : state ===
              'connecting'
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
            {roomName}
          </strong>

          <div className="room-id">
            {roomId}
          </div>
        </div>

        <div className="room-actions">
          <button
            className="secondary-button"
            onClick={copyInvite}
          >
            {copied
              ? '✓ Copied'
              : 'Copy invite'}
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
            value={notes}
            spellCheck="true"
            onChange={event =>
              editNotes(
                event.target.value
              )
            }
            placeholder="Write notes, ideas, documentation, TODOs..."
            aria-label="Collaborative Nexus notepad"
            className="notepad"
          />

          <div className="notepad-footer">
            <span>
              {notes.length.toLocaleString()}{' '}
              /{' '}
              {MAX_NOTES.toLocaleString()}{' '}
              chars
            </span>

            <span>
              {state === 'online'
                ? 'Live collaboration enabled'
                : 'Local editing enabled'}
            </span>
          </div>
        </section>

        <section className="right-column">
          <section className="runner-panel">
            <div className="pane-header">
              <div>
                <div className="pane-kicker">
                  PRIVATE EXECUTION
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
                value={code}
                spellCheck="false"
                onChange={event =>
                  editCode(
                    event.target.value
                  )
                }
                aria-label="Private Python code editor"
                className="python-editor"
                placeholder='print("Hello Nexus")'
              />

              <div className="runner-controls">
                <div className="runner-info">
                  <span className="dot" />
                  Python · E2B sandbox · Private source
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
                Your Python code is private to you
              </span>
            </div>
          </section>

          <section className="terminal-panel">
            <div className="pane-header">
              <div>
                <div className="pane-kicker">
                  SHARED OUTPUT
                </div>

                <div className="pane-name">
                  Execution Terminal
                </div>
              </div>

              <span
                className={`terminal-status ${
                  execution?.status ||
                  'ready'
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

  const [, forceRoute] =
    useState(0)

  useEffect(() => {
    const handlePopState = () => {
      setRoom(roomFromPath())
      forceRoute(value => value + 1)
    }

    window.addEventListener(
      'popstate',
      handlePopState
    )

    return () =>
      window.removeEventListener(
        'popstate',
        handlePopState
      )
  }, [])

  const enter = () => {
    const id = slug()

    history.pushState(
      {},
      '',
      `/nexus/room/${id}`
    )

    setRoom(id)

    window.dispatchEvent(
      new PopStateEvent(
        'popstate'
      )
    )
  }

  if (room) {
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
          Realtime collaborative notes,
          private Python execution,
          durable rooms, and a live
          systems view.
        </p>

        <div className="enter">
          <button onClick={enter}>
            Enter Nexus →
          </button>
        </div>

        <p className="hint">
          Shared Notepad · Private Python
          · E2B execution · Ably sync
        </p>
      </div>
    </div>
  )
}

createRoot(
  document.getElementById('root')!
).render(<App />)