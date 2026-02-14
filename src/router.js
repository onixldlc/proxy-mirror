/**
 * Routes incoming requests to the correct site config
 * based on the Host header, and resolves the upstream
 * target host (handling rewrite path prefixes and wildcards).
 */

class Router {
  constructor(configs) {
    this.routeMap = new Map();

    for (const config of configs) {
      this.routeMap.set(config.localSubdomain, config);
    }
  }

  resolve(req) {
    const hostHeader = (req.headers.host || '').split(':')[0];
    return this.routeMap.get(hostHeader) || null;
  }

  /**
   * Given a site config and the request path, determine
   * the actual upstream host and rewritten path.
   *
   * Checks explicit rewrites first (longest prefix match),
   * then wildcard rewrites.
   *
   * For wildcards: *.google.com = /g
   *   /g--lensfrontend-pa-clients6/v1/gsessionid
   *   → host: lensfrontend-pa.clients6.google.com
   *     path: /v1/gsessionid
   *
   * The subdomain is encoded in the path segment after the
   * wildcard prefix, with dots replaced by dashes and a
   * double-dash separating subdomain levels.
   */
  getUpstream(siteConfig, requestPath) {
    // 1. Check explicit rewrites (longest prefix match)
    const sorted = [...siteConfig.rewrites].sort(
      (a, b) => b.localPathPrefix.length - a.localPathPrefix.length
    );

    for (const rw of sorted) {
      if (requestPath.startsWith(rw.localPathPrefix + '/') || requestPath === rw.localPathPrefix) {
        return {
          host: rw.externalHost,
          path: requestPath.slice(rw.localPathPrefix.length) || '/',
          protocol: siteConfig.targetProtocol,
          port: siteConfig.targetPort,
        };
      }
    }

    // 2. Check wildcard rewrites
    for (const wc of siteConfig.wildcardRewrites) {
      const prefix = wc.localPathPrefix + '--';
      if (requestPath.startsWith(prefix)) {
        // Extract encoded subdomain from path
        // /g--lensfrontend-pa.clients6/v1/foo
        const afterPrefix = requestPath.slice(prefix.length);
        const slashIdx = afterPrefix.indexOf('/');

        let encodedSub, remainingPath;
        if (slashIdx === -1) {
          encodedSub = afterPrefix;
          remainingPath = '/';
        } else {
          encodedSub = afterPrefix.slice(0, slashIdx);
          remainingPath = afterPrefix.slice(slashIdx);
        }

        // Decode: dots are preserved as-is in the URL path
        const subdomain = encodedSub;
        const host = `${subdomain}.${wc.rootDomain}`;

        return {
          host,
          path: remainingPath,
          protocol: siteConfig.targetProtocol,
          port: siteConfig.targetPort,
        };
      }
    }

    // 3. Default: main target host
    return {
      host: siteConfig.targetHost,
      path: requestPath,
      protocol: siteConfig.targetProtocol,
      port: siteConfig.targetPort,
    };
  }

  listRoutes() {
    return [...this.routeMap.values()];
  }
}

module.exports = Router;