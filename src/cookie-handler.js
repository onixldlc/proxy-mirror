/**
 * Handles bidirectional cookie domain rewriting.
 * Only rewrites the domain= attribute. Everything else untouched.
 */

function parseCookie(raw) {
  const parts = raw.split(';').map(p => p.trim());
  const nameValue = parts[0];
  const attributes = new Map();

  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf('=');
    if (eqIdx === -1) {
      attributes.set(parts[i].toLowerCase(), true);
    } else {
      const key = parts[i].slice(0, eqIdx).trim().toLowerCase();
      const val = parts[i].slice(eqIdx + 1).trim();
      attributes.set(key, val);
    }
  }

  return { nameValue, attributes };
}

function serializeCookie({ nameValue, attributes }) {
  let result = nameValue;

  for (const [key, val] of attributes) {
    if (val === true) {
      result += `; ${key}`;
    } else {
      result += `; ${key}=${val}`;
    }
  }

  return result;
}

function buildCookieHandler(siteConfig) {
  // Collect ALL upstream domains — explicit + wildcard roots
  const upstreamDomains = [
    siteConfig.targetHost,
    ...siteConfig.rewrites.map(r => r.externalHost),
  ];

  // Root domains from explicit hosts
  const rootDomains = [...new Set(
    upstreamDomains.map(d => {
      const parts = d.split('.');
      return parts.length >= 2
        ? parts.slice(-2).join('.')
        : d;
    })
  )];

  // Add wildcard root domains
  for (const wc of siteConfig.wildcardRewrites) {
    const parts = wc.rootDomain.split('.');
    const root = parts.length >= 2
      ? parts.slice(-2).join('.')
      : wc.rootDomain;
    if (!rootDomains.includes(root)) {
      rootDomains.push(root);
    }
  }

  function rewriteSetCookies(setCookieHeaders) {
    if (!setCookieHeaders) return [];

    const cookies = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : [setCookieHeaders];

    return cookies.map(raw => {
      const parsed = parseCookie(raw);

      if (parsed.attributes.has('domain')) {
        const originalDomain = parsed.attributes.get('domain')
          .replace(/^\./, '');

        const matches = rootDomains.some(root =>
          originalDomain === root || originalDomain.endsWith('.' + root)
        );

        if (matches) {
          parsed.attributes.set('domain', siteConfig.localSubdomain);
        }
      } else {
        parsed.attributes.set('domain', siteConfig.localSubdomain);
      }

      return serializeCookie(parsed);
    });
  }

  function getInjectCookies() {
    return siteConfig.injectCookie || '';
  }

  return {
    rewriteSetCookies,
    getInjectCookies,
  };
}

module.exports = { buildCookieHandler, parseCookie, serializeCookie };