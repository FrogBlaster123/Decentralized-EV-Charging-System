import React from 'react';
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
    switch (node.state) {
      case 'IDLE': return '#374151'; // gray-700
      case 'REQUESTING': return '#EAB308'; // yellow-500
      case 'HELD': return '#10B981'; // emerald-500
      case 'FAILED': return '#EF4444'; // red-500
      default: return '#374151';
    }
};

export function NetworkGraph({ nodes, messageEvents, removeMessageEvent }: NetworkGraphProps) {
  // Draw edges between all nodes
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
            stroke="#1F2937" // gray-800
            strokeWidth="2"
          />
        ))}

        {/* Nodes */}
        {Object.values(nodes).map(node => {
          const pos = NODE_POSITIONS[node.id];
          if (!pos) return null;
          return (
            <g key={node.id}>
              <motion.circle
                cx={pos.x}
                cy={pos.y}
                r="30"
                fill="#111827" // gray-900
                stroke={getStatusColor(node)}
                strokeWidth="4"
                animate={{
                   stroke: getStatusColor(node)
                }}
                transition={{ duration: 0.3 }}
              />
              <text
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#F3F4F6" // gray-100
                fontSize="24"
                fontWeight="bold"
              >
                {node.id}
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
            
            const isRequest = msg.msg_type === "REQUEST";

            return (
              <motion.circle
                key={msg.id}
                r="6"
                fill={isRequest ? "#EAB308" : "#3B82F6"} // yellow for request, blue for reply
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
      <div className="absolute top-0 right-0 p-2 text-xs flex flex-col gap-1 bg-gray-900/50 rounded pointer-events-none">
         <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-500"></div> Requesting</div>
         <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Held</div>
         <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> Failed</div>
         <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Reply Msg</div>
      </div>
    </div>
  );
}
