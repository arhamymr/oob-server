#!/bin/bash
# OOB Server VPS Automated Setup Script
# Installs Node.js, PM2, Nginx, configures system environments, and sets up firewall rules.

set -euo pipefail

# Make sure we run as root
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run this script as root (sudo ./setup.sh)"
  exit 1
fi

echo "[*] Starting OOB Server environment installation..."

# 1. Update and install core system utilities
echo "[*] Updating apt repositories and installing tools..."
apt-get update -y
apt-get install -y curl git ufw nginx certbot python3-certbot-nginx

# 2. Install Node.js LTS (current Node 20 LTS)
echo "[*] Installing Node.js LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Verify node installation
node_ver=$(node -v)
echo "[+] Node.js installed successfully: $node_ver"

# 3. Install PM2 globally for process management
echo "[*] Installing PM2 process manager..."
npm install -g pm2

# 4. Open required firewall ports (HTTP/HTTPS and custom DNS UDP)
echo "[*] Configuring UFW Firewall rules..."
ufw allow 22/tcp       # SSH
ufw allow 80/tcp       # HTTP
ufw allow 443/tcp      # HTTPS
ufw allow 3007/tcp     # Local OOB API port (optional backup)
ufw allow 53/udp       # DNS UDP port
ufw allow 5354/udp     # Fallback DNS UDP port
ufw --force enable

# 5. Handle environment setup
if [ ! -f .env ]; then
  echo "[*] Initializing default .env configuration..."
  # Generate a secure 32-character API key
  secure_api_key=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
  
  cat <<EOF > .env
# OOB Server Configuration
OOB_DOMAIN=localhost
OOB_API_KEY=$secure_api_key
OOB_HTTP_PORT=3007
OOB_DNS_PORT=5354
EOF
  echo "[+] Default .env created with API Key: $secure_api_key"
else
  echo "[+] Existing .env file detected, preserving configuration."
fi

# 6. Install dependencies
echo "[*] Installing npm dependencies..."
npm install

# 7. Start the server under PM2
echo "[*] Starting OOB Server process with PM2..."
pm2 start server.js --name "oob-server"
pm2 save
pm2 startup

# 8. Setup Nginx reverse proxy template (Optional hint)
echo "=========================================================================="
echo "[+] Installation complete!"
echo "[+] OOB Server is running as background service under PM2."
echo "=========================================================================="
echo "Next Steps to expose to internet with domain:"
echo "1. Update OOB_DOMAIN in the .env file with your public domain name."
echo "2. If binding DNS on standard port 53, update OOB_DNS_PORT=53 in .env and restart: pm2 restart oob-server"
echo "3. Run: certbot --nginx -d yourdomain.com -d *.yourdomain.com"
echo "4. PM2 Status Dashboard: pm2 status"
echo "5. API Key for Tauri App connection: $(grep OOB_API_KEY .env | cut -d'=' -f2)"
echo "=========================================================================="
