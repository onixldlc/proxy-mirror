const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CERTS_DIR = process.env.CERTS_DIR || './certs';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate the root CA if it doesn't already exist.
 */
function ensureRootCA() {
  ensureDir(CERTS_DIR);

  const caKey = path.join(CERTS_DIR, 'ca.key');
  const caCrt = path.join(CERTS_DIR, 'ca.crt');

  if (fs.existsSync(caKey) && fs.existsSync(caCrt)) {
    console.log('[CERT] Root CA already exists, skipping generation');
    return { caKey, caCrt };
  }

  console.log('[CERT] Generating root CA...');

  // Generate CA private key
  execSync(`openssl genrsa -out "${caKey}" 4096`, { stdio: 'pipe' });

  // Generate CA certificate (valid 10 years)
  execSync(
    `openssl req -x509 -new -nodes ` +
    `-key "${caKey}" ` +
    `-sha256 -days 3650 ` +
    `-out "${caCrt}" ` +
    `-subj "/C=XX/ST=Proxy/L=Local/O=LocalGateway Monitoring/OU=IT/CN=LocalGateway Root CA"`,
    { stdio: 'pipe' }
  );

  console.log('[CERT] Root CA generated');
  console.log(`[CERT]   ⚠️  Install ${caCrt} as a trusted CA to suppress browser warnings`);
  console.log(`[CERT]   ⚠️  Or leave it untrusted — the warning is the notice`);

  return { caKey, caCrt };
}

/**
 * Generate a site certificate signed by the root CA.
 * @param {string} domain - e.g. "github.localgateway.com"
 * @returns {{ key: string, cert: string }} paths to key and cert files
 */
function ensureSiteCert(domain) {
  const sitesDir = path.join(CERTS_DIR, 'sites');
  ensureDir(sitesDir);

  const keyFile = path.join(sitesDir, `${domain}.key`);
  const crtFile = path.join(sitesDir, `${domain}.crt`);
  const csrFile = path.join(sitesDir, `${domain}.csr`);
  const extFile = path.join(sitesDir, `${domain}.ext`);

  if (fs.existsSync(keyFile) && fs.existsSync(crtFile)) {
    console.log(`[CERT] Certificate for ${domain} already exists`);
    return { key: keyFile, cert: crtFile };
  }

  const { caKey, caCrt } = ensureRootCA();

  console.log(`[CERT] Generating certificate for ${domain}...`);

  // Generate site private key
  execSync(`openssl genrsa -out "${keyFile}" 2048`, { stdio: 'pipe' });

  // Generate CSR
  execSync(
    `openssl req -new ` +
    `-key "${keyFile}" ` +
    `-out "${csrFile}" ` +
    `-subj "/C=XX/ST=Proxy/L=Local/O=LocalGateway Monitoring/OU=IT/CN=${domain}"`,
    { stdio: 'pipe' }
  );

  // Create extension file for SAN (Subject Alternative Names)
  const extContent = [
    'authorityKeyIdentifier=keyid,issuer',
    'basicConstraints=CA:FALSE',
    'keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment',
    'subjectAltName = @alt_names',
    '',
    '[alt_names]',
    `DNS.1 = ${domain}`,
    `DNS.2 = *.${domain}`,
    'IP.1 = 127.0.0.1',
    'IP.2 = ::1',
  ].join('\n');

  fs.writeFileSync(extFile, extContent);

  // Sign with CA (valid 1 year)
  execSync(
    `openssl x509 -req ` +
    `-in "${csrFile}" ` +
    `-CA "${caCrt}" ` +
    `-CAkey "${caKey}" ` +
    `-CAcreateserial ` +
    `-out "${crtFile}" ` +
    `-days 365 ` +
    `-sha256 ` +
    `-extfile "${extFile}"`,
    { stdio: 'pipe' }
  );

  // Clean up temp files
  try {
    fs.unlinkSync(csrFile);
    fs.unlinkSync(extFile);
  } catch (_) {}

  console.log(`[CERT] Certificate for ${domain} generated`);

  return { key: keyFile, cert: crtFile };
}

/**
 * Generate certificates for all site configs.
 * @param {object[]} configs - Array of parsed site configs
 * @returns {Map<string, { key: Buffer, cert: Buffer }>} domain → { key, cert }
 */
function generateAllCerts(configs) {
  ensureRootCA();

  const certMap = new Map();

  for (const cfg of configs) {
    const { key, cert } = ensureSiteCert(cfg.localSubdomain);
    certMap.set(cfg.localSubdomain, {
      key: fs.readFileSync(key),
      cert: fs.readFileSync(cert),
    });
  }

  return certMap;
}

module.exports = { ensureRootCA, ensureSiteCert, generateAllCerts };