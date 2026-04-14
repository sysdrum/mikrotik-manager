import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { requireAuth, requireWrite } from '../middleware/auth';
import { DeviceCollector, DeviceRow } from '../services/mikrotik/DeviceCollector';
import { lookupVendor } from '../utils/oui';

const router = Router();
router.use(requireAuth);

// ─── Helper ───────────────────────────────────────────────────────────────────

async function getAP(id: number): Promise<DeviceRow | null> {
  const rows = await query<DeviceRow>(
    `SELECT * FROM devices WHERE id = $1 AND device_type = 'wireless_ap'`,
    [id]
  );
  return rows[0] ?? null;
}

// ─── Bulk SSID deployment ─────────────────────────────────────────────────────

// POST /api/wireless/ssid/bulk — create the same SSID on multiple APs simultaneously
router.post('/ssid/bulk', requireWrite, async (req: Request, res: Response) => {
  const { apIds, ...ssidBody } = req.body as { apIds: number[] } & Record<string, unknown>;

  if (!Array.isArray(apIds) || apIds.length === 0) {
    return res.status(400).json({ error: '"apIds" must be a non-empty array' });
  }
  if (!ssidBody.ssid) {
    return res.status(400).json({ error: '"ssid" is required' });
  }

  const placeholders = apIds.map((_, i) => `$${i + 1}`).join(',');
  const aps = await query<DeviceRow>(
    `SELECT * FROM devices WHERE id IN (${placeholders}) AND device_type = 'wireless_ap'`,
    apIds
  );

  const settled = await Promise.allSettled(
    aps.map(async (ap) => {
      const collector = new DeviceCollector(ap);
      try {
        await collector.connect();
        const pkg = await collector.detectWifiPackage();
        const autoName = await collector.getNextInterfaceName();

        // Normalize mode to the correct value for this AP's package type
        let resolvedMode = String(ssidBody.mode || 'ap-bridge');
        if (pkg === 'wifi' && (resolvedMode === 'ap-bridge' || resolvedMode === 'bridge')) {
          resolvedMode = 'ap';
        } else if (pkg !== 'wifi' && resolvedMode === 'ap') {
          resolvedMode = 'ap-bridge';
        }

        const params: Record<string, string> = {
          name: autoName,
          ssid: String(ssidBody.ssid),
          mode: resolvedMode,
          disabled: ssidBody.disabled ? 'yes' : 'no',
        };
        const fieldMap: Record<string, string> = {
          band: 'band', frequency: 'frequency', channel_width: 'channel-width',
          tx_power: 'tx-power', tx_power_mode: 'tx-power-mode',
          antenna_gain: 'antenna-gain', country: 'country', installation: 'installation',
          security_profile: 'security-profile', passphrase: 'passphrase',
        };
        for (const [key, rosKey] of Object.entries(fieldMap)) {
          if (ssidBody[key]) params[rosKey] = String(ssidBody[key]);
        }
        if (ssidBody.authentication_types) {
          params['authentication-types'] = Array.isArray(ssidBody.authentication_types)
            ? (ssidBody.authentication_types as string[]).join(',')
            : String(ssidBody.authentication_types);
        }
        await collector.addWirelessInterface(params);
        await collector.collectWirelessInterfaces();
        return { id: ap.id, name: ap.name as string, ok: true };
      } catch (err) {
        return { id: ap.id, name: ap.name as string, ok: false, error: (err as Error).message };
      } finally {
        collector.disconnect();
      }
    })
  );

  const results = settled.map(r =>
    r.status === 'fulfilled' ? r.value : { id: 0, name: 'unknown', ok: false, error: String(r.reason) }
  );

  return res.json({ results });
});

// ─── Section overview ─────────────────────────────────────────────────────────

// GET /api/wireless — all wireless_ap devices with aggregated stats
router.get('/', async (_req: Request, res: Response) => {
  const aps = await query(`
    SELECT d.id, d.name, d.ip_address, d.model, d.device_type, d.status, d.last_seen,
           d.ros_version, d.firmware_version, d.serial_number, d.rack_name, d.rack_slot,
           COUNT(DISTINCT wi.id)                           AS radio_count,
           COALESCE(SUM(wi.registered_clients), 0)        AS client_count,
           COUNT(DISTINCT wi.id) FILTER (WHERE wi.ssid IS NOT NULL AND wi.disabled = false) AS ssid_count
    FROM devices d
    LEFT JOIN wireless_interfaces wi ON wi.device_id = d.id
    WHERE d.device_type = 'wireless_ap'
    GROUP BY d.id
    ORDER BY d.name ASC
  `);
  res.json(aps);
});

