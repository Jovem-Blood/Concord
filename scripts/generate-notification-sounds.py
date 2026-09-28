#!/usr/bin/env python3
"""Rebuild notification MP3s from the original join instrument (requires ffmpeg).

Run from any directory with: python3 scripts/generate-notification-sounds.py
The opening C4 is sampled before the original G4 enters. Pitch changes use
resampling; short fades prevent clicks and preserve the recorded attack.
"""

from pathlib import Path
import subprocess


SOUNDS = Path(__file__).resolve().parents[1] / "apps/client/src/renderer/assets/sounds"
# (semitones above C4, onset in milliseconds, gain)
PATTERNS = {
    "chat-notification": [(7, 0, 0.65), (12, 95, 0.52)],
    "screen-open": [(0, 0, 0.8), (4, 100, 0.8), (7, 200, 0.8)],
    "screen-close": [(7, 0, 0.8), (4, 100, 0.8), (0, 200, 0.8)],
}


def generate(name, notes):
    branches = "".join(f"[sample{i}]" for i in range(len(notes)))
    filters = [f"[0:a]atrim=start=0:end=0.18,asetpts=PTS-STARTPTS,asplit={len(notes)}{branches}"]
    for i, (semitones, delay, gain) in enumerate(notes):
        rate = round(44100 * 2 ** (semitones / 12))
        duration = 0.18 * 44100 / rate
        release = min(0.065, duration * 0.5)
        filters.append(
            f"[sample{i}]asetrate={rate},aresample=44100,"
            f"afade=t=in:d=0.003,afade=t=out:st={duration - release}:d={release},"
            f"volume={gain},adelay={delay}:all=1[note{i}]"
        )
    mixed = "".join(f"[note{i}]" for i in range(len(notes)))
    filters.append(f"{mixed}amix=inputs={len(notes)}:normalize=0,apad=pad_dur=0.06,asetpts=N/SR/TB[out]")
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(SOUNDS / "join.mp3"), "-filter_complex", ";".join(filters),
        "-map", "[out]", "-map_metadata", "-1", "-c:a", "libmp3lame",
        "-q:a", "2", str(SOUNDS / f"{name}.mp3"),
    ], check=True)
    print(f"Generated {name}.mp3")


if __name__ == "__main__":
    for name, notes in PATTERNS.items():
        generate(name, notes)
