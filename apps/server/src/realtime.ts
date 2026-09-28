import { Server, type Socket } from 'socket.io'
import type { Server as HttpServer } from 'node:http'
import { ACK_MS, PROTOCOL_VERSION, SOCKET_PATH, type Ack, type ClientEvents, type ServerEvents } from '@concord/protocol'
import { RoomAuthority, RoomError, type Participant } from './rooms.js'

type RoomSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, { member: Participant }>

export function createRealtime(server: HttpServer, rooms: RoomAuthority, allowedOrigin: (origin?: string) => boolean) {
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, { member: Participant }>(server, {
    path: SOCKET_PATH, transports: ['websocket'], serveClient: false,
    pingInterval: 10_000, pingTimeout: 5_000, connectTimeout: 10_000, maxHttpBufferSize: 16_384,
    allowRequest: (request, callback) => callback(null, allowedOrigin(request.headers.origin)),
    // Deliberately no connectionStateRecovery packet store: old conversation generations must not survive deletion.
  })

  io.use((socket, next) => {
    try {
      if (socket.handshake.auth.protocol !== PROTOCOL_VERSION) throw new RoomError('UPDATE_REQUIRED', 426)
      socket.data.member = rooms.authenticate(socket.handshake.auth.token)
      next()
    } catch (error) {
      next(Object.assign(new Error('Session unavailable'), { data: { code: error instanceof RoomError ? error.code : 'SESSION_ENDED' } }))
    }
  })

  function roomSockets(room: string): RoomSocket[] {
    return [...io.sockets.sockets.values()].filter((socket) => socket.data.member.roomCode === room &&
      rooms.owns(socket.data.member, socket.id) && socket.data.member.ready)
  }
  const budgets = new WeakMap<RoomSocket, { packets: number; bytes: number }>()
  function writable(socket: RoomSocket): boolean {
    const budget = budgets.get(socket)
    if (budget && (budget.packets > 64 || budget.bytes > 8 * 1024 * 1024)) { socket.conn.close(true); return false }
    return true
  }
  rooms.onPresence = (room, presence) => { for (const socket of roomSockets(room)) if (writable(socket)) socket.emit('room:presence', presence) }
  rooms.onMessage = (room, message) => { for (const socket of roomSockets(room)) if (writable(socket)) socket.emit('chat:message', message) }
  rooms.onTyping = (room, typing) => { for (const socket of roomSockets(room)) if (writable(socket)) socket.volatile.emit('chat:typing', typing) }
  rooms.onEnd = (id, reason) => { const socket = io.sockets.sockets.get(id); socket?.emit('session:ended', reason); socket?.disconnect(true) }

  io.on('connection', (socket) => {
    const budget = { packets: 0, bytes: 0 }
    budgets.set(socket, budget)
    const packetCreated = (packet: { data?: unknown }) => {
      budget.packets++
      budget.bytes += typeof packet.data === 'string' ? Buffer.byteLength(packet.data) : 16_384
      writable(socket)
    }
    const drained = () => { budget.packets = 0; budget.bytes = 0 }
    socket.conn.on('packetCreate', packetCreated)
    socket.conn.transport.on('drain', drained)
    let member: Participant
    try { member = rooms.attach(socket.handshake.auth.token, socket.id) } catch { socket.emit('session:ended', 'SESSION_ENDED'); socket.disconnect(true); return }
    socket.data.member = member
    const syncTimer = setTimeout(() => { if (!member.ready && member.socketId === socket.id) socket.conn.close() }, ACK_MS * 2)
    let events = 0
    let windowStart = Date.now()
    socket.use((_packet, next) => {
      if (Date.now() - windowStart >= 5000) { events = 0; windowStart = Date.now() }
      if (++events > 60 || !rooms.owns(member, socket.id)) { socket.disconnect(true); return }
      next()
    })
    function handle<T>(ack: Ack<T>, action: () => T): void {
      if (typeof ack !== 'function') return
      try {
        if (!rooms.owns(member, socket.id)) throw new RoomError('SESSION_ENDED')
        if (!writable(socket)) return
        ack({ ok: true, value: action() })
      } catch (error) { ack({ ok: false, code: error instanceof RoomError ? error.code : 'INVALID_REQUEST' }) }
    }
    socket.on('session:sync', (request, ack) => handle(ack, () => { const state = rooms.sync(member, request); clearTimeout(syncTimer); return state }))
    socket.on('session:renew', (ack) => handle(ack, () => rooms.renew(member)))
    socket.on('session:confirm', (token, ack) => handle(ack, () => { rooms.confirm(member, token); return null }))
    socket.on('session:leave', (ack) => {
      if (!rooms.owns(member, socket.id)) return
      if (typeof ack === 'function') ack({ ok: true, value: null })
      rooms.remove(member)
    })
    socket.on('chat:send', (input, ack) => handle(ack, () => rooms.send(member, input)))
    socket.on('chat:typing', (input) => { if (rooms.owns(member, socket.id)) rooms.setTyping(member, input) })
    socket.on('disconnect', () => {
      clearTimeout(syncTimer)
      socket.conn.off('packetCreate', packetCreated); socket.conn.transport.off('drain', drained)
      rooms.detach(member, socket.id)
    })
  })

  const reap = setInterval(() => rooms.sweep(), 1000)
  reap.unref()
  return {
    io,
    async close() { clearInterval(reap); await rooms.close(); await new Promise<void>((resolve) => io.close(() => resolve())) },
  }
}
