const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const HTML_FILE = path.join(__dirname, 'clark-and-co-business-plan.html');
const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', 'clark-and-co')
  : path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'checklist-state.json');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function ensureStateFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STATE_FILE);
  } catch {
    await fs.writeFile(STATE_FILE, JSON.stringify({ checkedIndices: [] }, null, 2));
  }
}

function normalizeState(input) {
  const arr = Array.isArray(input?.checkedIndices) ? input.checkedIndices : [];
  const normalized = [...new Set(arr)]
    .map((n) => Number.parseInt(String(n), 10))
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);

  return { checkedIndices: normalized };
}

async function readState() {
  await ensureStateFile();
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8');
    return normalizeState(JSON.parse(raw));
  } catch {
    const fallback = { checkedIndices: [] };
    await fs.writeFile(STATE_FILE, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

async function writeState(state) {
  const normalized = normalizeState(state);
  await fs.writeFile(STATE_FILE, JSON.stringify(normalized, null, 2));
  return normalized;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/checklist') {
    const state = await readState();
    sendJson(res, 200, state);
    return;
  }

  const checklistMatch = pathname.match(/^\/api\/checklist\/(\d+)$/);
  if (req.method === 'POST' && checklistMatch) {
    try {
      const index = Number.parseInt(checklistMatch[1], 10);
      const body = await parseBody(req);

      if (typeof body.done !== 'boolean') {
        sendJson(res, 400, { error: 'Request body must include boolean "done".' });
        return;
      }

      const state = await readState();
      const next = new Set(state.checkedIndices);

      if (body.done) {
        next.add(index);
      } else {
        next.delete(index);
      }

      const updated = await writeState({ checkedIndices: Array.from(next) });
      sendJson(res, 200, updated);
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Unable to update checklist state.' });
    }
    return;
  }

  if (req.method === 'GET' && (pathname === '/' || pathname === '/clark-and-co-business-plan.html')) {
    try {
      const html = await fs.readFile(HTML_FILE, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Unable to read HTML file.');
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

const server = http.createServer(async (req, res) => {
  try {
    await requestHandler(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error?.message || 'Internal server error' });
  }
});

module.exports = async (req, res) => {
  try {
    await requestHandler(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error?.message || 'Internal server error' });
  }
};

if (require.main === module) {
  server.listen(PORT, async () => {
    await ensureStateFile();
    console.log(`Clark & Co server listening on http://localhost:${PORT}`);
  });
}
