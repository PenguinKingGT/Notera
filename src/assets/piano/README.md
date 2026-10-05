# Bundled piano samples

These 30 MP3 files are the Salamander Grand Piano samples distributed by [Tonejs/audio](https://github.com/Tonejs/audio/tree/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander). They cover A0–C8 at minor-third intervals, totaling 2,012,677 bytes. `manifest.json` records the exact upstream revision, byte sizes and SHA-256 hashes.

**Author:** Alexander Holm. **Instrument:** Yamaha C5, Salamander Grand Piano. **License:** [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/). The upstream attribution is preserved in `UPSTREAM-README.txt`. Tone.js itself is MIT licensed; the piano samples have this separate license.

Notera redistributes the upstream MP3 bytes unchanged. The application repitches nearby samples and scales their gain for playback. This bank is a subset used by Tone examples, not the original instrument's complete velocity layers, release noises or SFZ configuration. Keep the author, source and license attribution in the application and repository when redistributing these resources.

The resources are bundled by Vite and loaded locally at playback initialization; no runtime sample downloads are required.
