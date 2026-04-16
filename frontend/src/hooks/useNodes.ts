import { useEffect, useState, useCallback, useRef } from 'react';

export type NodeState = 'IDLE' | 'REQUESTING' | 'HELD' | 'CONFIRMED' | 'WAITING' | 'FAILED';

export interface QueueInfo {
  node_id: string;
  lamport_ts: number;
  original_timestamp: number;
  request_id: string;
  created_at: number;
  age_seconds: number;
  preference: string;
  flex_range: number;
  is_reschedule: boolean;
}

export interface SlotSuggestion {
  node_id: string;
  slot_id: string;
  score: number;
  estimated_wait: number;
}

export interface SlotData {
  state: NodeState;
  deferred: string[];
  replies_received: string[];
  queue: QueueInfo[];
  hold_remaining: number | null;
  holder_id: string | null;
  active_request_id: string;
  active_is_reschedule: boolean;
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

export interface AlertEvent {
  id: string;
  event_id: string;
  alert_type: string;  // "QUEUE" | "REDIRECT" | "AUTO_ASSIGN" | "CONFIRM"
  node_id: string;
  message: string;
  request_id: string;
  slot_id: string;
  queue_position?: number;
  alternatives?: SlotSuggestion[];
  is_reschedule?: boolean;
}

const PORTS: Record<string, number> = {
  A: 8001,
  B: 8002,
  C: 8003,
  D: 8004,
  E: 8005,
};

export const TIME_SLOTS = ["10:00-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00"];

export function useNodes() {
  const [nodes, setNodes] = useState<Record<string, NodeData>>(() => {
    const initSlots = (): Record<string, SlotData> =>
      TIME_SLOTS.reduce(
        (acc, slot) => ({
          ...acc,
          [slot]: {
            state: 'IDLE' as NodeState,
            deferred: [], replies_received: [], queue: [],
            hold_remaining: null, holder_id: null,
            active_request_id: '', active_is_reschedule: false,
          },
        }),
        {} as Record<string, SlotData>
      );
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
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);

  // Event dedup: set of processed event_ids
  const processedEventIds = useRef<Set<string>>(new Set());

  // Ref-based hold timer
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      setNodes(prev => {
        let changed = false;
        const next = { ...prev };
        for (const nodeId of Object.keys(next)) {
          for (const slotId of TIME_SLOTS) {
            const slot = next[nodeId].slots[slotId];
            if (slot && slot.hold_remaining !== null && slot.hold_remaining > 0) {
              if (!changed) changed = true;
              next[nodeId] = {
                ...next[nodeId],
                slots: {
                  ...next[nodeId].slots,
                  [slotId]: { ...slot, hold_remaining: Math.max(0, slot.hold_remaining - 1) },
                },
              };
            }
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

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
                },
              }));
            } else if (data.type === 'LOG') {
              setLogs(prev => {
                const newLog: LogEntry = {
                  id: Math.random().toString(36).substr(2, 9),
                  timestamp: Date.now(),
                  node_id: data.node_id,
                  message: data.message,
                  actual_time: new Date(),
                };
                return [newLog, ...prev].slice(0, 150);
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
                  timestamp: Date.now(),
                },
              ]);
            } else if (data.type === 'ALERT') {
              // Deduplicate by event_id
              const eventId = data.event_id;
              if (eventId && processedEventIds.current.has(eventId)) {
                return; // Skip duplicate
              }
              if (eventId) {
                processedEventIds.current.add(eventId);
                // Cap size
                if (processedEventIds.current.size > 5000) {
                  const arr = Array.from(processedEventIds.current);
                  processedEventIds.current = new Set(arr.slice(arr.length - 2500));
                }
              }
              setAlerts(prev => [
                ...prev,
                {
                  id: Math.random().toString(36).substr(2, 9),
                  event_id: eventId || '',
                  alert_type: data.alert_type || '',
                  node_id: data.node_id || '',
                  message: data.message || '',
                  request_id: data.request_id || '',
                  slot_id: data.slot_id || '',
                  queue_position: data.queue_position,
                  alternatives: data.alternatives,
                  is_reschedule: data.is_reschedule,
                },
              ]);
            }
            // Legacy event types (QUEUE_UPDATE, AUTO_ASSIGNED, HOLD_CONFIRMED) are now
            // replaced by the unified ALERT system, so we ignore them.
          } catch (e) {
            console.error('Failed to parse WS msg', event.data);
          }
        };

        ws.onclose = () => {
          setNodes(prev => ({ ...prev, [nodeId]: { ...prev[nodeId], connected: false } }));
          setTimeout(connect, 3000);
        };

        sockets[nodeId] = ws;
      };

      connect();
    });

    return () => {
      Object.values(sockets).forEach(ws => ws.close());
    };
  }, []);

  // ── Action dispatchers ──────────────────────────────────────────

  const triggerBooking = useCallback(async (nodeId: string, slotId: string, preference: string = 'flexible', flexRange: number = 2) => {
    try {
      await fetch(`http://localhost:${PORTS[nodeId]}/api/trigger_booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_id: slotId, preference, flex_range: flexRange }),
      });
    } catch (e) { /* */ }
  }, []);

  const triggerRelease = useCallback(async (nodeId: string, slotId: string) => {
    try {
      await fetch(`http://localhost:${PORTS[nodeId]}/api/trigger_release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_id: slotId }),
      });
    } catch (e) { /* */ }
  }, []);

  const triggerConfirm = useCallback(async (nodeId: string, slotId: string) => {
    try {
      await fetch(`http://localhost:${PORTS[nodeId]}/api/trigger_confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_id: slotId }),
      });
    } catch (e) { /* */ }
  }, []);

  const triggerReschedule = useCallback(async (nodeId: string, oldSlot: string, newSlot: string) => {
    try {
      await fetch(`http://localhost:${PORTS[nodeId]}/api/trigger_reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_slot: oldSlot, new_slot: newSlot }),
      });
    } catch (e) { /* */ }
  }, []);

  const triggerFail = useCallback(async (nodeId: string) => {
    try {
      await fetch(`http://localhost:${PORTS[nodeId]}/api/trigger_fail`, { method: 'POST' });
    } catch (e) { /* */ }
  }, []);

  const triggerRecover = useCallback(async (nodeId: string) => {
    try {
      await fetch(`http://localhost:${PORTS[nodeId]}/api/trigger_recover`, { method: 'POST' });
    } catch (e) { /* */ }
  }, []);

  const triggerReset = useCallback(async () => {
    try {
      setLogs([]);
      setMessageEvents([]);
      setAlerts([]);
      processedEventIds.current.clear();
      const promises = Object.values(PORTS).map(port =>
        fetch(`http://localhost:${port}/api/reset`, { method: 'POST' }).catch(() => null)
      );
      await Promise.all(promises);
    } catch (e) { /* */ }
  }, []);

  const removeMessageEvent = useCallback((id: string) => {
    setMessageEvents(prev => prev.filter(m => m.id !== id));
  }, []);

  const removeAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  return {
    nodes,
    logs,
    messageEvents,
    alerts,
    triggerBooking,
    triggerRelease,
    triggerConfirm,
    triggerReschedule,
    triggerFail,
    triggerRecover,
    triggerReset,
    removeMessageEvent,
    removeAlert,
  };
}
