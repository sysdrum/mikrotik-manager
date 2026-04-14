import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Layers, CheckCircle, XCircle, HelpCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { switchesApi } from '../services/api';
import clsx from 'clsx';

interface SwitchDevice {
  id: number;
  name: string;
  ip_address: string;
  model?: string;
  status: string;
  last_seen?: string;
  ros_version?: string;
  rack_name?: string;
  rack_slot?: string;
  ports_up: number;
  ports_down: number;
  ports_disabled: number;
  ports_total: number;
}

function timeAgo(ts: string | undefined): string {
  if (!ts) return 'Never';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      status === 'online'  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
      status === 'offline' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                             'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400'
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full',
        status === 'online' ? 'bg-green-500' : status === 'offline' ? 'bg-red-500' : 'bg-gray-400'
      )} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function SwitchesOverviewPage() {
  const { data: switches = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['switches'],
    queryFn: () => switchesApi.list().then(r => r.data as unknown as SwitchDevice[]),
    refetchInterval: 30_000,
  });

  const online  = switches.filter(s => s.status === 'online').length;
  const offline = switches.filter(s => s.status === 'offline').length;
  const unknown = switches.filter(s => s.status !== 'online' && s.status !== 'offline').length;

  const kpis = [
    { label: 'Total Switches', value: switches.length, icon: Layers,       color: 'text-blue-600 dark:text-blue-400',  bg: 'bg-blue-50 dark:bg-blue-900/20' },
    { label: 'Online',         value: online,           icon: CheckCircle,  color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
    { label: 'Offline',        value: offline,          icon: XCircle,      color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-50 dark:bg-red-900/20' },
    { label: 'Unknown',        value: unknown,          icon: HelpCircle,   color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
  ];

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-gray-400"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading switches…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Switches</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Overview of all managed switch devices
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary flex items-center gap-1.5 text-xs py-1.5">
            <RefreshCw className={clsx('w-3.5 h-3.5', isFetching && 'animate-spin')} /> Refresh
          </button>
          <Link to="/devices" className="btn-secondary flex items-center gap-1.5 text-xs py-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> Manage Devices
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="card p-5 flex items-center gap-4">
            <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', bg)}>
              <Icon className={clsx('w-5 h-5', color)} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* No switches */}
      {switches.length === 0 && (
        <div className="card p-12 text-center">
          <Layers className="w-12 h-12 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-slate-400 font-medium">No switches found</p>
          <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
            Add devices with type <span className="font-mono">switch</span> to see them here.
          </p>
          <Link to="/devices" className="btn-primary inline-flex items-center gap-2 mt-4 text-sm">
            <ExternalLink className="w-4 h-4" /> Manage Devices
          </Link>
        </div>
      )}

      {/* Switch cards grid */}
      {switches.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {switches.map(sw => {
            const portPct = sw.ports_total > 0 ? Math.round((sw.ports_up / sw.ports_total) * 100) : 0;
            return (
              <div key={sw.id} className="card p-5 flex flex-col gap-4">
                {/* Card header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate">{sw.name}</h3>
                    <p className="text-xs font-mono text-gray-500 dark:text-slate-400 mt-0.5">{sw.ip_address}</p>
                  </div>
                  <StatusBadge status={sw.status} />
                </div>

                {/* Details */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {sw.model && (
                    <>
                      <span className="text-gray-500 dark:text-slate-400">Model</span>
                      <span className="text-gray-900 dark:text-white font-medium truncate">{sw.model}</span>
                    </>
                  )}
                  {sw.ros_version && (
                    <>
                      <span className="text-gray-500 dark:text-slate-400">RouterOS</span>
                      <span className="text-gray-900 dark:text-white font-mono">{sw.ros_version}</span>
                    </>
                  )}
                  {sw.rack_name && (
                    <>
                      <span className="text-gray-500 dark:text-slate-400">Rack</span>
                      <span className="text-gray-900 dark:text-white">{sw.rack_name}{sw.rack_slot ? ` / ${sw.rack_slot}` : ''}</span>
                    </>
                  )}
                  <span className="text-gray-500 dark:text-slate-400">Last seen</span>
                  <span className="text-gray-900 dark:text-white">{timeAgo(sw.last_seen)}</span>
                </div>

                {/* Port utilisation */}
                {sw.ports_total > 0 && (
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-gray-500 dark:text-slate-400">Ports</span>
                      <span className="text-gray-700 dark:text-slate-300">
                        <span className="text-green-600 dark:text-green-400 font-medium">{sw.ports_up}</span>
                        {' / '}
                        {sw.ports_total} up
                        {sw.ports_down > 0 && <span className="text-red-500 ml-1">· {sw.ports_down} down</span>}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${portPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Link */}
                <Link
                  to={`/devices/${sw.id}`}
                  className="btn-secondary text-xs py-1.5 text-center"
                >
                  View Device →
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
