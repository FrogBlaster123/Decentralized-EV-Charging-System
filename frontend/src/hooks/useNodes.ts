import { useEffect, useState, useCallback } from 'react';

export type NodeState = 'IDLE' | 'REQUESTING' | 'HELD' | 'FAILED';

export interface NodeData {
  id: string;
  clock: number;
  state: NodeState;
  deferred: string[];
  active_peers: string[];
  replies_received: string[];
  port: number;
  connected: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  node_id: string;
  message: string;
  actual_time: Date;
}

export interface MessageEvent {
  id: string;
  source: string;
  target: string;
  msg_type: string;
  timestamp: number;
}

const PORTS = {
  A: 8001,
  B: 8002,
  C: 8003,
  D: 8004,
  E: 8005,
};

export function useNodes() {
  const [nodes, setNodes] = useState<Record<string, NodeData>>({
    A: { id: 'A', clock: 0, state: 'IDLE', deferred: [], active_peers: [], replies_received: [], port: 8001, connected: false },
    B: { id: 'B', clock: 0, state: 'IDLE', deferred: [], active_peers: [], replies_received: [], port: 8002, connected: false },
    C: { id: 'C', clock: 0, state: 'IDLE', deferred: [], active_peers: [], replies_received: [], port: 8003, connected: false },
    D: { id: 'D', clock: 0, state: 'IDLE', deferred: [], active_peers: [], replies_received: [], port: 8004, connected: false },
    E: { id: 'E', clock: 0, state: 'IDLE', deferred: [], active_peers: [], replies_received: [], port: 8005, connected: false },
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [messageEvents, setMessageEvents] = useState<MessageEvent[]>([]);

  useEffect(() => {
    const sockets: Record<string, WebSocket> = {};

    Object.entries(PORTS).forEach(([nodeId, port]) => {
      const connect = () => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);
        
        ws.onopen = () => {
          setNodes(prev => ({ ...prev, [nodeId]: { ...prev[nodeId], connected: true } }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'STATE_UPDATE') {
              setNodes(prev => ({
                ...prev,
                [nodeId]: {
                  ...prev[nodeId],
                  clock: data.clock,
                  state: data.state,
                  deferred: data.deferred,
                  active_peers: data.active_peers,
                  replies_received: data.replies_received,
                }
              }));
            } else if (data.type === 'LOG') {
              setLogs(prev => {
                const newLog = {
                  id: Math.random().toString(36).substr(2, 9),
                  timestamp: Date.now(),
                  node_id: data.node_id,
                  message: data.message,
                  actual_time: new Date()
                };
                return [newLog, ...prev].slice(0, 100);
              });
            } else if (data.type === 'MESSAGE_EVENT') {
               setMessageEvents(prev => [
                 ...prev,
                 {
                   id: Math.random().toString(36).substr(2, 9),
                   source: data.source,
                   target: data.target,
                   msg_type: data.msg_type,
                   timestamp: Date.now()
                 }
               ]);
            }
          } catch (e) {
             console.error("Failed to parse WS msg", event.data);
          }
        };

        ws.onclose = () => {
          setNodes(prev => ({ ...prev, [nodeId]: { ...prev[nodeId], connected: false } }));
          setTimeout(connect, 3000); // Reconnect attempt
        };

        sockets[nodeId] = ws;
      };

      connect();
    });

    return () => {
      Object.values(sockets).forEach(ws => ws.close());
    };
  }, []);

  const triggerBooking = useCallback(async (nodeId: string) => {
    try {
      await fetch(`http://localhost:${PORTS[nodeId as keyof typeof PORTS]}/api/trigger_booking`, { method: 'POST' });
    } catch (e) {}
  }, []);

  const triggerFail = useCallback(async (nodeId: string) => {
    try {
      await fetch(`http://localhost:${PORTS[nodeId as keyof typeof PORTS]}/api/trigger_fail`, { method: 'POST' });
    } catch (e) {}
  }, []);

  const triggerRecover = useCallback(async (nodeId: string) => {
    try {
      await fetch(`http://localhost:${PORTS[nodeId as keyof typeof PORTS]}/api/trigger_recover`, { method: 'POST' });
    } catch (e) {}
  }, []);
  
  const triggerReset = useCallback(async () => {
    try {
       setLogs([]);
       setMessageEvents([]);
       const promises = Object.values(PORTS).map(port => 
          fetch(`http://localhost:${port}/api/reset`, { method: 'POST' }).catch(() => null)
       );
       await Promise.all(promises);
    } catch (e) {}
  }, []);
  
  const removeMessageEvent = useCallback((id: string) => {
    setMessageEvents(prev => prev.filter(m => m.id !== id));
  }, []);

  return { nodes, logs, messageEvents, triggerBooking, triggerFail, triggerRecover, triggerReset, removeMessageEvent };
}
