// Zero-dependency server: serves the web app and a JSON API so real people on different phones can match.
// Usage: node server.js [--demo] [--port 3000]   (DATA_FILE=path to choose where state is saved)
import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TripService, ServiceError, createState } from './public/core/service.js';
import { seedDemo, addNearbyTraveler } from './public/core/demo.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'state.json');
const args = process.argv.slice(2);
const DEMO = args.includes('--demo');
const PORT = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const state = existsSync(DATA_FILE) ? JSON.parse(await readFile(DATA_FILE, 'utf8')) : createState();
const service = new TripService(state);
if (DEMO && !Object.values(state.riders).some((r) => r.simulated)) seedDemo(service, Date.now());

let saving = Promise.resolve();
function persist() {
  saving = saving.then(async () => {
    await mkdir(path.dirname(DATA_FILE), { recursive: true });
    await writeFile(`${DATA_FILE}.tmp`, JSON.stringify(state));
    await rename(`${DATA_FILE}.tmp`, DATA_FILE);
  });
  return saving;
}

setInterval(() => {
  if (service.tick(Date.now())) persist();
}, 1000);

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new ServiceError('Request too large.', 413);
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new ServiceError('Invalid JSON.');
  }
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

// Prototype auth: the rider id handed out at sign-up acts as a bearer token.
// Production needs real accounts (phone verification) and sessions.
const riderFrom = (req) => req.headers['x-rider-id'];

const routes = [
  ['GET', /^\/api\/health$/, () => ({ ok: true, demo: DEMO })],
  ['POST', /^\/api\/riders$/, async (req, now) => {
    const { name } = await readJson(req);
    const rider = service.createRider({ name }, now);
    return { riderId: rider.id, view: service.viewFor(rider.id, now) };
  }],
  ['GET', /^\/api\/me$/, (req, now) => service.viewFor(riderFrom(req), now)],
  ['POST', /^\/api\/trips$/, async (req, now) => {
    service.postTrip(riderFrom(req), await readJson(req), now);
    return service.viewFor(riderFrom(req), now);
  }],
  ['POST', /^\/api\/trips\/([\w]+)\/cancel$/, (req, now, [id]) => {
    service.cancelTrip(riderFrom(req), id, now);
    return service.viewFor(riderFrom(req), now);
  }],
  ['POST', /^\/api\/trips\/([\w]+)\/demo-traveler$/, (req, now, [id]) => {
    if (!DEMO) throw new ServiceError('Demo controls are off. Start the server with --demo.', 403);
    addNearbyTraveler(service, service.ownTrip(riderFrom(req), id), now);
    return service.viewFor(riderFrom(req), now);
  }],
  ['POST', /^\/api\/matches\/([\w]+)\/respond$/, async (req, now, [id]) => {
    const { accept } = await readJson(req);
    service.respond(riderFrom(req), id, accept === true, now);
    return service.viewFor(riderFrom(req), now);
  }],
  ['POST', /^\/api\/matches\/([\w]+)\/messages$/, async (req, now, [id]) => {
    const { text } = await readJson(req);
    service.sendMessage(riderFrom(req), id, text, now);
    return service.viewFor(riderFrom(req), now);
  }],
  ['POST', /^\/api\/matches\/([\w]+)\/complete$/, async (req, now, [id]) => {
    const { actualFare } = await readJson(req);
    service.completeMatch(riderFrom(req), id, Number(actualFare), now);
    return service.viewFor(riderFrom(req), now);
  }],
];

async function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, decodeURIComponent(pathname));

  for (const [method, pattern, handler] of routes) {
    const m = pathname.match(pattern);
    if (!m || req.method !== method) continue;
    try {
      const result = await handler(req, Date.now(), m.slice(1));
      if (req.method !== 'GET') await persist();
      return send(res, 200, result);
    } catch (err) {
      if (err instanceof ServiceError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'Something went wrong.' });
    }
  }
  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`SplitCab running at http://localhost:${PORT}${DEMO ? ' (demo mode: simulated travelers on)' : ''}`);
});
