import { describe, expect, it, vi } from 'vitest'
import { RECOVERY_MS, TOKEN_MS, type SendMessage } from '@concord/protocol'
import { RoomAuthority, type Participant } from './rooms.js'

function fixture() {
  let now = 1_000_000
  let socketNumber = 0
  const cleanup = vi.fn(async () => undefined)
  const rooms = new RoomAuthority(cleanup, () => now)
  rooms.onEnd = vi.fn()
  rooms.onMessage = vi.fn()
  rooms.onPresence = vi.fn()
  rooms.onTyping = vi.fn()
  function join(roomCode = 'ABCD2345', name = 'Alice') {
    const credentials = rooms.create(roomCode, name)
    const member = rooms.attach(credentials.participantToken, `socket-${++socketNumber}`)
    const state = rooms.sync(member, { conversation: '', after: 0 })
    return { member, credentials, state }
  }
  const input = (member: Participant, id = 'message-1', clientSequence = 1): SendMessage => ({
    id, clientSequence, content: 'Hello', conversation: rooms.sync(member, { conversation: '', after: 0 }).conversation,
  })
  return { rooms, join, input, cleanup, advance: (ms: number) => { now += ms } }
}

describe('single room authority', () => {
  it('requires an authenticated, synchronized socket for media and expires unused join tokens', () => {
    const { rooms, advance } = fixture()
    const credentials = rooms.create('ABCD2345', 'Alice')
    expect(() => rooms.authenticate(credentials.participantToken, true)).toThrow('NOT_READY')
    expect(rooms.presence('ABCD2345').participants).toEqual([])
    advance(RECOVERY_MS)
    rooms.sweep()
    expect(() => rooms.authenticate(credentials.participantToken)).toThrow('SESSION_ENDED')
  })

  it('replaces a socket atomically and ignores its delayed disconnect', () => {
    const { rooms, join } = fixture()
    const { credentials, member } = join()
    const original = member.socketId!
    rooms.attach(credentials.participantToken, 'replacement')
    expect(rooms.onEnd).toHaveBeenCalledWith(original, 'REPLACED')
    rooms.detach(member, original)
    expect(rooms.owns(member, 'replacement')).toBe(true)
    expect(rooms.presence(member.roomCode).participants[0]!.connection).toBe('connected')
  })

  it('reserves disconnected slots for 30 seconds and cleans up expired media independently of HTTP traffic', () => {
    const { rooms, join, advance, cleanup } = fixture()
    const members = Array.from({ length: 16 }, () => join())
    const first = members[0]!
    rooms.detach(first.member, first.member.socketId!)
    expect(rooms.presence(first.member.roomCode).participants[0]!.connection).toBe('reconnecting')
    expect(() => rooms.create(first.member.roomCode, 'Extra')).toThrow('Room capacity reached')
    advance(RECOVERY_MS - 1)
    expect(rooms.authenticate(first.credentials.participantToken)).toBe(first.member)
    advance(1)
    rooms.sweep()
    expect(cleanup).toHaveBeenCalledWith(first.member)
    expect(() => rooms.authenticate(first.credentials.participantToken)).toThrow('SESSION_ENDED')
    expect(() => rooms.create(first.member.roomCode, 'Extra')).not.toThrow()
  })

  it('deletes history at the last socket disconnect, even with identities reserved', () => {
    const { rooms, join, input } = fixture()
    const alice = join()
    const bob = join()
    const message = input(alice.member)
    rooms.send(alice.member, message)
    rooms.detach(alice.member, alice.member.socketId!)
    expect(rooms.sync(bob.member, { conversation: '', after: 0 }).messages).toHaveLength(1)
    rooms.detach(bob.member, bob.member.socketId!)
    rooms.attach(alice.credentials.participantToken, 'returned')
    const reset = rooms.sync(alice.member, { conversation: alice.state.conversation, after: 0 })
    expect(reset.conversation).not.toBe(alice.state.conversation)
    expect(reset.messages).toEqual([])
    expect(reset.nextClientSequence).toBe(1)
    expect(() => rooms.send(alice.member, message)).toThrow('CONVERSATION_RESET')
  })

  it('isolates conversation history and authenticates authors instead of trusting payload claims', () => {
    const { rooms, join, input } = fixture()
    const alice = join()
    const other = join('WXYZ2345')
    const message = rooms.send(alice.member, input(alice.member))
    expect(message.senderName).toBe('Alice')
    expect(message.senderId).toBe(alice.member.identity)
    expect(rooms.sync(other.member, { conversation: '', after: 0 }).messages).toEqual([])
    expect(() => rooms.send(alice.member, { ...input(alice.member, 'forged', 2), senderId: 'forged' } as SendMessage)).toThrow('INVALID_REQUEST')
  })

  it('deduplicates lost acknowledgements and rejects conflicting reuse of a message id', () => {
    const { rooms, join, input } = fixture()
    const { member } = join()
    const request = input(member)
    const accepted = rooms.send(member, request)
    expect(rooms.send(member, request)).toEqual(accepted)
    expect(rooms.onMessage).toHaveBeenCalledOnce()
    expect(() => rooms.send(member, { ...request, content: 'Changed' })).toThrow('INVALID_REQUEST')
    expect(() => rooms.send(member, { ...request, id: 'different' })).toThrow('MESSAGE_EXPIRED')
  })

  it('bounds history and receipt retention without resurrecting evicted messages', () => {
    const { rooms, join, input, advance } = fixture()
    const { member } = join()
    const first = input(member, 'first')
    rooms.send(member, first)
    for (let index = 2; index <= 510; index++) {
      advance(1100)
      rooms.send(member, input(member, `m-${index}`, index))
    }
    const state = rooms.sync(member, { conversation: '', after: 0 })
    expect(state.messages).toHaveLength(500)
    expect(state.messages[0]!.sequence).toBe(11)
    expect(() => rooms.send(member, first)).toThrow('MESSAGE_EXPIRED')
    expect(rooms.sync(member, { conversation: state.conversation, after: 508 }).messages.map((message) => message.sequence)).toEqual([509, 510])
  })

  it('validates content and rate-limits accepted messages without rate-limiting retries', () => {
    const { rooms, join, input } = fixture()
    const { member } = join()
    expect(() => rooms.send(member, { ...input(member), content: '\ud800' })).toThrow('INVALID_REQUEST')
    expect(() => rooms.send(member, { ...input(member), content: 'x'.repeat(2001) })).toThrow('INVALID_REQUEST')
    for (let i = 1; i <= 5; i++) rooms.send(member, input(member, `m-${i}`, i))
    expect(() => rooms.send(member, input(member, 'm-6', 6))).toThrow('RATE_LIMITED')
    expect(() => rooms.send(member, input(member, 'm-1', 1))).not.toThrow()
  })

  it('throttles typing, expires lost stop events, and clears it on send or disconnect', () => {
    const { rooms, join, advance, input } = fixture()
    const { member, state } = join()
    const typing = { conversation: state.conversation, active: true }
    rooms.setTyping(member, typing)
    rooms.setTyping(member, typing)
    expect(rooms.onTyping).toHaveBeenCalledTimes(1)
    advance(3000); rooms.sweep()
    expect(rooms.onTyping).toHaveBeenLastCalledWith(member.roomCode, [])
    rooms.setTyping(member, typing)
    rooms.send(member, input(member))
    expect(rooms.onTyping).toHaveBeenLastCalledWith(member.roomCode, [])
    advance(1000); rooms.setTyping(member, typing)
    rooms.detach(member, member.socketId!)
    expect(rooms.onTyping).toHaveBeenLastCalledWith(member.roomCode, [])
  })

  it('renews credentials idempotently across lost responses and confirmation, then retires the old token', () => {
    const { rooms, join, advance } = fixture()
    const { member, credentials } = join()
    advance(TOKEN_MS - 5 * 60_000)
    const renewed = rooms.renew(member)
    expect(renewed.participantToken).not.toBe(credentials.participantToken)
    expect(rooms.renew(member)).toEqual(renewed)
    expect(rooms.authenticate(credentials.participantToken)).toBe(member)
    rooms.detach(member, member.socketId!)
    rooms.attach(credentials.participantToken, 'recovered-old-token')
    expect(rooms.sync(member, { conversation: '', after: 0 }).credentials).toEqual(renewed)
    rooms.confirm(member, renewed.participantToken)
    rooms.confirm(member, renewed.participantToken)
    advance(45_001)
    expect(() => rooms.authenticate(credentials.participantToken)).toThrow('SESSION_ENDED')
    expect(rooms.authenticate(renewed.participantToken)).toBe(member)
    rooms.remove(member)
    expect(() => rooms.authenticate(renewed.participantToken)).toThrow('SESSION_ENDED')
  })
})
