import { useNodes, TIME_SLOTS } from './hooks/useNodes';
import type { SlotSuggestion } from './hooks/useNodes';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, AlertOctagon, RotateCcw, RefreshCw, Calendar, ArrowRightLeft, Clock, CheckCircle, Users, Sparkles, Bell, Repeat } from 'lucide-react';
import { NetworkGraph } from './components/NetworkGraph';
import { useState, useEffect, useCallback } from 'react';

/* ── Preference type ──────────────────────────────────────────── */
type Preference = 'strict' | 'flex1' | 'flex2';
const PREF_MAP: Record<Preference, { label: string; preference: string; flexRange: number }> = {
  strict: { label: 'Strict slot only', preference: 'strict', flexRange: 0 },
  flex1:  { label: 'Flexible ±1 slot', preference: 'flexible', flexRange: 1 },
  flex2:  { label: 'Flexible ±2 slots', preference: 'flexible', flexRange: 2 },
};

/* ── Toast type ───────────────────────────────────────────────── */
interface Toast {
  id: string;
  eventId: string;
  type: 'auto_assign' | 'queue' | 'confirmed' | 'redirect';
  message: string;
  slotId?: string;
  nodeId?: string;
  suggestions?: SlotSuggestion[];
  isReschedule?: boolean;
}

