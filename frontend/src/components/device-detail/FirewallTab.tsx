import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, AlertCircle, RefreshCw, Check, X, ArrowRightLeft, Shield } from 'lucide-react';
import { devicesApi } from '../../services/api';
import { useCanWrite } from '../../hooks/useCanWrite';
import clsx from 'clsx';

// ─── Shared types ─────────────────────────────────────────────────────────────
interface FirewallRule extends Record<string, string> {
  '.id': string;
  chain: string;
  action: string;
}

interface NatRule extends Record<string, string> {
  '.id': string;
  chain: string;
  action: string;
}

// ─── Firewall constants ───────────────────────────────────────────────────────
const COMMON_CHAINS   = ['forward', 'input', 'output'];
const FW_ACTIONS      = ['accept', 'drop', 'reject', 'log', 'passthrough', 'jump', 'return'];
const PROTOCOLS       = ['', 'tcp', 'udp', 'icmp', 'ip', 'gre', 'ospf'];
const CONN_STATES     = ['new', 'established', 'related', 'invalid'];

const ACTION_COLOR: Record<string, string> = {
  accept: 'text-green-600 dark:text-green-400',
  drop: 'text-red-600 dark:text-red-400',
  reject: 'text-red-500 dark:text-red-400',
  log: 'text-yellow-600 dark:text-yellow-400',
  passthrough: 'text-blue-600 dark:text-blue-400',
  jump: 'text-purple-600 dark:text-purple-400',
  return: 'text-indigo-500 dark:text-indigo-400',
  masquerade: 'text-orange-600 dark:text-orange-400',
  'src-nat': 'text-blue-600 dark:text-blue-400',
  'dst-nat': 'text-cyan-600 dark:text-cyan-400',
  netmap: 'text-teal-600 dark:text-teal-400',
  redirect: 'text-violet-600 dark:text-violet-400',
};

// ─── NAT constants ────────────────────────────────────────────────────────────
const NAT_CHAINS  = ['srcnat', 'dstnat'];
const NAT_ACTIONS = ['masquerade', 'src-nat', 'dst-nat', 'netmap', 'redirect', 'accept', 'drop', 'return', 'jump', 'passthrough'];

// ─── Firewall rule form ───────────────────────────────────────────────────────
interface RuleForm {
  chain: string; action: string;
  src_address: string; dst_address: string;
  protocol: string; src_port: string; dst_port: string;
  in_interface: string; out_interface: string;
  connection_state: string; jump_target: string;
  comment: string; disabled: boolean;
}

const EMPTY_FW_FORM: RuleForm = {
  chain: 'forward', action: 'accept',
  src_address: '', dst_address: '', protocol: '',
  src_port: '', dst_port: '',
  in_interface: '', out_interface: '',
  connection_state: '', jump_target: '',
  comment: '', disabled: false,
};

