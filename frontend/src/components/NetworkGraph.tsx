import { motion, AnimatePresence } from 'framer-motion';
import { NodeData, MessageEvent } from '../hooks/useNodes';

interface NetworkGraphProps {
  nodes: Record<string, NodeData>;
  messageEvents: MessageEvent[];
  removeMessageEvent: (id: string) => void;
}

const NODE_POSITIONS: Record<string, { x: number, y: number }> = {
  A: { x: 200, y: 50 },
  B: { x: 342.6, y: 153.6 },
  C: { x: 288.1, y: 321.3 },
  D: { x: 111.8, y: 321.3 },
  E: { x: 57.3, y: 153.6 },
};

const getStatusColor = (node: NodeData) => {
  if (!node.connected) return '#4B5563'; // gray-600

  // Determine dominant state across all slots
  const states = Object.values(node.slots).map(s => s.state);
  const is_failed = node.is_failed;

  if (is_failed) return '#EF4444';  // red-500

  if (states.includes('CONFIRMED')) return '#059669'; // emerald-600 (deeper green)
  if (states.includes('HELD')) return '#10B981';      // emerald-500
  if (states.includes('WAITING')) return '#3B82F6';   // blue-500
  if (states.includes('REQUESTING')) return '#EAB308'; // yellow-500

  return '#374151'; // gray-700 (idle)
};

const MSG_COLORS: Record<string, string> = {
  REQUEST: '#EAB308',        // yellow
  REPLY: '#3B82F6',          // blue
  QUEUE_RESPONSE: '#A855F7', // purple
  AUTO_ASSIGN: '#06B6D4',    // cyan
  DENY: '#EF4444',           // red (legacy)
};

export function NetworkGraph({ nodes, messageEvents, removeMessageEvent }: NetworkGraphProps) {
  const nodeKeys = Object.keys(NODE_POSITIONS);
  const edges = [];
  for (let i = 0; i < nodeKeys.length; i++) {
    for (let j = i + 1; j < nodeKeys.length; j++) {
      edges.push([nodeKeys[i], nodeKeys[j]]);
    }
  }

  return (
    <div className="w-full flex justify-center items-center py-4 relative">
      <svg width="400" height="400" viewBox="0 0 400 400" className="max-w-full">
        {/* Background edges */}
        {edges.map(([src, dst]) => (
          <line
            key={`${src}-${dst}`}
            x1={NODE_POSITIONS[src].x}
            y1={NODE_POSITIONS[src].y}
            x2={NODE_POSITIONS[dst].x}
            y2={NODE_POSITIONS[dst].y}
            stroke="#1F2937"
            strokeWidth="2"
          />
        ))}

        {/* Nodes */}
        {Object.values(nodes).map(node => {
          const pos = NODE_POSITIONS[node.id];
          if (!pos) return null;
          const color = getStatusColor(node);
          return (
            <g key={node.id}>
              {/* Outer glow for active states */}
              {color !== '#374151' && color !== '#4B5563' && (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r="34"
                  fill="none"
                  stroke={color}
                  strokeWidth="1"
                  opacity={0.3}
                />
              )}
              <motion.circle
                cx={pos.x}
                cy={pos.y}
                r="30"
                fill="#111827"
                stroke={color}
                strokeWidth="4"
                animate={{ stroke: color }}
                transition={{ duration: 0.3 }}
              />
              <text
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#F3F4F6"
                fontSize="24"
                fontWeight="bold"
              >
                {node.id}
              </text>
              {/* Clock label */}
              <text
                x={pos.x}
                y={pos.y + 45}
                textAnchor="middle"
                fill="#9CA3AF"
                fontSize="11"
              >
                T={node.clock}
              </text>
            </g>
          );
        })}

        {/* Animated Message Packets */}
        <AnimatePresence>
          {messageEvents.map(msg => {
            const startNode = NODE_POSITIONS[msg.source];
            const endNode = NODE_POSITIONS[msg.target];
            if (!startNode || !endNode) return null;

            const color = MSG_COLORS[msg.msg_type] || '#6B7280';
            const r = msg.msg_type === 'AUTO_ASSIGN' ? 8 : 6;

            return (
              <motion.circle
                key={msg.id}
                r={r}
                fill={color}
                initial={{ cx: startNode.x, cy: startNode.y, opacity: 1 }}
                animate={{ cx: endNode.x, cy: endNode.y, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeInOut" }}
                onAnimationComplete={() => removeMessageEvent(msg.id)}
              />
            );
          })}
        </AnimatePresence>
      </svg>

      {/* Legend */}
      <div className="absolute top-0 right-0 p-2 text-xs flex flex-col gap-1 bg-gray-900/70 rounded-lg pointer-events-none backdrop-blur-sm border border-gray-800/50">
        <div className="text-gray-500 font-semibold mb-0.5 text-[10px] uppercase tracking-wider">Node State</div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-500"></div> Requesting</div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Waiting</div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Held</div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-600 border border-emerald-400"></div> Confirmed</div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> Failed</div>
        <div className="text-gray-500 font-semibold mt-1 mb-0.5 text-[10px] uppercase tracking-wider">Messages</div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-500"></div> Request</div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Reply</div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-500"></div> Queue Resp</div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-cyan-500"></div> Auto-Assign</div>
      </div>
    </div>
  );
}
