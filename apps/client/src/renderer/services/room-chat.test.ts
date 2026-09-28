import { describe, expect, it } from 'vitest'
import type { Message, SyncState } from '@concord/protocol'
import { RoomChat } from './room-chat'

const message = (id: string, sequence: number, senderId = 'remote', conversation = 'one'): Message => ({
  id, sequence, clientSequence: sequence, senderId, senderName: senderId, conversation, type: 'text', content: id, sentAt: sequence,
})
const snapshot = (messages: Message[], conversation = 'one'): SyncState => ({ messages, conversation, cursor: messages.length,
  presence: { participants: [], tracks: [] }, typing: [], serverTime: 1, nextClientSequence: 1,
  credentials: { identity: 'local', participantToken: 'token', expiresAt: 1000 } })

describe('room chat presentation', () => {
  it('loads initial history silently, marks catch-up unread, and sounds only live new messages', () => {
    const chat = new RoomChat(() => undefined)
    chat.synchronize(snapshot([message('first', 1)]), 'local', true)
    expect(chat.snapshot).toMatchObject({ unread: 0, notification: 0 })
    chat.synchronize(snapshot([message('first', 1), message('second', 2)]), 'local', false)
    expect(chat.snapshot).toMatchObject({ unread: 1, notification: 0 })
    chat.receive(message('third', 3), 'local')
    chat.receive(message('third', 3), 'local')
    expect(chat.snapshot).toMatchObject({ unread: 2, notification: 1 })
    chat.setOpen(true)
    expect(chat.snapshot.unread).toBe(0)
  })

  it('replaces optimistic messages without duplicates even when echo precedes the acknowledgement', () => {
    const chat = new RoomChat(() => undefined)
    chat.synchronize(snapshot([]), 'local', true)
    chat.pending(message('own', 1, 'local'))
    chat.receive(message('own', 1, 'local'), 'local')
    chat.status('own', 'failed')
    chat.receive(message('own', 1, 'local'), 'local', false)
    expect(chat.snapshot.messages).toHaveLength(1)
    expect(chat.snapshot.messages[0]!.status).toBe('sent')
    expect(chat.snapshot.notification).toBe(0)
  })

  it('clears a deleted conversation and preserves only unsent local text as explicit draft recovery', () => {
    const chat = new RoomChat(() => undefined)
    chat.synchronize(snapshot([message('old', 1)]), 'local', true)
    chat.pending(message('unsent', 2, 'local'))
    chat.synchronize(snapshot([], 'two'), 'local', false)
    expect(chat.snapshot.messages).toEqual([])
    expect(chat.snapshot.drafts).toEqual([{ id: 'unsent', content: 'unsent', senderId: 'local' }])
    chat.receive(message('old', 1), 'local')
    expect(chat.snapshot.messages).toEqual([])
    chat.dismissDraft('unsent')
    expect(chat.snapshot.drafts).toEqual([])
  })
})
