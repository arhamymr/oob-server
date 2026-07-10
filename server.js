import http from 'http';
import dgram from 'dgram';
import fs from 'fs';
import path from 'path';

// ponytail: simple zero-dependency .env loader
if (fs.existsSync('.env')) {
  try {
    const envContent = fs.readFileSync('.env', 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        process.env[key] = val;
      }
    }
  } catch (e) {
    console.error('[ENV] Failed to load .env file', e);
  }
}

// Configuration (supports .env, command line args, or defaults)
const domain = process.argv[2] || process.env.OOB_DOMAIN || 'localhost';
const apiKey = process.argv[3] || process.env.OOB_API_KEY || 'password';
const httpPort = parseInt(process.argv[4] || process.env.OOB_HTTP_PORT || '3007', 10);
const dnsPort = parseInt(process.argv[5] || process.env.OOB_DNS_PORT || '5353', 10); // fallback to 5353 if non-root

const dbFile = path.resolve('./db.json');

// In-memory Database
let db = {
  payloads: [],      // [{ identifier, name, payload_url }]
  interactions: [],  // [{ id, identifier, interaction_type, source_ip, method, path, headers, raw_request, request_body, server_response, timestamp }]
};

// Load database if exists
if (fs.existsSync(dbFile)) {
  try {
    db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    console.log(`[DB] Loaded database with ${db.payloads.length} payloads and ${db.interactions.length} interactions.`);
  } catch (e) {
    console.error('[DB] Failed to parse db.json, starting fresh', e);
  }
}

// Save database
function saveDb() {
  try {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('[DB] Failed to save database', e);
  }
}

// Helper to check API Key
function authorize(req, res) {
  const reqKey = req.headers['x-api-key'];
  if (reqKey !== apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: Invalid X-API-Key' }));
    return false;
  }
  return true;
}

// Helper to match identifier from incoming request (supports host subdomains, path segments, query parameters, and body)
function findIdentifier(str, req, urlObj, body) {
  if (!str) return null;
  const strLower = str.toLowerCase();

  for (const p of db.payloads) {
    const idLower = p.identifier.toLowerCase();

    // 1. Direct match on host header/subdomain or primary query string
    if (strLower.includes(idLower)) {
      return p.identifier;
    }

    // 2. Deep check request headers (Host header routing)
    if (req) {
      const host = (req.headers.host || '').toLowerCase();
      if (host.includes(idLower)) return p.identifier;
    }

    // 3. Deep check URL components (pathname and search params)
    if (urlObj) {
      if (urlObj.pathname.toLowerCase().includes(idLower)) return p.identifier;
      if (urlObj.search.toLowerCase().includes(idLower)) return p.identifier;
      
      // Match query values (e.g. ?token=ybx7oc)
      for (const val of urlObj.searchParams.values()) {
        if (val.toLowerCase().includes(idLower)) return p.identifier;
      }
    }

    // 4. Check POST request body content
    if (body && body.toLowerCase().includes(idLower)) {
      return p.identifier;
    }
  }
  return null;
}

