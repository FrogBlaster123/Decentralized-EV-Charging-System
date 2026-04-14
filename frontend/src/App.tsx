import { useNodes, TIME_SLOTS } from './hooks/useNodes';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, AlertOctagon, RotateCcw, RefreshCw, Calendar, ArrowRightLeft } from 'lucide-react';
import { NetworkGraph } from './components/NetworkGraph';

import { useEffect } from 'react';

export default function App() {
  const { nodes, logs, messageEvents, deniedEvents, triggerBooking, triggerRelease, triggerFail, triggerRecover, triggerReset, removeMessageEvent, removeDeniedEvent } = useNodes();

  useEffect(() => {
    if (deniedEvents.length > 0) {
      const ev = deniedEvents[0];
      removeDeniedEvent(ev.id);
      
      // Stop the infinite loop. If the network denies us, it's globally locked.
      // We just let the UI return to the IDLE/AVAILABLE state gracefully.
    }
  }, [deniedEvents, removeDeniedEvent]);

  const handleBooking = (nodeId: string, slotId: string) => {
    // Basic smart load balancer logic:
    // If the selected slot on the selected node is HELD or REQUESTING,
    // find an alternate node that is IDLE and connected.
    const targetNode = nodes[nodeId];
    if (!targetNode.connected || targetNode.is_failed) return;

    const slotState = targetNode.slots[slotId]?.state;
    if (slotState === 'HELD' || slotState === 'REQUESTING') {
      // Find an alternate
      const alternateNodeId = Object.keys(nodes).find(nid => {
        const n = nodes[nid];
        return n.connected && !n.is_failed && n.slots[slotId]?.state === 'IDLE';
      });

      if (alternateNodeId) {
        // Redirect the booking
        triggerBooking(alternateNodeId, slotId);
        return;
      }
    }
    
    // Otherwise, book directly
    triggerBooking(nodeId, slotId);
  };

  const ALL_NODES = ['A', 'B', 'C', 'D', 'E'];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 sm:p-6 font-sans">
      <header className="mb-6 border-b border-gray-800 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
            <Zap className="text-emerald-500" />
            Decentralized EV Charging System
          </h1>
          <p className="text-gray-400 mt-1 text-sm sm:text-base">Slot-Based Reservation with Smart Load Balancing</p>
        </div>
        <button onClick={triggerReset} className="bg-red-900/40 hover:bg-red-800 text-red-200 border border-red-700 px-4 py-2 rounded-md font-medium transition flex items-center gap-2 shrink-0">
          <RefreshCw size={16} /> Reset Network
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Nodes Panel */}
        <div className="lg:col-span-2 space-y-6">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 auto-rows-fr">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg flex flex-col">
               <h2 className="text-xl font-semibold w-full text-left mb-4 border-b border-gray-800 pb-2">Network Topology</h2>
               <div className="flex-1 flex justify-center items-center">
                 <NetworkGraph nodes={nodes as any} messageEvents={messageEvents} removeMessageEvent={removeMessageEvent} />
               </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
              <h2 className="text-xl font-semibold mb-4 border-b border-gray-800 pb-2">Fault Controls</h2>
              
              <div>
                 <div className="text-sm text-gray-400 mb-2 font-semibold flex items-center gap-1"><AlertOctagon size={14}/> Fail Compute Node (Crash Server):</div>
                 <div className="flex gap-2">
                    {ALL_NODES.map(id => (
                      <button key={`fail-${id}`} onClick={() => triggerFail(id)} className="bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-700 px-3 py-1.5 rounded text-sm transition flex items-center justify-center flex-1">
                         {id}
                      </button>
                    ))}
                 </div>
              </div>

              <div>
                 <div className="text-sm text-gray-400 mb-2 font-semibold flex items-center gap-1"><RotateCcw size={14}/> Recover Compute Node (Reboot):</div>
                 <div className="flex gap-2">
                    {ALL_NODES.map(id => (
                      <button key={`rec-${id}`} onClick={() => triggerRecover(id)} className="bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200 px-3 py-1.5 rounded text-sm transition flex items-center justify-center flex-1">
                         {id}
                      </button>
                    ))}
                 </div>
              </div>
              
              <div className="text-xs text-gray-400 mt-2 p-3 bg-gray-800/50 rounded border border-gray-700">
                <p><strong>Note:</strong> Booking requests to a crashed node will trigger an HTTP 503 error, allowing peers to adapt and resize the grid dynamically.</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg overflow-hidden">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 border-b border-gray-800 pb-2">
              <Calendar className="text-blue-400" size={20} />
              Decentralized Reservation Ledger
            </h2>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="py-3 px-4 font-medium text-gray-400">Time Slot</th>
                    {ALL_NODES.map(id => (
                      <th key={`th-${id}`} className="py-3 px-4 font-medium text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-gray-100 text-base">Node {id}</span>
                          <span className={`text-[10px] uppercase font-bold tracking-widest ${nodes[id]?.connected && !nodes[id]?.is_failed ? 'text-emerald-400' : 'text-red-400'}`}>
                            {nodes[id]?.connected && !nodes[id]?.is_failed ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TIME_SLOTS.map(slotId => (
                    <tr key={`tr-${slotId}`} className="border-b border-gray-800/50 group hover:bg-gray-800/20">
                      <td className="py-3 px-4 text-gray-300 font-medium">
                        {slotId}
                      </td>
                      {ALL_NODES.map(nodeId => {
                        const n = nodes[nodeId];
                        const slot = n.slots?.[slotId];
                        const isFailed = n.is_failed || !n.connected;
                        return (
                          <td key={`td-${nodeId}-${slotId}`} className="py-2 px-2 text-center">
                            <SlotButton 
                              nodeId={nodeId}
                              slotId={slotId}
                              state={slot?.state || 'IDLE'}
                              isFailed={isFailed}
                              onBook={() => handleBooking(nodeId, slotId)}
                              onRelease={() => triggerRelease(nodeId, slotId)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center gap-6 text-xs text-gray-400 px-4">
               <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-gray-800 border border-gray-700"></div> Available (Click to Book)</div>
               <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-yellow-900/30 border border-yellow-500/50"></div> Requesting (Resolving)</div>
               <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-emerald-900/40 border border-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></div> Held (Booked)</div>
               <div className="flex items-center gap-2"><ArrowRightLeft size={14} className="text-blue-400"/> Smart Redirection on Conflict</div>
            </div>
          </div>
        </div>

        {/* Logs Sidebar */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg lg:sticky lg:top-6 flex flex-col" style={{ maxHeight: 'calc(100vh - 3rem)' }}>
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-800 pb-2">Real-time Logs</h2>
          <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar min-h-[300px]">
            <AnimatePresence initial={false}>
              {logs.map((log) => (
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
  );
}

const SlotButton = ({ state, isFailed, onBook, onRelease }: any) => {
  if (isFailed) {
    return (
      <div className="w-full h-10 bg-red-900/10 border border-red-900/30 rounded flex items-center justify-center cursor-not-allowed">
        <span className="text-red-500/50 text-[10px] font-bold">OFFLINE</span>
      </div>
    );
  }

  if (state === 'HELD') {
    return (
      <button 
        onClick={onRelease}
        className="w-full h-10 neon-border bg-emerald-900/20 hover:bg-emerald-900/40 rounded flex items-center justify-center transition-all group"
      >
        <span className="text-emerald-400 text-xs font-bold tracking-wider group-hover:hidden">BOOKED</span>
        <span className="text-red-400 text-xs font-bold tracking-wider hidden group-hover:block transition-all">RELEASE</span>
      </button>
    );
  }

  if (state === 'REQUESTING') {
    return (
      <div className="w-full h-10 neon-border-yellow bg-yellow-900/10 rounded flex items-center justify-center transition-all">
        <span className="text-yellow-400 text-xs font-bold tracking-wider animate-pulse">WAITING</span>
      </div>
    );
  }

  return (
    <button 
      onClick={onBook}
      className="w-full h-10 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded flex items-center justify-center transition-all hover:border-gray-500"
    >
      <span className="text-gray-500 text-xs font-medium">AVAILABLE</span>
    </button>
  );
};
