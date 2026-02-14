const http = require('http');
const https = require('https');
const tls = require('tls');
const { loadAllConfigs } = require('./config-parser');
const { buildRewriter } = require('./rewriter');
const { buildCookieHandler } = require('./cookie-handler');
const { generateAllCerts } = require('./cert-generator');
const Router = require('./router');

// ── Settings ──────────────────────────────────────────────
const CONF_DIR = process.env.CONF_DIR || './conf';
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '80', 10);
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '443', 10);

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailers',
  'transfer-encoding', 'upgrade',
]);

const FALLBACK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// ── Bootstrap ─────────────────────────────────────────────
const configs = loadAllConfigs(CONF_DIR);

if (configs.length === 0) {
  console.error('[FATAL] No valid site configs loaded. Exiting.');
  process.exit(1);
}

const httpsConfigs = configs.filter(c => c.targetProtocol === 'https');
const httpConfigs = configs.filter(c => c.targetProtocol !== 'https');

let certMap = new Map();
if (httpsConfigs.length > 0) {
  console.log('\n[CERT] Generating certificates for HTTPS sites...');
  certMap = generateAllCerts(httpsConfigs);
}

const router = new Router(configs);

const rewriters = new Map();
const cookieHandlers = new Map();

for (const cfg of configs) {
  const port = cfg.targetProtocol === 'https' ? HTTPS_PORT : HTTP_PORT;
  rewriters.set(cfg.localSubdomain, buildRewriter(cfg, port));
  cookieHandlers.set(cfg.localSubdomain, buildCookieHandler(cfg));
}

