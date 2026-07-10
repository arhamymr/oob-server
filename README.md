# Out-of-Band (OOB) Interaction Server

A zero-dependency, lightweight Node.js server that logs incoming HTTP and DNS queries to test for Out-of-Band (OOB) vulnerabilities (like SSRF, Blind SQL injection, and XXE).

## Features
- **HTTP / API Server**: Exposes API endpoints for checking health, creating callback payloads, and retrieving logged interactions.
- **DNS Server**: Runs a native UDP DNS resolver to capture name queries containing registered payload identifiers.
- **Local Persistence**: Stores registered payloads and logged interactions in a flat `db.json` file.

## Quick Start

### 1. Run the Server
Run the server with Node.js:
```bash
node server.js <domain> <api_key> <http_port> <dns_port>
```

**Example (Local Development):**
```bash
node server.js localhost password 3000 5353
```

- **Domain**: `localhost` (subdomain routing will fall back to using port matching).
- **API Key**: `password` (used in `X-API-Key` headers for authorization).
- **HTTP Port**: `3000` (port the HTTP API and HTTP callback receiver bind to).
- **DNS Port**: `5353` (UDP port the mock DNS server binds to. Use `53` in production if running with root privileges).

## Integrating with Hexbuffer (Apsara Cyber Tools)

1. Open Apsara Cyber Tools.
2. Navigate to the **Listener** page.
3. In the **Hosts** tab, click **Add Host**:
   - **Name**: `Local OOB Server`
   - **Host URL**: `http://localhost:3000`
   - **API Key**: `password` (or whatever API key you started the server with)
4. Click **Connect Host**.
5. Once connected, click **Generate URL** on the card to generate a test callback URL (e.g. `ybx7oc.localhost:3000`).

## Testing Callbacks

### Test HTTP Callback
Trigger an HTTP request to the payload domain:
```bash
curl "http://localhost:3000/trigger-test?id=ybx7oc&data=sensitive-exfiltration"
```
Or send a POST request with headers and a request body:
```bash
curl -X POST \
  -H "X-My-Header: test" \
  -d '{"exfil": "data"}' \
  "http://localhost:3000/path?id=ybx7oc"
```
Verify it is recorded in the client UI under **Interactions**.

### Test DNS Callback
Query the UDP DNS server directly:
```bash
dig @127.0.0.1 -p 5353 ybx7oc.localhost
```
Verify the DNS query name resolves and is captured under **Interactions**.
