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
- [ ] Send chat messages in both directions. Reconnect and confirm old messages
      are cleared.
- [ ] Disconnect the network briefly and restore it. Check recovery, then leave
      the room and confirm all microphone and capture resources stop.
- [ ] Copy an invite in the web and desktop clients and open it on the other device.
- [ ] Check the landing page and room on mobile and desktop, including keyboard
      focus, readable controls, and permission error messages.
- [ ] For a release, install and launch the Windows NSIS and Linux AppImage builds;
      check update behavior separately from portable ZIP builds.

Connectivity requiring a TURN relay is currently unsupported. Note such a network
restriction separately from a regression.
