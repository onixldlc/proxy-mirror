const TEXT_CONTENT_TYPES = [
  'text/html',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/json',
  'application/xml',
  'text/xml',
  'text/plain',
  'application/xhtml+xml',
];

function isTextContent(contentType) {
  if (!contentType) return false;
  return TEXT_CONTENT_TYPES.some(t => contentType.includes(t));
}

/**
 * Builds a rewrite function for a given site config.
 */
function buildRewriter(siteConfig, localPort) {
  const localProtocol = siteConfig.targetProtocol === 'https' ? 'https' : 'http';
  const localOrigin = `${localProtocol}://${siteConfig.localSubdomain}:${localPort}`;
  const localHostPort = `${siteConfig.localSubdomain}:${localPort}`;

  // Pre-compute static replacement pairs
  const replacements = [];

  // Main target host
  replacements.push(
    { from: `https://${siteConfig.targetHost}`, to: localOrigin },
    { from: `http://${siteConfig.targetHost}`, to: localOrigin },
    { from: `//${siteConfig.targetHost}`, to: `//${localHostPort}` },
  );

  // Explicit rewrites
  for (const rw of siteConfig.rewrites) {
    const localRewriteOrigin = `${localOrigin}${rw.localPathPrefix}`;
    replacements.push(
      { from: `https://${rw.externalHost}`, to: localRewriteOrigin },
      { from: `http://${rw.externalHost}`, to: localRewriteOrigin },
      { from: `//${rw.externalHost}`, to: `//${localHostPort}${rw.localPathPrefix}` },
    );
  }

  // Build wildcard regex replacers
  // e.g., *.google.com = /g
  // https://lensfrontend-pa.clients6.google.com/v1/foo
  //   → https://google.localgateway.com:443/g--lensfrontend-pa.clients6/v1/foo
  const wildcardReplacers = siteConfig.wildcardRewrites.map(wc => {
    const escapedRoot = wc.rootDomain.replace(/\./g, '\\.');
    return {
      // Match https://anything.rootdomain.com or http:// or //
      regex: new RegExp(
        `(https?:)?//([a-zA-Z0-9._-]+)\\.${escapedRoot}`,
        'g'
      ),
      localPathPrefix: wc.localPathPrefix,
      rootDomain: wc.rootDomain,
    };
  });

  return function rewrite(body, contentType) {
    if (!siteConfig.rewriteContent) return body;
    if (!isTextContent(contentType)) return body;
    if (!body || body.length === 0) return body;

    let content = body.toString('utf8');

    // Apply static replacements
    for (const { from, to } of replacements) {
      content = content.split(from).join(to);
    }

    // Apply wildcard replacements
    for (const wc of wildcardReplacers) {
      content = content.replace(wc.regex, (match, protocol, subdomain) => {
        const proto = protocol || `${localProtocol}:`;
        return `${proto}//${localHostPort}${wc.localPathPrefix}--${subdomain}`;
      });
    }

    return Buffer.from(content, 'utf8');
  };
}

module.exports = { buildRewriter, isTextContent };