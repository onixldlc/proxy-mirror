const http = require('http');
const https = require('https');
const { loadAllConfigs } = require('./config-parser');
const { buildRewriter } = require('./rewriter');
const Router = require('./router');

// ── Settings ──────────────────────────────────────────────
const CONF_DIR = process.env.CONF_DIR || './conf';
const LOCAL_PORT = parseInt(process.env.LOCAL_PORT || '3000', 10);

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailers',
  'transfer-encoding', 'upgrade',
]);

// ── Bootstrap ─────────────────────────────────────────────
const configs = loadAllConfigs(CONF_DIR);

if (configs.length === 0) {
  console.error('[FATAL] No valid site configs loaded. Exiting.');
  process.exit(1);
}

const router = new Router(configs);

// Pre-build a rewriter per site
const rewriters = new Map();
for (const cfg of configs) {
  rewriters.set(cfg.localSubdomain, buildRewriter(cfg, LOCAL_PORT));
}

// ── Request handler ───────────────────────────────────────
function handleRequest(req, res) {
  // Handle CORS preflight globally
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'access-control-allow-headers': '*',
      'access-control-max-age': '86400',
    });
    return res.end();
  }

  // ── Route lookup ──
  const siteConfig = router.resolve(req);

  if (!siteConfig) {
    // No matching config — show a helpful landing page
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(landingPage());
  }

  const upstream = router.getUpstream(siteConfig, req.url);
  const rewrite = rewriters.get(siteConfig.localSubdomain);

  // ── Build upstream request ──
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k)) headers[k] = v;
  }
  headers.host = upstream.host;
  delete headers['accept-encoding']; // we need raw body for rewriting

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
    `${upstream.host}${upstream.path}`
  );

  const proxyReq = transport.request(options, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', c => chunks.push(c));
    proxyRes.on('end', () => {
      let body = Buffer.concat(chunks);
      const contentType = proxyRes.headers['content-type'] || '';

      // Rewrite body
      body = rewrite(body, contentType);

      // Build response headers
      const resHeaders = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (!HOP_BY_HOP.has(k)) resHeaders[k] = v;
      }

      // Remove security headers from config
      for (const h of siteConfig.headersRemove) {
        delete resHeaders[h];
      }

      // Add custom headers from config
      for (const [k, v] of Object.entries(siteConfig.headersAdd)) {
        resHeaders[k] = v;
      }

      // Fix content-length after rewrite
      resHeaders['content-length'] = body.length;

      // Rewrite Location header on redirects
      if (resHeaders.location) {
        resHeaders.location = resHeaders.location
          .replace(
            new RegExp(`https?://${escapeRegex(siteConfig.targetHost)}`, 'g'),
            `http://${siteConfig.localSubdomain}:${LOCAL_PORT}`
          );
        // Also rewrite rewrite-hosts in Location
        for (const rw of siteConfig.rewrites) {
          resHeaders.location = resHeaders.location.replace(
            new RegExp(`https?://${escapeRegex(rw.externalHost)}`, 'g'),
            `http://${siteConfig.localSubdomain}:${LOCAL_PORT}${rw.localPathPrefix}`
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
  const rows = router.listRoutes().map(c =>
    `<tr>
      <td><strong>${c.name}</strong></td>
      <td><a href="http://${c.localSubdomain}:${LOCAL_PORT}">
        ${c.localSubdomain}:${LOCAL_PORT}</a></td>
      <td>${c.targetHost}</td>
    </tr>`
  ).join('\n');

  return `<!DOCTYPE html>
<html><head><title>Local Gateway Proxy</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
</style></head>
<body>
  <h1>🌐 Local Gateway Proxy</h1>
  <p>No site matched your <code>Host</code> header. Available sites:</p>
  <table>
    <tr><th>Name</th><th>Local Address</th><th>Upstream</th></tr>
    ${rows}
  </table>
  <h3>Setup</h3>
  <p>Add these lines to <code>/etc/hosts</code>:</p>
  <pre>${router.listRoutes().map(c => `127.0.0.1  ${c.localSubdomain}`).join('\n')}</pre>
</body></html>`;
}

// ── Start ─────────────────────────────────────────────────
const server = http.createServer(handleRequest);

server.listen(LOCAL_PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║              Local Gateway Proxy Running                       ║
╠════════════════════════════════════════════════════════════════╣
║  Port:     ${String(LOCAL_PORT).padEnd(48)}║
║  Configs:  ${String(configs.length + ' sites loaded').padEnd(48)}║
╠════════════════════════════════════════════════════════════════╣`);

  for (const c of configs) {
    const line = `  ${c.name.padEnd(10)} http://${c.localSubdomain}:${LOCAL_PORT}`;
    console.log(`║${line.padEnd(60)}║`);
    console.log(`║${'            => ' + c.targetProtocol + '://' + c.targetHost}${''.padEnd(60 - 15 - c.targetProtocol.length - 3 - c.targetHost.length)}║`);
  }

  console.log(`╚════════════════════════════════════════════════════════════════╝

Add to /etc/hosts:
${router.listRoutes().map(c => `  127.0.0.1  ${c.localSubdomain}`).join('\n')}
  `);
});