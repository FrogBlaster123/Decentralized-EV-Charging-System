import { useEffect, useState, useCallback } from 'react';

export type NodeState = 'IDLE' | 'REQUESTING' | 'HELD' | 'FAILED';

export interface SlotData {
  state: NodeState;
  deferred: string[];
  replies_received: string[];
}

export interface NodeData {
  id: string;
  clock: number;
  is_failed: boolean;
  slots: Record<string, SlotData>;
  active_peers: string[];
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
  slot_id: string;
  timestamp: number;
}

export interface DeniedEvent {
  id: string;
  node_id: string;
  slot_id: string;
}

const PORTS = {
  A: 8001,
  B: 8002,
  C: 8003,
  D: 8004,
  E: 8005,
};

export const TIME_SLOTS = ["10:00-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00"];

export function useNodes() {
  const [nodes, setNodes] = useState<Record<string, NodeData>>(() => {
    const initSlots = () => TIME_SLOTS.reduce((acc, slot) => ({...acc, [slot]: { state: 'IDLE', deferred: [], replies_received: [] }}), {});
    return {
      A: { id: 'A', clock: 0, is_failed: false, slots: initSlots(), active_peers: [], port: 8001, connected: false },
      B: { id: 'B', clock: 0, is_failed: false, slots: initSlots(), active_peers: [], port: 8002, connected: false },
      C: { id: 'C', clock: 0, is_failed: false, slots: initSlots(), active_peers: [], port: 8003, connected: false },
      D: { id: 'D', clock: 0, is_failed: false, slots: initSlots(), active_peers: [], port: 8004, connected: false },
      E: { id: 'E', clock: 0, is_failed: false, slots: initSlots(), active_peers: [], port: 8005, connected: false },
    };
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [messageEvents, setMessageEvents] = useState<MessageEvent[]>([]);
  const [deniedEvents, setDeniedEvents] = useState<DeniedEvent[]>([]);

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
                  is_failed: data.is_failed,
                  slots: data.slots,
                  active_peers: data.active_peers,
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
                   slot_id: data.slot_id,
                   timestamp: Date.now()
                 }
               ]);
            } else if (data.type === 'BOOKING_DENIED') {
               setDeniedEvents(prev => [
                 ...prev,
                 {
                   id: Math.random().toString(36).substr(2, 9),
                   node_id: data.node_id,
                   slot_id: data.slot_id
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

  const triggerBooking = useCallback(async (nodeId: string, slotId: string) => {
    try {
      await fetch(`http://localhost:${PORTS[nodeId as keyof typeof PORTS]}/api/trigger_booking`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_id: slotId })
      });
    } catch (e) {}
  }, []);

  const triggerRelease = useCallback(async (nodeId: string, slotId: string) => {
    try {
      await fetch(`http://localhost:${PORTS[nodeId as keyof typeof PORTS]}/api/trigger_release`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_id: slotId })
      });
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

  const removeDeniedEvent = useCallback((id: string) => {
    setDeniedEvents(prev => prev.filter(m => m.id !== id));
  }, []);

  return { nodes, logs, messageEvents, deniedEvents, triggerBooking, triggerRelease, triggerFail, triggerRecover, triggerReset, removeMessageEvent, removeDeniedEvent };
}