// ── HTTP API & CALLBACK SERVER ─────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // Setup CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 1. API: Health Check
  if (pathname === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // 2. API: Create/Register Payload
  if (pathname === '/api/payloads' && req.method === 'POST') {
    if (!authorize(req, res)) return;

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const identifier = data.identifier || Math.random().toString(36).substring(2, 8);
        const payloadUrl = domain === 'localhost' 
          ? `${identifier}.localhost:${httpPort}`
          : `${identifier}.${domain}`;

        // ponytail: check if identifier already exists to prevent duplicate entries
        let payload = db.payloads.find(p => p.identifier === identifier);
        if (!payload) {
          payload = {
            id: Math.random().toString(36).substring(2, 15),
            serverId: 'custom-server',
            identifier,
            payloadUrl,
            name: data.name || `Payload ${identifier}`,
            description: '',
            interactionCount: 0,
            status: 'active',
            createdAt: new Date().toISOString(),
            lastSeenAt: null
          };
          db.payloads.push(payload);
          saveDb();
        }

        console.log(`[API] Registered payload: ${identifier} -> ${payloadUrl}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          identifier,
          payload_url: payloadUrl
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON request body' }));
      }
    });
    return;
  }

  // 3. API: List/Poll Interactions
  if (pathname === '/api/interactions' && req.method === 'GET') {
    if (!authorize(req, res)) return;

    const identifier = urlObj.searchParams.get('identifier');
    if (!identifier) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing query parameter: identifier' }));
      return;
    }

    // ponytail: auto-sync check. If client is polling for a payload we don't have, auto-register it!
    const exists = db.payloads.some(p => p.identifier.toLowerCase() === identifier.toLowerCase());
    if (!exists) {
      const payloadUrl = domain === 'localhost' 
        ? `${identifier}.localhost:${httpPort}`
        : `${identifier}.${domain}`;

      const payload = {
        id: Math.random().toString(36).substring(2, 15),
        serverId: 'custom-server',
        identifier,
        payloadUrl,
        name: `Auto-Sync Payload ${identifier}`,
        description: 'Auto-registered during polling sync',
        interactionCount: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
        lastSeenAt: null
      };

      db.payloads.push(payload);
      saveDb();
      console.log(`[API] Auto-sync registered payload: ${identifier} -> ${payloadUrl}`);
    }

    // Filter interactions matching the payload identifier
    const matched = db.interactions.filter(i => i.identifier.toLowerCase() === identifier.toLowerCase());

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(matched));
    return;
  }

  // 4. Callback: Catch any other requests (HTTP logs)
  let matchedIdentifier = findIdentifier(req.headers.host, req, urlObj, null) || 
                          findIdentifier(pathname, req, urlObj, null) || 
                          findIdentifier(urlObj.search, req, urlObj, null);

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    // If no identifier matched, we try to match from the parsed request body
    if (!matchedIdentifier) {
      matchedIdentifier = findIdentifier(body, req, urlObj, body);
    }

    // ponytail: fallback to log to ALL active payloads if no specific ID is found
    const targetIdentifiers = matchedIdentifier
      ? [matchedIdentifier]
      : db.payloads.filter(p => p.status === 'active').map(p => p.identifier);

    if (targetIdentifiers.length > 0) {
      const serverResponse = 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nRecorded.';
      
      for (const idf of targetIdentifiers) {
        const newInteraction = {
          id: Math.random().toString(36).substring(2, 15),
          identifier: idf,
          interaction_type: 'http',
          source_ip: req.socket.remoteAddress || '127.0.0.1',
          method: req.method,
          path: req.url,
          headers: JSON.stringify(req.headers),
          raw_request: `${req.method} ${req.url} HTTP/1.1\r\n` +
            Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
            '\r\n\r\n' + body,
          request_body: body || null,
          server_response: serverResponse,
          timestamp: new Date().toISOString()
        };
        db.interactions.push(newInteraction);
      }
      saveDb();

      console.log(`[HTTP] Logged interaction for ${targetIdentifiers.length} payload(s) from ${req.socket.remoteAddress || '127.0.0.1'}`);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Recorded.\n');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('OOB Listener Server. Send HTTP callbacks containing your registered payload identifier.\n');
    }
  });
});

httpServer.listen(httpPort, () => {
  console.log(`[HTTP] Server listening on http://localhost:${httpPort}`);
  console.log(`[HTTP] Configured Domain: ${domain}`);
});


// ── DNS UDP SERVER (ZERO-DEPENDENCY PARSER) ────────────────────────
const dnsServer = dgram.createSocket('udp4');

function parseQname(buffer, offset) {
  const parts = [];
  let curr = offset;
  while (curr < buffer.length) {
    const len = buffer[curr];
    if (len === 0) {
      curr++;
      break;
    }
    // Handle DNS compression pointers (0xC0) in QNAME
    if ((len & 0xC0) === 0xC0) {
      curr += 2;
      break;
    }
    curr++;
    parts.push(buffer.toString('utf8', curr, curr + len));
    curr += len;
  }
  return { domain: parts.join('.'), nextOffset: curr };
}

dnsServer.on('message', (msg, rinfo) => {
  try {
    if (msg.length < 12) return; // invalid DNS header

    // Parse DNS transaction ID (bytes 0-1) and questions count (bytes 4-5)
    const questionsCount = msg.readUInt16BE(4);
    if (questionsCount === 0) return;

    // Decode QNAME (domain query) starting at byte 12
    const { domain: qnameDomain } = parseQname(msg, 12);

    if (qnameDomain) {
      console.log(`[DNS] Received query for: ${qnameDomain} from ${rinfo.address}`);

      const matchedIdentifier = findIdentifier(qnameDomain);
      const targetIdentifiers = matchedIdentifier
        ? [matchedIdentifier]
        : db.payloads.filter(p => p.status === 'active').map(p => p.identifier);

      if (targetIdentifiers.length > 0) {
        for (const idf of targetIdentifiers) {
          const newInteraction = {
            id: Math.random().toString(36).substring(2, 15),
            identifier: idf,
            interaction_type: 'dns',
            source_ip: rinfo.address,
            method: null,
            path: null,
            headers: null,
            raw_request: `DNS Query: ${qnameDomain}`,
            request_body: null,
            server_response: null,
            timestamp: new Date().toISOString()
          };
          db.interactions.push(newInteraction);
        }
        saveDb();
        console.log(`[DNS] Logged DNS interaction for ${targetIdentifiers.length} payload(s)`);
      }
    }

    // Build and send standard response: NOERROR Standard query response
    // Transaction ID (bytes 0-1) is copied. QR bit is set to 1.
    const qnameEnd = 12 + msg.slice(12).indexOf(0x00);
    if (qnameEnd > 12 && qnameEnd < msg.length) {
      const response = Buffer.alloc(qnameEnd + 5);
      msg.copy(response, 0, 0, qnameEnd + 5);
      response[2] = 0x81; // Response flags QR=1
      response[3] = 0x80; // Response flags RCODE=0 (NOERROR)
      dnsServer.send(response, rinfo.port, rinfo.address);
    }
  } catch (err) {
    console.error('[DNS] Error parsing query', err);
  }
});

dnsServer.on('error', (err) => {
  console.error('[DNS] Socket error:', err.message);
  if (err.code === 'EACCES') {
    console.warn(`[DNS] Port ${dnsPort} requires root privileges. Restart server as root or configure a higher port.`);
  }
});

dnsServer.bind(dnsPort, () => {
  console.log(`[DNS] Server listening on UDP port ${dnsPort}`);
});
