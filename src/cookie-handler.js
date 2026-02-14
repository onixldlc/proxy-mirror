/**
 * Handles bidirectional cookie domain rewriting.
 *
 * Since we now serve HTTPS with self-signed certs:
 *   - Secure flag is KEPT (we're on HTTPS!)
 *   - SameSite=None is KEPT (works with Secure)
 *   - __Secure- and __Host- prefixes are KEPT (work with Secure)
 *   - Only the domain= attribute is rewritten
 *
 * Downstream (upstream → client):
 *   Set-Cookie: NID=abc; domain=.google.com; path=/; Secure; HttpOnly; SameSite=None
 *   becomes:
 *   Set-Cookie: NID=abc; domain=google.localgateway.com; path=/; Secure; HttpOnly; SameSite=None
 *
 * That's it. Just the domain. Everything else passes through.
 */

/**
 * Parse a Set-Cookie header string into its parts.
 * @param {string} raw - Raw Set-Cookie header value
 * @returns {{ nameValue: string, attributes: Map<string, string|true> }}
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

/**
 * Serialize parsed cookie back to Set-Cookie string.
 */
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

/**
 * Build a cookie rewriter for a given site config.
 *
 * @param {object} siteConfig - Parsed site config
 * @returns {{ rewriteSetCookies: function, getInjectCookies: function }}
 */
function buildCookieHandler(siteConfig) {
  const upstreamDomains = [
    siteConfig.targetHost,
    ...siteConfig.rewrites.map(r => r.externalHost),
  ];

  const rootDomains = [...new Set(
    upstreamDomains.map(d => {
      const parts = d.split('.');
      return parts.length >= 2
        ? parts.slice(-2).join('.')
        : d;
    })
  )];

  /**
   * Rewrite Set-Cookie headers from upstream response.
   * ONLY rewrites the domain= attribute. Everything else untouched.
   *
   * @param {string|string[]} setCookieHeaders
   * @returns {string[]}
   */
  function rewriteSetCookies(setCookieHeaders) {
    if (!setCookieHeaders) return [];

    const cookies = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : [setCookieHeaders];

    return cookies.map(raw => {
      const parsed = parseCookie(raw);

      // ── Rewrite domain — the ONLY thing we change ──
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

  /**
   * Get any static cookies to inject from config.
   * @returns {string}
   */
  function getInjectCookies() {
    return siteConfig.injectCookie || '';
  }

  return {
    rewriteSetCookies,
    getInjectCookies,
  };
}

module.exports = { buildCookieHandler, parseCookie, serializeCookie };