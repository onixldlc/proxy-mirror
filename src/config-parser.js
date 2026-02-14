const fs = require('fs');
const path = require('path');

function parseConfFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const config = {
    name: path.basename(filePath, '.conf'),
    localSubdomain: '',
    targetHost: '',
    targetProtocol: 'https',
    targetPort: 443,
    rewrites: [],           // { externalHost, localPathPrefix, isWildcard }
    wildcardRewrites: [],   // { pattern (regex), rootDomain, localPathPrefix }
    headersRemove: [],
    headersAdd: {},
    rewriteContent: true,
    injectCookie: '',
  };

  let currentSection = null;

  for (let rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase().trim();
      continue;
    }

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
        case 'inject_cookie':
          config.injectCookie = v;
          break;
      }
    } else if (currentSection === 'rewrites') {
      const [key, ...rest] = line.split('=');
      if (rest.length > 0) {
        const externalHost = key.trim();
        const localPathPrefix = rest.join('=').trim();

        if (externalHost.startsWith('*.')) {
          // Wildcard rewrite: *.google.com = /g
          // Matches: anything.google.com, sub.anything.google.com, etc.
          const rootDomain = externalHost.slice(2); // remove "*."
          const escapedRoot = rootDomain.replace(/\./g, '\\.');
          config.wildcardRewrites.push({
            pattern: new RegExp(`^(.+)\\.${escapedRoot}$`),
            rootDomain,
            localPathPrefix,
          });
        } else {
          config.rewrites.push({
            externalHost,
            localPathPrefix,
          });
        }
      }
    } else if (currentSection === 'headers.remove') {
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
      if (config.wildcardRewrites.length > 0) {
        console.log(`[CONFIG]   Wildcards: ${config.wildcardRewrites.map(w => '*.' + w.rootDomain).join(', ')}`);
      }
    } catch (err) {
      console.error(`[CONFIG] Failed to parse ${file}: ${err.message}`);
    }
  }

  return configs;
}

module.exports = { parseConfFile, loadAllConfigs };