# Manual verification

[English](manual-test-checklist.md) | [Português do Brasil](manual-test-checklist.pt-BR.md)

Use two clients on separate devices, with test rooms and your own SFU credentials.
Record the commit, OS, browser or desktop version, and any unsupported cases in the
pull request. Automated tests cover domain behavior; these checks exercise real
permissions, capture, and connectivity.

- [ ] Create a room and join from the second client using its code and invite link.
- [ ] Enable and mute each microphone. Confirm remote audio and speaking indicators.
- [ ] Share a screen or window, switch sources, and stop sharing from both the app
      and the browser's native control. Confirm remote tiles disappear.
- [ ] Share from both clients simultaneously and focus each stream.
- [ ] Test system audio when the platform supports it; deny permissions and confirm
      the app explains how to recover without starting an unintended capture.
- [ ] Send chat messages in both directions. Reconnect or join with a new client
      while someone remains and confirm history is restored without duplicate messages.
      Have everyone leave, reuse the room code, and confirm history is empty.
- [ ] Drop one client's WebSocket while another remains. Confirm a reconnecting
      tile, preserved voice/screen media, disabled Send with a spinner, editable
      draft, and silent catch-up. Confirm the draft is not sent automatically.
- [ ] Drop the last socket and reconnect within 30 seconds. Confirm the identity
      recovers but the old history is cleared. Failed text must require Copy to draft.
- [ ] Lose a message acknowledgement. Confirm pending text becomes sent once,
      or becomes red after 30 seconds; Resend must not duplicate an accepted message.
- [ ] Verify combined typing names, no self indicator, and clearing after 3 seconds
      idle, Send, empty draft, chat close, page hiding, and disconnect.
- [ ] Exceed the reconnect deadline or restart the API. Confirm media stops and
      an explicit rejoin is required. Refresh must not automatically join.
- [ ] Verify automatic credential renewal in a room lasting over two hours.
- [ ] Repeat idle/reconnect checks through Cloudflare Tunnel and confirm WebSocket
      transport only. An old client must receive an update-required response.
- [ ] Disconnect the network briefly and restore it. Check recovery, then leave
      the room and confirm all microphone and capture resources stop.
- [ ] Copy an invite in the web and desktop clients and open it on the other device.
- [ ] Check the landing page and room on mobile and desktop, including keyboard
      focus, readable controls, and permission error messages.
- [ ] Check fullscreen on mobile and tablet. Trigger room notifications and confirm
      that toasts expire automatically and allow clicks on controls beneath them.
- [ ] With desktop development running, run `pnpm build:web`; the web output must
      not reload the desktop renderer or interrupt its active session.
- [ ] For a release, install and launch the Windows NSIS and Linux AppImage builds;
      check update behavior separately from portable ZIP builds.

Connectivity requiring a TURN relay needs both `CLOUDFLARE_TURN_KEY_ID` and
`CLOUDFLARE_TURN_API_TOKEN` on the server. Test from different networks and record
whether TURN is enabled. If a timeout occurs, record `causeMessage` from the local
console and the ICE connection states; a later successful connection does not
establish the cause of the earlier failure.
