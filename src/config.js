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
export const domain = process.argv[2] || process.env.OOB_DOMAIN || 'localhost';
export const apiKey = process.argv[3] || process.env.OOB_API_KEY || 'password';
export const httpPort = parseInt(process.argv[4] || process.env.OOB_HTTP_PORT || '3007', 10);
export const dnsPort = parseInt(process.argv[5] || process.env.OOB_DNS_PORT || '5353', 10);
