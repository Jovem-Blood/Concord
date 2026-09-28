# Realtime room lifecycle (protocol v2)

## Ownership and transport

- `packages/protocol` is the shared event/type contract and policy constants.
- `apps/server/src/rooms.ts`: one in-memory `RoomAuthority` owns membership, credentials, conversation generations, ordering, message receipts, and typing.
- `apps/server/src/realtime.ts`: Socket.IO gateway on `/v2/realtime/`, **WebSocket only**, with origin checks, authenticated events, bounded packets, and heartbeat detection.
- `apps/client/src/renderer/services/room-session.ts`: the single client controller owns joins, readiness, recovery, credential rotation, the bounded outbox, typing, and departure.
- The Cloudflare media service receives pushed presence and only performs HTTP SFU operations. It has event-driven reconciliation and failure recovery, not room polling.

The server rejects old joins and retired room/chat APIs with HTTP 426 (`UPDATE_REQUIRED`). Socket handshakes must declare protocol 2. Credentials are sent in the Socket.IO auth payload, not URLs. There is no HTTP long-polling fallback and no Socket.IO packet-recovery store that could retain a deleted conversation.

## Lifecycle

1. HTTP join issues an anonymous participant credential and reserves a slot for up to 30 seconds.
2. The socket authenticates and becomes the sole owner of that participant connection. A replacement is installed before the old socket closes.
3. `session:sync` returns authoritative presence, conversation generation, message cursor/history, typing, and credentials. Sending is enabled only after synchronization.
4. Healthy sockets receive pushed state changes. The server sends a heartbeat every 10 seconds with a 5-second timeout.
5. An unexpected disconnect reserves identity and capacity for **30 seconds after detection**. The participant is displayed as reconnecting; ordinary recovery produces no leave/join sound. Voice and screen media can continue during this interval.
6. Expiry removes the participant and closes server media resources. The client stops capture and asks for an explicit rejoin. A waking/suspended client checks elapsed time before continuing.
7. Explicit Leave and delivered refresh/tab-close signals revoke the session immediately. Unload beacons have a keepalive fallback. A lost unload signal follows normal failure detection and expiry.

Independent tabs are independent identities. Display names do not authenticate users. Reserved identities count toward the 16-person room capacity. Switching tabs or minimizing does not itself leave the room; typing stops while hidden.

## Conversation lifetime and synchronization

**Zero live sockets means immediate history deletion**, even if identities remain reserved for recovery. This is intentionally stricter than the participant lifecycle. A new conversation gets a new random generation ID; reconnecting clients clear the old transcript and cannot replay its messages.

History is limited to 500 messages of at most 2,000 Unicode characters each, in RAM only. Sync and live delivery have one ordered handoff. The client buffers bounded events arriving during synchronization, deduplicates overlap, and resynchronizes on gaps. Initial history is silent/read; missed remote messages are unread when the chat is closed, but recovery never produces notification sounds.

An API restart clears all state. Clients receive a terminal session response or fail credential validation, stop media, and show **Entrar novamente**. They do not silently recreate the room.

## Delivery and drafts

- Muted message text: pending; normal text: accepted by the server; red: failed with a retry action. Acceptance is not a read or per-recipient delivery receipt.
- Offline composition remains a local editable draft. Send is disabled, with a spinner during recovery. Drafts are never automatically submitted.
- Only previously submitted messages may retry, for at most 30 seconds and only in the same conversation. A serialized, 20-message outbox preserves sender order.
- Automatic and manual retries use the original message ID and client sequence. The server supplies the author identity, timestamp, and room sequence.
- Recent receipts are retained independently of the visible history (60 seconds, capped at 2,048 per room). A participant high-water mark prevents ancient/evicted requests from being published again. If an old result cannot be recovered, the client offers Copy to draft instead of guessing delivery.
- When a conversation/session ends, pending/failed local text can be copied into a draft for explicit sending. A stale acknowledgement cannot populate a newer conversation or room.

## Credential renewal

Credentials last two hours and renew five minutes before expiry, using the server clock offset. Renewal is staged and idempotent: repeated requests return the same pending credential, and reconnect sync can recover it using the prior credential. After the client adopts and confirms the replacement, the old credential is accepted for another 45 seconds to cover in-flight HTTP operations. Leaving revokes both. Renewal never extends a disconnected participant's recovery deadline.

## Typing and resource bounds

Typing updates are volatile, at most once per second, and expire after three seconds idle. Send, empty draft, chat close, hidden page, and disconnect clear the indicator. The server expires abandoned indicators; the client has a fallback expiry for lost volatile events. Typing is never buffered or replayed.

Inbound socket frames are capped at 16 KiB. Accepted messages are limited to five per five seconds per participant; duplicate delivery checks do not consume that allowance. Socket events have an additional burst limit. Slow readers exceeding the outbound packet/byte budget are disconnected and must resynchronize. All timers, listeners, pending callbacks, and media operations are scoped to a session generation.

## Cloudflare Tunnel deployment

Use the existing API hostname in `VITE_SERVER_URL` (for example, `https://api.example.com`). Socket.IO derives the secure WebSocket URL automatically. Route that hostname to the API HTTP service, including `/v2/realtime/`. The web Nginx container also proxies `/v2/realtime/` to the Compose `server:3001` service, preserving WebSocket upgrades for same-host deployments where the tunnel routes only `/v1/` to the API and all other paths to the web container.

Example tunnel ingress:

```yaml
ingress:
  - hostname: api.example.com
    service: http://localhost:3001
  - hostname: concord.example.com
    service: http://localhost:4173
  - service: http_status:404
```

When cloudflared runs in the Compose network, use the appropriate service names instead of localhost. Configure `ALLOWED_ORIGINS` with the public web app origin. Preserve the WebSocket upgrade and Socket.IO path; any additional proxy must allow long-lived upgraded connections. No sticky sessions or shared adapters are required for this **single API instance** deployment.

Deploy the updated server and web/desktop clients together. SIGTERM/SIGINT closes sockets and media through Fastify's shutdown lifecycle. Server deployments and tunnel restarts may interrupt connections: a surviving API permits recovery within the deadline, while an API restart requires rejoining.

Validate the actual tunnel separately from localhost tests: WSS upgrade, idle connections, brief tunnel restart, a restart exceeding recovery, browser background/wake, and incompatible desktop versions.