// ─── Wireless interfaces (SSIDs) ──────────────────────────────────────────────

// GET /api/wireless/:id/bridges — bridge list + current port memberships
router.get('/:id/bridges', async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    const [bridges, ports] = await Promise.all([
      collector.getBridges(),
      collector.getBridgePorts(),
    ]);
    return res.json({ bridges, ports });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// GET /api/wireless/:id/interfaces — live from device
router.get('/:id/interfaces', async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    const ifaces = await collector.getWirelessInterfaces();
    return res.json(ifaces);
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// POST /api/wireless/:id/interfaces — create new SSID/virtual AP
router.post('/:id/interfaces', requireWrite, async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const {
    ssid, mode = 'ap-bridge', band, frequency, channel_width,
    tx_power, tx_power_mode, antenna_gain, country, installation,
    security_profile, disabled = false,
    passphrase, authentication_types,
    bridge, vlan_id,
    // advanced
    master_interface,
  } = req.body as Record<string, string | boolean | number | string[] | undefined>;

  if (!ssid) {
    return res.status(400).json({ error: '"ssid" is required' });
  }

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();

    // Auto-generate the next available interface name (e.g. wifi3, wifi4 …)
    const autoName = await collector.getNextInterfaceName();

    const params: Record<string, string> = {
      name: autoName,
      ssid: String(ssid),
      mode: String(mode),
      disabled: disabled ? 'yes' : 'no',
    };
    if (band)             params['band']             = String(band);
    if (frequency)        params['frequency']        = String(frequency);
    if (channel_width)    params['channel-width']    = String(channel_width);
    if (tx_power)         params['tx-power']         = String(tx_power);
    if (tx_power_mode)    params['tx-power-mode']    = String(tx_power_mode);
    if (antenna_gain !== undefined) params['antenna-gain'] = String(antenna_gain);
    if (country)          params['country']          = String(country);
    if (installation)     params['installation']     = String(installation);
    if (security_profile) params['security-profile'] = String(security_profile);
    if (passphrase)       params['passphrase']       = String(passphrase);
    if (authentication_types) {
      params['authentication-types'] = Array.isArray(authentication_types)
        ? authentication_types.join(',')
        : String(authentication_types);
    }
    if (master_interface) params['master-interface'] = String(master_interface);

    await collector.addWirelessInterface(params);
    // Bridge port membership — must be done after interface exists
    if (bridge) {
      await collector.setInterfaceBridge(
        autoName,
        String(bridge),
        vlan_id ? Number(vlan_id) : undefined,
      );
      // Ensure the VLAN ID is also in the bridge VLAN table (untagged)
      if (vlan_id) {
        await collector.ensureVlanMembership(autoName, Number(vlan_id));
      }
    }
    // Refresh cache
    await collector.collectWirelessInterfaces();
    return res.status(201).json({ ok: true, name: autoName });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// PUT /api/wireless/:id/interfaces/:name — update SSID/radio config
router.put('/:id/interfaces/:name', requireWrite, async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const ifaceName = req.params.name;
  const body = req.body as Record<string, string | boolean | number | undefined>;

  const params: Record<string, string> = {};
  const map: Record<string, string> = {
    ssid: 'ssid', mode: 'mode', band: 'band', frequency: 'frequency',
    channel_width: 'channel-width', tx_power: 'tx-power',
    tx_power_mode: 'tx-power-mode', antenna_gain: 'antenna-gain',
    country: 'country', installation: 'installation',
    security_profile: 'security-profile', master_interface: 'master-interface',
    passphrase: 'passphrase',
  };

  for (const [key, rosKey] of Object.entries(map)) {
    if (body[key] !== undefined) params[rosKey] = String(body[key]);
  }
  if (body.disabled !== undefined) params['disabled'] = body.disabled ? 'yes' : 'no';
  if (body.authentication_types !== undefined) {
    params['authentication-types'] = Array.isArray(body.authentication_types)
      ? (body.authentication_types as string[]).join(',')
      : String(body.authentication_types);
  }

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    await collector.setWirelessInterface(ifaceName, params);
    // Bridge port membership — only touched when 'bridge' key is present in the request
    if (body.bridge !== undefined) {
      const bridgeName = body.bridge ? String(body.bridge) : null;
      const pvid = body.vlan_id ? Number(body.vlan_id) : undefined;
      await collector.setInterfaceBridge(ifaceName, bridgeName, pvid);
      // Ensure the VLAN ID is in the bridge VLAN table (untagged)
      if (bridgeName && body.vlan_id) {
        await collector.ensureVlanMembership(ifaceName, Number(body.vlan_id));
      }
    }
    await collector.collectWirelessInterfaces();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// DELETE /api/wireless/:id/interfaces/:name
router.delete('/:id/interfaces/:name', requireWrite, async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    await collector.removeWirelessInterface(req.params.name);
    await query(
      `DELETE FROM wireless_interfaces WHERE device_id=$1 AND name=$2`,
      [ap.id, req.params.name]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// ─── Security Profiles ────────────────────────────────────────────────────────

// GET /api/wireless/:id/security-profiles — live from device
router.get('/:id/security-profiles', async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    const profiles = await collector.getSecurityProfilesLive();
    return res.json(profiles);
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// POST /api/wireless/:id/security-profiles
router.post('/:id/security-profiles', requireWrite, async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const {
    name, mode = 'dynamic-keys',
    authentication_types, passphrase,
    unicast_ciphers, group_ciphers, management_protection = 'disabled',
    management_protection_key,
  } = req.body as Record<string, string | string[] | undefined>;

  if (!name) return res.status(400).json({ error: '"name" is required' });

  const params: Record<string, string> = {
    name: String(name),
    mode: String(mode),
    'management-protection': String(management_protection),
  };

  if (authentication_types) {
    params['authentication-types'] = Array.isArray(authentication_types)
      ? authentication_types.join(',')
      : String(authentication_types);
  }
  if (unicast_ciphers) {
    params['unicast-ciphers'] = Array.isArray(unicast_ciphers)
      ? unicast_ciphers.join(',')
      : String(unicast_ciphers);
  }
  if (group_ciphers) {
    params['group-ciphers'] = Array.isArray(group_ciphers)
      ? group_ciphers.join(',')
      : String(group_ciphers);
  }
  if (passphrase)               params['passphrase']               = String(passphrase);
  if (management_protection_key) params['management-protection-key'] = String(management_protection_key);

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    await collector.addSecurityProfile(params);
    await collector.collectSecurityProfiles();
    return res.status(201).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// PUT /api/wireless/:id/security-profiles/:name
router.put('/:id/security-profiles/:name', requireWrite, async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const profileName = req.params.name;
  const body = req.body as Record<string, string | string[] | undefined>;

  const params: Record<string, string> = {};
  if (body.mode)                      params['mode']                      = String(body.mode);
  if (body.management_protection)     params['management-protection']     = String(body.management_protection);
  if (body.management_protection_key) params['management-protection-key'] = String(body.management_protection_key);
  if (body.passphrase)                params['passphrase']                = String(body.passphrase);

  if (body.authentication_types !== undefined) {
    params['authentication-types'] = Array.isArray(body.authentication_types)
      ? body.authentication_types.join(',')
      : String(body.authentication_types);
  }
  if (body.unicast_ciphers !== undefined) {
    params['unicast-ciphers'] = Array.isArray(body.unicast_ciphers)
      ? body.unicast_ciphers.join(',')
      : String(body.unicast_ciphers);
  }
  if (body.group_ciphers !== undefined) {
    params['group-ciphers'] = Array.isArray(body.group_ciphers)
      ? body.group_ciphers.join(',')
      : String(body.group_ciphers);
  }

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    await collector.setSecurityProfile(profileName, params);
    await collector.collectSecurityProfiles();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// DELETE /api/wireless/:id/security-profiles/:name
router.delete('/:id/security-profiles/:name', requireWrite, async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    await collector.removeSecurityProfile(req.params.name);
    await query(
      `DELETE FROM wireless_security_profiles WHERE device_id=$1 AND name=$2`,
      [ap.id, req.params.name]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// ─── Radio monitoring / diagnostics ──────────────────────────────────────────

// GET /api/wireless/:id/radios — hardware radio capabilities (wifi package only)
router.get('/:id/radios', async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    const radios = await collector.getWifiRadioInfo();
    return res.json(radios);
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// GET /api/wireless/:id/registration-table — connected wireless clients
router.get('/:id/registration-table', async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    const table = await collector.getWirelessRegistrationTable();
    return res.json(table);
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// GET /api/wireless/:id/monitor/:iface — real-time radio monitor snapshot
router.get('/:id/monitor/:iface', async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    const data = await collector.getWirelessMonitor(req.params.iface);
    return res.json(data[0] ?? {});
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// GET /api/wireless/:id/scan/:iface — scan for nearby APs (5 s)
router.get('/:id/scan/:iface', async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    const results = await collector.scanWireless(req.params.iface);
    return res.json(results);
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// Aggregate raw RouterOS spectral-scan rows (35 k+ per 10 s scan) into one point
// per unique frequency. Each row has: freq (MHz, string), magn (dBm, string),
// peak (dBm, string). We average magn and keep the highest peak per frequency.
function aggregateSpectralRows(
  rows: Record<string, string>[]
): { freq: number; magn: number; peak: number }[] {
  const map = new Map<number, { sum: number; count: number; peak: number }>();
  for (const row of rows) {
    const freq = parseFloat(row['freq'] || '0');
    const magn = parseInt(row['magn'] || '-120', 10);
    const peak = parseInt(row['peak'] || magn.toString(), 10);
    if (freq <= 0) continue;
    const existing = map.get(freq);
    if (existing) {
      existing.sum   += magn;
      existing.count += 1;
      existing.peak   = Math.max(existing.peak, peak);
    } else {
      map.set(freq, { sum: magn, count: 1, peak });
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([freq, { sum, count, peak }]) => ({
      freq,
      magn: Math.round(sum / count),
      peak,
    }));
}

// POST /api/wireless/:id/spectral-scan/:iface — run an on-demand spectral scan,
// save the aggregated result and return it immediately.
router.post('/:id/spectral-scan/:iface', requireWrite, async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  const collector = new DeviceCollector(ap);
  try {
    await collector.connect();
    const rows = await collector.collectSpectralScan(req.params.iface);
    if (rows.length === 0) {
      return res.status(422).json({ error: 'No spectral data returned — interface may not support spectral scan' });
    }
    const aggregated = aggregateSpectralRows(rows);
    const saved = await query<{ id: number; scanned_at: string }>(
      `INSERT INTO spectral_scan_data (device_id, interface_name, data, scan_type)
       VALUES ($1, $2, $3, 'manual')
       RETURNING id, scanned_at`,
      [ap.id, req.params.iface, JSON.stringify(aggregated)]
    );
    return res.json({ id: saved[0].id, scanned_at: saved[0].scanned_at, data: aggregated });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  } finally {
    collector.disconnect();
  }
});

// GET /api/wireless/:id/spectral-history/:iface?limit=5 — return last N scans from DB
router.get('/:id/spectral-history/:iface', async (req: Request, res: Response) => {
  const deviceId = parseInt(req.params.id);
  const iface = req.params.iface;
  const limit = Math.min(parseInt(String(req.query.limit || '5'), 10), 20);

  const scans = await query<{ id: number; scanned_at: string; scan_type: string; data: unknown }>(
    `SELECT id, scanned_at, scan_type, data
     FROM spectral_scan_data
     WHERE device_id = $1 AND interface_name = $2
     ORDER BY scanned_at DESC
     LIMIT $3`,
    [deviceId, iface, limit]
  );
  return res.json(scans);
});

// ─── AP scan ──────────────────────────────────────────────────────────────────

interface APBandEntry {
  bssid: string; vendor: string; signal: number;
  freq: number; band: string; channel_width: string;
}
interface APNetworkEntry {
  ssid: string; security: string; hidden: boolean; entries: APBandEntry[];
}

function normBand(band: string, freq: number): string {
  if (band.includes('6ghz') || freq >= 5925) return '6 GHz';
  if (band.includes('5ghz') || (freq >= 4900 && freq < 5925)) return '5 GHz';
  return '2.4 GHz';
}

function aggregateAPScanRows(
  allRows: { iface: string; rows: Record<string, string>[] }[]
): APNetworkEntry[] {
  const byKey = new Map<string, APNetworkEntry>();

  for (const { rows } of allRows) {
    for (const row of rows) {
      const ssid   = row['network-name'] || row['ssid'] || '';
      const bssid  = (row['address'] || row['bssid'] || '').toLowerCase();
      if (!bssid) continue;
      const rawSig = row['signal-strength'] || row['signal'] || '-100';
      const signal = parseInt(rawSig, 10) || -100;
      const freq   = parseFloat(row['frequency'] || row['channel'] || '0');
      const band   = normBand(row['band'] || row['radio-band'] || '', freq);
      // security: prefer explicit field; if auth-types present but no explicit security, call it WPA
      const security = row['security']
        || (row['authentication-types'] ? 'WPA' : 'open');
      const channelWidth = row['channel-width'] || '';
      const key = ssid || `hidden:${bssid}`;

      if (!byKey.has(key)) {
        byKey.set(key, { ssid, security, hidden: !ssid, entries: [] });
      }
      const net = byKey.get(key)!;
      const existing = net.entries.find(e => e.bssid === bssid && e.freq === freq);
      if (existing) {
        if (signal > existing.signal) existing.signal = signal;
      } else {
        net.entries.push({
          bssid,
          vendor: lookupVendor(bssid),
          signal,
          freq,
          band,
          channel_width: channelWidth,
        });
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const aBest = Math.max(...a.entries.map(e => e.signal));
    const bBest = Math.max(...b.entries.map(e => e.signal));
    return bBest - aBest;
  });
}

// POST /api/wireless/:id/ap-scan — scan all interfaces, combine results, save + return
router.post('/:id/ap-scan', requireWrite, async (req: Request, res: Response) => {
  const ap = await getAP(parseInt(req.params.id));
  if (!ap) return res.status(404).json({ error: 'Wireless AP not found' });

  // Only scan physical radios (master=true). Virtual APs (master=false, e.g. extra SSIDs)
  // share a radio with their master interface and cannot initiate scans independently.
  const ifaces = await query<{ name: string }>(
    `SELECT name FROM wireless_interfaces
     WHERE device_id = $1
       AND disabled = FALSE
       AND (config_json->>'master' IS NULL OR config_json->>'master' != 'false')`,
    [ap.id]
  );
  if (ifaces.length === 0) {
    return res.status(422).json({ error: 'No active wireless interfaces found' });
  }

  // Use a separate TCP connection per radio — a 10 s streaming scan can leave
  // residual bytes in the socket that corrupt a subsequent scan on the same connection.
  const allRows: { iface: string; rows: Record<string, string>[] }[] = [];
  for (const iface of ifaces) {
    const collector = new DeviceCollector(ap);
    try {
      await collector.connect();
      const rows = await collector.scanWireless(iface.name, 10_000);
      if (rows.length > 0) allRows.push({ iface: iface.name, rows });
    } catch {
      // ignore per-interface errors; continue to next radio
    } finally {
      collector.disconnect();
    }
  }

  if (allRows.length === 0) {
    return res.status(422).json({ error: 'No AP scan data returned' });
  }

  try {
    const aggregated = aggregateAPScanRows(allRows);
    const saved = await query<{ id: number; scanned_at: string }>(
      `INSERT INTO ap_scan_data (device_id, data, scan_type)
       VALUES ($1, $2, 'manual') RETURNING id, scanned_at`,
      [ap.id, JSON.stringify(aggregated)]
    );
    return res.json({ id: saved[0].id, scanned_at: saved[0].scanned_at, data: aggregated });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }
});

// GET /api/wireless/:id/ap-scan-history?limit=5 — last N saved scans
router.get('/:id/ap-scan-history', async (req: Request, res: Response) => {
  const deviceId = parseInt(req.params.id);
  const limit = Math.min(parseInt(String(req.query.limit || '5'), 10), 20);

  const scans = await query<{ id: number; scanned_at: string; scan_type: string; data: unknown }>(
    `SELECT id, scanned_at, scan_type, data
     FROM ap_scan_data
     WHERE device_id = $1
     ORDER BY scanned_at DESC
     LIMIT $2`,
    [deviceId, limit]
  );
  return res.json(scans);
});

export default router;
