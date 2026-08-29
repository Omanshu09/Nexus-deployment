import { neon } from '@neondatabase/serverless'
import { config } from './config.js'
import * as Y from 'yjs'
export const sql = neon(config.databaseUrl)
export async function initialiseDatabase() {
 await sql`CREATE TABLE IF NOT EXISTS nexus_rooms (room_id VARCHAR(64) PRIMARY KEY, document_state TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
}
export async function getRoom(roomId:string) { const rows = await sql`SELECT document_state, updated_at FROM nexus_rooms WHERE room_id = ${roomId}`; return rows[0] as {document_state:string;updated_at:string}|undefined }
const fromBase64 = (value:string) => Uint8Array.from(Buffer.from(value, 'base64'))
const toBase64 = (value:Uint8Array) => Buffer.from(value).toString('base64')
// Merge CRDT updates rather than last-write-wins so a delayed offline autosave cannot erase another collaborator's update.
export async function saveRoom(roomId:string,state:string) {
 const existing = await getRoom(roomId)
 const merged = existing?.document_state ? toBase64(Y.mergeUpdates([fromBase64(existing.document_state), fromBase64(state)])) : state
 await sql`INSERT INTO nexus_rooms (room_id, document_state, updated_at) VALUES (${roomId}, ${merged}, NOW()) ON CONFLICT (room_id) DO UPDATE SET document_state = EXCLUDED.document_state, updated_at = NOW()`
}
