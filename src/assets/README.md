# Bundled assets

`piano-example.notera.json` is a hand-authored original example derived from the core test fixture. The editor loads it through the same native-file decoder as other scores. Keep application assets independent of test helpers; JSON envelopes remain comment-free to satisfy the strict native format.

`piano/` contains locally bundled Salamander piano samples. Read `piano/README.md` before changing samples or attribution; preserve its upstream revision, hashes and CC BY 3.0 author/license notice.
