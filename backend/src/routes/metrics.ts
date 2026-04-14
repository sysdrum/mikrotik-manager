import { Router, Request, Response } from 'express';
import { getQueryApi, bucket } from '../config/influxdb';
import { query } from '../config/database';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

function rangeToFlux(range: string): string {
  const allowed = ['1h', '3h', '6h', '12h', '24h', '7d', '30d'];
  return allowed.includes(range) ? range : '24h';
}

// GET /api/metrics/clients-over-time?range=24h
router.get('/clients-over-time', async (req: Request, res: Response) => {
  const range = rangeToFlux(String(req.query.range || '24h'));
  const queryApi = getQueryApi();

  // Use the global deduplicated metric (_global tag) written by DeviceCollector.
  // This avoids double-counting clients seen by multiple devices simultaneously.
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "client_counts")
      |> filter(fn: (r) => r._field == "total_clients")
      |> filter(fn: (r) => r.device_id == "_global")
      |> aggregateWindow(every: 5m, fn: last, createEmpty: false)
      |> yield(name: "clients_over_time")
  `;

  const rawPoints: { time: string; value: number }[] = [];
  try {
    await queryApi.collectRows(fluxQuery, (row, tableMeta) => {
      const time = tableMeta.get(row, '_time') as string;
      const value = tableMeta.get(row, '_value') as number;
      rawPoints.push({ time, value: Math.round(value) });
    });
  } catch {
    // InfluxDB might not have data yet
  }

  // If no global metric exists yet (first run or old data), fall back to max across devices.
  // max() is better than sum() since the device with the most clients is the gateway that
  // sees everyone — summing would double-count clients visible from multiple devices.
  if (rawPoints.length === 0) {
    const fallbackQuery = `
      from(bucket: "${bucket}")
        |> range(start: -${range})
        |> filter(fn: (r) => r._measurement == "client_counts")
        |> filter(fn: (r) => r._field == "total_clients")
        |> filter(fn: (r) => r.device_id != "_global")
        |> aggregateWindow(every: 5m, fn: max, createEmpty: false)
        |> group()
        |> aggregateWindow(every: 5m, fn: max, createEmpty: false)
        |> yield(name: "clients_over_time_fallback")
    `;
    try {
      await queryApi.collectRows(fallbackQuery, (row, tableMeta) => {
        const time = tableMeta.get(row, '_time') as string;
        const value = tableMeta.get(row, '_value') as number;
        rawPoints.push({ time, value: Math.round(value) });
      });
    } catch {
      // No data yet
    }
  }

  const points = rawPoints.sort((a, b) => a.time.localeCompare(b.time));
  res.json(points);
});

// GET /api/metrics/top-clients?limit=10&range=24h
router.get('/top-clients', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit || '10'), 10), 50);

  // Use postgres data (most recent client data)
  const clients = await query(
    `SELECT c.mac_address, c.hostname, c.ip_address, c.interface_name,
            c.tx_bytes + c.rx_bytes as total_bytes,
            c.tx_bytes, c.rx_bytes, c.client_type, d.name as device_name
     FROM clients c JOIN devices d ON d.id = c.device_id
     WHERE c.active = TRUE AND (c.tx_bytes + c.rx_bytes) > 0
     ORDER BY total_bytes DESC LIMIT $1`,
    [limit]
  );

  res.json(clients);
});

// GET /api/metrics/interface/:deviceId/:interface?range=1h
router.get('/interface/:deviceId/:interface', async (req: Request, res: Response) => {
  const range = rangeToFlux(String(req.query.range || '1h'));
  const queryApi = getQueryApi();
  const deviceId = req.params.deviceId;
  const iface = req.params.interface;

  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "interface_traffic")
      |> filter(fn: (r) => r.device_id == "${deviceId}")
      |> filter(fn: (r) => r.interface == "${iface}")
      |> filter(fn: (r) => r._field == "rx_bytes" or r._field == "tx_bytes")
      |> aggregateWindow(every: 1m, fn: last, createEmpty: false)
      |> derivative(unit: 1s, nonNegative: true)
      |> yield(name: "traffic")
  `;

  const points: Record<string, unknown>[] = [];
  try {
    await queryApi.collectRows(fluxQuery, (row, tableMeta) => {
      points.push({
        time: tableMeta.get(row, '_time'),
        field: tableMeta.get(row, '_field'),
        value: tableMeta.get(row, '_value'),
      });
    });
  } catch {
    // No data yet
  }

  // Pivot rx/tx into single objects per timestamp
  const pivoted: Record<string, { time: string; rx: number; tx: number }> = {};
  for (const p of points) {
    const t = p['time'] as string;
    if (!pivoted[t]) pivoted[t] = { time: t, rx: 0, tx: 0 };
    if (p['field'] === 'rx_bytes') pivoted[t].rx = Number(p['value']) || 0;
    if (p['field'] === 'tx_bytes') pivoted[t].tx = Number(p['value']) || 0;
  }

  res.json(Object.values(pivoted).sort((a, b) => a.time.localeCompare(b.time)));
});

