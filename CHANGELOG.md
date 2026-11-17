# Changelog

## 1.2.0

### Compatibility

- Update the desktop app before joining a room on the current Concord server.
  Desktop, web and API use room protocol 5. Self-hosters should update all three together.

### Changes

- Select LiveKit or Cloudflare SFU with the server's `MEDIA_PROVIDER` setting.
  Web and desktop clients discover the provider when joining.
- Share each screen with one video encoding at up to 30 FPS. The 720p and 1080p
  profiles prioritize motion and keep their respective 2 Mb/s and 5 Mb/s ceilings.
- On Cloudflare, recover an ended remote track while keeping healthy audio and video connected.
- Press Ctrl+Shift+D in a room to export two local WebRTC samples. When available,
  the export includes source, encoded and received frame counters, freeze duration,
  packet loss and round-trip time.

## 1.1.1

### Changes

- Add a desktop update panel with installed version, download progress, manual
  checks, errors, and retry actions.
- Check for stable releases at startup and every four hours, avoiding concurrent
  downloads. Preserve automatic installation on exit.
- Allow restarting to install a downloaded update after leaving the room.
- Restrict update IPC to the main window's main frame and detect unsupported builds.

### Validation and limitations

- Client typecheck, lint, and 118 tests passed; Windows packaging and web build passed.
- Electron UI tests exercised real local downloads, invalid checksum rejection,
  retry, and the restart command. A simulated room verified the restart button guard.
- The installer execution was intercepted in the UI test. Full NSIS replacement
  and relaunch, and AppImage execution on Linux, remain unverified.
- Room protocol remains 3. Windows artifacts are unsigned; portable ZIPs do not self-update.
- See `docs/audit/updates-2026-11-15.md` for details.

## 1.1.0

### Breaking changes

- Desktop, web, and API use room protocol 3. Message sync now refreshes the bounded
  transcript so reaction state remains authoritative after reconnecting.

### Changes

- Add message replies with quoted context, authenticated emoji reactions, an emoji
  picker, and compact grouping for consecutive messages from the same participant.
- Play the chat notification cue when new messages arrive outside the visible,
  focused chat, including background tabs and minimized desktop windows.
- Prepare the microphone muted when joining, so subsequent unmute does not need
  a new publication. Synchronize mute indicators between participants.
- Add three simulcast layers capped at the selected 720p or 1080p quality, with
  receiver layer selection based on tile size and visibility.
- Preserve active media on rejected subscriptions and recover partial subscriptions
  without unnecessary connection resets.
- Export local media diagnostics with Ctrl+Shift+D inside a room.
- Add optional OpenTelemetry instrumentation and a Grafana reference stack.

### Known limitations

- Update the API alongside clients: this release uses room protocol 3.
- Synthetic browser tests exercised two simultaneous streams against the SFU.
  Restoration to the highest layer, audible microphone delivery, separate devices
  and networks, native capture, and installed-app updates remain unverified.
- Simulcast caps quality, not total Cloudflare usage or billing. TURN configuration
  is still required for networks that need a relay.
- Windows artifacts are unsigned. Portable ZIP builds do not self-update.
- See `docs/audit/media-2026-11-15.md` for test evidence and remaining checks.

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
