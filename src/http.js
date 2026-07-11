import http from 'http';
import { domain, apiKey, httpPort } from './config.js';
import { db, saveDb, findIdentifier } from './db.js';

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

export function startHttpServer() {
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

  return httpServer;
}
