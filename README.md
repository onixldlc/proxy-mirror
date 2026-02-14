# proxy-mirror

A lightweight, configuration-driven HTTP reverse proxy that maps local hostnames to remote upstream servers. It rewrites response bodies and headers so that all links and references point back through the proxy, keeping traffic flowing through a single local endpoint.

## Features

- **Host-based routing** — resolves incoming requests to upstream targets based on the `Host` header
- **URL rewriting** — rewrites URLs in HTML, CSS, JS, JSON, and other text responses so they reference the proxy instead of the upstream
- **Sub-host mapping** — maps multiple upstream sub-hosts (e.g. `api.*`, `assets.*`) to local path prefixes (e.g. `/api`, `/assets`)
- **Header management** — remove or inject response headers via configuration
- **CORS handling** — responds to `OPTIONS` preflight requests automatically
- **Zero dependencies** — uses only Node.js built-in modules (`http`, `https`, `fs`, `path`)
- **Docker-ready** — ships with a Dockerfile and Compose files for both production and development

## Quick Start

### Using Docker Compose (production)

```bash
docker compose up -d
```

This pulls the pre-built image and mounts the local `conf/` directory as read-only.

### Using Docker Compose (development)

```bash
docker compose -f docker-compose.dev.yml up
```

This builds the image locally from source.

### Running directly

```bash
CONF_DIR=./conf LOCAL_PORT=3000 node src/proxy.js
```

## Environment Variables

| Variable     | Default      | Description                                  |
|--------------|--------------|----------------------------------------------|
| `CONF_DIR`   | `./conf`     | Path to the directory containing `.conf` files |
| `LOCAL_PORT` | `3000`       | Port the proxy listens on                     |

## Project Structure

```
.
├── Dockerfile
├── docker-compose.yml          # Production compose (pulls image)
├── docker-compose.dev.yml      # Development compose (builds locally)
├── conf/                       # Site configuration files (.conf)
└── src/
    ├── proxy.js                # HTTP server and request handler
    ├── config-parser.js        # .conf file parser
    ├── router.js               # Host-based request routing
    └── rewriter.js             # URL rewriting in response bodies
```

## How It Works

1. On startup, all `.conf` files in `CONF_DIR` are parsed and loaded
2. A route map is built from `local_subdomain` → upstream target
3. Incoming requests are matched by their `Host` header
4. The request is forwarded to the configured upstream server
5. The response body is scanned and upstream URLs are rewritten to point back through the proxy
6. Configured headers are removed or added before sending the response to the client

Visiting the proxy without a matching `Host` header displays a landing page listing all configured sites and the `/etc/hosts` entries needed.

## DNS Setup

Add entries to your `/etc/hosts` file (or local DNS) so the configured `local_subdomain` values resolve to the proxy:

```
127.0.0.1  example.localgateway.com
```

See the `conf/` directory README for configuration file format and examples.