# proxy-mirror — Configuration

This directory holds `.conf` files that define proxy sites. Each `.conf` file configures one site. All files are loaded automatically on startup.

## File Format

Configuration files use an INI-style format with sections denoted by `[section]` headers. Lines starting with `#` are comments. Blank lines are ignored.

### `[proxy]` — Main site settings

| Key                | Required | Default   | Description                                      |
|--------------------|----------|-----------|--------------------------------------------------|
| `name`             | No       | filename  | Display name for this site                       |
| `local_subdomain`  | Yes      | —         | The hostname the proxy listens for (matched via `Host` header) |
| `target_host`      | Yes      | —         | The upstream server hostname to forward requests to |
| `target_protocol`  | No       | `https`   | Protocol to use when connecting upstream (`http` or `https`) |
| `target_port`      | No       | `443`     | Port to use when connecting upstream             |
| `rewrite_content`  | No       | `true`    | Whether to rewrite URLs in response bodies       |

### `[rewrites]` — Sub-host path mappings

Maps upstream sub-hosts to local path prefixes. Each line follows the format:

```
<upstream-host> = <local-path-prefix>
```

Requests to `http://<local_subdomain>:<port><local-path-prefix>/...` are forwarded to `<upstream-host>/...`.

### `[headers.remove]` — Response headers to strip

Each line is a header name (case-insensitive) that will be removed from upstream responses before forwarding to the client.

### `[headers.add]` — Response headers to inject

Each line follows `header-name = value` format. These headers are added to every response for this site.

## Example

```ini
# example.conf

[proxy]
name = example
local_subdomain = example.localgateway.com
target_host = example.com
target_protocol = https

[rewrites]
api.example.com = /api
assets.example.com = /assets

[headers.remove]
content-security-policy
strict-transport-security
x-frame-options

[headers.add]
access-control-allow-origin = *
access-control-allow-methods = GET, POST, PUT, DELETE, OPTIONS
access-control-allow-headers = *
```

With this configuration:

- Requests with `Host: example.localgateway.com` are forwarded to `https://example.com`
- Requests to `/api/...` are forwarded to `api.example.com/...`
- Requests to `/assets/...` are forwarded to `assets.example.com/...`
- Security headers (`CSP`, `HSTS`, `X-Frame-Options`) are stripped from responses
- CORS headers are injected into every response
- All upstream URLs in text responses are rewritten to point back through the proxy