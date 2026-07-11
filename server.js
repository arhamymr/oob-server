import { startHttpServer } from './src/http.js';
import { startDnsServer } from './src/dns.js';

// ponytail: keep root entrypoint simple - just bootstrap the services
startHttpServer();
startDnsServer();
