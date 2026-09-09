# Native decoder decision

D1 selects **FFmpeg 9.0.1**, built from the source and configure flags in
[`ffmpeg.json`](../scripts/desktop/ffmpeg.json). Rust starts the executable on a
media worker; CPAL still owns live input/output. There is no subprocess, file IO
or decoding in the audio callback. The minimal build has no network protocol,
external codec libraries, GPL/nonfree components, video decoding or AAC encoding.
It accepts WAV, WebM, Ogg and MP4 and decodes PCM, Opus and AAC to float WAV.

The initial Symphonia 0.6.1 + symphonia-adapter-libopus 0.3.0 experiment failed on
both actual recorder WebM files: unexpected EOF for Chromium and Opus decoder
creation failure for Firefox. FFmpeg decoded both. This is a finding about the
tested integration, not a claim that those libraries can never support them.
Their dependencies were removed; FFmpeg's native Opus decoder needs no libopus.

## Build and ownership

`bun run build:decoder` builds under `.agent/ffmpeg-proof` using Python 3.12+,
a POSIX shell, make and a C compiler. Windows uses MSYS2 UCRT64. Nix builds the
same source/flags through `nix/ffmpeg.nix` and sets `SONGWRITER_FFMPEG` in the
development shell, including ARM Linux. No production runtime download exists.

The source archive SHA-256 is
`cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635`.
Its detached signature was verified against FFmpeg's published release fingerprint
`FCF986EA15E6E293A5644F10B4322F04D67658D8` on 2026-09-09.
The recipe saves `build.json`, the exact source archive, `LICENSE.md` and
`COPYING.LGPLv2.1` alongside the built executable. Nix retains the same source and
notices under `share/songwriter-ffmpeg`.

The proof CLI uses `SONGWRITER_FFMPEG` (or the developer's `ffmpeg` on PATH).
The packaged application must supply a verified bundled executable path and
ship the matching notices/source-access information. Tauri sidecar packaging,
code signing and Windows runtime-DLL auditing are still release gates; this
proof does not silently add an unverified executable to the desktop installer.

FFmpeg describes its default license as LGPL 2.1-or-later, with distribution
requirements depending on enabled components. Keep the build configuration,
corresponding source and license notices available with distributed artifacts.
Do not substitute an arbitrary GPL/nonfree-enabled system build for this recipe
without reviewing the distribution implications. AAC patent considerations
depend on jurisdiction/use and are not resolved by an open-source license.
Sources: [FFmpeg legal/distribution guidance](https://ffmpeg.org/legal.html),
[release source and verification](https://ffmpeg.org/download.html),
[command options](https://ffmpeg.org/ffmpeg.html).

## Limits

Imports preserve originals before decoding. This spike accepts up to 25 MiB,
60 seconds, two channels and 8–192 kHz. FFmpeg runs with no stdin, no shell,
fixed arguments, a format/protocol allowlist, a 15-second deadline, bounded
diagnostics, a single-allocation ceiling and an output byte ceiling. It is killed
and reaped on timeout. These are work bounds, not an OS security sandbox or an
aggregate memory guarantee. Decode failures retain an inspectable original.

The output keeps the first audio stream's rate/channels. No downmix, resampling,
time stretch or peak clamp is requested. Codec priming, padding and demuxer
tolerance still matter: success does not certify an undamaged complete source
or sample-accurate take alignment. D4 must define alignment/cache semantics.

Capture stores float PCM checkpoints and recovers to float WAV using Hound
3.5.1; that path works even when FFmpeg is absent. Rtrb 0.3.2 supplies the
preallocated SPSC queue. Files/journals stay outside the canonical song model.