// GET /api/metrics/interface/:deviceId/:interface/packets?range=1h
router.get('/interface/:deviceId/:interface/packets', async (req: Request, res: Response) => {
  const range = rangeToFlux(String(req.query.range || '1h'));
  const queryApi = getQueryApi();
  const deviceId = req.params.deviceId;
  const iface = req.params.interface;

  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "interface_traffic")
      |> filter(fn: (r) => r.device_id == "${deviceId}")
      |> filter(fn: (r) => r.interface == "${iface}")
      |> filter(fn: (r) => r._field == "rx_packets" or r._field == "tx_packets")
      |> aggregateWindow(every: 1m, fn: last, createEmpty: false)
      |> derivative(unit: 1s, nonNegative: true)
      |> yield(name: "packets")
  `;

  const points: Record<string, unknown>[] = [];
  try {
    await queryApi.collectRows(fluxQuery, (row, tableMeta) => {
      points.push({
        time: tableMeta.get(row, '_time'),
        field: tableMeta.get(row, '_field'),
        value: tableMeta.get(row, '_value'),
      });
    });
  } catch {
    // No data yet
  }

  const pivoted: Record<string, { time: string; rx: number; tx: number }> = {};
  for (const p of points) {
    const t = p['time'] as string;
    if (!pivoted[t]) pivoted[t] = { time: t, rx: 0, tx: 0 };
    if (p['field'] === 'rx_packets') pivoted[t].rx = Number(p['value']) || 0;
    if (p['field'] === 'tx_packets') pivoted[t].tx = Number(p['value']) || 0;
  }

  res.json(Object.values(pivoted).sort((a, b) => a.time.localeCompare(b.time)));
});

// GET /api/metrics/device/:deviceId/resources?range=24h
router.get('/device/:deviceId/resources', async (req: Request, res: Response) => {
  const range = rangeToFlux(String(req.query.range || '24h'));
  const queryApi = getQueryApi();
  const deviceId = req.params.deviceId;

  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "device_resources")
      |> filter(fn: (r) => r.device_id == "${deviceId}")
      |> filter(fn: (r) => r._field == "cpu_load" or r._field == "memory_used" or r._field == "memory_total")
      |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)
      |> yield(name: "resources")
  `;

  const points: Record<string, unknown>[] = [];
  try {
    await queryApi.collectRows(fluxQuery, (row, tableMeta) => {
      points.push({
        time: tableMeta.get(row, '_time'),
        field: tableMeta.get(row, '_field'),
        value: tableMeta.get(row, '_value'),
      });
    });
  } catch {
    // No data yet
  }

  const pivoted: Record<string, Record<string, unknown>> = {};
  for (const p of points) {
    const t = p['time'] as string;
    if (!pivoted[t]) pivoted[t] = { time: t };
    pivoted[t][p['field'] as string] = Number(p['value']) || 0;
  }

  res.json(Object.values(pivoted).sort((a, b) => String(a['time']).localeCompare(String(b['time']))));
});

// GET /api/metrics/summary - dashboard summary stats
router.get('/summary', async (_req: Request, res: Response) => {
  const [deviceStats, clientStats, alertStats] = await Promise.all([
    query<{ total: string; online: string; offline: string }>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status='online') as online,
        COUNT(*) FILTER (WHERE status='offline') as offline
       FROM devices`
    ),
    query<{ total: string; active: string }>(
      `SELECT COUNT(DISTINCT mac_address) as total,
              COUNT(DISTINCT mac_address) FILTER (WHERE active=TRUE) as active
       FROM clients`
    ),
    query<{ critical: string; warning: string }>(
      `SELECT
        COUNT(*) FILTER (WHERE severity='error') as critical,
        COUNT(*) FILTER (WHERE severity='warning') as warning
       FROM events WHERE event_time > NOW() - INTERVAL '24 hours'`
    ),
  ]);

  res.json({
    devices: {
      total: parseInt(deviceStats[0]?.total || '0', 10),
      online: parseInt(deviceStats[0]?.online || '0', 10),
      offline: parseInt(deviceStats[0]?.offline || '0', 10),
    },
    clients: {
      total: parseInt(clientStats[0]?.total || '0', 10),
      active: parseInt(clientStats[0]?.active || '0', 10),
    },
    alerts: {
      critical: parseInt(alertStats[0]?.critical || '0', 10),
      warning: parseInt(alertStats[0]?.warning || '0', 10),
    },
  });
});

export default router;
