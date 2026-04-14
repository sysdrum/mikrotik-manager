import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { requireAuth, requireWrite } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// GET /api/events
router.get('/', async (req: Request, res: Response) => {
  const {
    deviceId,
    severity,
    topic,
    search,
    since,
    limit = '200',
    offset = '0',
  } = req.query;

  const filters: string[] = ['1=1'];
  const params: unknown[] = [];
  let idx = 1;

  if (deviceId) {
    filters.push(`e.device_id = $${idx++}`);
    params.push(deviceId);
  }
  if (severity) {
    // Accept comma-separated list e.g. "error,warning"
    // 'error' also includes 'critical' rows
    const requested = String(severity).split(',').map((s) => s.trim()).filter(Boolean);
    const expanded = new Set<string>();
    for (const s of requested) {
      expanded.add(s);
      if (s === 'error') expanded.add('critical');
    }
    const placeholders = Array.from(expanded).map(() => `$${idx++}`).join(',');
    filters.push(`e.severity IN (${placeholders})`);
    params.push(...Array.from(expanded));
  }
  if (topic) {
    filters.push(`e.topic ILIKE $${idx++}`);
    params.push(`%${topic}%`);
  }
  if (since) {
    filters.push(`e.event_time >= $${idx++}`);
    params.push(since);
  }
  if (search) {
    filters.push(`(e.message ILIKE $${idx} OR e.topic ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = filters.join(' AND ');

  const [events, totalResult, criticalCount] = await Promise.all([
    query(
      `SELECT e.*, d.name as device_name
       FROM events e
       LEFT JOIN devices d ON d.id = e.device_id
       WHERE ${where}
       ORDER BY e.event_time DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(String(limit), 10), parseInt(String(offset), 10)]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM events e WHERE ${where}`,
      params
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM events WHERE severity IN ('error','critical') AND event_time > NOW() - INTERVAL '24 hours'`
    ),
  ]);

  res.json({
    events,
    total: parseInt(totalResult[0]?.count || '0', 10),
    criticalCount: parseInt(criticalCount[0]?.count || '0', 10),
  });
});

// DELETE /api/events (clear events for a device or all)
router.delete('/', requireWrite, async (req: Request, res: Response) => {
  const { deviceId } = req.query;
  if (deviceId) {
    await query(`DELETE FROM events WHERE device_id = $1`, [deviceId]);
  } else {
    await query(`DELETE FROM events`);
  }
  res.json({ message: 'Events cleared' });
});

export default router;
