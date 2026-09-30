// Vercel serverless function: GET /api/album?token=<TOKEN> → [{ id, url }]
import { handleAlbumRequest } from '../lib/icloud.js';

// iCloud can be slow (20s+ for some albums), so allow more than the default.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed', message: 'Use GET.' });
  }
  const token = new URL(req.url, 'http://x').searchParams.get('token') || '';
  const { status, headers, body } = await handleAlbumRequest(token);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.status(status).send(body);
}
