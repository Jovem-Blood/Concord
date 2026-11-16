# Screen-sharing quality reference and validation

## Follow-up: reported frame-rate regression

After deploying the initial change, the user reported reduced frame rate and
continued low resolution. The initial `detail` / `maintain-resolution` policy
favored presentation clarity, despite the application's moving-video use case.
Moreover, the earlier canvas harness bypassed App.vue's `detail` assignment, so
that live test did not exercise the exact production content hint.

The follow-up moves the content hint into the shared publication service and
uses `motion` / `maintain-framerate`. The same policy now applies to native,
browser and synthetic publication paths. Bitrate ceilings and the two layers are
unchanged. The 30 room/quality tests, client typecheck and lint passed. This is
a correction of the configured FPS tradeoff, not a measured resolution of the
reported regression; frame rate and automatic SFU layer recovery still need
live verification. Preserving frame rate can still sacrifice resolution when
resources are constrained.

Reference: https://www.w3.org/TR/mst-content-hint/ explains why treating movies
or games as text-oriented screen content can cause excessive frame dropping.

The sections below record the original implementation and test results.

## Reference

Use LiveKit's 30-fps screen-share presets and default half-resolution fallback as
the baseline, while retaining Cloudflare's SFU and alphabetical RID priority.
Sources consulted on 2026-11-16:

- https://github.com/livekit/client-sdk-js/blob/main/src/room/track/options.ts
- https://github.com/livekit/client-sdk-js/blob/main/src/room/participant/publishUtils.ts
- https://developers.cloudflare.com/realtime/sfu/features/simulcast/

720p: full at 2 Mbps plus half at 0.5 Mbps (2.5 Mbps total video ceiling).
1080p: full at 5 Mbps plus half at 1.25 Mbps (6.25 Mbps total video ceiling).
Both layers allow 30 fps. Encodings are ordered low-to-high; the RIDs remain
`h` for half and `f` for full, so Cloudflare's alphabetical fallback prefers full.
The sender prefers maintaining resolution; capture uses the detail content hint.
Under pressure this can sacrifice frame rate. It does not guarantee resolution.

Visible streams prefer full; hidden streams prefer half. Tile width no longer
forces a downgrade. The API accepts both two-layer and older three-layer SDP.
Legacy `q` requests remain accepted for existing clients. Cloudflare's configured
fallback handles a missing RID. This does not implement LiveKit Dynacast or SVC.

## Validation

- 119 client and 53 server tests passed; typecheck, lint and web build passed.
- After aligning encoding order, all 30 quality/room tests passed again.
- Tests exercise half-to-full updates on the same receiving track, preserving
  sender encoding parameters, and API acceptance of both publication layouts.
- Two independent sessions in one Chromium-based in-app browser used the local
  API and real Cloudflare SFU, with animated canvas video and synthetic audio.
- With the final encoding order, the first stream reached 1280x720. Explicitly
  requesting half produced 640x360; requesting full restored 1280x720. The
  receiving MID stayed `3`; the sampled freeze counter stayed zero. The final
  sample showed 28 fps and 16 cumulative lost packets, so this was not lossless.
- A simultaneous second publication delivered 640x360 while its sender reported
  `qualityLimitationReason: bandwidth`, zero encoded full-layer frames, and an
  active half layer. The first stream continued at 720p. The second receiver
  recorded two freezes totaling 0.621 seconds at that sample.
- In the later sample, the second sender had resumed its full layer at 1280x720,
  30 fps, with limitation reason `none` and about 4.69 Mbps estimated available
  outgoing bandwidth. Its viewer still received 640x360 at 28 fps. This leaves
  SFU/receiver automatic recovery unresolved even though explicit layer switching
  succeeded. The first viewer remained at 720p with zero freezes; its cumulative
  loss count had risen to 46 packets. Both test sessions were then disconnected.

The test confirms explicit layer restoration, not automatic recovery from an
induced network bottleneck. It does not establish the cause of users' reported
quality drops. Cross-device/network testing, 1080p delivery, native capture and
audible audio were not verified in this run. The canvas harness exercises the
publication service; it does not exercise the App.vue capture content hint.