function ruleToForm(r: FirewallRule): RuleForm {
  const states = (r['connection-state'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    chain: r.chain ?? 'forward', action: r.action ?? 'accept',
    src_address: r['src-address'] ?? '', dst_address: r['dst-address'] ?? '',
    protocol: r.protocol ?? '',
    src_port: r['src-port'] ?? '', dst_port: r['dst-port'] ?? '',
    in_interface: r['in-interface'] ?? '', out_interface: r['out-interface'] ?? '',
    connection_state: states.join(','), jump_target: r['jump-target'] ?? '',
    comment: r.comment ?? '', disabled: r.disabled === 'true',
  };
}

function formToPayload(f: RuleForm): Record<string, unknown> {
  const p: Record<string, unknown> = { chain: f.chain, action: f.action, disabled: f.disabled ? 'yes' : 'no' };
  if (f.src_address)      p.src_address = f.src_address;
  if (f.dst_address)      p.dst_address = f.dst_address;
  if (f.protocol)         p.protocol = f.protocol;
  if (f.src_port)         p.src_port = f.src_port;
  if (f.dst_port)         p.dst_port = f.dst_port;
  if (f.in_interface)     p.in_interface = f.in_interface;
  if (f.out_interface)    p.out_interface = f.out_interface;
  if (f.connection_state) p.connection_state = f.connection_state;
  if (f.jump_target)      p.jump_target = f.jump_target;
  if (f.comment)          p.comment = f.comment;
  return p;
}

// ─── NAT rule form ────────────────────────────────────────────────────────────
interface NatForm {
  chain: string; action: string;
  src_address: string; dst_address: string;
  protocol: string; src_port: string; dst_port: string;
  in_interface: string; out_interface: string;
  to_addresses: string; to_ports: string;
  comment: string; disabled: boolean;
}

const EMPTY_NAT_FORM: NatForm = {
  chain: 'srcnat', action: 'masquerade',
  src_address: '', dst_address: '', protocol: '',
  src_port: '', dst_port: '',
  in_interface: '', out_interface: '',
  to_addresses: '', to_ports: '',
  comment: '', disabled: false,
};

function natRuleToForm(r: NatRule): NatForm {
  return {
    chain: r.chain ?? 'srcnat', action: r.action ?? 'masquerade',
    src_address: r['src-address'] ?? '', dst_address: r['dst-address'] ?? '',
    protocol: r.protocol ?? '',
    src_port: r['src-port'] ?? '', dst_port: r['dst-port'] ?? '',
    in_interface: r['in-interface'] ?? '', out_interface: r['out-interface'] ?? '',
    to_addresses: r['to-addresses'] ?? '', to_ports: r['to-ports'] ?? '',
    comment: r.comment ?? '', disabled: r.disabled === 'true',
  };
}

function natFormToPayload(f: NatForm): Record<string, unknown> {
  const p: Record<string, unknown> = { chain: f.chain, action: f.action, disabled: f.disabled ? 'yes' : 'no' };
  if (f.src_address)  p.src_address  = f.src_address;
  if (f.dst_address)  p.dst_address  = f.dst_address;
  if (f.protocol)     p.protocol     = f.protocol;
  if (f.src_port)     p.src_port     = f.src_port;
  if (f.dst_port)     p.dst_port     = f.dst_port;
  if (f.in_interface) p.in_interface = f.in_interface;
  if (f.out_interface)p.out_interface= f.out_interface;
  if (f.to_addresses) p.to_addresses = f.to_addresses;
  if (f.to_ports)     p.to_ports     = f.to_ports;
  if (f.comment)      p.comment      = f.comment;
  return p;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function errMsg(err: unknown) {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Operation failed';
}

function DisabledToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium text-gray-700 dark:text-slate-300">Disabled</label>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={clsx('relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
          value ? 'bg-gray-300 dark:bg-slate-600' : 'bg-blue-600')}
      >
        <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          value ? 'translate-x-1' : 'translate-x-6')} />
      </button>
    </div>
  );
}

