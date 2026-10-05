# Musical fixtures

`piano-core.notera.json` is an original, hand-authored version-1 Notera document used to verify core semantics and file round trips. Its upper staff has two voices and its lower staff has one. It contains dotted and triplet durations, chords, rests, absolute accidentals and supported anchored marks.

The triplet starts at `3/8` and advances by `1/12`; a deliberate gap follows it. The final quarter-note C5 in measure 1 ties to the first C5 in measure 2. Gaps are intentional editing states, not implicit rests.

Change this fixture only when its musical expectations or the versioned file contract intentionally change. Expected results must remain independent of the implementation under test.

`external-piano.musicxml` is a separate original, hand-authored MusicXML 4.0 example with ten events and three voices: measure 1 is 3/4 in C, with a C-sharp5/E5 dotted-quarter chord, D5 eighth, G5 quarter, an inner E4 dotted half, and lower C3 half/quarter rest. Measure 2 is 4/4 with one sharp; the upper G5 tie/slur ends at its first quarter, followed by a deliberate quarter gap and half rest. Two other voices contain whole-measure rests. It has mp, pedal and a three-play repeat. The official XSD validates it independently of the adapter.
