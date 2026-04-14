import { useQuery } from '@tanstack/react-query';
import { devicesApi } from '../../services/api';
import clsx from 'clsx';

export default function InterfacesTab({ deviceId }: { deviceId: number }) {
  const { data: interfaces = [], isLoading } = useQuery({
    queryKey: ['interfaces', deviceId],
    queryFn: () => devicesApi.getInterfaces(deviceId).then((r) => r.data),
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="text-center py-8 text-gray-400">Loading...</div>;
  if (!interfaces.length) return (
    <div className="text-center py-8 text-gray-400 dark:text-slate-500">
      No interfaces found. Sync the device to collect data.
    </div>
  );

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50">
            <th className="table-header px-4 py-2.5 text-left">Name</th>
            <th className="table-header px-4 py-2.5 text-left">Type</th>
            <th className="table-header px-4 py-2.5 text-left">Status</th>
            <th className="table-header px-4 py-2.5 text-left">MAC Address</th>
            <th className="table-header px-4 py-2.5 text-left">MTU</th>
            <th className="table-header px-4 py-2.5 text-left">Speed</th>
            <th className="table-header px-4 py-2.5 text-left">Comment</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-700 table-zebra">
          {interfaces.map((iface) => (
            <tr key={iface.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
              <td className="px-4 py-2.5 font-mono font-semibold text-gray-900 dark:text-white">
                {iface.name}
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400 capitalize">
                {iface.type || '—'}
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={clsx(
                    'inline-flex items-center gap-1.5 text-xs font-medium',
                    iface.disabled
                      ? 'text-gray-400'
                      : iface.running
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-500 dark:text-red-400'
                  )}
                >
                  <span
                    className={clsx(
                      'w-1.5 h-1.5 rounded-full',
                      iface.disabled ? 'bg-gray-400' : iface.running ? 'bg-green-500' : 'bg-red-500'
                    )}
                  />
                  {iface.disabled ? 'Disabled' : iface.running ? 'Running' : 'Down'}
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-slate-400">
                {iface.mac_address || '—'}
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400">
                {iface.mtu || '—'}
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400">
                {iface.speed || '—'}
              </td>
              <td className="px-4 py-2.5 text-gray-400 dark:text-slate-500 italic">
                {iface.comment || ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
