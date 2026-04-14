import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HardDrive, Plus, Download, RotateCcw, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { backupsApi, devicesApi } from '../services/api';
import { useCanWrite } from '../hooks/useCanWrite';
import { format } from 'date-fns';
import clsx from 'clsx';

function formatBytes(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function BackupsPage() {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [selectedDevice, setSelectedDevice] = useState('');
  const [notes, setNotes] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [error, setError] = useState('');

  const { data: backups = [], isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: () => backupsApi.list().then((r) => r.data),
  });

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list().then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => backupsApi.create(parseInt(selectedDevice), notes || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] });
      setShowCreateForm(false);
      setSelectedDevice('');
      setNotes('');
      setError('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Backup failed');
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => backupsApi.restore(id),
    onSuccess: () => setRestoreConfirm(null),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Restore failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => backupsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] });
      setDeleteConfirm(null);
    },
  });

  const downloadBackup = async (id: number, filename: string) => {
    const res = await backupsApi.download(id);
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          Backups
          {backups.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500 dark:text-slate-400">
              ({backups.length} total)
            </span>
          )}
        </h1>
        {canWrite && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Backup
          </button>
        )}
      </div>

      {/* Create backup form */}
      {showCreateForm && (
        <div className="card p-5 border-blue-200 dark:border-blue-700">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">New Backup</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Device</label>
              <select
                className="input"
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
              >
                <option value="">Select a device...</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.ip_address})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <input
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Pre-upgrade backup..."
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => { setShowCreateForm(false); setError(''); }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!selectedDevice || createMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <HardDrive className="w-4 h-4" />
              )}
              {createMutation.isPending ? 'Creating...' : 'Create Backup'}
            </button>
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">
            Backup uses SSH export. Make sure SSH credentials are configured for this device.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">Loading...</div>
      ) : backups.length === 0 ? (
        <div className="card p-12 flex flex-col items-center gap-4 text-center">
          <HardDrive className="w-16 h-16 text-gray-300 dark:text-slate-600" />
          <div>
            <p className="font-medium text-gray-700 dark:text-slate-300">No backups yet</p>
            <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
              Create a backup to save your device configurations
            </p>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                <th className="table-header px-4 py-2.5 text-left">Device</th>
                <th className="table-header px-4 py-2.5 text-left">Filename</th>
                <th className="table-header px-4 py-2.5 text-left">Size</th>
                <th className="table-header px-4 py-2.5 text-left">Created</th>
                <th className="table-header px-4 py-2.5 text-left">Notes</th>
                <th className="table-header px-4 py-2.5 text-left w-32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700 table-zebra">
              {backups.map((backup) => (
                <tr key={backup.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                    {backup.device_name || '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-slate-400">
                    {backup.filename}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400">
                    {formatBytes(backup.size_bytes)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400">
                    {format(new Date(backup.created_at), 'MMM d, yyyy HH:mm')}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 dark:text-slate-500 italic">
                    {backup.notes || ''}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => downloadBackup(backup.id, backup.filename)}
                        className="p-1.5 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                        title="Download"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>

                      {canWrite && (restoreConfirm === backup.id ? (
                        <div className="flex gap-1 text-xs">
                          <button
                            onClick={() => restoreMutation.mutate(backup.id)}
                            disabled={restoreMutation.isPending}
                            className="text-orange-500 hover:text-orange-600 font-medium"
                          >
                            {restoreMutation.isPending ? '...' : 'Restore?'}
                          </button>
                          <button
                            onClick={() => setRestoreConfirm(null)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRestoreConfirm(backup.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                          title="Restore"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      ))}

                      {canWrite && (deleteConfirm === backup.id ? (
                        <div className="flex gap-1 text-xs">
                          <button
                            onClick={() => deleteMutation.mutate(backup.id)}
                            className="text-red-500 hover:text-red-600 font-medium"
                          >
                            Delete?
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(backup.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
