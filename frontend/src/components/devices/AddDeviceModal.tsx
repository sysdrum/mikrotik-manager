import { useState, FormEvent } from 'react';
import { X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { devicesApi } from '../../services/api';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
  prefill?: { name?: string; ip_address?: string };
}

export default function AddDeviceModal({ onClose, onSuccess, prefill }: Props) {
  const [form, setForm] = useState({
    name: prefill?.name || '',
    ip_address: prefill?.ip_address || '',
    api_port: '8728',
    api_username: 'admin',
    api_password: '',
    ssh_port: '22',
    ssh_username: '',
    ssh_password: '',
    device_type: 'router',
    notes: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.ip_address || !form.api_username || !form.api_password) {
      setError('Name, IP address, username, and password are required');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await devicesApi.create({
        ...form,
        api_port: parseInt(form.api_port),
        ssh_port: parseInt(form.ssh_port),
        device_type: form.device_type as import('../../types').DeviceType,
      });
      onSuccess();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed to add device');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="card w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add Device</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">Device Name *</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Core Switch"
              />
            </div>
            <div>
              <label className="label">IP Address *</label>
              <input
                className="input"
                value={form.ip_address}
                onChange={(e) => set('ip_address', e.target.value)}
                placeholder="192.168.1.1"
              />
            </div>
            <div>
              <label className="label">Device Type</label>
              <select
                className="input"
                value={form.device_type}
                onChange={(e) => set('device_type', e.target.value)}
              >
                <option value="router">Router</option>
                <option value="switch">Switch</option>
                <option value="wireless_ap">Wireless AP</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {/* API credentials */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              RouterOS API Credentials
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Username *</label>
                <input
                  className="input"
                  value={form.api_username}
                  onChange={(e) => set('api_username', e.target.value)}
                  placeholder="admin"
                />
              </div>
              <div>
                <label className="label">API Port</label>
                <input
                  className="input"
                  type="number"
                  value={form.api_port}
                  onChange={(e) => set('api_port', e.target.value)}
                  placeholder="8728"
                />
              </div>
              <div className="col-span-2">
                <label className="label">Password *</label>
                <input
                  className="input"
                  type="password"
                  value={form.api_password}
                  onChange={(e) => set('api_password', e.target.value)}
                  placeholder="RouterOS API password"
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>

          {/* SSH credentials (optional) */}
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider select-none">
              SSH Credentials (optional, for backup/restore)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label">SSH Username</label>
                <input
                  className="input"
                  value={form.ssh_username}
                  onChange={(e) => set('ssh_username', e.target.value)}
                  placeholder="admin"
                />
              </div>
              <div>
                <label className="label">SSH Port</label>
                <input
                  className="input"
                  type="number"
                  value={form.ssh_port}
                  onChange={(e) => set('ssh_port', e.target.value)}
                  placeholder="22"
                />
              </div>
              <div className="col-span-2">
                <label className="label">SSH Password</label>
                <input
                  className="input"
                  type="password"
                  value={form.ssh_password}
                  onChange={(e) => set('ssh_password', e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
          </details>

          <div>
            <label className="label">Notes (optional)</label>
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Any notes about this device..."
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
              <p className="text-sm text-blue-600 dark:text-blue-400">
                Testing connection and collecting device data...
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              Add Device
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
