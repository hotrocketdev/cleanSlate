# CleanSlate

**Offline metadata and machine-trace remover for images and videos.**
One HTML file. No uploads, no server, no account — and it does not re-encode
your media, so quality stays identical.

**Use it live:** https://hotrocketdev.github.io/cleanSlate/
**Offline copy:** download `CleanSlate.zip` from the latest CI artifact (or the
[releases](../../releases) page), extract, double-click `index.html`. It works
with no internet connection.

---

## What it does

Drop images and/or videos in, read the report of what is hiding in them, press
**Clean files**, download the results (individually or as one ZIP, plus an
optional text report).

### Images — JPG, PNG, WebP, BMP
Default mode **Strip only · lossless**: the metadata is deleted, the pixels are
never re-encoded, so image quality is identical to the original.

- JPEG: EXIF (camera, software, artist, comment, GPS), XMP, IPTC/Photoshop,
  embedded C2PA Content Credentials, other APPn segments and comments. JFIF,
  the ICC colour profile and the Adobe colour-transform marker are kept, because
  dropping them changes how colours render.
- PNG: `tEXt` / `zTXt` / `iTXt` (including the `parameters` and `workflow`
  prompt blocks written by Stable Diffusion, AUTOMATIC1111 and ComfyUI), `eXIf`,
  C2PA (`caBX`) and `tIME`.
- WebP: EXIF and XMP chunks, with the corresponding VP8X flag bits cleared.

**Rebuild & resize** mode re-encodes the pixels — that is what converts the
format (JPEG/PNG/WebP), applies a Social size, or changes quality. It is the
only mode that touches image pixels.

### Videos — MP4, MOV, M4V
Streams are copied bit for bit: no re-encode, no quality loss, no codec
dependency (H.264, HEVC, AV1, VP9 and ProRes all pass through). On top of
deleting the container metadata — XMP, C2PA Content Credentials, QuickTime/
iTunes tags, `udta`/`ilst`/`mdta` lists, GPS (`©xyz`, 3GPP `loci`), `emsg` timed
metadata, padding — it neutralises what the machine wrote *inside* the streams:

- the sample description's compressor-name field (`Lavc… libx264`)
- SEI `user_data_unregistered` payloads in the video stream and in the codec
  configuration box — where `x264`/`x265` record their version and full
  settings string. HDR and timing SEI are deliberately left alone.
- encoder identification inside AAC fill elements

Those bytes are overwritten in place, so every length, offset and sample stays
exactly where it was. Where a safe rewrite is impossible (fragmented/streaming
files, a `sidx` stream index, external media references) the container boxes are
neutralised in place instead, keeping the size and all offsets valid. The
rewritten file is then opened by your own browser's decoder before it is offered
for download.

## The report

Per file, three separate counts, because "made with an AI tool" and "encoded by
x264" are different questions:

- **AI traces** — C2PA/JUMBF Content Credentials, IPTC digital source type
  (`trainedAlgorithmicMedia`), XMP CreatorTool and history agents, PNG generation
  keys, EXIF software/artist/comment fields, "made with AI" labels, and AI tool
  names anywhere including the filename (DALL·E, Midjourney, Stable Diffusion,
  SDXL, ComfyUI, FLUX, Firefly, Imagen, Veo, Sora, Nano Banana, Seedream,
  Ideogram, Runway, Kling, Luma, HeyGen, Synthesia, ElevenLabs, ChatGPT, Gemini,
  Claude, Grok, Copilot …)
- **Encoder IDs (machine traces)** — in-stream and sample-description
  identification, as listed above
- **Other metadata** — GPS, device fields, dates, colour profiles and the rest

## What it cannot do

Be clear-eyed about this before you rely on it:

- **Visible watermarks and logos in the picture are not removed.** Neither is
  burned-in text.
- **Invisible pixel-level watermarks (e.g. SynthID) and steganography are not
  removed.** Deleting metadata does not touch them, and this tool deliberately
  never re-encodes video, so the original pixels stay exactly as they were.
- **Inaudible watermarks inside the audio signal are not removed.**
- **A platform can re-attach labels** or content credentials after you upload.
- Bitstreams other than AVC/HEVC video and AAC audio are not rewritten (AV1,
  VP9, Opus, …): their in-stream strings survive, while all container metadata
  is still removed. The report says so per file.
- Videos are processed in memory: keep files under roughly 2 GB.

Metadata tells a machine *who produced a file and with what*. It is not the same
question as "does this look AI-made to a detector" — that is answered from the
pixels, and no metadata cleaner can change it.

## Privacy

Everything runs locally in your browser. Files are never uploaded and the page
makes no network requests at all — asserted by the end-to-end test, not just
claimed.

## How it works

`index.html` is a **build artifact**: sources live in `src/` and
`scripts/build.mjs` assembles the single file. CI rebuilds it and fails if the
committed `index.html` does not match `src/`, so the two cannot drift.

- `src/cleanslate-core.js` — the pure engine (no DOM): container parsers for
  JPEG/PNG/WebP/BMP and ISO BMFF (MP4/MOV/M4V), the box-tree rewriter with
  chunk-offset repair, in-stream identification neutralisation, the AI-trace
  dictionary, and the ZIP writer.
- `src/cleanslate-ui.js` — the UI layer; it never re-implements engine logic.
- `src/index.template.html` — markup and CSS.

## Tests — every claim above is measured

```bash
node scripts/build.mjs            # rebuild index.html from src/
node tests/make-fixtures.mjs      # build real images + videos carrying real metadata
node tests/core-test.mjs          # engine + ffmpeg/ffprobe: decodes, tags gone, streams intact
node tests/deep-clean-test.mjs    # no trace survives AND no quality lost (hash-level proof)
node tests/browser-test.mjs       # drives the real page in Chromium, verifies the downloads
node tests/trace-audit.mjs        # human-readable scorecard per file
node tests/clean-one.mjs <file>   # run any real file through the UI and verify the output
```

The fixtures are generated with ffmpeg and carry genuine C2PA, XMP, IPTC, EXIF,
GPS, PNG prompt chunks and in-stream x264/x265 identification — then each is
validated with ffprobe before use. The quality claims are proved the only way
that means anything: hashing the **decoded** output. `ffmpeg -f framemd5` for
video frames, `-f md5` for decoded audio, and `framemd5` again for image pixels —
all must be byte-identical before and after cleaning.

The browser suite needs Playwright (`npm i playwright`); everything else needs
only Node and ffmpeg, both preinstalled on GitHub's runners.

## Licence

MIT — use it, modify it, ship it, no strings beyond keeping the copyright
notice. Contributions welcome: please keep the tests green, since they are what
makes the promises in this README checkable.
