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
    qr: true,
    qrpos: 'br',
    qrsize: 's',
    qrurl: '',            // empty = use the album link
    qrcap: 'Add your photos',
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
    q.set('qr', s.qr ? '1' : '0');
    q.set('qrpos', s.qrpos);
    q.set('qrsize', s.qrsize);
    if (s.qrurl && s.qrurl !== albumLink(s.album)) q.set('qrurl', s.qrurl);
    q.set('qrcap', s.qrcap);
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
    return { title, photos: body };
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
    f.qr.checked = s.qr;
    f.qrpos.value = s.qrpos;
    f.qrsize.value = s.qrsize;
    f.qrurl.value = s.qrurl;
    f.qrcap.value = s.qrcap;
    updateFormPreview();
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
      qr: f.qr.checked,
      qrpos: f.qrpos.value || base.qrpos,
      qrsize: f.qrsize.value || base.qrsize,
      qrurl: f.qrurl.value.trim(),
      qrcap: f.qrcap.value,
    };
  }

  function updateFormPreview() {
    const f = form.elements;
    form.classList.toggle('qr-on', f.qr.checked);
    let target = f.qrurl.value.trim();
    let note = 'Points to your custom link.';
    if (!target) {
      const p = parseAlbumInput(f.album.value);
      target = p.token ? albumLink(p.token) : '';
      note = p.token ? 'Points to the public album (view-only).' : 'Add an album link to generate the QR code.';
    }
    formPreview.classList.toggle('medium', f.qrsize.value === 'm');
    renderQr($('.qr-code', formPreview), target);
    $('.qr-caption', formPreview).textContent = f.qrcap.value;
    formPreview.hidden = !target;
    $('.qr-preview-note', form).textContent = note;
  }

  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', () => {
    updateFormPreview();
    if (form.closest('#settings')) player.applySettings(readForm(player.settings));
  });
  // Normalise the seconds field once the user is done with it.
  form.elements.sec.addEventListener('change', () => {
    const base = form.closest('#settings') ? player.settings : DEFAULTS;
    form.elements.sec.value = readForm(base).sec;
  });

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
    controls: $('#controls'),
    refreshBtn: $('[data-action="refresh"]'),
    settings: $('#settings'),
  };

  const player = {
    settings: { ...DEFAULTS },
    running: false,
    urls: new Map(),      // id -> current signed URL
    albumOrder: [],       // ids in album order
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

    // ---- lifecycle ----

    start(settings, album) {
      this.running = true;
      this.paused = false;
      this.ended = false;
      this.urls = new Map();
      this.albumOrder = [];
      this.order = [];
      this.pos = -1;
      this.currentId = null;
      this.nextOrder = null;
      this.failures = 0;
      this.preloads.clear();
      for (const l of this.layers()) { l.classList.remove('on'); l.removeAttribute('src'); }
      els.status.textContent = '';
      els.status.classList.remove('show', 'error');

      showScreen('player');
      this.applySettings(settings, { writeUrl: false });
      this.setPausedUi();
      activity.poke();

      if (album) {
        this.ingest(album.photos);
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
      this.closeSettings();
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
      els.qrCaption.textContent = next.qrcap;
      // Keep the status note out of the QR code's corner.
      els.status.classList.toggle('br', next.qr && next.qrpos === 'bl');
      els.status.classList.toggle('bl', !(next.qr && next.qrpos === 'bl'));

      if (this.running) {
        if (prev.refresh !== next.refresh || !this.refreshTimer) this.scheduleRefresh();
        if (prev.shuffle !== next.shuffle) this.reorder();
        if (prev.sec !== next.sec) this.scheduleNext();
        if (!prev.loop && next.loop && this.ended) { this.ended = false; this.advance(1); }
      }
      if (write) writeUrl(next);
    },

    // ---- data ----

    ingest(photos) {
      this.urls = new Map(photos.map((p) => [p.id, p.url]));
      this.albumOrder = photos.map((p) => p.id);
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
      this.preloadNext();
    },

    begin() {
      this.order = this.buildOrder(null);
      this.pos = -1;
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
    // photo on screen. New photos are queued up next; deleted ones are dropped.
    merge(photos) {
      const fresh = new Map(photos.map((p) => [p.id, p.url]));
      const added = photos.map((p) => p.id).filter((id) => !this.urls.has(id));
      const removed = [...this.urls.keys()].filter((id) => !fresh.has(id));
      const wasEmpty = !this.order.length;

      this.urls = fresh;
      this.albumOrder = photos.map((p) => p.id);
      this.preloads.clear();  // signed URLs changed
      this.nextOrder = null;

      if (wasEmpty) {
        if (this.albumOrder.length && this.currentId === null) this.begin();
        else this.reorder();
        return { added: added.length, removed: removed.length };
      }

      // Drop deleted photos and work out where we are in what's left.
      let kept = 0;
      const filtered = [];
      this.order.forEach((id, i) => {
        if (fresh.has(id)) {
          filtered.push(id);
          if (i <= this.pos) kept++;
        }
      });
      let pos = kept - 1;

      let order;
      if (this.settings.shuffle) {
        order = filtered;
        order.splice(pos + 1, 0, ...shuffled(added));
      } else {
        // Album order puts newly added photos at the end, after everything
        // already in the cycle, so positions of kept photos are unchanged.
        order = this.albumOrder.slice();
        if (this.currentId && fresh.has(this.currentId)) pos = order.indexOf(this.currentId);
      }
      this.order = order;
      this.pos = pos;

      if (!this.order.length) {
        this.currentId = null;
        this.navSeq++;
        clearTimeout(this.timer);
        for (const l of this.layers()) l.classList.remove('on');
        this.showMessage(this.emptyText(), false);
      } else if (this.ended && added.length) {
        this.ended = false;
        this.advance(1);
      } else {
        this.preloadNext();
      }
      return { added: added.length, removed: removed.length };
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
            this.ingest(album.photos);
            this.begin();
            return;
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
      btn.title = this.paused ? 'Play (Space)' : 'Pause (Space)';
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
      els.status.textContent = text;
      els.status.classList.toggle('error', error);
      if (flash) {
        els.status.classList.add('show');
        clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(() => {
          els.status.classList.remove('show');
          if (transient) {
            setTimeout(() => {
              if (els.status.classList.contains('show')) return;
              const last = this.lastRefreshNote;
              els.status.textContent = last ? last.text : '';
              els.status.classList.toggle('error', !!last?.error);
            }, 700);
          }
        }, 4000);
      }
    },

    openSettings() {
      fillForm(this.settings);
      $('#options-home-player').append(form);
      els.settings.hidden = false;
      els.player.classList.add('active');
      els.player.classList.remove('idle');
    },

    closeSettings() {
      if (els.settings.hidden) return;
      els.settings.hidden = true;
      form.elements.sec.value = this.settings.sec;
      activity.poke();
    },
  };

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
      if (!els.settings.hidden) return;
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
    if (e.target.closest('.controls, .settings')) return;
    swipe = { x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType };
  });
  els.player.addEventListener('pointerup', (e) => {
    if (!swipe || e.target.closest('.controls, .settings')) { swipe = null; return; }
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
    activity.poke();
    switch (btn.dataset.action) {
      case 'prev': player.advance(-1); break;
      case 'next': player.advance(1); break;
      case 'toggle': player.togglePause(); break;
      case 'refresh': player.refresh({ manual: true }); break;
      case 'settings': player.openSettings(); break;
      case 'exit': exitToSetup(); break;
    }
  });

  $('#settings-done').addEventListener('click', () => player.closeSettings());
  els.settings.addEventListener('click', (e) => { if (e.target === els.settings) player.closeSettings(); });

  document.addEventListener('keydown', (e) => {
    if (els.player.hidden) return;
    if (!els.settings.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); player.closeSettings(); }
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
      f: () => enterFullscreen(),
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
    fillForm(settings);
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
    if (e.key === 'Enter') { e.preventDefault(); $('#start-btn').click(); }
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
