# LiveKit media

This branch uses the official LiveKit browser SDK for voice and screen sharing.
The existing Concord API, room admission and Socket.IO chat remain in place.
API, web and desktop use protocol 4 to prevent mixing incompatible media clients.

Configure `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in the root
`.env`, then rebuild API and clients. Compose passes these only to the server.
No client build-time LiveKit secret or URL is required. Cloudflare Tunnel can
continue exposing Concord HTTP/WebSocket traffic. LiveKit Cloud carries media
directly between clients and its SFU; home port forwarding is unnecessary.

`POST /v1/livekit/token` requires a valid Concord participant token. The server
chooses the room (`concord-<roomCode>`), identity and name, ignoring caller-supplied
values. Tokens expire after ten minutes and permit microphone, screen video and
screen audio publication plus subscriptions; chat stays on Concord Socket.IO.
LiveKit refreshes connection tokens through its SDK while connected. Leaving or
expiry of the Concord session also removes the LiveKit participant server-side.

The SDK owns negotiation, reconnection, simulcast RIDs, adaptive subscriptions
and Dynacast. Remote video uses SDK `attach`/`detach` so visibility and dimensions
drive adaptation. Visible small tiles may intentionally use a lower layer;
focusing/enlarging the video lets the SDK request the larger layer. No Concord
RID-selection loop or periodic quality forcing is used.

Screen capture still uses Concord's source picker, 720p/1080p ceiling and system
audio handling on web and desktop. Publication uses LiveKit ScreenSharePresets
at 30 fps and a motion/frame-rate preference for moving video. Under constrained
resources the SDK/browser may still lower quality; this is not a guarantee of
constant resolution or FPS. Microphone capture is prepared silently on entry.

Ctrl+Shift+D exports two local LiveKit RTP-stat samples without room tokens,
credentials, SDP or network addresses. `media-audit.html` and `ui-audit.html`
remain development-only synthetic capture tools, excluded from production builds.

The old Cloudflare implementation is retained for historical tests but is not
selected by the application. When LiveKit is configured, legacy Cloudflare SFU
creation is disabled. LiveKit SDKs handle ICE/TURN; the old TURN settings are not
required. Do not use the old Cloudflare audit results to claim LiveKit behavior.

References:
- https://docs.livekit.io/reference/client-sdk-js/
- https://docs.livekit.io/transport/media/advanced/
- https://docs.livekit.io/transport/media/screenshare/

## Validation — 2026-11-16

- Typecheck and lint passed; 123 client and 56 server tests passed.
- Production web build and Windows x64 Electron packaging passed.
- Two independent browser sessions connected to the configured LiveKit Cloud
  project through the local Concord server and published synthetic 720p/30 video
  simultaneously. Small video elements received 640×360; after enlarging them,
  both received 1280×720 at 29 fps in the measured sample. Both inbound video
  reports showed zero packet loss and zero freezes (5 and 11 dropped frames
  accumulated during startup/layer changes).
- Prepared synthetic microphone toggled out of mute in 0 ms at the harness's
  millisecond precision. The other client received audio RTP. This measures the
  local action, not end-to-end acoustic latency.
- Stopping one screen left the other screen publishing at 720p/30 and voice
  connected. A third client using the actual Vue interface joined, received the
  other screen, published through the source picker, and received 720p when
  focusing the remote tile. All three left successfully.
- These are real Cloud SFU tests with generated media on one computer. Native
  Electron capture, real system audio, 1080p and different household networks
  were not exercised by this browser test. The desktop package was built, not
  interactively tested. A local API restart during development ended the prior
  room; clients successfully joined a new session afterward.
