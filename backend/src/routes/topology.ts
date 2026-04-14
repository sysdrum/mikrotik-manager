import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { requireAuth, requireWrite } from '../middleware/auth';
import { PollerService } from '../services/PollerService';

const router = Router();
router.use(requireAuth);

let pollerService: PollerService | null = null;
export function setPollerService(p: PollerService): void {
  pollerService = p;
}

// GET /api/topology
router.get('/', async (_req: Request, res: Response) => {
  // Protocol priority: lldp (point-to-point) > cdp > mndp (L2 broadcast, can be indirect)
  const PROTO_RANK: Record<string, number> = { lldp: 0, cdp: 1, mndp: 2 };
  const protoRank = (p: string | null) => PROTO_RANK[p ?? ''] ?? 3;

  interface LinkRow {
    id: number;
    from_device_id: number | null;
    from_interface: string | null;
    to_interface: string | null;
    to_device_id: number | null;
    neighbor_address: string | null;
    neighbor_identity: string | null;
    neighbor_platform: string | null;
    neighbor_mac: string | null;
    stp_role: string | null;
    stp_state: string | null;
    bridge_name: string | null;
    neighbor_caps: string | null;
    link_type: string | null;
    discovered_by: string | null;
    from_device_name: string | null;
    to_device_name: string | null;
  }

  const [devices, allLinks] = await Promise.all([
    query(
      `SELECT id, name, ip_address, model, device_type, status, ros_version
       FROM devices ORDER BY name ASC`
    ),
    query<LinkRow>(
      `SELECT tl.*,
              fd.name as from_device_name, fd.ip_address as from_device_ip,
              td.name as to_device_name, td.ip_address as to_device_ip
       FROM topology_links tl
       LEFT JOIN devices fd ON fd.id = tl.from_device_id
       LEFT JOIN devices td ON td.id = tl.to_device_id
       ORDER BY tl.discovered_at DESC`
    ),
  ]);

  // Deduplicate: for each (from_device, neighbor) pair keep only the highest-priority
  // protocol link. This removes MNDP duplicates when the same neighbor was also found
  // via LLDP or CDP on the same or a better-quality path.
  const bestLinks = new Map<string, LinkRow>();
  for (const link of allLinks as LinkRow[]) {
    if (!link.from_device_id) continue;
    const neighborKey = link.to_device_id
      ? String(link.to_device_id)
      : (link.neighbor_mac || link.neighbor_address || link.neighbor_identity || '');
    const key = `${link.from_device_id}::${neighborKey}`;
    const existing = bestLinks.get(key);
    if (!existing || protoRank(link.link_type) < protoRank(existing.link_type)) {
      bestLinks.set(key, link);
    }
  }
  const links = Array.from(bestLinks.values());

  // Build synthetic external nodes from unresolved neighbor entries
  const externalMap = new Map<string, {
    id: string;
    name: string;
    address: string;
    platform: string;
    mac: string;
    caps: string;
  }>();

  for (const link of links) {
    if (link.to_device_id) continue; // resolved — skip
    const key = link.neighbor_address || link.neighbor_mac || link.neighbor_identity || '';
    if (!key) continue;
    if (!externalMap.has(key)) {
      const safeId = key.replace(/[.: ]/g, '');
      externalMap.set(key, {
        id: `ext-${safeId}`,
        name: link.neighbor_identity || link.neighbor_address || 'Unknown',
        address: link.neighbor_address || '',
        platform: link.neighbor_platform || '',
        mac: link.neighbor_mac || '',
        caps: link.neighbor_caps || '',
      });
    }
  }

  res.json({ devices, links, externalNodes: Array.from(externalMap.values()) });
});

// POST /api/topology/discover - trigger neighbor discovery on all devices
router.post('/discover', requireWrite, async (_req: Request, res: Response) => {
  const devices = await query<{ id: number }>(`SELECT id FROM devices WHERE status='online'`);

  if (pollerService) {
    for (const d of devices) {
      await pollerService.scheduleDeviceSync(d.id, 'slow');
    }
  }

  res.json({ message: `Discovery triggered for ${devices.length} device(s)` });
});

export default router;
