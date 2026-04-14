/**
 * Local IEEE OUI database lookup.
 * Downloads the official IEEE MA-L CSV on first use, caches it for 30 days,
 * then serves all vendor lookups from memory — no rate limits, no external calls
 * per client.
 */
import https from 'https';
import fs from 'fs';

const CACHE_FILE = '/tmp/oui-ieee.json';
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const IEEE_CSV_URL = 'https://standards-oui.ieee.org/oui/oui.csv';

let db: Map<string, string> | null = null;
let initPromise: Promise<void> | null = null;

export function initOuiDatabase(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = _load();
  return initPromise;
}

export function lookupVendor(mac: string): string {
  if (!db) return '';
  const oui = mac.replace(/[:\-.]/g, '').substring(0, 6).toUpperCase();
  return db.get(oui) ?? '';
}

async function _load(): Promise<void> {
  // Try valid cache first
  try {
    const stat = fs.statSync(CACHE_FILE);
    if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Record<string, string>;
      const map = new Map(Object.entries(raw));
      if (map.size > 10_000) {
        db = map;
        console.log(`OUI database loaded from cache: ${db.size} entries`);
        return;
      }
    }
  } catch { /* cache miss */ }

  // Download fresh from IEEE
  try {
    console.log('Downloading IEEE OUI database…');
    const csv = await _fetch(IEEE_CSV_URL);
    const map = _parseCsv(csv);
    if (map.size > 10_000) {
      db = map;
      console.log(`OUI database downloaded: ${db.size} entries`);
      // Persist cache
      const obj: Record<string, string> = {};
      for (const [k, v] of map) obj[k] = v;
      fs.writeFileSync(CACHE_FILE, JSON.stringify(obj));
    } else {
      console.warn('OUI: Downloaded file too small, ignoring');
      db = new Map();
    }
  } catch (err) {
    console.warn(`OUI: Download failed (${(err as Error).message}). Vendor lookups will be empty.`);
    db = new Map();
  }
}

function _parseCsv(csv: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of csv.split('\n')) {
    // IEEE CSV: Registry,Assignment,Organization Name,Organization Address
    // Quoted fields may contain commas, e.g. "Cisco Systems, Inc"
    const fields = _csvSplit(line);
    if (fields[0]?.trim() !== 'MA-L') continue;
    const oui  = fields[1]?.trim().toUpperCase();
    const name = fields[2]?.trim();
    if (oui?.length === 6 && name) map.set(oui, name);
  }
  return map;
}

function _csvSplit(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"')           { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { fields.push(cur); cur = ''; }
    else                      { cur += ch; }
  }
  fields.push(cur);
  return fields;
}

function _fetch(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60_000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
