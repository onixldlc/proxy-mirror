/**
 * Rewrites URLs in response bodies so that the client
 * stays on the local proxy instead of being redirected
 * to the real upstream host.
 */

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
 *
 * @param {object} siteConfig - parsed config from config-parser
 * @param {number} localPort  - the port the proxy is listening on
 * @returns {function(Buffer, string): Buffer}
 */
function buildRewriter(siteConfig, localPort) {
  const localOrigin = `http://${siteConfig.localSubdomain}:${localPort}`;

  // Pre-compute all replacement pairs
  const replacements = [];

  // Main target host
  replacements.push(
    { from: `https://${siteConfig.targetHost}`, to: localOrigin },
    { from: `http://${siteConfig.targetHost}`, to: localOrigin },
    { from: `//${siteConfig.targetHost}`, to: `//${siteConfig.localSubdomain}:${localPort}` },
  );

  // Rewrite hosts (subdomains like api.github.com -> /api)
  for (const rw of siteConfig.rewrites) {
    const localRewriteOrigin = `${localOrigin}${rw.localPathPrefix}`;
    replacements.push(
      { from: `https://${rw.externalHost}`, to: localRewriteOrigin },
      { from: `http://${rw.externalHost}`, to: localRewriteOrigin },
      { from: `//${rw.externalHost}`, to: `//${siteConfig.localSubdomain}:${localPort}${rw.localPathPrefix}` },
    );
  }

  return function rewrite(body, contentType) {
    if (!siteConfig.rewriteContent) return body;
    if (!isTextContent(contentType)) return body;
    if (!body || body.length === 0) return body;

    let content = body.toString('utf8');

    for (const { from, to } of replacements) {
      content = content.split(from).join(to);
    }

    return Buffer.from(content, 'utf8');
  };
}

module.exports = { buildRewriter, isTextContent };