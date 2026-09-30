// Stateless client for the (unofficial) iCloud Shared Album web API.
// Nothing is cached or stored: every call hits Apple and returns fresh,
// short-lived image URLs.

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const HOST_RE = /^p\d{1,4}-sharedstreams\.icloud\.com$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{10,200}$/;
const BATCH_SIZE = 100;
const BATCH_CONCURRENCY = 4;
const TIMEOUT_MS = 55000; // Apple can take 20s+ to answer for some albums.

export class AlbumError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isValidToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

// Apple encodes the storage partition in the token. It's only a starting
// guess; a 330 response tells us the right host.
function initialHost(token) {
  const decode = (s) => [...s].reduce((n, c) => n * 62 + BASE62.indexOf(c), 0);
  const partition = token[0] === 'A' ? decode(token[1]) : decode(token.slice(1, 3));
  const p = partition >= 1 && partition < 1000 ? String(partition).padStart(2, '0') : '01';
  return `p${p}-sharedstreams.icloud.com`;
}

async function post(host, token, endpoint, body) {
  const res = await fetch(`https://${host}/${token}/sharedstreams/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res;
}

async function fetchStream(token) {
  let host = initialHost(token);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await post(host, token, 'webstream', { streamCtag: null });
    if (res.status === 330) {
      let next = res.headers.get('x-apple-mme-host');
      if (!next) {
        try { next = (await res.json())['X-Apple-MMe-Host']; } catch { /* ignore */ }
      }
      if (!next || !HOST_RE.test(next)) {
        throw new AlbumError(502, 'upstream', 'iCloud returned an unexpected redirect.');
      }
      host = next;
      continue;
    }
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      throw new AlbumError(404, 'not_found', 'Album not found, or it isn’t public.');
    }
    if (!res.ok) {
      throw new AlbumError(502, 'upstream', `iCloud responded with ${res.status}.`);
    }
    const data = await res.json();
    return { host, data };
  }
  throw new AlbumError(502, 'upstream', 'Too many iCloud redirects.');
}

// Image derivatives, smallest first. Each photo usually has a thumbnail
// (~340px) and a full-size version.
function imageDerivatives(photo) {
  const list = [];
  for (const [key, d] of Object.entries(photo.derivatives || {})) {
    // Image derivatives are keyed by their pixel width; video ones use
    // names like "PosterFrame" or "720p".
    if (!/^\d+$/.test(key) || !d?.checksum) continue;
    const area = (Number(d.width) || Number(key)) * (Number(d.height) || 1);
    list.push({ checksum: d.checksum, area, size: Number(d.fileSize) || 0 });
  }
  return list.sort((a, b) => a.area - b.area || a.size - b.size);
}

async function fetchAssetUrls(host, token, guids) {
  const batches = [];
  for (let i = 0; i < guids.length; i += BATCH_SIZE) batches.push(guids.slice(i, i + BATCH_SIZE));

  const items = {};
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      const res = await post(host, token, 'webasseturls', { photoGuids: batch });
      if (!res.ok) throw new AlbumError(502, 'upstream', `iCloud asset lookup failed (${res.status}).`);
      const data = await res.json();
      Object.assign(items, data.items || {});
    }
  }
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, worker));
  return items;
}

// Returns { title, photos: [{ id, url, thumb, sum }] } in the order photos were added.
export async function getAlbum(token) {
  if (!isValidToken(token)) {
    throw new AlbumError(400, 'invalid_token', 'That doesn’t look like a shared album link.');
  }

  const { host, data } = await fetchStream(token);
  const photos = (data.photos || [])
    .filter((p) => p.mediaAssetType !== 'video')
    .map((p) => {
      const sizes = imageDerivatives(p);
      return {
        id: p.photoGuid,
        checksum: sizes.at(-1)?.checksum,
        thumbChecksum: sizes[0]?.checksum,
        // Sort by when it was added to the album, then by capture date, so
        // newly added photos always land at the end.
        key: `${p.batchDateCreated || ''}|${p.dateCreated || ''}|${p.photoGuid}`,
      };
    })
    .filter((p) => p.id && p.checksum)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const items = photos.length ? await fetchAssetUrls(host, token, photos.map((p) => p.id)) : {};
  const result = [];
  const urlFor = (checksum) => {
    const loc = items[checksum];
    return loc?.url_location && loc?.url_path ? `https://${loc.url_location}${loc.url_path}` : null;
  };
  for (const p of photos) {
    const url = urlFor(p.checksum);
    // `sum` is the full-size file's checksum: equal sums mean byte-identical copies.
    if (url) result.push({ id: p.id, url, thumb: urlFor(p.thumbChecksum) || url, sum: p.checksum });
  }
  return { title: data.streamName || '', photos: result };
}

// Framework-agnostic handler: takes the token, returns { status, headers, body }.
export async function handleAlbumRequest(token) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  try {
    const { title, photos } = await getAlbum(token);
    headers['X-Album-Title'] = encodeURIComponent(title);
    return { status: 200, headers, body: JSON.stringify(photos) };
  } catch (err) {
    const e = err instanceof AlbumError
      ? err
      : new AlbumError(502, 'upstream', err?.name === 'TimeoutError' ? 'iCloud timed out.' : 'Couldn’t reach iCloud.');
    return { status: e.status, headers, body: JSON.stringify({ error: e.code, message: e.message }) };
  }
}
