import fs from 'fs';
import path from 'path';

export const dbFile = path.resolve('./db.json');

// In-memory Database
export let db = {
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
export function saveDb() {
  try {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('[DB] Failed to save database', e);
  }
}

// Helper to match identifier from incoming request (supports host subdomains, path segments, query parameters, and body)
export function findIdentifier(str, req, urlObj, body) {
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
