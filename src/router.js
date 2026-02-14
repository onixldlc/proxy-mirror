/**
 * Routes incoming requests to the correct site config
 * based on the Host header, and resolves the upstream
 * target host (handling rewrite path prefixes like /api -> api.github.com).
 */

class Router {
  constructor(configs) {
    // Map: localSubdomain -> siteConfig
    this.routeMap = new Map();

    for (const config of configs) {
      this.routeMap.set(config.localSubdomain, config);
    }
  }

  /**
   * Find the site config for an incoming request.
   * @param {http.IncomingMessage} req
   * @returns {object|null} siteConfig or null if no match
   */
  resolve(req) {
    const hostHeader = (req.headers.host || '').split(':')[0]; // strip port
    return this.routeMap.get(hostHeader) || null;
  }

  /**
   * Given a site config and the request path, determine
   * the actual upstream host and rewritten path.
   *
   * e.g., if path = /api/v3/repos and there's a rewrite
   *        api.github.com = /api
   *        then upstream = api.github.com, path = /v3/repos
   */
  getUpstream(siteConfig, requestPath) {
    // Check rewrites first (longest prefix match)
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

    // Default: main target host
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