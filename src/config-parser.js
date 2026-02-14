const fs = require('fs');
const path = require('path');

/**
 * Parses a .conf file with the following format:
 *
 *   # Comment lines start with #
 *   [proxy]
 *   name = example
 *   local_subdomain = example.localgateway.com
 *   target_host = example.com
 *   target_protocol = https
 *
 *   [rewrites]
 *   api.example.com = /api
 *   raw.example.com = /raw
 *   assets.example.com = /assets
 *   avatars.example.com = /avatars
 *
 *   [headers.remove]
 *   content-security-policy
 *   strict-transport-security
 *   x-frame-options
 *
 *   [headers.add]
 *   access-control-allow-origin = *
 *   access-control-allow-methods = GET, POST, PUT, DELETE, OPTIONS
 *   access-control-allow-headers = *
 */

function parseConfFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const config = {
    name: path.basename(filePath, '.conf'),
    localSubdomain: '',
    targetHost: '',
    targetProtocol: 'https',
    targetPort: 443,
    rewrites: [],          // { externalHost, localPathPrefix }
    headersRemove: [],
    headersAdd: {},
    rewriteContent: true,  // whether to do URL rewriting in response bodies
  };

  let currentSection = null;

  for (let rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    // Section header
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase().trim();
      continue;
    }

    // Key-value or standalone value depending on section
    if (currentSection === 'proxy') {
      const [key, ...rest] = line.split('=');
      const k = key.trim().toLowerCase();
      const v = rest.join('=').trim();

      switch (k) {
        case 'name':
          config.name = v;
          break;
        case 'local_subdomain':
          config.localSubdomain = v;
          break;
        case 'target_host':
          config.targetHost = v;
          break;
        case 'target_protocol':
          config.targetProtocol = v.replace(':', '');
          break;
        case 'target_port':
          config.targetPort = parseInt(v, 10);
          break;
        case 'rewrite_content':
          config.rewriteContent = v.toLowerCase() === 'true' || v === '1';
          break;
      }
    } else if (currentSection === 'rewrites') {
      // format: external.host.com = /local-prefix
      const [key, ...rest] = line.split('=');
      if (rest.length > 0) {
        config.rewrites.push({
          externalHost: key.trim(),
          localPathPrefix: rest.join('=').trim(),
        });
      }
    } else if (currentSection === 'headers.remove') {
      // Each line is just a header name
      config.headersRemove.push(line.toLowerCase());
    } else if (currentSection === 'headers.add') {
      const [key, ...rest] = line.split('=');
      if (rest.length > 0) {
        config.headersAdd[key.trim().toLowerCase()] = rest.join('=').trim();
      }
    }
  }

  return config;
}

function loadAllConfigs(confDir) {
  const configs = [];

  if (!fs.existsSync(confDir)) {
    console.error(`[CONFIG] Config directory not found: ${confDir}`);
    return configs;
  }

  const files = fs.readdirSync(confDir).filter(f => f.endsWith('.conf'));

  if (files.length === 0) {
    console.warn(`[CONFIG] No .conf files found in ${confDir}`);
    return configs;
  }

  for (const file of files) {
    try {
      const config = parseConfFile(path.join(confDir, file));
      configs.push(config);
      console.log(`[CONFIG] Loaded: ${file} -> ${config.localSubdomain} => ${config.targetHost}`);
    } catch (err) {
      console.error(`[CONFIG] Failed to parse ${file}: ${err.message}`);
    }
  }

  return configs;
}

module.exports = { parseConfFile, loadAllConfigs };