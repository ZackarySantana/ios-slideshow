(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Settings <-> URL
  // ---------------------------------------------------------------------------

  const DEFAULTS = {
    album: '',
    sec: 7,
    shuffle: true,
    loop: true,
    tr: 'fade',
    fit: 'contain',
    refresh: 5,
    dupes: true,          // hide duplicate photos
    qr: true,
    qrpos: 'br',
    qrsize: 's',
    qrurl: '',            // empty = use the album link
    qrcap: null,          // null = automatic caption (see autoCaption)
  };
  const REFRESH_CHOICES = [0, 2, 5, 15];
  const TOKEN_RE = /^[A-Za-z0-9_-]{10,200}$/;
  const ALBUM_HINT = 'In Photos, open the shared album, tap the People icon, and turn on Public Website.';

  function albumLink(token) {
    return `https://www.icloud.com/sharedalbum/#${token}`;
  }

  // Accepts a full shared-album link or a bare token. Returns { token } or { error }.
  function parseAlbumInput(raw) {
    const s = (raw || '').trim();
    if (!s) return { error: 'Paste a shared album link to get started.' };
    if (TOKEN_RE.test(s)) return { token: s };

    let url;
    try {
      url = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
      return { error: 'That doesn’t look like a link.' };
    }
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'share.icloud.com' || url.pathname.startsWith('/photos')) {
      return { error: 'That’s an iCloud Photos share link, not a Shared Album link.', hint: 'Use a link that looks like icloud.com/sharedalbum/#…' };
    }
    if (host !== 'icloud.com' || !url.pathname.startsWith('/sharedalbum')) {
      return { error: 'That isn’t an iCloud Shared Album link.', hint: 'It should look like https://www.icloud.com/sharedalbum/#B0aB1cD2eF3gH4i' };
    }
    const token = url.hash.replace(/^#/, '').split(/[;&?]/)[0];
    if (!TOKEN_RE.test(token)) {
      return { error: 'That album link is incomplete.', hint: 'Make sure you copied the whole link, including the part after #.' };
    }
    return { token };
  }

  function settingsFromQuery(search) {
    const q = new URLSearchParams(search);
    const s = { ...DEFAULTS };
    const bool = (k) => { if (q.has(k)) s[k] = q.get(k) !== '0' && q.get(k) !== 'false'; };
    const pick = (k, allowed) => { if (allowed.includes(q.get(k))) s[k] = q.get(k); };

    if (q.has('album')) {
      const p = parseAlbumInput(q.get('album'));
      s.album = p.token || '';
    }
    const sec = Number(q.get('sec'));
    if (q.has('sec') && Number.isFinite(sec)) s.sec = clampSec(sec);
    bool('shuffle');
    bool('loop');
    pick('tr', ['fade', 'none']);
    pick('fit', ['contain', 'cover']);
    const r = Number(q.get('refresh'));
    if (q.has('refresh') && REFRESH_CHOICES.includes(r)) s.refresh = r;
    bool('dupes');
    bool('qr');
    pick('qrpos', ['tl', 'tr', 'bl', 'br']);
    pick('qrsize', ['s', 'm']);
    if (q.has('qrurl')) s.qrurl = q.get('qrurl').trim();
    if (q.has('qrcap')) s.qrcap = q.get('qrcap').slice(0, 60);
    return s;
  }

  function settingsToQuery(s) {
    const q = new URLSearchParams();
    q.set('album', s.album);
    q.set('sec', String(s.sec));
    q.set('shuffle', s.shuffle ? '1' : '0');
    q.set('loop', s.loop ? '1' : '0');
    q.set('tr', s.tr);
    q.set('fit', s.fit);
    q.set('refresh', String(s.refresh));
    q.set('dupes', s.dupes ? '1' : '0');
    q.set('qr', s.qr ? '1' : '0');
    q.set('qrpos', s.qrpos);
    q.set('qrsize', s.qrsize);
    if (s.qrurl && s.qrurl !== albumLink(s.album)) q.set('qrurl', s.qrurl);
    if (s.qrcap !== null) q.set('qrcap', s.qrcap);
    return q.toString();
  }

  function writeUrl(s) {
    history.replaceState(null, '', `${location.pathname}?${settingsToQuery(s)}`);
  }

  function clampSec(n) {
    return Math.min(600, Math.max(2, Math.round(n)));
  }

  function qrTarget(s) {
    return s.qrurl || (s.album ? albumLink(s.album) : '');
  }

  // Guests can only view the public album link, so the default caption only
  // invites them to add photos once the QR code points somewhere else.
  function autoCaption(qrurl) {
    return qrurl ? 'Add your photos' : 'View the album';
  }

  function qrCaptionText(s) {
    return s.qrcap ?? autoCaption(s.qrurl);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function timeLabel(d = new Date()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function renderQr(container, text) {
    container.textContent = '';
    if (!text) return;
    try {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
      const qr = qrcode(0, 'M');
      qr.addData(text, 'Byte');
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
      container.innerHTML =
        `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
        `<path d="${d}" fill="#000"/></svg>`;
    } catch {
      container.textContent = 'Link too long for a QR code';
    }
  }

  // Fetches the album through our proxy. Throws { code, message } on failure.
  async function fetchAlbum(token) {
    let res;
    try {
      res = await fetch(`api/album?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    } catch {
      throw { code: 'network', message: 'Couldn’t reach the server. Check your connection.' };
    }
    let body = null;
    try { body = await res.json(); } catch { /* handled below */ }
    if (!res.ok || !Array.isArray(body)) {
      throw { code: body?.error || 'upstream', message: body?.message || `Server error (${res.status}).` };
    }
    let title = '';
    try { title = decodeURIComponent(res.headers.get('X-Album-Title') || ''); } catch { /* ignore */ }
    return { title, photos: body, fetchedAt: new Date() };
  }

  function showError(el, err) {
    el.textContent = '';
    const strong = document.createElement('strong');
    const hint = document.createElement('div');
    hint.className = 'hint';
    if (err.code === 'not_found') {
      strong.textContent = 'This album isn’t available.';
      hint.textContent = `It may not exist or isn’t public. ${ALBUM_HINT}`;
    } else if (err.code === 'invalid_token') {
      strong.textContent = err.message;
      hint.textContent = 'It should look like https://www.icloud.com/sharedalbum/#B0aB1cD2eF3gH4i';
    } else {
      strong.textContent = err.message || 'Something went wrong.';
      hint.textContent = err.hint || '';
    }
    el.append(strong);
    if (hint.textContent) el.append(hint);
    el.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Full screen + wake lock
  // ---------------------------------------------------------------------------

  function enterFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => {});
    } catch { /* not supported (e.g. iPhone Safari) */ }
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function toggleFullscreen() {
    if (isFullscreen()) exitFullscreen();
    else enterFullscreen();
  }

  // Keep the full-screen button in sync however full screen is entered or left.
  function syncFullscreenButton() {
    const on = isFullscreen();
    const btn = document.querySelector('[data-action="fullscreen"]');
    document.getElementById('player').classList.toggle('fullscreen', on);
    btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    btn.dataset.tip = on ? 'Exit full screen (F)' : 'Full screen (F)';
  }
  document.addEventListener('fullscreenchange', syncFullscreenButton);
  document.addEventListener('webkitfullscreenchange', syncFullscreenButton);

  function exitFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
      try {
        const p = exit.call(document);
        if (p && p.catch) p.catch(() => {});
      } catch { /* ignore */ }
    }
  }

  const wake = {
    lock: null,
    wanted: false,
    async acquire() {
      this.wanted = true;
      if (!('wakeLock' in navigator) || this.lock || document.visibilityState !== 'visible') return;
      try {
        this.lock = await navigator.wakeLock.request('screen');
        this.lock.addEventListener('release', () => { this.lock = null; });
      } catch { /* denied or unsupported; nothing to do */ }
    },
    release() {
      this.wanted = false;
      if (this.lock) this.lock.release().catch(() => {});
      this.lock = null;
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wake.wanted) wake.acquire();
  });

  // ---------------------------------------------------------------------------
  // Options form (one instance, moved between setup and the player overlay)
  // ---------------------------------------------------------------------------

  const form = $('#options-template').content.firstElementChild.cloneNode(true);
  const formPreview = $('.qr-preview', form);

  function fillForm(s) {
    const f = form.elements;
    f.album.value = s.album ? albumLink(s.album) : '';
    f.sec.value = s.sec;
    f.shuffle.checked = s.shuffle;
    f.loop.checked = s.loop;
    f.tr.value = s.tr;
    f.fit.value = s.fit;
    f.refresh.value = String(s.refresh);
    f.dupes.checked = s.dupes;
    f.qr.checked = s.qr;
    f.qrpos.value = s.qrpos;
    f.qrsize.value = s.qrsize;
    f.qrurl.value = s.qrurl;
    f.qrcap.value = qrCaptionText(s);
    f.qrcap.dataset.auto = s.qrcap === null ? '1' : '';
    updateFormPreview();
  }

  // 'setup' (editable album link) or 'player' (read-only link, duplicates report).
  function setFormContext(context) {
    form.dataset.context = context;
    form.elements.album.readOnly = context === 'player';
  }

  // Reads the form. The album field is parsed separately (it can be invalid).
  function readForm(base) {
    const f = form.elements;
    const sec = Number(f.sec.value);
    return {
      ...base,
      sec: Number.isFinite(sec) && f.sec.value !== '' ? clampSec(sec) : base.sec,
      shuffle: f.shuffle.checked,
      loop: f.loop.checked,
      tr: f.tr.value || base.tr,
      fit: f.fit.value || base.fit,
      refresh: Number(f.refresh.value),
      dupes: f.dupes.checked,
      qr: f.qr.checked,
      qrpos: f.qrpos.value || base.qrpos,
      qrsize: f.qrsize.value || base.qrsize,
      qrurl: f.qrurl.value.trim(),
      qrcap: f.qrcap.dataset.auto ? null : f.qrcap.value,
    };
  }

  function updateFormPreview() {
    const f = form.elements;
    form.classList.toggle('qr-on', f.qr.checked);
    let target = f.qrurl.value.trim();
    let note = 'Opens your link.';
    if (!target) {
      const p = parseAlbumInput(f.album.value);
      target = p.token ? albumLink(p.token) : '';
      note = p.token ? 'Opens the album for viewing.' : 'Add an album link to generate the QR code.';
    }
    formPreview.classList.toggle('medium', f.qrsize.value === 'm');
    renderQr($('.qr-code', formPreview), target);
    $('.qr-caption', formPreview).textContent = f.qrcap.value;
    formPreview.hidden = !target;
    $('.qr-preview-note', form).textContent = note;
  }

  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    const cap = form.elements.qrcap;
    // Typing a caption makes it custom; until then it follows the QR link.
    if (e.target === cap) cap.dataset.auto = '';
    if (e.target === form.elements.qrurl && cap.dataset.auto) cap.value = autoCaption(e.target.value.trim());
    updateFormPreview();
    if (form.closest('#settings')) player.applySettings(readForm(player.settings));
  });
  // Normalise the seconds field once the user is done with it.
  form.elements.sec.addEventListener('change', () => {
    const base = form.closest('#settings') ? player.settings : DEFAULTS;
    form.elements.sec.value = readForm(base).sec;
  });

  // ---------------------------------------------------------------------------
  // Duplicate detection
  //
  // Each thumbnail gets two 64-bit perceptual hashes (pHash from a 32x32 DCT,
  // dHash from a 9x8 gradient). Two photos are duplicates when both hashes are
  // close and their shapes match, or when their files are byte-identical
  // (same checksum). Runs in the browser; iCloud's image CDN sends CORS
  // headers, so thumbnail pixels are readable. Nothing is stored anywhere.
  // ---------------------------------------------------------------------------

  const DUP = {
    P_MAX: 6,               // max pHash distance (bits)
    D_MAX: 8,               // max dHash distance (bits)
    AR_TOL: 0.02,           // aspect ratios must match within 2%
    FLAT_SD: 8,             // near-uniform images never match by looks
    CONCURRENCY: 4,
    REFRESH_BUDGET_MS: 5000, // time a refresh may spend hashing new photos
  };

  const DCT_COS = (() => {
    const t = new Float64Array(8 * 32);
    for (let u = 0; u < 8; u++) {
      for (let x = 0; x < 32; x++) t[u * 32 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 64);
    }
    return t;
  })();

  function popcount32(n) {
    n -= (n >>> 1) & 0x55555555;
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  function hamming(a, b) {
    return popcount32(a[0] ^ b[0]) + popcount32(a[1] ^ b[1]);
  }

  // Box-average a luma image down to w x h. Done in JS rather than with canvas
  // scaling so every browser produces the same hashes.
  function shrink(luma, sw, sh, w, h) {
    const out = new Float64Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor((y * sh) / h);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / h));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor((x * sw) / w);
        const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / w));
        let sum = 0;
        for (let yy = y0; yy < y1; yy++) {
          const row = yy * sw;
          for (let xx = x0; xx < x1; xx++) sum += luma[row + xx];
        }
        out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
      }
    }
    return out;
  }

  // 64 booleans -> [hi, lo] 32-bit words.
  function packBits(test) {
    const words = [0, 0];
    for (let i = 0; i < 64; i++) if (test(i)) words[i >> 5] |= 1 << (i & 31);
    return [words[0] >>> 0, words[1] >>> 0];
  }

  function fingerprint(luma, w, h) {
    const g = shrink(luma, w, h, 32, 32);
    let mean = 0;
    for (const v of g) mean += v;
    mean /= g.length;
    let variance = 0;
    for (const v of g) variance += (v - mean) ** 2;
    const flat = Math.sqrt(variance / g.length) < DUP.FLAT_SD;

    // Low-frequency 8x8 block of the 2-D DCT (rows, then columns).
    const rows = new Float64Array(8 * 32);
    for (let y = 0; y < 32; y++) {
      for (let u = 0; u < 8; u++) {
        let sum = 0;
        for (let x = 0; x < 32; x++) sum += g[y * 32 + x] * DCT_COS[u * 32 + x];
        rows[u * 32 + y] = sum;
      }
    }
    const coef = new Float64Array(64);
    for (let v = 0; v < 8; v++) {
      for (let u = 0; u < 8; u++) {
        let sum = 0;
        for (let y = 0; y < 32; y++) sum += rows[u * 32 + y] * DCT_COS[v * 32 + y];
        coef[v * 8 + u] = sum;
      }
    }
    const ac = Array.from(coef.subarray(1)).sort((a, b) => a - b);
    const median = ac[31];
    const p = packBits((i) => i > 0 && coef[i] > median);

    const small = shrink(luma, w, h, 9, 8);
    const d = packBits((i) => {
      const y = i >> 3;
      const x = i & 7;
      return small[y * 9 + x] < small[y * 9 + x + 1];
    });
    return { p, d, flat };
  }

  let dupCanvas = null;

  async function thumbFingerprint(url) {
    // A fresh CORS request: a cached copy from the gallery's <img> may lack CORS headers.
    const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    let source;
    let release = () => {};
    if (typeof createImageBitmap === 'function') {
      source = await createImageBitmap(blob);
      release = () => source.close();
    } else {
      const objectUrl = URL.createObjectURL(blob);
      source = new Image();
      source.src = objectUrl;
      await source.decode();
      release = () => URL.revokeObjectURL(objectUrl);
    }
    try {
      const w0 = source.width;
      const h0 = source.height;
      const scale = Math.min(1, 512 / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round(h0 * scale));
      dupCanvas = dupCanvas || document.createElement('canvas');
      dupCanvas.width = w;
      dupCanvas.height = h;
      const ctx = dupCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      const luma = new Float64Array(w * h);
      for (let i = 0; i < luma.length; i++) {
        luma[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      }
      return { ...fingerprint(luma, w, h), ar: w0 / h0 };
    } finally {
      release();
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const dupes = {
    hashes: new Map(),    // id -> { p, d, flat, ar }
    failed: new Set(),    // ids whose thumbnail couldn't be read
    groups: [],           // [{ keep: id, hide: [ids] }], keeper = earliest added
    hidden: new Set(),    // every id in some group's `hide`
    state: 'idle',        // idle | running | done | unavailable
    progress: { done: 0, total: 0 },
    gen: 0,               // bumped on reset so stale work is discarded
    succeeded: 0,

    reset() {
      this.gen++;
      this.hashes.clear();
      this.failed.clear();
      this.groups = [];
      this.hidden = new Set();
      this.state = 'idle';
      this.progress = { done: 0, total: 0 };
      this.succeeded = 0;
    },

    // Hash photos ({ id, thumb }) not hashed yet. Returns false if reset meanwhile.
    async hashPhotos(photos, { budgetMs = Infinity, onProgress } = {}) {
      const gen = this.gen;
      const todo = photos.filter((p) => p.thumb && !this.hashes.has(p.id));
      const deadline = Date.now() + budgetMs;
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < todo.length && gen === this.gen && this.state !== 'unavailable' && Date.now() < deadline) {
          if (document.hidden) { await sleep(1000); continue; }
          const p = todo[next++];
          try {
            const fp = await thumbFingerprint(p.thumb);
            if (gen !== this.gen) return;
            this.hashes.set(p.id, fp);
            this.failed.delete(p.id);
            this.succeeded++;
          } catch {
            if (gen !== this.gen) return;
            this.failed.add(p.id);
            // Nothing readable at all: most likely blocked by CORS. Stop trying.
            if (!this.succeeded && this.failed.size >= 3) this.state = 'unavailable';
          }
          done++;
          if (onProgress) onProgress(done, todo.length);
          await sleep(0);  // keep the slideshow responsive
        }
      };
      await Promise.all(Array.from({ length: Math.min(DUP.CONCURRENCY, todo.length) }, worker));
      return gen === this.gen;
    },

    // Start the full background pass if it hasn't run yet.
    ensureRun() {
      if (this.state === 'idle' && player.allOrder.length) this.runAll();
    },

    async runAll() {
      const gen = this.gen;
      this.state = 'running';
      this.failed.clear();
      // Loop so photos added by a refresh during the pass are covered too.
      for (;;) {
        const photos = player.allOrder
          .filter((id) => !this.hashes.has(id) && !this.failed.has(id))
          .map((id) => ({ id, thumb: player.thumbs.get(id) }));
        if (!photos.length || this.state === 'unavailable') break;
        this.progress = { done: 0, total: photos.length };
        dupeReport.render();
        const ok = await this.hashPhotos(photos, {
          onProgress: (done, total) => {
            this.progress = { done, total };
            dupeReport.renderSoon();
          },
        });
        if (!ok || gen !== this.gen) return;
      }
      if (this.state !== 'unavailable') this.state = 'done';
      player.applyFilter();
      dupeReport.render();
    },

    same(a, b) {
      const sa = player.sums.get(a);
      if (sa && sa === player.sums.get(b)) return true;
      const fa = this.hashes.get(a);
      const fb = this.hashes.get(b);
      if (!fa || !fb || fa.flat || fb.flat) return false;
      if (Math.abs(fa.ar / fb.ar - 1) > DUP.AR_TOL) return false;
      return hamming(fa.p, fb.p) <= DUP.P_MAX && hamming(fa.d, fb.d) <= DUP.D_MAX;
    },

    // Star grouping in album order: each photo joins the first group whose
    // keeper it matches (so A~B~C chains can't pull in unrelated photos).
    regroup() {
      const groups = [];
      for (const id of player.allOrder) {
        const g = groups.find((grp) => this.same(grp.keep, id));
        if (g) g.hide.push(id);
        else groups.push({ keep: id, hide: [] });
      }
      this.groups = groups.filter((g) => g.hide.length);
      this.hidden = new Set(this.groups.flatMap((g) => g.hide));
    },
  };

  // ---------------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------------

  const els = {
    player: $('#player'),
    stage: $('#stage'),
    layers: [...document.querySelectorAll('#stage .layer')],
    message: $('#message'),
    messageText: $('#message-text'),
    messageSpinner: $('#message-spinner'),
    qr: $('#qr'),
    qrCode: $('#qr-code'),
    qrCaption: $('#qr-caption'),
    status: $('#status'),
    statusNote: $('#status-note'),
    statusCount: $('#status-count'),
    controls: $('#controls'),
    refreshBtn: $('[data-action="refresh"]'),
    settings: $('#settings'),
    settingsPanel: $('.settings-panel'),
    settingsSub: $('#settings-sub'),
    gallery: $('#gallery'),
    galleryGrid: $('#gallery-grid'),
    gallerySub: $('#gallery-sub'),
  };

  const player = {
    settings: { ...DEFAULTS },
    running: false,
    urls: new Map(),      // id -> current signed URL
    thumbs: new Map(),    // id -> signed thumbnail URL (gallery, duplicate checks)
    sums: new Map(),      // id -> full-size file checksum
    allOrder: [],         // every photo id, in album order
    albumOrder: [],       // ids that play: allOrder minus hidden duplicates
    order: [],            // ids for the current cycle
    pos: -1,              // index in `order` of the photo on screen
    currentId: null,
    nextOrder: null,      // pre-built order for the next cycle (so we can preload its first photo)
    paused: false,
    ended: false,
    timer: 0,
    refreshTimer: 0,
    refreshing: null,
    navSeq: 0,
    front: 0,             // which <img> layer is visible
    failures: 0,
    preloads: new Map(),  // url -> Promise<void>
    lastQr: '',
    loopCount: 1,         // which pass through the album we're on
    title: '',

    // ---- lifecycle ----

    start(settings, album) {
      this.running = true;
      this.paused = false;
      this.ended = false;
      this.urls = new Map();
      this.thumbs = new Map();
      this.sums = new Map();
      this.allOrder = [];
      this.albumOrder = [];
      this.order = [];
      this.title = album ? album.title : '';
      dupes.reset();
      dupeReport.showAll = false;
      dupeReport.expanded.clear();
      this.pos = -1;
      this.currentId = null;
      this.nextOrder = null;
      this.failures = 0;
      this.preloads.clear();
      for (const l of this.layers()) { l.classList.remove('on'); l.removeAttribute('src'); }
      this.lastRefreshNote = null;
      els.statusNote.textContent = '';
      els.statusNote.classList.remove('error');
      els.statusCount.textContent = '';
      els.status.classList.remove('show');
      this.syncStatusBox();

      showScreen('player');
      this.applySettings(settings, { writeUrl: false });
      this.setPausedUi();
      activity.poke();

      if (album) {
        this.ingest(album.photos);
        this.setStatus(`Updated ${timeLabel(album.fetchedAt)}`);
        this.begin();
      } else {
        this.showMessage('Loading album…', true);
        this.refresh({ initial: true });
      }
    },

    stop() {
      this.running = false;
      this.navSeq++;
      clearTimeout(this.timer);
      clearInterval(this.refreshTimer);
      dupes.reset();
      this.closeSettings();
      gallery.close();
    },

    layers() { return els.layers; },

    // ---- settings ----

    applySettings(next, { writeUrl: write = true } = {}) {
      const prev = this.settings;
      this.settings = next;

      els.stage.classList.toggle('fade', next.tr === 'fade');
      els.stage.classList.toggle('fit-cover', next.fit === 'cover');
      els.stage.classList.toggle('fit-contain', next.fit !== 'cover');

      // QR overlay
      els.qr.hidden = !next.qr;
      els.qr.className = `qr ${next.qrpos} ${next.qrsize === 'm' ? 'medium' : 'small'}`;
      const target = qrTarget(next);
      if (target !== this.lastQr) { renderQr(els.qrCode, target); this.lastQr = target; }
      els.qrCaption.textContent = qrCaptionText(next);
      // Keep the status note out of the QR code's corner.
      els.status.classList.toggle('br', next.qr && next.qrpos === 'bl');
      els.status.classList.toggle('bl', !(next.qr && next.qrpos === 'bl'));

      if (this.running) {
        if (prev.refresh !== next.refresh || !this.refreshTimer) this.scheduleRefresh();
        if (prev.shuffle !== next.shuffle) this.reorder();
        if (prev.sec !== next.sec) this.scheduleNext();
        if (!prev.loop && next.loop && this.ended) { this.ended = false; this.advance(1); }
        if (prev.dupes !== next.dupes) {
          this.applyFilter();
          if (next.dupes) dupes.ensureRun();
          dupeReport.render();
        }
        this.updateCount();
      }
      if (write) writeUrl(next);
    },

    // ---- data ----

    ingest(photos) {
      this.setPhotos(photos);
      this.albumOrder = this.visibleOrder();
    },

    setPhotos(photos) {
      this.urls = new Map(photos.map((p) => [p.id, p.url]));
      this.thumbs = new Map(photos.map((p) => [p.id, p.thumb]));
      this.sums = new Map(photos.map((p) => [p.id, p.sum]));
      this.allOrder = photos.map((p) => p.id);
      dupes.regroup();
    },

    visibleOrder() {
      return this.settings.dupes ? this.allOrder.filter((id) => !dupes.hidden.has(id)) : this.allOrder.slice();
    },

    // Re-apply the duplicate filter (setting toggled, or a check finished). Silent.
    applyFilter() {
      dupes.regroup();
      this.reconcile();
    },

    buildOrder(avoidFirst) {
      if (!this.settings.shuffle) return this.albumOrder.slice();
      const o = shuffled(this.albumOrder);
      // Don't show the same photo twice in a row across a reshuffle.
      if (o.length > 1 && o[0] === avoidFirst) {
        const j = 1 + Math.floor(Math.random() * (o.length - 1));
        [o[0], o[j]] = [o[j], o[0]];
      }
      return o;
    },

    // Called when shuffle is toggled: keep the current photo, rebuild the rest.
    reorder() {
      this.nextOrder = null;
      if (!this.albumOrder.length) return;
      if (this.settings.shuffle) {
        const rest = shuffled(this.albumOrder.filter((id) => id !== this.currentId));
        this.order = this.currentId && this.urls.has(this.currentId) ? [this.currentId, ...rest] : rest;
        this.pos = this.currentId && this.urls.has(this.currentId) ? 0 : -1;
      } else {
        this.order = this.albumOrder.slice();
        this.pos = this.order.indexOf(this.currentId);
      }
      this.updateCount();
      this.preloadNext();
    },

    begin() {
      this.order = this.buildOrder(null);
      this.pos = -1;
      this.loopCount = 1;
      if (!this.order.length) {
        this.showMessage(this.emptyText(), false);
        return;
      }
      this.hideMessage();
      this.advance(1);
    },

    emptyText() {
      return this.settings.refresh
        ? 'This album has no photos yet. New ones will appear automatically.'
        : 'This album has no photos yet.';
    },

    // Merge a fresh listing into the current cycle without interrupting the
    // photo on screen. Returns counts of photos added (that will play) and deleted.
    merge(photos) {
      const addedIds = photos.filter((p) => !this.urls.has(p.id)).map((p) => p.id);
      const ids = new Set(photos.map((p) => p.id));
      const removed = [...this.urls.keys()].filter((id) => !ids.has(id)).length;
      this.setPhotos(photos);
      this.preloads.clear();  // signed URLs changed
      this.reconcile();
      const playing = new Set(this.albumOrder);
      return { added: addedIds.filter((id) => playing.has(id)).length, removed };
    },

    // Bring the current cycle in line with visibleOrder(): drop photos that no
    // longer play (deleted or hidden duplicates) and queue ones that now do.
    reconcile() {
      const before = new Set(this.albumOrder);
      this.albumOrder = this.visibleOrder();
      const visible = new Set(this.albumOrder);
      const arrived = this.albumOrder.filter((id) => !before.has(id));
      this.nextOrder = null;

      if (!this.order.length) {
        if (this.albumOrder.length && this.currentId === null) this.begin();
        else this.reorder();
        return;
      }

      // Work out where we are in what's left: the last photo still playing at
      // or before the current position.
      let lastKept = null;
      const filtered = [];
      this.order.forEach((id, i) => {
        if (visible.has(id)) {
          filtered.push(id);
          if (i <= this.pos) lastKept = id;
        }
      });

      let order;
      let pos;
      if (this.settings.shuffle) {
        // New photos play next.
        order = filtered;
        pos = lastKept ? order.indexOf(lastKept) : -1;
        order.splice(pos + 1, 0, ...shuffled(arrived));
      } else {
        order = this.albumOrder.slice();
        pos = this.currentId && visible.has(this.currentId)
          ? order.indexOf(this.currentId)
          : lastKept ? order.indexOf(lastKept) : -1;
      }
      this.order = order;
      this.pos = pos;

      if (!this.order.length) {
        this.currentId = null;
        this.navSeq++;
        clearTimeout(this.timer);
        for (const l of this.layers()) l.classList.remove('on');
        this.showMessage(this.emptyText(), false);
      } else if (this.ended && arrived.length) {
        this.ended = false;
        this.advance(1);
      } else {
        this.preloadNext();
      }
      this.updateCount();
    },

    async refresh({ initial = false, manual = false } = {}) {
      if (this.refreshing) return this.refreshing;
      const token = this.settings.album;
      els.refreshBtn.classList.add('spinning');
      this.refreshing = (async () => {
        try {
          const album = await fetchAlbum(token);
          if (!this.running || token !== this.settings.album) return;
          if (initial) {
            this.title = album.title;
            this.ingest(album.photos);
            this.setStatus(`Updated ${timeLabel(album.fetchedAt)}`);
            this.begin();
            return;
          }
          // Check new photos for duplicates first, so a re-upload never gets queued.
          if (this.settings.dupes && dupes.state === 'done') {
            await dupes.hashPhotos(album.photos, { budgetMs: DUP.REFRESH_BUDGET_MS });
            if (!this.running || token !== this.settings.album) return;
          }
          const { added, removed } = this.merge(album.photos);
          const parts = [`Updated ${timeLabel()}`];
          if (added) parts.push(`+${added} new`);
          if (removed) parts.push(`${removed} removed`);
          if (!added && !removed && manual) parts.push('no changes');
          this.setStatus(parts.join(' · '), { flash: manual || added > 0 || removed > 0 });
        } catch (err) {
          if (!this.running) return;
          if (initial) {
            this.showMessage(`${err.message} Retrying…`, true);
            this.setStatus('Couldn’t load album', { error: true, flash: true });
            setTimeout(() => this.running && !this.order.length && this.refresh({ initial: true }), 15000);
          } else {
            this.setStatus('Couldn’t refresh', { error: true, flash: true });
          }
        } finally {
          els.refreshBtn.classList.remove('spinning');
          this.refreshing = null;
        }
      })();
      return this.refreshing;
    },

    scheduleRefresh() {
      clearInterval(this.refreshTimer);
      this.refreshTimer = 0;
      if (this.settings.refresh > 0) {
        this.refreshTimer = setInterval(() => this.refresh(), this.settings.refresh * 60000);
      }
    },

    // ---- navigation ----

    advance(dir) {
      if (!this.order.length) return;
      this.ended = false;
      let p = this.pos + dir;
      if (p >= this.order.length) {
        if (!this.settings.loop) {
          this.ended = true;
          this.pos = this.order.length - 1;
          clearTimeout(this.timer);
          this.setStatus('End of album', { flash: true });
          return;
        }
        this.order = this.nextOrder || this.buildOrder(this.currentId);
        this.nextOrder = null;
        this.loopCount++;
        p = 0;
      } else if (p < 0) {
        p = this.settings.loop ? this.order.length - 1 : 0;
      }
      this.show(p);
    },

    show(p) {
      const seq = ++this.navSeq;
      clearTimeout(this.timer);
      const id = this.order[p];
      const url = this.urls.get(id);
      this.pos = p;

      this.load(url).then(() => {
        if (seq !== this.navSeq || !this.running) return;
        this.failures = 0;
        this.currentId = id;
        this.updateCount();
        // The duplicate check starts once something is on screen.
        if (this.settings.dupes) dupes.ensureRun();
        this.hideMessage();
        const [a, b] = [this.layers()[this.front], this.layers()[1 - this.front]];
        b.src = url;
        b.classList.add('on');
        a.classList.remove('on');
        this.front = 1 - this.front;
        this.scheduleNext();
        this.preloadNext();
      }, () => {
        if (seq !== this.navSeq || !this.running) return;
        // Most likely an expired URL. Skip it and fetch fresh URLs.
        this.preloads.delete(url);
        this.failures++;
        if (this.failures >= Math.min(this.order.length, 5)) {
          this.failures = 0;
          if (!this.currentId) this.showMessage('Couldn’t load photos. Retrying…', true);
          this.refresh().then(() => {
            if (seq === this.navSeq && this.running) this.timer = setTimeout(() => this.advance(1), 3000);
          });
        } else {
          if (this.failures === 1) this.refresh();
          this.timer = setTimeout(() => { if (seq === this.navSeq) this.advance(1); }, 300);
        }
      });
    },

    load(url) {
      if (!url) return Promise.reject(new Error('missing'));
      let p = this.preloads.get(url);
      if (!p) {
        p = new Promise((resolve, reject) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(resolve);
          img.onerror = reject;
          img.src = url;
        });
        p.catch(() => {});
        this.preloads.set(url, p);
      }
      return p;
    },

    preloadNext() {
      let id;
      if (this.pos + 1 < this.order.length) id = this.order[this.pos + 1];
      else if (this.settings.loop && this.order.length) {
        this.nextOrder = this.nextOrder || this.buildOrder(this.currentId);
        id = this.nextOrder[0];
      }
      // Keep only the current and next images in the cache.
      const keep = new Set([this.urls.get(this.currentId), this.urls.get(id)]);
      for (const u of this.preloads.keys()) if (!keep.has(u)) this.preloads.delete(u);
      if (id) this.load(this.urls.get(id));
    },

    scheduleNext() {
      clearTimeout(this.timer);
      if (this.paused || this.ended || !this.currentId || !this.running) return;
      const seq = this.navSeq;
      this.timer = setTimeout(() => { if (seq === this.navSeq) this.advance(1); }, this.settings.sec * 1000);
    },

    togglePause() {
      this.paused = !this.paused;
      this.setPausedUi();
      if (this.paused) clearTimeout(this.timer);
      else if (this.ended) { this.pos = -1; this.ended = false; this.advance(1); }
      else this.scheduleNext();
      this.setStatus(this.paused ? 'Paused' : 'Playing', { flash: true });
    },

    setPausedUi() {
      els.player.classList.toggle('paused', this.paused);
      const btn = $('[data-action="toggle"]');
      btn.setAttribute('aria-label', this.paused ? 'Play' : 'Pause');
      btn.dataset.tip = this.paused ? 'Play (Space)' : 'Pause (Space)';
    },

    // ---- UI bits ----

    showMessage(text, spinning) {
      els.messageText.textContent = text;
      els.messageSpinner.hidden = !spinning;
      els.message.hidden = false;
    },

    hideMessage() { els.message.hidden = true; },

    statusTimer: 0,
    lastRefreshNote: null,
    setStatus(text, { error = false, flash = false } = {}) {
      // Transient notes (paused, end of album) revert to the last refresh note.
      const transient = !/^(Updated|Couldn’t)/.test(text);
      if (!transient) this.lastRefreshNote = { text, error };
      els.statusNote.textContent = text;
      els.statusNote.classList.toggle('error', error);
      this.syncStatusBox();
      if (flash) {
        els.status.classList.add('show');
        clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(() => {
          els.status.classList.remove('show');
          if (transient) {
            setTimeout(() => {
              if (els.status.classList.contains('show')) return;
              const last = this.lastRefreshNote;
              els.statusNote.textContent = last ? last.text : '';
              els.statusNote.classList.toggle('error', !!last?.error);
              this.syncStatusBox();
            }, 700);
          }
        }, 4000);
      }
    },

    // Line 2 of the status note: "Photo 12 of 137 · Loop 3".
    updateCount() {
      const total = this.order.length;
      let text = '';
      if (total && this.currentId) {
        // If the photo on screen was just deleted, pos points at the one
        // before it, so clamp to a sensible number.
        const n = Math.min(total, Math.max(1, this.pos + 1));
        text = `Photo ${n} of ${total}`;
        if (this.settings.loop) text += ` · Loop ${this.loopCount}`;
      }
      els.statusCount.textContent = text;
      this.syncStatusBox();
      gallery.sync();
      if (!els.settings.hidden) this.updateSettingsSub();
    },

    updateSettingsSub() {
      const n = this.albumOrder.length;
      els.settingsSub.textContent = [this.title, `${n} photo${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    },

    // Jump to a photo in the current loop (from the gallery).
    jumpTo(index) {
      if (index < 0 || index >= this.order.length) return;
      this.ended = false;
      this.show(index);
    },

    syncStatusBox() {
      els.status.hidden = !els.statusNote.textContent && !els.statusCount.textContent;
    },

    openSettings() {
      gallery.close();
      setFormContext('player');
      fillForm(this.settings);
      $('#options-home-player').append(form);
      els.settings.hidden = false;
      els.player.classList.add('active');
      els.player.classList.remove('idle');
      this.updateSettingsSub();
      // Opening settings checks for duplicates even with the filter off, so
      // the count is there to see.
      dupes.ensureRun();
      dupeReport.render();
      els.settingsPanel.scrollTop = 0;
      $('#settings-title').focus({ preventScroll: true });
    },

    closeSettings() {
      if (els.settings.hidden) return;
      const hadFocus = els.settings.contains(document.activeElement);
      els.settings.hidden = true;
      form.elements.sec.value = this.settings.sec;
      activity.poke();
      if (hadFocus) $('[data-action="settings"]').focus({ preventScroll: true });
    },
  };

  // ---------------------------------------------------------------------------
  // Duplicates report in the settings panel
  // ---------------------------------------------------------------------------

  const dupeReport = {
    showAll: false,
    expanded: new Set(),   // keeper ids of groups shown large
    groupsKey: '',
    throttle: 0,

    renderSoon() {
      if (this.throttle) return;
      this.throttle = setTimeout(() => { this.throttle = 0; this.render(); }, 250);
    },

    render() {
      const statusEl = $('#dupe-status', form);
      const bar = $('.dupe-progress', form);
      const list = $('#dupe-groups', form);
      if (form.dataset.context !== 'player') {
        statusEl.textContent = 'Near-identical copies play once. Checked after the album loads.';
        statusEl.classList.remove('error');
        return;
      }
      if (els.settings.hidden) return;

      const on = player.settings.dupes;
      const n = dupes.hidden.size;
      const g = dupes.groups.length;
      const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
      let text;
      switch (dupes.state) {
        case 'running':
          text = `Checking photos… ${dupes.progress.done} of ${dupes.progress.total}`;
          break;
        case 'done':
          if (!n) text = `No duplicates in ${plural(player.allOrder.length, 'photo')}.`;
          else if (on) text = `${plural(n, 'duplicate')} hidden · ${plural(g, 'group')}`;
          else text = `${plural(n, 'duplicate')} found · showing all`;
          if (dupes.failed.size) text += ` · couldn’t check ${plural(dupes.failed.size, 'photo')}`;
          break;
        case 'unavailable':
          text = 'Couldn’t check for duplicates.';
          break;
        default:
          text = 'Checks once photos finish loading.';
      }
      statusEl.textContent = text;
      statusEl.classList.toggle('error', dupes.state === 'unavailable');

      const running = dupes.state === 'running';
      bar.hidden = !running;
      if (running) {
        const pct = dupes.progress.total ? Math.round((dupes.progress.done / dupes.progress.total) * 100) : 0;
        bar.firstElementChild.style.width = `${pct}%`;
        bar.setAttribute('aria-valuenow', String(pct));
      }

      const groups = dupes.state === 'done' ? dupes.groups : [];
      const key = [
        groups.map((grp) => [grp.keep, ...grp.hide].join(',')).join(';'),
        this.showAll, [...this.expanded].join(','), player.thumbs.size,
      ].join('|');
      if (key !== this.groupsKey) {
        this.groupsKey = key;
        this.renderGroups(list, groups);
      }
    },

    renderGroups(list, groups) {
      const frag = document.createDocumentFragment();
      const shown = groups.slice(0, this.showAll ? 30 : 3);
      shown.forEach((grp, i) => {
        const ids = [grp.keep, ...grp.hide];
        const expanded = this.expanded.has(grp.keep);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `dupe-group${expanded ? ' expanded' : ''}`;
        btn.dataset.keep = grp.keep;
        btn.setAttribute('aria-expanded', String(expanded));
        btn.setAttribute('aria-label', `Group ${i + 1}: 1 kept, ${grp.hide.length} hidden`);
        const visible = expanded || ids.length <= 5 ? ids : ids.slice(0, 4);
        visible.forEach((id, j) => {
          const cell = document.createElement('span');
          cell.className = `dupe-thumb ${j === 0 ? 'kept' : 'hidden-dup'}`;
          const img = document.createElement('img');
          img.alt = '';
          img.loading = 'lazy';
          img.draggable = false;
          img.src = player.thumbs.get(id) || '';
          cell.append(img);
          btn.append(cell);
        });
        if (visible.length < ids.length) {
          const more = document.createElement('span');
          more.className = 'dupe-thumb more';
          more.textContent = `+${ids.length - visible.length}`;
          btn.append(more);
        }
        frag.append(btn);
      });
      if (!this.showAll && groups.length > 3) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'text-btn dupe-more';
        more.textContent = `Show all ${groups.length} groups`;
        frag.append(more);
      } else if (this.showAll && groups.length > 30) {
        const note = document.createElement('p');
        note.className = 'hint';
        note.textContent = `and ${groups.length - 30} more`;
        frag.append(note);
      }
      list.replaceChildren(frag);
    },
  };

  $('#dupe-groups', form).addEventListener('click', (e) => {
    if (e.target.closest('.dupe-more')) {
      dupeReport.showAll = true;
    } else {
      const grp = e.target.closest('.dupe-group');
      if (!grp) return;
      const keep = grp.dataset.keep;
      if (dupeReport.expanded.has(keep)) dupeReport.expanded.delete(keep);
      else dupeReport.expanded.add(keep);
    }
    dupeReport.render();
  });

  $('#copy-album', form).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const input = form.elements.album;
    const live = $('#copy-live', form);
    try {
      await navigator.clipboard.writeText(input.value);
      btn.classList.add('copied');
      live.textContent = 'Copied';
      setTimeout(() => { btn.classList.remove('copied'); live.textContent = ''; }, 1500);
    } catch {
      input.focus();
      input.select();
    }
  });

  $('#exit-link', form).addEventListener('click', () => exitToSetup());

  els.settingsPanel.addEventListener('scroll', () => {
    els.settingsPanel.classList.toggle('scrolled', els.settingsPanel.scrollTop > 4);
  }, { passive: true });

  // Keep Tab inside the open settings panel.
  function trapFocus(e, container) {
    const items = [...container.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Gallery: the current loop in play order, as a scrolling grid of thumbnails
  // ---------------------------------------------------------------------------

  const gallery = {
    renderedOrder: null,
    renderedThumbs: null,

    isOpen() { return !els.gallery.hidden; },

    open() {
      player.closeSettings();
      els.gallery.hidden = false;
      els.player.classList.add('active');
      els.player.classList.remove('idle');
      this.sync();
      const current = $('.tile.current', els.galleryGrid);
      if (current) current.scrollIntoView({ block: 'center' });
      else els.galleryGrid.parentElement.scrollTop = 0;
    },

    close() {
      if (!this.isOpen()) return;
      els.gallery.hidden = true;
      activity.poke();
    },

    // Rebuild the grid when the loop order or thumbnail URLs change;
    // otherwise just move the "now playing" highlight.
    sync() {
      if (!this.isOpen()) return;
      if (this.renderedOrder !== player.order || this.renderedThumbs !== player.thumbs) this.render();
      const pos = player.order[player.pos] === player.currentId ? player.pos : -1;
      const tiles = els.galleryGrid.children;
      for (let i = 0; i < tiles.length; i++) {
        tiles[i].classList.toggle('played', i < player.pos);
        tiles[i].classList.toggle('current', i === pos);
      }
      els.gallerySub.textContent = player.order.length
        ? `${els.statusCount.textContent} · Tap a photo to play it`
        : 'No photos yet';
    },

    render() {
      this.renderedOrder = player.order;
      this.renderedThumbs = player.thumbs;
      const frag = document.createDocumentFragment();
      player.order.forEach((id, i) => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile';
        tile.dataset.index = i;
        tile.setAttribute('aria-label', `Play photo ${i + 1}`);
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.draggable = false;
        img.onerror = () => tile.classList.add('broken');
        img.src = player.thumbs.get(id) || player.urls.get(id) || '';
        tile.append(img);
        frag.append(tile);
      });
      els.galleryGrid.replaceChildren(frag);
    },
  };

  els.galleryGrid.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    player.jumpTo(Number(tile.dataset.index));
    gallery.close();
  });
  $('#gallery-close').addEventListener('click', () => gallery.close());
  els.gallery.addEventListener('click', (e) => { if (e.target === els.gallery) gallery.close(); });

  // ---------------------------------------------------------------------------
  // Activity: show controls/cursor while the user is interacting
  // ---------------------------------------------------------------------------

  const activity = {
    timer: 0,
    poke() {
      els.player.classList.add('active');
      els.player.classList.remove('idle');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.hide(), 3000);
    },
    hide() {
      clearTimeout(this.timer);
      if (!els.settings.hidden || gallery.isOpen()) return;
      if (els.controls.matches(':hover') && matchMedia('(hover: hover)').matches) {
        this.timer = setTimeout(() => this.hide(), 3000);
        return;
      }
      els.player.classList.remove('active');
      els.player.classList.add('idle');
    },
  };

  let lastMove = { x: -1, y: -1 };
  els.player.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    // Ignore synthetic zero-distance moves some browsers fire after hiding the cursor.
    if (Math.abs(e.clientX - lastMove.x) + Math.abs(e.clientY - lastMove.y) < 3) return;
    lastMove = { x: e.clientX, y: e.clientY };
    activity.poke();
  });

  // Tap toggles the controls; horizontal swipe goes next/previous.
  let swipe = null;
  els.stage.parentElement.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.controls, .settings, .gallery')) return;
    swipe = { x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType };
  });
  els.player.addEventListener('pointerup', (e) => {
    if (!swipe || e.target.closest('.controls, .settings, .gallery')) { swipe = null; return; }
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    const type = swipe.type;
    swipe = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      player.advance(dx < 0 ? 1 : -1);
      activity.poke();
      return;
    }
    if (type === 'mouse') { activity.poke(); return; }
    if (els.player.classList.contains('active')) activity.hide();
    else activity.poke();
  });

  els.controls.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    // Mouse clicks shouldn't leave a focus ring behind (keyboard use keeps it).
    if (e.detail > 0) btn.blur();
    activity.poke();
    switch (btn.dataset.action) {
      case 'prev': player.advance(-1); break;
      case 'next': player.advance(1); break;
      case 'toggle': player.togglePause(); break;
      case 'refresh': player.refresh({ manual: true }); break;
      case 'settings': player.openSettings(); break;
      case 'gallery': gallery.open(); break;
      case 'exit': exitToSetup(); break;
      case 'fullscreen': toggleFullscreen(); break;
    }
  });

  $('#settings-done').addEventListener('click', () => player.closeSettings());
  els.settings.addEventListener('click', (e) => { if (e.target === els.settings) player.closeSettings(); });

  document.addEventListener('keydown', (e) => {
    if (els.player.hidden) return;
    if (gallery.isOpen()) {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'g') { e.preventDefault(); gallery.close(); }
      return;
    }
    if (!els.settings.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); player.closeSettings(); }
      if (e.key === 'Tab') trapFocus(e, els.settingsPanel);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const handled = {
      ArrowRight: () => player.advance(1),
      ArrowLeft: () => player.advance(-1),
      ' ': () => player.togglePause(),
      k: () => player.togglePause(),
      r: () => player.refresh({ manual: true }),
      s: () => player.openSettings(),
      g: () => gallery.open(),
      f: () => toggleFullscreen(),
    }[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (handled) {
      e.preventDefault();
      handled();
      activity.poke();
    }
  });

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  function showScreen(name) {
    $('#setup').hidden = name !== 'setup';
    $('#gate').hidden = name !== 'gate';
    els.player.hidden = name !== 'player';
  }

  function showSetup(settings, error) {
    setFormContext('setup');
    fillForm(settings);
    dupeReport.render();
    $('#options-home-setup').append(form);
    const errEl = $('#setup-error');
    errEl.hidden = true;
    if (error) showError(errEl, error);
    $('#start-btn').disabled = false;
    $('#start-btn').textContent = 'Start slideshow';
    showScreen('setup');
  }

  function exitToSetup() {
    const s = player.settings;
    player.stop();
    wake.release();
    exitFullscreen();
    history.replaceState(null, '', location.pathname);
    document.title = 'Album Slideshow';
    showSetup(s);
  }

  // Setup: Start
  $('#start-btn').addEventListener('click', async () => {
    const errEl = $('#setup-error');
    errEl.hidden = true;
    const parsed = parseAlbumInput(form.elements.album.value);
    if (parsed.error) {
      showError(errEl, { message: parsed.error, hint: parsed.hint });
      form.elements.album.focus();
      return;
    }
    const settings = { ...readForm(DEFAULTS), album: parsed.token };

    // Full screen and wake lock need the click's user activation, so request
    // them now and undo them if the album turns out to be unavailable.
    enterFullscreen();
    wake.acquire();
    const btn = $('#start-btn');
    btn.disabled = true;
    btn.textContent = 'Checking album…';
    // iCloud is sometimes slow to answer; say so rather than look stuck.
    const slowTimer = setTimeout(() => { btn.textContent = 'Still loading. iCloud can take up to a minute…'; }, 6000);
    try {
      const album = await fetchAlbum(parsed.token);
      clearTimeout(slowTimer);
      writeUrl(settings);
      setTitle(album.title);
      player.start(settings, album);
    } catch (err) {
      clearTimeout(slowTimer);
      wake.release();
      exitFullscreen();
      showError(errEl, err);
      btn.disabled = false;
      btn.textContent = 'Start slideshow';
    }
  });

  form.elements.album.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && form.dataset.context === 'setup') { e.preventDefault(); $('#start-btn').click(); }
  });

  function setTitle(title) {
    document.title = title ? `${title} · Slideshow` : 'Album Slideshow';
  }

  // Gate ("Tap to start") for links that already carry settings.
  function showGate(settings) {
    showScreen('gate');
    const titleEl = $('#gate-title');
    const errEl = $('#gate-error');
    const btn = $('#gate-btn');
    let album = null;
    let failed = null;

    const load = () => {
      failed = null;
      errEl.hidden = true;
      titleEl.textContent = '';
      return fetchAlbum(settings.album).then((a) => {
        album = a;
        titleEl.textContent = a.title || '';
        setTitle(a.title);
      }, (err) => {
        failed = err;
        // Network hiccups are retried when the user taps; a missing album is shown right away.
        if (err.code === 'not_found' || err.code === 'invalid_token') showError(errEl, err);
      });
    };
    let loading = load();

    btn.onclick = async () => {
      if (failed && (failed.code === 'not_found' || failed.code === 'invalid_token')) {
        loading = load();
        btn.disabled = true;
        await loading;
        btn.disabled = false;
        if (failed) return;
      }
      enterFullscreen();
      wake.acquire();
      if (album) {
        player.start(settings, album);
      } else {
        // Still loading (or a transient failure): let the player fetch and retry.
        player.start(settings, null);
      }
    };

    $('#gate-edit').onclick = () => {
      history.replaceState(null, '', location.pathname);
      showSetup(settings);
    };
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
    $('[data-action="fullscreen"]').hidden = true;
  }
  syncFullscreenButton();

  const initial = settingsFromQuery(location.search);
  if (initial.album) {
    showGate(initial);
  } else {
    const q = new URLSearchParams(location.search);
    const badAlbum = q.get('album');
    showSetup(initial, badAlbum ? { message: 'The album in this link isn’t valid.', hint: 'Paste the shared album link again.' } : null);
    if (badAlbum) form.elements.album.value = badAlbum;
  }
})();
