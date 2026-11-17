# Media providers

Set `MEDIA_PROVIDER=livekit` or `MEDIA_PROVIDER=cloudflare` on the server.
The public, uncached `/v1/media/config` endpoint tells web and desktop which
backend to use on entry. There is no independent per-client switch or silent
fallback: everyone on a server must use the same backend.

LiveKit requires `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
Cloudflare requires `CLOUDFLARE_SFU_APP_ID`, `CLOUDFLARE_SFU_APP_SECRET` and
optionally both Cloudflare TURN variables. Credentials for the inactive backend
may stay in `.env`; they are not selected or validated. Compose defaults to
LiveKit. Outside Compose, omitting MEDIA_PROVIDER preserves legacy inference
(LiveKit if any LiveKit credentials exist, otherwise Cloudflare).

After deploying these changes, rebuild both server and web and update desktop
clients: protocol 5 rejects old clients that could still publish simulcast.
Subsequent provider changes require only editing the server environment and
running `docker compose up -d --force-recreate server`. This ends active rooms;
participants must rejoin. A client rebuild is not needed just to switch backend.
Keep the existing public Concord URLs and origin configuration unchanged.
Cloudflare Tunnel continues serving the Concord API/web; media goes to the
chosen SFU. LiveKit Cloud does not require home port forwarding.

Both backends now publish ONE video encoding per screen, with the selected
720p/1080p capture ceiling and 30 fps cap (2/5 Mbps respective bitrate ceilings).
Cloudflare uses one encoding without RIDs. LiveKit uses VP8 with simulcast,
adaptiveStream and Dynacast disabled. No tile-driven layer selection or quality
update endpoint remains. Browser congestion control can still reduce quality;
a single encoding does not guarantee fixed resolution or frame rate.

Microphone preparation, screen audio, mute/deafen, local playback controls,
Concord room authorization and Socket.IO chat are preserved. LiveKit uses
room-scoped server-issued tokens. Ctrl+Shift+D exports media diagnostics.
`media-audit.html` now follows the selected provider too.

## Validation of provider switch and single encoding — 2026-11-17

125 client tests and 57 server tests passed, along with typecheck, lint,
production web build and Windows Electron packaging. Tests cover server provider
selection with both sets of credentials present, client discovery/cancellation,
single Cloudflare encoding without RIDs, subscriptions without layer preferences,
and LiveKit publication with simulcast disabled. No new real-SFU browser session
or production deployment was performed for this change.

## Historical test results (before single-encoding change)

The results below describe the previous simulcast implementation, not the
current single-encoding implementation.

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
