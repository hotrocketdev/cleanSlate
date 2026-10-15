/* CleanSlate UI — talks to CleanSlateCore, never re-implements it */
(() => {
  const C = window.CleanSlateCore;
  const $ = (s) => document.querySelector(s);
  const drop = $('#drop'), picker = $('#picker'), list = $('#list'), queue = $('#queue'), clean = $('#clean'), settings = $('.settings');

  let items = [];
  let format = 'image/jpeg', quality = 92, background = '#ffffff', resizePreset = 'original', resizeMode = 'crop';
  let rename = false, baseName = 'COV', numberFiles = true, startNumber = 1;
  let imageMode = 'lossless'; // lossless = strip tags only, pixels untouched
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const resizeTargets = {
    'instagram-portrait': [1080, 1350], 'instagram-square': [1080, 1080], 'instagram-landscape': [1080, 566],
    'meta-vertical': [1080, 1920], 'facebook-landscape': [1200, 630], 'facebook-portrait': [1080, 1350],
    tiktok: [1080, 1920], linkedin: [1200, 627], x: [1600, 900], pinterest: [1000, 1500], youtube: [1280, 720],
  };
  const MAX_BYTES = 2 * 1024 * 1024 * 1024;
  const KIND_LABEL = { image: 'image', video: 'video' };

  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 7000);
  }

  const safePart = (n) => n.trim().replace(/[^a-zA-Z0-9._ -]+/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'file';
  // videos keep their container; lossless images keep their own format too
  const srcExt = (x) => (x.ext === 'jpeg' ? 'jpg' : x.ext || 'jpg');
  const outExt = (x) => (x.kind === 'video' || imageMode === 'lossless' ? srcExt(x) : ext[format]);
  function outName(x) {
    const index = items.indexOf(x);
    const base = safePart(rename ? baseName : x.name0.replace(/\.[^.]+$/, ''));
    if (rename) return base + (numberFiles ? '-' + (startNumber + index) : '') + '.' + outExt(x);
    return base + '-clean.' + outExt(x);
  }
  function updateRenamePreview() {
    const base = safePart(baseName), first = base + (numberFiles ? '-' + startNumber : '') + '.' + ext[format];
    const second = base + (numberFiles ? '-' + (startNumber + 1) : '') + '.' + ext[format];
    $('#renamePreview').textContent = 'Preview: ' + first + (numberFiles ? ', ' + second + '…' : '');
  }

  /* ---------- output for images: rebuild from rendered pixels ---------- */
  async function encode(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const target = resizeTargets[resizePreset], c = document.createElement('canvas');
      if (target) { c.width = target[0]; c.height = target[1]; } else { c.width = bitmap.width; c.height = bitmap.height; }
      const ctx = c.getContext('2d', { alpha: format !== 'image/jpeg' });
      if (!ctx) throw new Error('Canvas unavailable');
      if (format === 'image/jpeg' || (target && resizeMode === 'fit')) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
      if (!target) ctx.drawImage(bitmap, 0, 0);
      else if (resizeMode === 'fit') {
        const scale = Math.min(c.width / bitmap.width, c.height / bitmap.height);
        const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
        ctx.drawImage(bitmap, (c.width - w) / 2, (c.height - h) / 2, w, h);
      } else {
        const scale = Math.max(c.width / bitmap.width, c.height / bitmap.height);
        const sw = c.width / scale, sh = c.height / scale;
        ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, c.width, c.height);
      }
      const blob = await new Promise((r) => c.toBlob(r, format, format === 'image/png' ? undefined : quality / 100));
      if (!blob) throw new Error('Format not supported');
      return blob;
    } finally { bitmap.close(); }
  }

  /* ---------- output for video: confirm the rewritten file still plays ---------- */
  function probeVideo(bytes, type) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: type || 'video/mp4' }));
      const v = document.createElement('video');
      let settled = false;
      const finish = (ok, info) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        v.removeAttribute('src');
        try { v.load(); } catch (e) { /* ignore */ }
        URL.revokeObjectURL(url);
        resolve({ ok, info });
      };
      const timer = setTimeout(() => finish(false, 'playback check timed out'), 20000);
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => {
        const dims = v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : 'audio only';
        const len = isFinite(v.duration) && v.duration > 0 ? `, ${v.duration.toFixed(1)}s` : '';
        finish(!!(v.videoWidth || v.duration > 0), dims + len);
      };
      v.onerror = () => finish(false, 'browser refused the rewritten file');
      v.src = url;
    });
  }

  /* ---------- queue ---------- */
  async function add(fileList) {
    const skipped = [];
    for (const file of [...fileList]) {
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const kind = C.detectKind(file, head);
      if (!kind) { skipped.push(file.name); continue; }
      const item = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())),
        file, name0: file.name, kind, ext: (file.name.split('.').pop() || '').toLowerCase(),
        size: file.size, status: 'Reading…', findings: [], aiCount: 0, metaCount: 0, output: null,
      };
      items.push(item);
      render();
      try {
        if (file.size > MAX_BYTES) throw new Error('larger than the 2 GB browser limit');
        item.bytes = new Uint8Array(await file.arrayBuffer());
        item.analysis = await C.analyse(item.bytes, kind, file.name);
        item.findings = item.analysis.findings;
        item.aiCount = item.analysis.aiCount;
        item.metaCount = item.analysis.metaCount;
        item.machineCount = item.analysis.machineCount || 0;
        item.notes = item.analysis.notes || [];
        item.status = 'Ready';
        if (kind === 'image') item.url = URL.createObjectURL(file);
      } catch (e) {
        item.status = 'Failed';
        item.error = e.message || String(e);
      }
      render();
    }
    if (skipped.length) toast(`Skipped ${skipped.length} unsupported file${skipped.length === 1 ? '' : 's'}: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`);
  }

  function chip(text, cls) {
    const s = document.createElement('span');
    s.className = 'chip' + (cls ? ' ' + cls : '');
    s.textContent = text;
    return s;
  }

  function findingRow(f) {
    const row = document.createElement('div');
    row.className = 'frow' + (f.ai ? ' ai' : (f.machine ? ' machine' : ''));
    const tag = document.createElement('b');
    tag.textContent = f.ai ? 'AI' : (f.machine ? 'ID' : 'tag');
    const name = document.createElement('span');
    name.className = 'fname';
    name.textContent = f.name;
    const val = document.createElement('span');
    val.className = 'fval';
    val.textContent = f.value;
    const where = document.createElement('i');
    where.textContent = f.where;
    row.append(tag, name, val, where);
    return row;
  }

  function card(x) {
    const el = document.createElement('article');
    el.className = 'card';
    const thumb = x.kind === 'image' && x.url
      ? Object.assign(document.createElement('img'), { alt: '', src: x.url })
      : Object.assign(document.createElement('div'), { className: 'vid', textContent: '▶' });
    const info = document.createElement('div');
    info.className = 'info';
    const nm = document.createElement('strong');
    nm.textContent = x.name || x.name0;
    const sub = document.createElement('span');
    sub.textContent = `${C.bytesText(x.size)} · ${x.kind === 'video' ? (x.analysis && x.analysis.format) || 'video' : (x.analysis && x.analysis.format) || 'image'}`;
    info.append(nm, sub);
    if (x.kind === 'image' && thumb.naturalWidth) sub.textContent += ` · ${thumb.naturalWidth}×${thumb.naturalHeight}`;
    if (x.kind === 'image' && thumb.tagName === 'IMG') {
      thumb.addEventListener('load', () => {
        if (thumb.naturalWidth) { sub.textContent = `${C.bytesText(x.size)} · ${x.analysis.format} · ${thumb.naturalWidth}×${thumb.naturalHeight}`; }
      }, { once: true });
    }
    const chips = document.createElement('div');
    chips.className = 'chips';
    if (x.aiCount) chips.append(chip(x.aiCount + ' AI trace' + (x.aiCount === 1 ? '' : 's'), 'ai'));
    else if (x.kind === 'video' && x.status !== 'Reading…') chips.append(chip('no AI traces found', 'clean'));
    if (x.machineCount) chips.append(chip(x.machineCount + ' encoder ID' + (x.machineCount === 1 ? '' : 's'), 'machine'));
    if (x.metaCount) chips.append(chip(x.metaCount + ' metadata tag' + (x.metaCount === 1 ? '' : 's')));
    if (x.mode) {
      const label = x.mode === 'lossless' ? 'lossless strip'
        : x.kind === 'video' ? (x.mode === 'pad' ? 'in-place clean' : 'rewritten') + (x.deep ? ' + deep' : '')
          : 'rebuilt (pixels re-encoded)';
      chips.append(chip(label, x.mode === 'lossless' || x.kind === 'video' ? 'clean' : ''));
    }
    if (x.kind === 'image' && (x.mode === 'lossless' || (imageMode === 'lossless' && !x.output))) chips.append(chip('no quality loss', 'clean'));
    const status = document.createElement('div');
    status.className = 'status' + (x.status === 'Cleaned' ? ' done' : x.status === 'Failed' ? ' error' : '');
    status.textContent = x.status;
    if (x.output) {
      const small = document.createElement('small');
      small.textContent = C.bytesText(x.output.size);
      status.append(small);
    }
    const btn = document.createElement('button');
    btn.className = 'icon' + (x.output ? ' download' : '');
    btn.setAttribute('aria-label', x.output ? 'Download ' + (x.name || x.name0) : 'Remove ' + x.name0);
    btn.textContent = x.output ? '↓' : '×';
    btn.onclick = () => (x.output ? download(x.output, x.name) : remove(x.id));
    el.append(thumb, info, chips, status, btn);

    if (x.error) {
      const err = document.createElement('p');
      err.className = 'err';
      err.textContent = x.error;
      el.append(err);
    }
    if (x.findings && x.findings.length) {
      const toggle = document.createElement('button');
      toggle.className = 'link find-toggle';
      toggle.textContent = `What was found (${x.findings.length})`;
      const box = document.createElement('div');
      box.className = 'findings';
      x.findings.forEach((f) => box.append(findingRow(f)));
      (x.notes || []).forEach((n) => {
        const p = document.createElement('p');
        p.className = 'note';
        p.textContent = n;
        box.append(p);
      });
      toggle.onclick = () => {
        box.classList.toggle('show');
        toggle.textContent = (box.classList.contains('show') ? 'Hide' : 'What was found') + ` (${x.findings.length})`;
      };
      el.append(toggle, box);
    }
    return el;
  }

  function render() {
    const images = items.filter((x) => x.kind === 'image');
    queue.classList.toggle('show', !!items.length);
    settings.classList.toggle('dim', items.length > 0 && images.length === 0);
    settings.classList.toggle('rebuildmode', imageMode === 'rebuild');
    clean.disabled = !items.length || items.some((x) => /ing…$/.test(x.status));
    clean.textContent = items.length ? `Clean ${items.length} file${items.length === 1 ? '' : 's'}` : 'Clean files';
    const totalIn = items.reduce((a, x) => a + x.size, 0);
    $('#summary').textContent = items.length
      ? `${items.length} selected · ${C.bytesText(totalIn)} total · ${images.length} image${images.length === 1 ? '' : 's'}, ${items.length - images.length} video${items.length - images.length === 1 ? '' : 's'}`
      : '';
    list.innerHTML = '';
    items.forEach((x) => list.append(card(x)));
    const done = items.filter((x) => x.output);
    $('#downloadbar').classList.toggle('show', !!done.length);
    $('#ready').textContent = `${done.length} clean file${done.length === 1 ? '' : 's'} ready`;
    $('#saving').textContent = done.length ? `${C.bytesText(totalIn)} → ${C.bytesText(done.reduce((a, x) => a + x.output.size, 0))}` : '';
    renderReport();
  }

  function renderReport() {
    const box = $('#report');
    const withAi = items.filter((x) => x.aiCount > 0);
    const aiTotal = items.reduce((a, x) => a + x.aiCount, 0);
    const tagTotal = items.reduce((a, x) => a + x.metaCount, 0);
    box.classList.toggle('show', !!items.length);
    const sum = $('#reportSummary');
    if (!items.length) { sum.textContent = ''; return; }
    const idTotal = items.reduce((a, x) => a + (x.machineCount || 0), 0);
    const idText = idTotal ? ` · ${idTotal} encoder ID${idTotal === 1 ? '' : 's'} (machine traces)` : '';
    sum.textContent = withAi.length
      ? `${aiTotal} AI trace${aiTotal === 1 ? '' : 's'} found in ${withAi.length} of ${items.length} file${items.length === 1 ? '' : 's'}${idText}${tagTotal ? ` · ${tagTotal} other metadata tag${tagTotal === 1 ? '' : 's'}` : ''}`
      : `No AI traces found in ${items.length} file${items.length === 1 ? '' : 's'}${idText}${tagTotal ? ` · ${tagTotal} metadata tag${tagTotal === 1 ? '' : 's'}` : ''} — everything found will still be removed`;
    const body = $('#reportBody');
    body.innerHTML = '';
    items.filter((x) => x.aiCount).slice(0, 6).forEach((x) => {
      const line = document.createElement('p');
      line.className = 'rline';
      line.textContent = `${x.name0} — ${x.aiCount} AI trace${x.aiCount === 1 ? '' : 's'}: ` +
        [...new Set(x.findings.filter((f) => f.ai).flatMap((f) => (f.marks.length ? f.marks : [f.name])))].slice(0, 4).join(', ');
      body.append(line);
    });
  }

  function reportText() {
    const when = new Date().toLocaleString('en-GB');
    const out = [`CleanSlate report — ${when}`, ''];
    out.push(`Files: ${items.length} · AI traces: ${items.reduce((a, x) => a + x.aiCount, 0)} · encoder IDs (machine traces): ${items.reduce((a, x) => a + (x.machineCount || 0), 0)} · other metadata tags: ${items.reduce((a, x) => a + x.metaCount, 0)}`, '');
    for (const x of items) {
      out.push(`FILE  ${x.name0}  (${x.kind === 'video' ? (x.analysis && x.analysis.format) || 'video' : (x.analysis && x.analysis.format) || 'image'}, ${C.bytesText(x.size)}${x.output ? ' → ' + C.bytesText(x.output.size) : ''})`);
      if (x.note) out.push(`  method: ${x.note}`);
      else if (x.analysis) out.push(`  method: ${x.analysis.modeReason || ''}`);
      if (x.status === 'Failed') out.push(`  FAILED: ${x.error || 'unknown error'}`);
      const ai = x.findings.filter((f) => f.ai);
      const ids = x.findings.filter((f) => f.machine);
      const meta = x.findings.filter((f) => !f.ai && !f.machine);
      if (ai.length) {
        out.push(`  AI traces found (${ai.length}):`);
        ai.forEach((f) => out.push(`    - [${f.where}] ${f.name}: ${f.value}`));
      } else out.push('  AI traces found: none');
      if (ids.length) {
        out.push(`  machine traces found (${ids.length}) — encoder identification, neutralised:`);
        ids.forEach((f) => out.push(`    - [${f.where}] ${f.name}: ${f.value}`));
      }
      if (meta.length) {
        out.push(`  other metadata found (${meta.length}):`);
        meta.forEach((f) => out.push(`    - [${f.where}] ${f.name}: ${f.value}`));
      }
      (x.notes || []).forEach((n) => out.push(`  note: ${n}`));
      out.push('');
    }
    out.push('Every listed tag is removed by CleanSlate. Images: the container metadata is deleted and the pixels are NOT re-encoded, so image quality is identical. Videos: the metadata boxes are removed, the container is compacted, and encoder identification written inside the compressed streams (SEI user data, codec configuration, audio fill elements) is neutralised in place — decoded video frames and audio are byte-identical before and after. What cannot be removed: invisible pixel-level watermarks (e.g. SynthID), visible watermarks, and steganography.');
    return out.join('\n');
  }

  function remove(id) {
    const x = items.find((i) => i.id === id);
    if (x && x.url) URL.revokeObjectURL(x.url);
    items = items.filter((i) => i.id !== id);
    render();
  }

  function reset() {
    items.forEach((x) => { x.output = null; x.name = null; x.status = 'Ready'; });
    render();
  }

  function download(blob, name) {
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u;
    a.download = name || 'cleanslate-output';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  }

  /* ---------- the clean run ---------- */
  clean.onclick = async () => {
    clean.disabled = true;
    for (const x of items) {
      if (x.status === 'Cleaned') continue;
      x.status = x.kind === 'video' ? 'Cleaning…' : 'Rebuilding…';
      render();
      try {
        if (x.kind === 'video') {
          let res = C.cleanVideo(x.bytes, x.analysis);
          let probe = await probeVideo(res.bytes, x.file.type);
          if (!probe.ok && res.mode === 'rewrite') {
            res = C.cleanVideo(x.bytes, x.analysis, { forcePad: true }); // deep clean still applies
            probe = await probeVideo(res.bytes, x.file.type);
          }
          if (!probe.ok) throw new Error('the cleaned video did not play back — the original was kept (' + probe.info + ')');
          x.output = new Blob([res.bytes], { type: x.file.type || 'video/mp4' });
          x.mode = res.mode;
          x.deep = res.deep;
          x.note = [res.method,
            `${C.bytesText(res.sizeBefore)} → ${C.bytesText(res.sizeAfter)}`,
            res.deep ? `in-stream identification neutralised in ${res.targets} place${res.targets === 1 ? '' : 's'} (${C.bytesText(res.zeroed)})` : 'no in-stream identification found',
            'streams untouched: pixels and audio bit-identical',
            `verified ${probe.info}`].join(' · ');
        } else if (imageMode === 'lossless') {
          const res = C.stripImageLossless(x.bytes, x.analysis);
          x.output = new Blob([res.bytes], { type: x.file.type || 'image/jpeg' });
          x.mode = 'lossless';
          x.note = ['metadata stripped without re-encoding',
            `${res.removed.length} item${res.removed.length === 1 ? '' : 's'} removed: ${res.removed.map((r) => r.what).join(', ') || 'none'}`,
            `${C.bytesText(x.size)} → ${C.bytesText(res.bytes.length)}`,
            'pixels untouched' + (res.kept.length ? ` · kept ${res.kept.join(', ')}` : '')].join(' · ');
        } else {
          x.output = await encode(x.file);
          x.mode = 'rebuild';
          x.note = 'rebuilt from rendered pixels — every container tag dropped, pixels re-encoded';
        }
        x.name = outName(x);
        x.status = 'Cleaned';
        delete x.error;
      } catch (e) {
        x.status = 'Failed';
        x.error = e.message || String(e);
      }
      render();
    }
    clean.disabled = false;
    const failed = items.filter((x) => x.status === 'Failed').length;
    toast(failed ? `${failed} file${failed === 1 ? '' : 's'} could not be cleaned — nothing was downloaded for those` : 'All files cleaned. Nothing left your device.');
  };

  /* ---------- wiring ---------- */
  $('#downloadAll').onclick = async () => {
    const done = items.filter((x) => x.output);
    if (!done.length) return;
    download(await C.zip(done.map((x) => ({ name: x.name, blob: x.output }))), `cleanslate-${new Date().toISOString().slice(0, 10)}.zip`);
  };
  $('#reportDownload').onclick = () => download(new Blob([reportText()], { type: 'text/plain' }), `cleanslate-report-${new Date().toISOString().slice(0, 10)}.txt`);
  $('#clear').onclick = () => {
    items.forEach((x) => x.url && URL.revokeObjectURL(x.url));
    items = [];
    render();
  };
  drop.onclick = () => picker.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } };
  picker.onchange = (e) => { add(e.target.files); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.ondrop = (e) => add(e.dataTransfer.files);
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  const modeButtons = document.querySelectorAll('#modeBox button');
  function applyImageMode() {
    modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === imageMode));
    $('#modeNote').textContent = imageMode === 'lossless'
      ? 'Pixels are not re-encoded. Only the metadata is deleted, so image quality is identical to the original.'
      : 'Pixels are re-encoded: this is what converts the format and resizes to a Social size.';
    settings.classList.toggle('lossless', imageMode === 'lossless');
    reset();
  }
  modeButtons.forEach((b) => { b.onclick = () => { imageMode = b.dataset.mode; applyImageMode(); }; });
  applyImageMode();

  document.querySelectorAll('#formatRow button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#formatRow button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      format = b.dataset.format;
      $('#qualityBox').style.display = format === 'image/png' ? 'none' : 'block';
      $('#backgroundBox').style.display = format === 'image/jpeg' ? 'flex' : 'none';
      updateRenamePreview();
      reset();
    };
  });
  $('#resizePreset').onchange = (e) => {
    resizePreset = e.target.value;
    $('#resizeNote').textContent = resizePreset === 'original'
      ? 'Original dimensions will be preserved.'
      : `${resizeTargets[resizePreset][0]} × ${resizeTargets[resizePreset][1]} px · ${resizeMode === 'crop' ? 'The centre is cropped to fill.' : 'The whole image is fitted with the selected background.'}`;
    reset();
  };
  $('#resizeMode').onchange = (e) => { resizeMode = e.target.value; $('#resizePreset').dispatchEvent(new Event('change')); };
  $('#quality').oninput = (e) => { quality = +e.target.value; $('#qualityOut').value = quality + '%'; reset(); };
  $('#background').oninput = (e) => { background = e.target.value; reset(); };
  $('#renameToggle').onchange = (e) => { rename = e.target.checked; $('#renameControls').classList.toggle('show', rename); reset(); };
  $('#baseName').oninput = (e) => { baseName = e.target.value; updateRenamePreview(); reset(); };
  $('#numberFiles').onchange = (e) => { numberFiles = e.target.checked; updateRenamePreview(); reset(); };
  $('#startNumber').oninput = (e) => { startNumber = Math.max(0, parseInt(e.target.value || '0', 10) || 0); updateRenamePreview(); reset(); };
  updateRenamePreview();
})();
