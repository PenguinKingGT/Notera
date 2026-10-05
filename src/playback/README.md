# Piano playback boundary

Read this before changing performance compilation, audio scheduling, sample loading or score following.

## Responsibilities

- `timeline.ts` validates a native score and produces exact whole-note fractions. Repeated visits have distinct occurrences; source event IDs stay available for SVG highlighting. Rests and empty gaps consume time. Quarter-note BPM belongs to transport, not the persisted score.
- `controller.ts` owns transport state, a 120ms scheduling horizon and a 25ms callback. Its injected `PianoAudio` owns resources and exposes the audio clock. Timer drift does not accumulate into musical position. A stall beyond the horizon pauses at the last confirmed position.
- `piano.ts` lazily loads Tone.js and 30 bundled samples. Every attack owns a separate `ToneBufferSource`; releasing a pitch in one voice cannot release another voice. A dedicated context uses timeout ticking, without changing global Tone context or expanding CSP. Sample loading failure disposes the incomplete bank; retry creates a new context.
- The renderer subscribes to transport locally. `ScoreCanvas` updates transient SVG annotations only when event identities change, and scrolls within the music viewport. A pending layout clears highlighting until fresh mappings arrive.

## Musical rules

Dynamics apply to their staff from their written position, defaulting to `mf`. A tied chain has one attack and the first note's velocity. Pedal extends key release on the same staff, including other voices; release exactly on the pedal boundary is not extended. Repeat jumps break pending ties and clip pedal spans. Native validation already excludes overlapping repeat ranges. Slurs currently do not alter articulation.

Limit expanded performances to 20,000 measure visits and 200,000 attacks/events; reject pitches outside piano A0–C8 explicitly. Musical compilation never changes the input score, and converts fractions to floating-point quarter beats only at the transport boundary.

## Lifecycle

Pause freezes position and silences all queued/sounding sources. Resume reconstructs held samples at their elapsed phase. Tempo changes integrate sample age across preceding tempo segments and reschedule future releases. Stop, document replacement, import, unsaved prompts, musical edits, native close and unmount invalidate pending async playback. Selection and saving preserve playback. Hidden windows pause; resource or scheduling errors remain visible and retryable.

## Sound and verification

Salamander MP3 samples use one velocity layer, gain-based dynamics and a 120ms release, without hammer/pedal noises or physical resonance. Nearest samples are repitched; exhausted natural decays stay silent. Pause/tempo transitions reconstruct sources and may be audible. This is piano preview, not a full SFZ piano instrument.

Vitest checks independently authored timings and injected-clock transport races. Desktop tests disable network, inspect the real audio graph for signal/silence, and exercise editing, file transitions and sample failure/retry. Packaged macOS runs use the same suite. Human listening and long-score scrolling checks remain necessary for perceptual quality. See `src/assets/piano/README.md` for provenance and attribution.