// ── Core proxy logic ──────────────────────────────────────
function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'access-control-allow-headers': '*',
      'access-control-max-age': '86400',
    });
    return res.end();
  }

  const siteConfig = router.resolve(req);

  if (!siteConfig) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(landingPage());
  }

  const upstream = router.getUpstream(siteConfig, req.url);
  const rewrite = rewriters.get(siteConfig.localSubdomain);
  const cookies = cookieHandlers.get(siteConfig.localSubdomain);
  const localPort = siteConfig.targetProtocol === 'https' ? HTTPS_PORT : HTTP_PORT;

  // ── Build upstream headers ──
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k)) headers[k] = v;
  }

  headers.host = upstream.host;
  delete headers['accept-encoding'];

  if (!headers['user-agent']) {
    headers['user-agent'] = FALLBACK_UA;
  }

  // ── Cookie handling: outgoing ──
  const injectCookies = cookies.getInjectCookies();
  if (injectCookies) {
    headers['cookie'] = headers['cookie']
      ? `${headers['cookie']}; ${injectCookies}`
      : injectCookies;
  }

  const transport = upstream.protocol === 'https' ? https : http;

  const options = {
    hostname: upstream.host,
    port: upstream.port,
    path: upstream.path,
    method: req.method,
    headers,
  };

  console.log(
    `[PROXY] ${siteConfig.name.padEnd(12)} ${req.method.padEnd(7)} ` +
    `${upstream.protocol}://${upstream.host}${upstream.path}`
  );

  const proxyReq = transport.request(options, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', c => chunks.push(c));
    proxyRes.on('end', () => {
      let body = Buffer.concat(chunks);
      const contentType = proxyRes.headers['content-type'] || '';

      body = rewrite(body, contentType);

      const resHeaders = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (!HOP_BY_HOP.has(k)) resHeaders[k] = v;
      }

      for (const h of siteConfig.headersRemove) {
        delete resHeaders[h];
      }

      // ── Cookie handling: incoming ──
      if (resHeaders['set-cookie']) {
        const rewritten = cookies.rewriteSetCookies(resHeaders['set-cookie']);
        if (rewritten.length > 0) {
          resHeaders['set-cookie'] = rewritten;
        } else {
          delete resHeaders['set-cookie'];
        }
      }

      for (const [k, v] of Object.entries(siteConfig.headersAdd)) {
        resHeaders[k] = v;
      }

      resHeaders['content-length'] = body.length;

      // Rewrite Location on redirects
      if (resHeaders.location) {
        const localProto = siteConfig.targetProtocol === 'https' ? 'https' : 'http';
        const localOrigin = `${localProto}://${siteConfig.localSubdomain}:${localPort}`;

        resHeaders.location = resHeaders.location.replace(
          new RegExp(`https?://${escapeRegex(siteConfig.targetHost)}`, 'g'),
          localOrigin
        );
        for (const rw of siteConfig.rewrites) {
          resHeaders.location = resHeaders.location.replace(
            new RegExp(`https?://${escapeRegex(rw.externalHost)}`, 'g'),
            `${localOrigin}${rw.localPathPrefix}`
          );
        }
      }

      res.writeHead(proxyRes.statusCode, resHeaders);
      res.end(body);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[ERROR] ${siteConfig.name}: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Proxy Error (${siteConfig.name}): ${err.message}`);
  });

  req.on('data', c => proxyReq.write(c));
  req.on('end', () => proxyReq.end());
}

// ── Helpers ───────────────────────────────────────────────
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function landingPage() {
  const rows = router.listRoutes().map(c => {
    const proto = c.targetProtocol === 'https' ? 'https' : 'http';
    const port = c.targetProtocol === 'https' ? HTTPS_PORT : HTTP_PORT;
    return `<tr>
      <td><strong>${c.name}</strong></td>
      <td><a href="${proto}://${c.localSubdomain}:${port}">
        ${c.localSubdomain}:${port}</a></td>
      <td>${c.targetProtocol}://${c.targetHost}</td>
      <td>${proto.toUpperCase()}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html><head><title>Local Gateway Proxy</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
  .warn { background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 4px; margin: 16px 0; }
</style></head>
<body>
  <h1>🌐 Local Gateway Proxy</h1>
  <div class="warn">
    ⚠️ <strong>Notice:</strong> All traffic through this gateway is monitored.
    Self-signed certificates are used intentionally.
  </div>
  <p>No site matched your <code>Host</code> header. Available sites:</p>
  <table>
    <tr><th>Name</th><th>Local Address</th><th>Upstream</th><th>Protocol</th></tr>
    ${rows}
  </table>
  <h3>Setup</h3>
  <p>Add these lines to <code>/etc/hosts</code>:</p>
  <pre>${router.listRoutes().map(c => `127.0.0.1  ${c.localSubdomain}`).join('\n')}</pre>
</body></html>`;
}

// ── Start servers ─────────────────────────────��───────────

if (httpsConfigs.length > 0) {
  const defaultCert = certMap.values().next().value;

  const httpsServer = https.createServer(
    {
      key: defaultCert.key,
      cert: defaultCert.cert,
      SNICallback: (servername, cb) => {
        const siteCert = certMap.get(servername);
        if (siteCert) {
          cb(null, tls.createSecureContext({
            key: siteCert.key,
            cert: siteCert.cert,
          }));
        } else {
          cb(null, tls.createSecureContext({
            key: defaultCert.key,
            cert: defaultCert.cert,
          }));
        }
      },
    },
    handleRequest
  );

  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`[SERVER] HTTPS listening on port ${HTTPS_PORT}`);
  });
}

const httpServer = http.createServer((req, res) => {
  const siteConfig = router.resolve(req);

  if (siteConfig && siteConfig.targetProtocol === 'https') {
    const location = `https://${siteConfig.localSubdomain}:${HTTPS_PORT}${req.url}`;
    res.writeHead(301, { Location: location });
    return res.end();
  }

  handleRequest(req, res);
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`[SERVER] HTTP  listening on port ${HTTP_PORT}`);
});

// ── Startup banner ─────────────────��──────────────────────
console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                   Local Gateway Proxy Running                        ║
╠══════════════════════════════════════════════════════════════════════╣
║  HTTP:   port ${String(HTTP_PORT).padEnd(53)}║
║  HTTPS:  port ${String(HTTPS_PORT).padEnd(53)}║
║  Sites:  ${String(configs.length + ' loaded').padEnd(58)}║
╠══════════════════════════════════════════════════════════════════════╣`);

for (const c of configs) {
  const proto = c.targetProtocol === 'https' ? 'https' : 'http';
  const port = c.targetProtocol === 'https' ? HTTPS_PORT : HTTP_PORT;
  const local = `${proto}://${c.localSubdomain}:${port}`;
  const upstream = `${c.targetProtocol}://${c.targetHost}`;
  console.log(`║  ${c.name.padEnd(10)} ${local.padEnd(50)} ║`);
  console.log(`║  ${''.padEnd(10)} => ${upstream.padEnd(47)}║`);
}

console.log(`╠══════════════════════════════════════════════════════════════════════╣
║  ⚠️  Self-signed certs = browser warnings = monitoring notice       ║
║  📁 CA cert: ./certs/ca.crt (install to trust, or don't)            ║
╚══════════════════════════════════════════════════════════════════════╝

/etc/hosts:
${router.listRoutes().map(c => `  127.0.0.1  ${c.localSubdomain}`).join('\n')}
`);