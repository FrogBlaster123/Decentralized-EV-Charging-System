import { useNodes, NodeData } from './hooks/useNodes';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Zap, Play, AlertOctagon, RotateCcw, RefreshCw } from 'lucide-react';
import { NetworkGraph } from './components/NetworkGraph';

function App() {
  const { nodes, logs, messageEvents, triggerBooking, triggerFail, triggerRecover, triggerReset, removeMessageEvent } = useNodes();

  const handleHighLoad = () => {
    Object.values(nodes).forEach(node => {
      if (node.state === 'IDLE' && node.connected) triggerBooking(node.id);
    });
  };

  const handleSequentialBooking = async () => {
    const availableNodes = Object.values(nodes).filter(node => node.state === 'IDLE' && node.connected);
    for (const node of availableNodes) {
      triggerBooking(node.id);
      await new Promise(r => setTimeout(r, 1500));
    }
  };

  const handleFailureContention = () => {
    const availableNodes = Object.values(nodes).filter(node => node.state === 'IDLE' && node.connected);
    if (availableNodes.length >= 2) {
      const p1 = availableNodes[0];
      const p2 = availableNodes[1];
      triggerBooking(p1.id);
      setTimeout(() => triggerFail(p1.id), 500); 
      setTimeout(() => triggerBooking(p2.id), 1000); 
    }
  };

  const handleRecoveryRejoin = () => {
    const availableNodes = Object.values(nodes).filter(node => node.connected);
    if (availableNodes.length >= 1) {
      const p1 = availableNodes[0];
      triggerFail(p1.id);
      setTimeout(() => triggerRecover(p1.id), 4000);
      setTimeout(() => triggerBooking(p1.id), 5000);
    }
  };

  const handlePartition = () => {
    triggerFail('D');
    triggerFail('E');
    setTimeout(() => {
      ['A', 'B', 'C'].forEach(id => {
        if (nodes[id]?.connected && nodes[id]?.state === 'IDLE') triggerBooking(id);
      });
    }, 1500);
  };

  const ALL_NODES = ['A', 'B', 'C', 'D', 'E'];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-sans">
      <header className="mb-8 border-b border-gray-800 pb-4 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Zap className="text-emerald-500" />
            Decentralized EV Charging System
          </h1>
          <p className="text-gray-400 mt-2">Ricart–Agrawala Mutual Exclusion Simulation</p>
        </div>
        <button onClick={triggerReset} className="bg-red-900/40 hover:bg-red-800 text-red-200 border border-red-700 px-4 py-2 rounded-md font-medium transition flex items-center gap-2">
          <RefreshCw size={16} /> Reset Network
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Nodes Panel */}
        <div className="lg:col-span-2 space-y-6">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg flex flex-col justify-center items-center">
               <h2 className="text-xl font-semibold w-full text-left mb-4 border-b border-gray-800 pb-2">Network Topology</h2>
               <NetworkGraph nodes={nodes} messageEvents={messageEvents} removeMessageEvent={removeMessageEvent} />
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
              <h2 className="text-xl font-semibold mb-4 border-b border-gray-800 pb-2">Universal Controls</h2>
              
              <div>
                 <div className="text-sm text-gray-400 mb-2 font-semibold">Book Slot (Enter Critical Section):</div>
                 <div className="flex gap-2">
                    {ALL_NODES.map(id => (
                      <button key={`book-${id}`} onClick={() => triggerBooking(id)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-sm font-medium transition flex items-center justify-center flex-1">
                        {id}
                      </button>
                    ))}
                 </div>
              </div>

              <div>
                 <div className="text-sm text-gray-400 mb-2 font-semibold flex items-center gap-1"><AlertOctagon size={14}/> Fail Compute Node:</div>
                 <div className="flex gap-2">
                    {ALL_NODES.map(id => (
                      <button key={`fail-${id}`} onClick={() => triggerFail(id)} className="bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-700 px-3 py-1.5 rounded text-sm transition flex items-center justify-center flex-1">
                         {id}
                      </button>
                    ))}
                 </div>
              </div>

              <div>
                 <div className="text-sm text-gray-400 mb-2 font-semibold flex items-center gap-1"><RotateCcw size={14}/> Recover Compute Node:</div>
                 <div className="flex gap-2">
                    {ALL_NODES.map(id => (
                      <button key={`rec-${id}`} onClick={() => triggerRecover(id)} className="bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200 px-3 py-1.5 rounded text-sm transition flex items-center justify-center flex-1">
                         {id}
                      </button>
                    ))}
                 </div>
              </div>

              <div className="w-full h-px bg-gray-800 my-2"></div>
              
              <div>
                 <div className="text-sm text-gray-400 mb-2 font-semibold">Simulation Scenarios:</div>
                 <div className="grid grid-cols-2 gap-2">
                    <button onClick={handleHighLoad} className="bg-purple-600/80 hover:bg-purple-600 text-white px-3 py-2 rounded text-xs font-medium transition text-left leading-tight">
                      <div className="font-bold">High Load</div>
                      <div className="text-[10px] text-purple-200">All nodes request at once</div>
                    </button>
                    <button onClick={handleSequentialBooking} className="bg-blue-600/80 hover:bg-blue-600 text-white px-3 py-2 rounded text-xs font-medium transition text-left leading-tight">
                      <div className="font-bold">Sequential</div>
                      <div className="text-[10px] text-blue-200">Nodes request one by one</div>
                    </button>
                    <button onClick={handleFailureContention} className="bg-orange-600/80 hover:bg-orange-600 text-white px-3 py-2 rounded text-xs font-medium transition text-left leading-tight">
                      <div className="font-bold">Contention Failure</div>
                      <div className="text-[10px] text-orange-200">Node fails during a run</div>
                    </button>
                    <button onClick={handleRecoveryRejoin} className="bg-emerald-600/80 hover:bg-emerald-600 text-white px-3 py-2 rounded text-xs font-medium transition text-left leading-tight">
                      <div className="font-bold">Recovery & Rejoin</div>
                      <div className="text-[10px] text-emerald-200">Fails, recovers, then requests</div>
                    </button>
                    <button onClick={handlePartition} className="bg-indigo-800/80 hover:bg-indigo-800 text-white px-3 py-2 rounded text-xs font-medium transition text-left leading-tight col-span-2">
                      <div className="font-bold text-center">Network Partition / Split</div>
                      <div className="text-[10px] text-indigo-200 text-center">Drops 2 nodes to simulate cluster split</div>
                    </button>
                 </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 border-b border-gray-800 pb-2">
              <Activity className="text-blue-400" size={20} />
              Node Cluster Status
            </h2>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <AnimatePresence>
                {Object.values(nodes).map((node) => (
                  <NodeCard key={node.id} node={node} />
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Logs Sidebar */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg h-[80vh] flex flex-col">
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-800 pb-2">Real-time Logs</h2>
          <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
            <AnimatePresence initial={false}>
              {logs.map((log) => (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm bg-gray-950 p-3 rounded border border-gray-800/50 flex flex-col gap-1"
                >
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-blue-400">Node {log.node_id}</span>
                    <span className="text-gray-500 text-[10px]">{log.actual_time.toLocaleTimeString()}</span>
                  </div>
                  <span className="text-gray-300 font-mono break-words">{log.message}</span>
                </motion.div>
              ))}
              {logs.length === 0 && (
                <div className="text-center text-gray-500 mt-10">No logs yet.</div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

const NodeCard = ({ node }: { node: NodeData }) => {

  const getStatusColor = () => {
    if (!node.connected) return 'border-gray-700 bg-gray-800 text-gray-500';
    switch (node.state) {
      case 'IDLE': return 'border-gray-700 bg-gray-800/50';
      case 'REQUESTING': return 'neon-border-yellow bg-yellow-900/10';
      case 'HELD': return 'neon-border bg-emerald-900/10';
      case 'FAILED': return 'neon-border-red bg-red-900/10';
      default: return 'border-gray-700 bg-gray-800/50';
    }
  };

  const getStatusTextClasses = () => {
    switch (node.state) {
      case 'IDLE': return 'text-gray-400';
      case 'REQUESTING': return 'text-yellow-400 font-bold';
      case 'HELD': return 'text-emerald-400 font-bold';
      case 'FAILED': return 'text-red-400 font-bold';
      default: return 'text-gray-400';
    }
  };

  return (
    <motion.div
      layout
      className={`rounded-lg p-4 border transition-colors duration-300 ${getStatusColor()}`}
    >
      <div className="flex justify-between items-center border-b border-gray-700/50 pb-2 mb-3">
        <h3 className="text-2xl font-bold flex items-center gap-2">
          Node {node.id}
          <div className={`w-2 h-2 rounded-full ${node.connected ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
        </h3>
        <div className="text-right">
          <div className="text-xs text-gray-500">Lamport Clock</div>
          <div className="font-mono font-bold text-lg">{node.clock}</div>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Status:</span>
          <span className={`${getStatusTextClasses()} tracking-widest text-xs uppercase`}>
            {node.connected ? (node.state === 'HELD' ? 'WAITING_SLOT' : node.state) : 'OFFLINE'}
            {node.state === 'HELD' && <span className="text-emerald-400 block text-[10px]">IN CRITICAL SEC</span>}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Deferred:</span>
          <span className="text-gray-300">{node.deferred.length > 0 ? node.deferred.join(', ') : 'None'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Replies:</span>
          <span className="text-gray-300">
            {node.replies_received.length} / {Math.max(0, node.active_peers.length - 1)}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

export default App;
