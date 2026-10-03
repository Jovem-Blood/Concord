# Changelog

## 1.0.0

### Breaking changes

- Desktop, web, and API use room protocol 2. Upgrade clients and deploy a compatible
  API together; clients from the previous release receive an update-required response.
- Room sessions use authenticated Socket.IO connections for presence, chat,
  credential renewal, and recovery. The previous room and chat HTTP endpoints
  require a client update.

### Changes

- Realtime chat with delivery acknowledgements, typing indicators, and recovery
  while another connection keeps the conversation alive. History remains in memory
  and is cleared when the last connection leaves or the API restarts.
- Fix Electron screen-capture permission handling for the selected source, with
  selection expiration, frame validation, and single-use authorization.
- Gather ICE candidates before sending WebRTC offers and answers over HTTP.
- Show publication failure causes and connection states in the local console;
  remote telemetry contains only classified diagnostics.
- Replace room notification banners with temporary toasts that allow clicks on
  underlying controls. Keep fullscreen available, including on mobile and tablet.
- Ignore web build output in the desktop development watcher to prevent unintended
  renderer reloads and session interruptions.
- Document optional server-side TURN configuration and release checks.

### Known limitations

- An intermittent publication timeout was reported and did not reproduce in
  isolated Electron tests against production with synthetic video and audio.
  STUN DNS resolution failures were also observed; the timeout's cause is unconfirmed.
- Networks requiring a relay need server-side TURN configuration.
- Windows artifacts are unsigned. Portable ZIP builds do not self-update.
- Cross-device, cross-network, installed-app, and update checks remain part of the
  manual release checklist; automated tests and packaging do not replace them.
