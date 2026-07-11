import dgram from 'dgram';
import { dnsPort } from './config.js';
import { db, saveDb, findIdentifier } from './db.js';

// Helper to decode DNS QNAME (zero-dependency standard DNS format query decoder)
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

export function startDnsServer() {
  const dnsServer = dgram.createSocket('udp4');

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

  return dnsServer;
}
