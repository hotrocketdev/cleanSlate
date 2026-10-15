CleanSlate — Offline Metadata & Machine-Trace Remover

WHAT IT DOES
CleanSlate removes metadata and machine-processing traces from images AND videos
entirely inside your browser, and shows you what it found before it removes
anything. Nothing is uploaded, there is no account, no quota and no server.
Nothing is re-encoded unless you ask for it, so image, video and audio quality
stay identical.

HOW TO USE
1. Extract the ZIP file.
2. Double-click index.html.
3. Drop images and/or videos into the page (or click to browse).
4. Read the report: AI traces, encoder IDs and metadata found, per file.
5. Images: choose Strip only - lossless (default) or Rebuild & resize.
6. Click Clean files.
7. Download each result, or all of them as one ZIP. "Download report" saves a
   text record of what was found and removed in each file.

IMAGES — JPG, PNG, WebP, BMP
Strip only (lossless, default): the tags are deleted, the pixels are never
re-encoded, so the image quality is identical to the original.
  - JPEG: EXIF (camera, software, artist, comment, GPS), XMP, IPTC/Photoshop,
    embedded C2PA Content Credentials, APP11/other APPn segments and comments
    are removed. JFIF, the ICC colour profile and the Adobe colour-transform
    marker are kept, because dropping them can change how colours are rendered.
  - PNG: tEXt / zTXt / iTXt chunks (including the "parameters" and "workflow"
    prompt blocks written by Stable Diffusion, AUTOMATIC1111 and ComfyUI), eXIf,
    C2PA (caBX) and tIME are removed. Colour chunks are kept.
  - WebP: EXIF and XMP chunks are removed and their flag bits cleared in the
    VP8X header. The ICC profile and the image data are untouched.
  - BMP carries no metadata container; the file passes through unchanged.
Rebuild & resize: re-encodes the pixels, which is what converts the format
(JPEG/PNG/WebP), applies a Social size, or changes quality. Quality then changes
by definition — that is the only mode that touches image pixels.

VIDEOS — MP4, MOV, M4V
The video and audio streams are copied bit for bit — no re-encode, no quality
loss, no codec dependency (H.264, HEVC, AV1, VP9 and ProRes all fine). On top of
the container clean, deep clean neutralises what the machine wrote into the
streams themselves:
  - container metadata boxes removed and the file compacted: XMP (uuid box),
    C2PA Content Credentials (uuid box), QuickTime/iTunes tags (udta, ilst,
    mdta key lists: title, encoder, software, comment, author), GPS ((c)xyz,
    3GPP loci — shown as coordinates in the report), timed metadata (emsg),
    free/skip padding
  - the sample description's compressor-name field ("Lavc63.1.101 libx264")
  - SEI user_data_unregistered payloads in the video stream, in the sample data
    and in the codec configuration box — this is where x264/x265 write "x264 -
    core 165 ... options: cabac=1 ref=3 ...". Only the encoder identification is
    zeroed: HDR and timing SEI are left alone.
  - encoder identification inside the audio stream's AAC fill elements.
Those bytes are overwritten in place, so every length, offset and every pixel or
audio byte in the file stays exactly where it was: decoded video frames and
decoded audio are byte-identical before and after (verified with ffmpeg
framemd5 in tests/deep-clean-test.mjs). Where the file's layout makes a safe
rewrite impossible — fragmented/streaming files, a stream index (sidx), external
media references — the container boxes are neutralised in place instead, so the
size and all offsets stay valid. Output keeps the original container and
extension, so an mp4 stays an mp4.

THE REPORT
Three separate counts, per file:
  - AI traces: C2PA/JUMBF, IPTC digital source type (trainedAlgorithmicMedia),
    XMP CreatorTool and history agents, PNG generation keys (Software,
    parameters, workflow, prompt, seed, sampler, steps, model hash), EXIF
    Software/Artist/Make/Model/UserComment, "made with AI" labels, and AI tool
    names anywhere including the file name (DALL-E, Midjourney, Stable
    Diffusion, SDXL, ComfyUI, FLUX, Firefly, Imagen, Veo, Sora, Nano Banana,
    Seedream, Ideogram, Runway, Kling, Luma, HeyGen, Synthesia, ElevenLabs,
    ChatGPT, Gemini, Claude, Grok, Copilot and more).
  - Encoder IDs (machine traces): the in-stream and sample-description
    identification listed above.
  - Other metadata: GPS, device fields, dates, colour profile notes and the rest.

WHAT IT CANNOT DO
- It cannot remove information visible in the picture: burned-in text, visible
  watermarks or logos.
- It cannot remove invisible pixel-level watermarks (for example SynthID) or
  steganography. Deleting metadata does not touch them, and re-encoding does not
  defeat them reliably.
- It does not strip inaudible watermarks embedded in the audio signal itself.
- It cannot stop a platform (social network, marketplace) from adding its own
  labels or content credentials after you upload.
- Bitstreams other than AVC/HEVC video and AAC audio are not rewritten (for
  example AV1 or VP9 video, Opus audio): their in-stream encoder strings survive,
  while all container metadata is still removed. The report says so per file.
- Videos are processed in memory: keep files under roughly 2 GB.
- Animated PNG/WebP inputs become a single still frame in Rebuild mode; in
  Strip only mode they keep all frames.

PRIVACY
All processing occurs locally inside your browser. Images and videos are not
uploaded. The page makes no network requests.

SOCIAL SIZE PRESETS (Rebuild mode, images)
Instagram portrait 1080x1350, square 1080x1080, landscape 1080x566,
Instagram/Facebook Reels and Stories 1080x1920, Facebook feed landscape
1200x630, Facebook portrait 1080x1350, TikTok 1080x1920, LinkedIn 1200x627,
X 1600x900, Pinterest 1000x1500, YouTube thumbnails 1280x720. Crop to fill
matches the exact platform dimensions; Fit whole image keeps the complete
picture with the chosen background colour.

SUPPORTED INPUTS
Best results in current Chrome or Edge.

TESTING / DEVELOPMENT
tests/ holds the harness; every claim above is measured there:
  tests/make-fixtures.mjs     generates real images and videos carrying C2PA,
                              XMP, IPTC, EXIF, GPS, PNG prompt chunks, AI encoder
                              tags and in-stream x264/x265 identification, then
                              validates every fixture with ffprobe
  tests/core-test.mjs         cleaning engine + ffmpeg/ffprobe proof that cleaned
                              videos decode, keep identical stream parameters and
                              durations, and carry no residual tags
  tests/deep-clean-test.mjs   the two promises: no machine trace survives (byte
                              scan) and no quality is lost (decoded frame, audio
                              and image hashes identical before/after)
  tests/browser-test.mjs      drives the page in Chromium, cleans every fixture
                              through the UI, verifies the real downloaded files,
                              the ZIP, the report and that no network request is made
  tests/trace-audit.mjs       human-readable scorecard: per file, what was found,
                              what was neutralised, and the decoded hashes
  node tests/make-fixtures.mjs && node tests/core-test.mjs && node tests/deep-clean-test.mjs && node tests/browser-test.mjs