export default function App() {
  const {
    nodes, logs, messageEvents, alerts,
    triggerBooking, triggerRelease, triggerConfirm,
    triggerFail, triggerRecover, triggerReset,
    removeMessageEvent, removeAlert,
  } = useNodes();

  const [preference, setPreference] = useState<Preference>('flex2');
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Dedup: track toast event_ids so we never show the same toast twice
  const [processedToastIds] = useState<Set<string>>(() => new Set());

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    // Dedup check
    if (toast.eventId && processedToastIds.has(toast.eventId)) return;
    if (toast.eventId) processedToastIds.add(toast.eventId);

    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000);
  }, [processedToastIds]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Process alerts → convert to toasts (deduplicated)
  useEffect(() => {
    if (alerts.length === 0) return;
    const ev = alerts[0];
    removeAlert(ev.id);

    const toastType =
      ev.alert_type === 'AUTO_ASSIGN' ? 'auto_assign' :
      ev.alert_type === 'CONFIRM' ? 'confirmed' :
      ev.alert_type === 'REDIRECT' ? 'redirect' : 'queue';

    addToast({
      eventId: ev.event_id,
      type: toastType,
      message: ev.message,
      slotId: ev.slot_id,
      nodeId: ev.node_id,
      suggestions: ev.alternatives,
      isReschedule: ev.is_reschedule,
    });
  }, [alerts, removeAlert, addToast]);

  const handleBooking = (nodeId: string, slotId: string) => {
    const targetNode = nodes[nodeId];
    if (!targetNode.connected || targetNode.is_failed) return;

    const p = PREF_MAP[preference];

    const slotState = targetNode.slots[slotId]?.state;
    if (slotState === 'CONFIRMED' || slotState === 'HELD' || slotState === 'REQUESTING') {
      // Smart redirect: find alternate TIME SLOT on the SAME node
      const alternateSlot = TIME_SLOTS.find(sid => {
        if (sid === slotId) return false;
        return targetNode.slots[sid]?.state === 'IDLE';
      });
      if (alternateSlot) {
        triggerBooking(nodeId, alternateSlot, p.preference, p.flexRange);
        return;
      }
    }

    triggerBooking(nodeId, slotId, p.preference, p.flexRange);
  };

  const handleSuggestionClick = (suggestion: SlotSuggestion) => {
    const p = PREF_MAP[preference];
    triggerBooking(suggestion.node_id, suggestion.slot_id, p.preference, p.flexRange);
  };

  const ALL_NODES = ['A', 'B', 'C', 'D', 'E'];

  // Color mapping for alert types
  const alertColors: Record<string, string> = {
    auto_assign: 'bg-emerald-900/30 border-emerald-600/50',
    confirmed: 'bg-green-900/30 border-green-600/50',
    queue: 'bg-indigo-900/30 border-indigo-600/50',
    redirect: 'bg-amber-900/30 border-amber-600/50',
  };


  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 sm:p-6 font-sans">
      <header className="mb-6 border-b border-gray-800 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
            <Zap className="text-emerald-500" />
            Decentralized EV Charging System
          </h1>
          <p className="text-gray-400 mt-1 text-sm sm:text-base">Smart Queueing • FIFO Fairness • Deduplicated Alerts</p>
        </div>
        <button onClick={triggerReset} className="bg-red-900/40 hover:bg-red-800 text-red-200 border border-red-700 px-4 py-2 rounded-md font-medium transition flex items-center gap-2 shrink-0">
          <RefreshCw size={16} /> Reset Network
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 auto-rows-fr">
            {/* Network graph */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg flex flex-col">
              <h2 className="text-xl font-semibold w-full text-left mb-4 border-b border-gray-800 pb-2">Network Topology</h2>
              <div className="flex-1 flex justify-center items-center">
                <NetworkGraph nodes={nodes as any} messageEvents={messageEvents} removeMessageEvent={removeMessageEvent} />
              </div>
            </div>

            {/* Controls */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
              <h2 className="text-xl font-semibold mb-2 border-b border-gray-800 pb-2">Controls</h2>

              {/* Preference toggle */}
              <div>
                <div className="text-sm text-gray-400 mb-2 font-semibold flex items-center gap-1"><Sparkles size={14} /> Booking Preference:</div>
                <div className="flex gap-2">
                  {(Object.keys(PREF_MAP) as Preference[]).map(key => (
                    <button
                      key={key}
                      onClick={() => setPreference(key)}
                      className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition border ${
                        preference === key
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {PREF_MAP[key].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fail buttons */}
              <div>
                <div className="text-sm text-gray-400 mb-2 font-semibold flex items-center gap-1"><AlertOctagon size={14} /> Fail Node:</div>
                <div className="flex gap-2">
                  {ALL_NODES.map(id => (
                    <button key={`fail-${id}`} onClick={() => triggerFail(id)} className="bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-700 px-3 py-1.5 rounded text-sm transition flex items-center justify-center flex-1">
                      {id}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recover buttons */}
              <div>
                <div className="text-sm text-gray-400 mb-2 font-semibold flex items-center gap-1"><RotateCcw size={14} /> Recover Node:</div>
                <div className="flex gap-2">
                  {ALL_NODES.map(id => (
                    <button key={`rec-${id}`} onClick={() => triggerRecover(id)} className="bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200 px-3 py-1.5 rounded text-sm transition flex items-center justify-center flex-1">
                      {id}
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-xs text-gray-400 mt-1 p-3 bg-gray-800/50 rounded border border-gray-700">
                <p><strong>Note:</strong> Rescheduled requests retain their original priority (FIFO). Alerts are deduplicated — each event fires exactly once.</p>
              </div>
            </div>
          </div>

          {/* Reservation ledger */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg overflow-hidden">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 border-b border-gray-800 pb-2">
              <Calendar className="text-blue-400" size={20} />
              Decentralized Reservation Ledger
            </h2>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="py-3 px-4 font-medium text-gray-400">Node</th>
                    {TIME_SLOTS.map(slotId => (
                      <th key={`th-${slotId}`} className="py-3 px-4 font-medium text-center">
                        <span className="text-gray-100 text-sm">{slotId}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALL_NODES.map(nodeId => {
                    const n = nodes[nodeId];
                    const isFailed = n.is_failed || !n.connected;
                    return (
                      <tr key={`tr-${nodeId}`} className="border-b border-gray-800/50 group hover:bg-gray-800/20">
                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-100 font-semibold text-base">Node {nodeId}</span>
                            <span className={`text-[10px] uppercase font-bold tracking-widest ${!isFailed ? 'text-emerald-400' : 'text-red-400'}`}>
                              {!isFailed ? 'Online' : 'Offline'}
                            </span>
                          </div>
                        </td>
                        {TIME_SLOTS.map(slotId => {
                          const slot = n.slots?.[slotId];
                          return (
                            <td key={`td-${nodeId}-${slotId}`} className="py-2 px-2 text-center">
                              <SlotButton
                                nodeId={nodeId}
                                slotId={slotId}
                                state={slot?.state || 'IDLE'}
                                isFailed={isFailed}
                                holdRemaining={slot?.hold_remaining}
                                queue={slot?.queue || []}
                                isReschedule={slot?.active_is_reschedule || false}
                                onBook={() => handleBooking(nodeId, slotId)}
                                onRelease={() => triggerRelease(nodeId, slotId)}
                                onConfirm={() => triggerConfirm(nodeId, slotId)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-400 px-4">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-gray-800 border border-gray-700"></div> Available</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-yellow-900/30 border border-yellow-500/50"></div> Resolving</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-emerald-900/40 border border-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></div> Held (Soft-lock)</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-emerald-600 border border-emerald-400"></div> Confirmed</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-blue-900/40 border border-blue-500/50 shadow-[0_0_8px_rgba(59,130,246,0.3)]"></div> Waiting (Queued)</div>
              <div className="flex items-center gap-2"><Repeat size={12} className="text-amber-400" /> Priority Retained</div>
              <div className="flex items-center gap-2"><ArrowRightLeft size={14} className="text-indigo-400" /> Slot Redirection</div>
            </div>
          </div>
        </div>

        {/* Right column: alerts + logs */}
        <div className="space-y-4 lg:sticky lg:top-6" style={{ maxHeight: 'calc(100vh - 3rem)' }}>

          {/* Alert Toast Stack */}
          <AnimatePresence>
            {toasts.map(toast => (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className={`p-4 rounded-xl border shadow-lg cursor-pointer mb-2 ${alertColors[toast.type] || 'bg-gray-900/30 border-gray-600/50'}`}
                onClick={() => dismissToast(toast.id)}
              >
                <div className="flex items-start gap-2">
                  <Bell size={14} className="mt-0.5 shrink-0 text-gray-300" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium mb-0.5">{toast.message}</p>
                    {toast.isReschedule && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-900/30 border border-amber-700/50 px-1.5 py-0.5 rounded-full">
                        <Repeat size={8} /> PRIORITY RETAINED
                      </span>
                    )}
                    {toast.suggestions && toast.suggestions.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-gray-400 font-semibold">💡 Suggested alternatives:</p>
                        {toast.suggestions.map((s, i) => (
                          <button
                            key={i}
                            onClick={(e) => { e.stopPropagation(); handleSuggestionClick(s); dismissToast(toast.id); }}
                            className="w-full text-left bg-gray-800/70 hover:bg-gray-700 border border-gray-700 rounded-lg px-3 py-2 text-xs transition flex justify-between items-center"
                          >
                            <span className="font-medium text-gray-200">{s.slot_id} on Node {s.node_id}</span>
                            <span className="text-gray-500">Score: {s.score} • Wait: {s.estimated_wait}s</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 mt-1 text-right">Click to dismiss</p>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Logs */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 3rem)' }}>
            <h2 className="text-xl font-semibold mb-4 border-b border-gray-800 pb-2">Real-time Logs</h2>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar min-h-[300px]">
              <AnimatePresence initial={false}>
                {logs.map(log => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm bg-gray-950 p-3 rounded border border-gray-800/50 flex flex-col gap-1 hover:border-gray-700 transition-colors"
                  >
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-blue-400">Node {log.node_id}</span>
                      <span className="text-gray-500 text-[10px]">{log.actual_time.toLocaleTimeString()}</span>
                    </div>
                    <span className="text-gray-300 font-mono break-words leading-relaxed">{log.message}</span>
                  </motion.div>
                ))}
                {logs.length === 0 && (
                  <div className="text-center text-gray-500 mt-10">No logs yet. Click an Available slot to book it.</div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── SlotButton Component ────────────────────────────────────────── */

interface SlotButtonProps {
  nodeId: string;
  slotId: string;
  state: string;
  isFailed: boolean;
  holdRemaining?: number | null;
  queue?: any[];
  isReschedule?: boolean;
  onBook: () => void;
  onRelease: () => void;
  onConfirm: () => void;
}

const SlotButton = ({ state, isFailed, holdRemaining, queue, isReschedule, onBook, onRelease, onConfirm }: SlotButtonProps) => {
  if (isFailed) {
    return (
      <div className="w-full h-12 bg-red-900/10 border border-red-900/30 rounded-lg flex items-center justify-center cursor-not-allowed">
        <span className="text-red-500/50 text-[10px] font-bold">OFFLINE</span>
      </div>
    );
  }

  // CONFIRMED state
  if (state === 'CONFIRMED') {
    return (
      <button
        onClick={onRelease}
        className="w-full h-12 neon-border-confirmed bg-emerald-900/30 hover:bg-emerald-900/50 rounded-lg flex items-center justify-center transition-all group relative"
      >
        <span className="text-emerald-300 text-xs font-bold tracking-wider group-hover:hidden flex items-center gap-1">
          <CheckCircle size={12} /> CONFIRMED
        </span>
        <span className="text-red-400 text-xs font-bold tracking-wider hidden group-hover:block transition-all">RELEASE</span>
        {isReschedule && (
          <span className="absolute -top-1.5 -left-1.5 bg-amber-600 text-white text-[7px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center" title="Priority retained">
            ↻
          </span>
        )}
        {queue && queue.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
            {queue.length}
          </span>
        )}
      </button>
    );
  }

  // HELD state
  if (state === 'HELD') {
    const remaining = holdRemaining != null ? Math.ceil(holdRemaining) : null;
    return (
      <div className="w-full h-12 neon-border bg-emerald-900/20 rounded-lg flex items-center justify-center transition-all relative overflow-hidden group">
        {remaining != null && (
          <div
            className="absolute inset-0 bg-emerald-500/10 transition-all duration-1000"
            style={{ width: `${(remaining / 8) * 100}%` }}
          />
        )}
        <div className="relative z-10 flex items-center gap-1">
          <button onClick={onConfirm} className="text-emerald-400 text-[10px] font-bold tracking-wider hover:text-emerald-200 transition flex items-center gap-0.5" title="Confirm booking">
            <Clock size={10} />
            {remaining != null ? `HOLD ${remaining}s` : 'HOLD'}
          </button>
          <span className="text-gray-600 mx-0.5">|</span>
          <button onClick={onRelease} className="text-red-400/70 text-[10px] font-bold hover:text-red-300 transition" title="Release">
            ✕
          </button>
        </div>
        {isReschedule && (
          <span className="absolute -top-1.5 -left-1.5 bg-amber-600 text-white text-[7px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center" title="Priority retained">
            ↻
          </span>
        )}
        {queue && queue.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
            {queue.length}
          </span>
        )}
      </div>
    );
  }

  // WAITING state
  if (state === 'WAITING') {
    return (
      <div className="w-full h-12 neon-border-blue bg-blue-900/15 rounded-lg flex items-center justify-center transition-all relative">
        <span className="text-blue-400 text-[10px] font-bold tracking-wider animate-pulse flex items-center gap-1">
          <Users size={10} /> QUEUED
        </span>
        {isReschedule && (
          <span className="absolute -top-1.5 -left-1.5 bg-amber-600 text-white text-[7px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center" title="Priority retained">
            ↻
          </span>
        )}
      </div>
    );
  }

  // REQUESTING state
  if (state === 'REQUESTING') {
    return (
      <div className="w-full h-12 neon-border-yellow bg-yellow-900/10 rounded-lg flex items-center justify-center transition-all relative">
        <span className="text-yellow-400 text-xs font-bold tracking-wider animate-pulse">RESOLVING</span>
        {isReschedule && (
          <span className="absolute -top-1.5 -left-1.5 bg-amber-600 text-white text-[7px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center" title="Priority retained">
            ↻
          </span>
        )}
      </div>
    );
  }

  // IDLE state
  return (
    <button
      onClick={onBook}
      className="w-full h-12 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg flex items-center justify-center transition-all hover:border-gray-500"
    >
      <span className="text-gray-500 text-xs font-medium">AVAILABLE</span>
    </button>
  );
};