// ─── Firewall Rule Modal ──────────────────────────────────────────────────────
function RuleModal({
  title, form, setForm, onSave, onClose, isPending, error,
}: {
  title: string; form: RuleForm;
  setForm: React.Dispatch<React.SetStateAction<RuleForm>>;
  onSave: () => void; onClose: () => void;
  isPending: boolean; error: string;
}) {
  const set = (key: keyof RuleForm, val: string | boolean) => setForm(f => ({ ...f, [key]: val }));

  const toggleConnState = (state: string) => {
    const current = form.connection_state ? form.connection_state.split(',').map(s => s.trim()).filter(Boolean) : [];
    const next = current.includes(state) ? current.filter(s => s !== state) : [...current, state];
    set('connection_state', next.join(','));
  };

  const connStates = form.connection_state ? form.connection_state.split(',').map(s => s.trim()).filter(Boolean) : [];
  const hasPorts = form.protocol === 'tcp' || form.protocol === 'udp' || form.protocol === '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="card w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-slate-700">
          <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5">
          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">Basic</h4>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Chain</label>
                  <input list="chains-list" className="input" value={form.chain} onChange={e => set('chain', e.target.value)} placeholder="forward" />
                  <datalist id="chains-list">{COMMON_CHAINS.map(c => <option key={c} value={c} />)}</datalist>
                </div>
                <div>
                  <label className="label">Action</label>
                  <select className="input" value={form.action} onChange={e => set('action', e.target.value)}>
                    {FW_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>
              {form.action === 'jump' && (
                <div>
                  <label className="label">Jump Target Chain</label>
                  <input className="input" value={form.jump_target} onChange={e => set('jump_target', e.target.value)} placeholder="custom-chain" />
                </div>
              )}
              <div>
                <label className="label">Comment</label>
                <input className="input" value={form.comment} onChange={e => set('comment', e.target.value)} placeholder="Optional description…" />
              </div>
              <DisabledToggle value={form.disabled} onChange={v => set('disabled', v)} />
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">Address &amp; Port</h4>
            <div className="space-y-3">
              <div>
                <label className="label">Protocol</label>
                <select className="input" value={form.protocol} onChange={e => set('protocol', e.target.value)}>
                  <option value="">— any —</option>
                  {PROTOCOLS.filter(Boolean).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Src Address</label>
                  <input className="input font-mono" value={form.src_address} onChange={e => set('src_address', e.target.value)} placeholder="0.0.0.0/0" /></div>
                <div><label className="label">Dst Address</label>
                  <input className="input font-mono" value={form.dst_address} onChange={e => set('dst_address', e.target.value)} placeholder="0.0.0.0/0" /></div>
              </div>
              {hasPorts && (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Src Port</label>
                    <input className="input font-mono" value={form.src_port} onChange={e => set('src_port', e.target.value)} placeholder="e.g. 80 or 1024-2048" /></div>
                  <div><label className="label">Dst Port</label>
                    <input className="input font-mono" value={form.dst_port} onChange={e => set('dst_port', e.target.value)} placeholder="e.g. 443" /></div>
                </div>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">Interface</h4>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">In Interface</label>
                <input className="input font-mono" value={form.in_interface} onChange={e => set('in_interface', e.target.value)} placeholder="ether1" /></div>
              <div><label className="label">Out Interface</label>
                <input className="input font-mono" value={form.out_interface} onChange={e => set('out_interface', e.target.value)} placeholder="ether2" /></div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">Connection State</h4>
            <div className="flex flex-wrap gap-2">
              {CONN_STATES.map(s => (
                <button key={s} type="button" onClick={() => toggleConnState(s)}
                  className={clsx('px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                    connStates.includes(s)
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-blue-400'
                  )}>{s}</button>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={onSave} disabled={isPending} className="btn-primary flex items-center gap-2">
              {isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save Rule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── NAT Rule Modal ───────────────────────────────────────────────────────────
function NatModal({
  title, form, setForm, onSave, onClose, isPending, error,
}: {
  title: string; form: NatForm;
  setForm: React.Dispatch<React.SetStateAction<NatForm>>;
  onSave: () => void; onClose: () => void;
  isPending: boolean; error: string;
}) {
  const set = (key: keyof NatForm, val: string | boolean) => setForm(f => ({ ...f, [key]: val }));

  const needsTarget = ['src-nat', 'dst-nat', 'netmap'].includes(form.action);
  const needsPort   = ['redirect', 'dst-nat', 'src-nat'].includes(form.action);
  const hasPorts    = form.protocol === 'tcp' || form.protocol === 'udp' || form.protocol === '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="card w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-slate-700">
          <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5">
          {/* Basic */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">Basic</h4>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Chain</label>
                  <select className="input" value={form.chain} onChange={e => set('chain', e.target.value)}>
                    {NAT_CHAINS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Action</label>
                  <select className="input" value={form.action} onChange={e => set('action', e.target.value)}>
                    {NAT_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>
              {/* action description */}
              <p className="text-xs text-gray-400 dark:text-slate-500">
                {form.action === 'masquerade'  && 'Replaces source IP with router\'s outgoing interface IP. Best for dynamic WAN IPs.'}
                {form.action === 'src-nat'      && 'Replaces source IP with a static address (specify in To Addresses).'}
                {form.action === 'dst-nat'      && 'Replaces destination IP/port, used for port forwarding.'}
                {form.action === 'netmap'       && 'One-to-one address translation. Requires To Addresses.'}
                {form.action === 'redirect'     && 'Redirects packets to the router itself (specify To Ports for target port).'}
              </p>
              <div>
                <label className="label">Comment</label>
                <input className="input" value={form.comment} onChange={e => set('comment', e.target.value)} placeholder="Optional description…" />
              </div>
              <DisabledToggle value={form.disabled} onChange={v => set('disabled', v)} />
            </div>
          </div>

          {/* Match */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">Match Criteria</h4>
            <div className="space-y-3">
              <div>
                <label className="label">Protocol</label>
                <select className="input" value={form.protocol} onChange={e => set('protocol', e.target.value)}>
                  <option value="">— any —</option>
                  {PROTOCOLS.filter(Boolean).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Src Address</label>
                  <input className="input font-mono" value={form.src_address} onChange={e => set('src_address', e.target.value)} placeholder="0.0.0.0/0" /></div>
                <div><label className="label">Dst Address</label>
                  <input className="input font-mono" value={form.dst_address} onChange={e => set('dst_address', e.target.value)} placeholder="0.0.0.0/0" /></div>
              </div>
              {hasPorts && (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Src Port</label>
                    <input className="input font-mono" value={form.src_port} onChange={e => set('src_port', e.target.value)} placeholder="e.g. 80" /></div>
                  <div><label className="label">Dst Port</label>
                    <input className="input font-mono" value={form.dst_port} onChange={e => set('dst_port', e.target.value)} placeholder="e.g. 443" /></div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">In Interface</label>
                  <input className="input font-mono" value={form.in_interface} onChange={e => set('in_interface', e.target.value)} placeholder="ether1" /></div>
                <div><label className="label">Out Interface</label>
                  <input className="input font-mono" value={form.out_interface} onChange={e => set('out_interface', e.target.value)} placeholder="ether2" /></div>
              </div>
            </div>
          </div>

          {/* Translation target */}
          {(needsTarget || needsPort) && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">Translation Target</h4>
              <div className="space-y-3">
                {needsTarget && (
                  <div><label className="label">To Addresses</label>
                    <input className="input font-mono" value={form.to_addresses} onChange={e => set('to_addresses', e.target.value)} placeholder="e.g. 192.168.1.10 or 192.168.1.10-192.168.1.20" /></div>
                )}
                {needsPort && (
                  <div><label className="label">To Ports</label>
                    <input className="input font-mono" value={form.to_ports} onChange={e => set('to_ports', e.target.value)} placeholder="e.g. 8080 or 8080-8090" /></div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={onSave} disabled={isPending} className="btn-primary flex items-center gap-2">
              {isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save Rule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── NAT Card (router-only) ───────────────────────────────────────────────────
function NatCard({ deviceId }: { deviceId: number }) {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

  const [chainFilter, setChainFilter] = useState('all');
  const [editingRule, setEditingRule] = useState<NatRule | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<NatForm>(EMPTY_NAT_FORM);
  const [mutError, setMutError] = useState('');

  const { data: rules = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['nat', deviceId],
    queryFn: () => devicesApi.getNat(deviceId).then(r => r.data as NatRule[]),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['nat', deviceId] });

  const addMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => devicesApi.addNatRule(deviceId, data),
    onSuccess: () => { invalidate(); setShowAdd(false); setMutError(''); },
    onError: (err: unknown) => setMutError(errMsg(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      devicesApi.updateNatRule(deviceId, id, data),
    onSuccess: () => { invalidate(); setEditingRule(null); setMutError(''); },
    onError: (err: unknown) => setMutError(errMsg(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => devicesApi.deleteNatRule(deviceId, id),
    onSuccess: () => { invalidate(); setMutError(''); },
    onError: (err: unknown) => setMutError(errMsg(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      devicesApi.updateNatRule(deviceId, id, { disabled: disabled ? 'yes' : 'no' }),
    onSuccess: () => invalidate(),
  });

  const openAdd = () => {
    setForm({ ...EMPTY_NAT_FORM, chain: chainFilter !== 'all' ? chainFilter : 'srcnat' });
    setMutError('');
    setShowAdd(true);
  };

  const openEdit = (rule: NatRule) => {
    setForm(natRuleToForm(rule));
    setMutError('');
    setEditingRule(rule);
  };

  const allChains = ['all', ...Array.from(new Set(rules.map(r => r.chain).filter(Boolean))).sort()];
  const filtered = chainFilter === 'all' ? rules : rules.filter(r => r.chain === chainFilter);

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2 pt-2">
        <div className="w-7 h-7 bg-orange-50 dark:bg-orange-900/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <ArrowRightLeft className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Network Address Translation (NAT)</h3>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
          {allChains.map(c => (
            <button key={c} onClick={() => setChainFilter(c)}
              className={clsx('px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize',
                chainFilter === c
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
              )}>
              {c === 'all' ? `All (${rules.length})` : `${c} (${rules.filter(r => r.chain === c).length})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary flex items-center gap-1.5 text-xs py-1.5">
            <RefreshCw className={clsx('w-3.5 h-3.5', isFetching && 'animate-spin')} /> Refresh
          </button>
          {canWrite && (
            <button onClick={openAdd} className="btn-primary flex items-center gap-1.5 text-xs py-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Rule
            </button>
          )}
        </div>
      </div>

      {mutError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-600 dark:text-red-400">{mutError}</p>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-6 text-gray-400"><RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading NAT rules…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-gray-400 dark:text-slate-500">
          No NAT rules{chainFilter !== 'all' ? ` in chain "${chainFilter}"` : ''}.
        </div>
      ) : (
        <div className="card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50">
                <th className="table-header px-3 py-2.5 text-left w-8">#</th>
                <th className="table-header px-3 py-2.5 text-left">Chain</th>
                <th className="table-header px-3 py-2.5 text-left">Action</th>
                <th className="table-header px-3 py-2.5 text-left">Proto</th>
                <th className="table-header px-3 py-2.5 text-left">Src</th>
                <th className="table-header px-3 py-2.5 text-left">Dst</th>
                <th className="table-header px-3 py-2.5 text-left">Ports</th>
                <th className="table-header px-3 py-2.5 text-left">To</th>
                <th className="table-header px-3 py-2.5 text-left">Comment</th>
                {canWrite && <th className="table-header px-3 py-2.5 w-24" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700 table-zebra">
              {filtered.map((r, i) => {
                const disabled = r.disabled === 'true';
                const srcPort  = r['src-port'];
                const dstPort  = r['dst-port'];
                const portCell = [srcPort && `src:${srcPort}`, dstPort && `dst:${dstPort}`].filter(Boolean).join(' ');
                const toCell   = [
                  r['to-addresses'] && r['to-addresses'],
                  r['to-ports'] && `:${r['to-ports']}`,
                ].filter(Boolean).join('');
                return (
                  <tr key={r['.id'] ?? i} className={clsx('hover:bg-gray-50 dark:hover:bg-slate-700/30', disabled && 'opacity-40')}>
                    <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-slate-300">{r.chain}</td>
                    <td className={clsx('px-3 py-2 text-xs font-bold uppercase', ACTION_COLOR[r.action] ?? 'text-gray-500')}>
                      {r.action}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">{r.protocol || 'any'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">
                      {[r['src-address'], r['in-interface'] && `in:${r['in-interface']}`].filter(Boolean).join(' ') || 'any'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">
                      {[r['dst-address'], r['out-interface'] && `out:${r['out-interface']}`].filter(Boolean).join(' ') || 'any'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">{portCell || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-orange-600 dark:text-orange-400">{toCell || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500 italic max-w-[120px] truncate">{r.comment || ''}</td>
                    {canWrite && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            title={disabled ? 'Enable' : 'Disable'}
                            onClick={() => toggleMutation.mutate({ id: r['.id'], disabled: !disabled })}
                            className={clsx('p-1 rounded transition-colors', disabled ? 'text-gray-400 hover:text-green-500' : 'text-green-500 hover:text-gray-400')}
                          >
                            <span className={clsx('inline-block w-2 h-2 rounded-full', disabled ? 'bg-gray-400' : 'bg-green-500')} />
                          </button>
                          <button onClick={() => openEdit(r)} className="p-1 rounded text-gray-400 hover:text-blue-500 transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => { if (confirm('Delete this NAT rule?')) deleteMutation.mutate(r['.id']); }}
                            className="p-1 rounded text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <NatModal
          title="Add NAT Rule"
          form={form} setForm={setForm}
          onSave={() => addMutation.mutate(natFormToPayload(form))}
          onClose={() => setShowAdd(false)}
          isPending={addMutation.isPending}
          error={mutError}
        />
      )}
      {editingRule && (
        <NatModal
          title={`Edit NAT Rule #${rules.indexOf(editingRule) + 1}`}
          form={form} setForm={setForm}
          onSave={() => updateMutation.mutate({ id: editingRule['.id'], data: natFormToPayload(form) })}
          onClose={() => setEditingRule(null)}
          isPending={updateMutation.isPending}
          error={mutError}
        />
      )}
    </div>
  );
}

// ─── Main FirewallTab ─────────────────────────────────────────────────────────
export default function FirewallTab({ deviceId, deviceType }: { deviceId: number; deviceType?: string }) {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

  const [chainFilter, setChainFilter] = useState('all');
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<RuleForm>(EMPTY_FW_FORM);
  const [mutError, setMutError] = useState('');

  const { data: rules = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['firewall', deviceId],
    queryFn: () => devicesApi.getFirewall(deviceId).then(r => r.data as FirewallRule[]),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['firewall', deviceId] });

  const addMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => devicesApi.addFirewallRule(deviceId, data),
    onSuccess: () => { invalidate(); setShowAdd(false); setMutError(''); },
    onError: (err: unknown) => setMutError(errMsg(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      devicesApi.updateFirewallRule(deviceId, id, data),
    onSuccess: () => { invalidate(); setEditingRule(null); setMutError(''); },
    onError: (err: unknown) => setMutError(errMsg(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => devicesApi.deleteFirewallRule(deviceId, id),
    onSuccess: () => invalidate(),
    onError: (err: unknown) => setMutError(errMsg(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      devicesApi.updateFirewallRule(deviceId, id, { disabled: disabled ? 'yes' : 'no' }),
    onSuccess: () => invalidate(),
  });

  const openAdd = () => {
    setForm({ ...EMPTY_FW_FORM, chain: chainFilter !== 'all' ? chainFilter : 'forward' });
    setMutError('');
    setShowAdd(true);
  };

  const openEdit = (rule: FirewallRule) => {
    setForm(ruleToForm(rule));
    setMutError('');
    setEditingRule(rule);
  };

  const allChains = ['all', ...Array.from(new Set(rules.map(r => r.chain).filter(Boolean))).sort()];
  const filtered  = chainFilter === 'all' ? rules : rules.filter(r => r.chain === chainFilter);

  if (isLoading) return <div className="text-center py-8 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-4">
      {/* Section heading */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <Shield className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Firewall Rules</h3>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg flex-wrap">
          {allChains.map(c => (
            <button key={c} onClick={() => setChainFilter(c)}
              className={clsx('px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize',
                chainFilter === c
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
              )}>
              {c === 'all' ? `All (${rules.length})` : `${c} (${rules.filter(r => r.chain === c).length})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary flex items-center gap-1.5 text-xs py-1.5">
            <RefreshCw className={clsx('w-3.5 h-3.5', isFetching && 'animate-spin')} /> Refresh
          </button>
          {canWrite && (
            <button onClick={openAdd} className="btn-primary flex items-center gap-1.5 text-xs py-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Rule
            </button>
          )}
        </div>
      </div>

      {mutError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-600 dark:text-red-400">{mutError}</p>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-gray-400 dark:text-slate-500">
          No firewall rules{chainFilter !== 'all' ? ` in chain "${chainFilter}"` : ''}.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50">
                <th className="table-header px-3 py-2.5 text-left w-8">#</th>
                <th className="table-header px-3 py-2.5 text-left">Chain</th>
                <th className="table-header px-3 py-2.5 text-left">Action</th>
                <th className="table-header px-3 py-2.5 text-left">Protocol</th>
                <th className="table-header px-3 py-2.5 text-left">Src</th>
                <th className="table-header px-3 py-2.5 text-left">Dst</th>
                <th className="table-header px-3 py-2.5 text-left">Ports</th>
                <th className="table-header px-3 py-2.5 text-left">State</th>
                <th className="table-header px-3 py-2.5 text-left">Comment</th>
                {canWrite && <th className="table-header px-3 py-2.5 w-24" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700 table-zebra">
              {filtered.map((r, i) => {
                const disabled = r.disabled === 'true';
                const srcPort  = r['src-port'];
                const dstPort  = r['dst-port'];
                const portCell = [srcPort && `src:${srcPort}`, dstPort && `dst:${dstPort}`].filter(Boolean).join(' ');
                return (
                  <tr key={r['.id'] ?? i} className={clsx('hover:bg-gray-50 dark:hover:bg-slate-700/30', disabled && 'opacity-40')}>
                    <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-slate-300">{r.chain}</td>
                    <td className={clsx('px-3 py-2 text-xs font-bold uppercase', ACTION_COLOR[r.action] ?? 'text-gray-500')}>
                      {r.action}{r['jump-target'] ? ` → ${r['jump-target']}` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">{r.protocol || 'any'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">
                      {[r['src-address'], r['in-interface'] && `in:${r['in-interface']}`].filter(Boolean).join(' ') || 'any'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">
                      {[r['dst-address'], r['out-interface'] && `out:${r['out-interface']}`].filter(Boolean).join(' ') || 'any'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">{portCell || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">{r['connection-state'] || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500 italic max-w-[140px] truncate">{r.comment || ''}</td>
                    {canWrite && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            title={disabled ? 'Enable' : 'Disable'}
                            onClick={() => toggleMutation.mutate({ id: r['.id'], disabled: !disabled })}
                            className={clsx('p-1 rounded transition-colors', disabled ? 'text-gray-400 hover:text-green-500' : 'text-green-500 hover:text-gray-400')}
                          >
                            <span className={clsx('inline-block w-2 h-2 rounded-full', disabled ? 'bg-gray-400' : 'bg-green-500')} />
                          </button>
                          <button onClick={() => openEdit(r)} className="p-1 rounded text-gray-400 hover:text-blue-500 transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => { if (confirm('Delete this firewall rule?')) deleteMutation.mutate(r['.id']); }}
                            className="p-1 rounded text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <RuleModal
          title="Add Firewall Rule"
          form={form} setForm={setForm}
          onSave={() => addMutation.mutate(formToPayload(form))}
          onClose={() => setShowAdd(false)}
          isPending={addMutation.isPending}
          error={mutError}
        />
      )}
      {editingRule && (
        <RuleModal
          title={`Edit Rule #${rules.indexOf(editingRule) + 1}`}
          form={form} setForm={setForm}
          onSave={() => updateMutation.mutate({ id: editingRule['.id'], data: formToPayload(form) })}
          onClose={() => setEditingRule(null)}
          isPending={updateMutation.isPending}
          error={mutError}
        />
      )}

      {/* NAT card — routers only */}
      {deviceType === 'router' && (
        <>
          <div className="border-t border-gray-200 dark:border-slate-700 pt-2" />
          <NatCard deviceId={deviceId} />
        </>
      )}
    </div>
  );
}
