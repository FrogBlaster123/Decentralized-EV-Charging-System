import asyncio
import httpx
import os
import json
import logging
import time
import uuid

from pydantic import BaseModel
from typing import List, Dict, Optional, Set, Tuple

logger = logging.getLogger("uvicorn.error")

TIME_SLOTS = ["10:00-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00"]

# ── Configuration ────────────────────────────────────────────────
HOLD_TIMEOUT = 8            # seconds before soft-lock auto-confirms
AGING_FACTOR = 0.1          # priority bonus per second of waiting
MAX_WAIT_CAP = 60           # seconds – after this, entry gets max priority
SLOT_INDEX = {s: i for i, s in enumerate(TIME_SLOTS)}

# ── Pydantic models ─────────────────────────────────────────────
class RequestMessage(BaseModel):
    timestamp: int
    node_id: str
    slot_id: str
    request_id: str = ""
    original_timestamp: int = 0
    preference: str = "flexible"
    flex_range: int = 2
    is_reschedule: bool = False

class ReplyMessage(BaseModel):
    node_id: str
    slot_id: str

class RecoverMessage(BaseModel):
    node_id: str
    is_active: bool

class QueueResponseMessage(BaseModel):
    node_id: str
    slot_id: str
    action: str              # "WAIT" | "REDIRECT"
    queue_position: int = 0
    alternatives: list = []
    event_id: str = ""
    request_id: str = ""

class AutoAssignMessage(BaseModel):
    node_id: str
    slot_id: str
    event_id: str = ""
    request_id: str = ""

class SlotStatusRequest(BaseModel):
    slot_id: str = ""

class RescheduleMessage(BaseModel):
    request_id: str
    requester_node_id: str
    old_slot: str
    new_slot: str
    original_timestamp: int
    preference: str = "flexible"
    flex_range: int = 2

class QueueUpdateMessage(BaseModel):
    node_id: str
    slot_id: str
    queue: list = []

class LoadBalanceRequest(BaseModel):
    slot_id: str

class DequeueMessage(BaseModel):
    node_id: str
    slot_id: str
    request_id: str = ""

# ── State constants ──────────────────────────────────────────────
class NodeState:
    IDLE = "IDLE"
    REQUESTING = "REQUESTING"
    HELD = "HELD"
    CONFIRMED = "CONFIRMED"
    WAITING = "WAITING"
    FAILED = "FAILED"

# ── Queue entry ──────────────────────────────────────────────────
class QueueEntry:
    def __init__(self, node_id: str, lamport_ts: int, preference: str = "flexible",
                 flex_range: int = 2, request_id: str = "",
                 original_timestamp: int = 0, is_reschedule: bool = False):
        self.node_id = node_id
        self.lamport_ts = lamport_ts
        self.created_at = time.time()
        self.preference = preference
        self.flex_range = flex_range
        self.request_id = request_id or str(uuid.uuid4())
        # FIFO: original_timestamp is preserved across rescheduling
        self.original_timestamp = original_timestamp if original_timestamp > 0 else lamport_ts
        self.is_reschedule = is_reschedule

    def effective_priority(self) -> Tuple[float, str]:
        """Priority is based on original_timestamp for strict FIFO, with aging."""
        age = time.time() - self.created_at
        if age >= MAX_WAIT_CAP:
            return (float('-inf'), self.node_id)
        bonus = age * AGING_FACTOR
        return (self.original_timestamp - bonus, self.node_id)

    def to_dict(self) -> dict:
        age = time.time() - self.created_at
        return {
            "node_id": self.node_id,
            "lamport_ts": self.lamport_ts,
            "original_timestamp": self.original_timestamp,
            "request_id": self.request_id,
            "created_at": self.created_at,
            "age_seconds": round(age, 1),
            "preference": self.preference,
            "flex_range": self.flex_range,
            "is_reschedule": self.is_reschedule,
        }

# ── Per-slot state ───────────────────────────────────────────────
class NodeSlot:
    def __init__(self):
        self.state = NodeState.IDLE
        self.request_timestamp = 0
        self.deferred_replies: List[str] = []
        self.replies_received: Set[str] = set()
        self.wait_queue: List[QueueEntry] = []
        self.hold_expiry: Optional[float] = None
        self.holder_id: Optional[str] = None
        self._hold_task: Optional[asyncio.Task] = None
        # Track the request_id for the current booking on this slot
        self.active_request_id: str = ""
        self.active_original_ts: int = 0
        self.active_is_reschedule: bool = False

    def queue_position(self, node_id: str) -> int:
        for i, e in enumerate(self.wait_queue):
            if e.node_id == node_id:
                return i + 1
        return 0

    def queue_position_by_request(self, request_id: str) -> int:
        for i, e in enumerate(self.wait_queue):
            if e.request_id == request_id:
                return i + 1
        return 0

    def has_request(self, request_id: str) -> bool:
        """Check if a request_id is already in this slot's queue."""
        return any(e.request_id == request_id for e in self.wait_queue)

    def has_node_in_queue(self, node_id: str) -> bool:
        return any(e.node_id == node_id for e in self.wait_queue)

    def remove_request(self, request_id: str) -> Optional['QueueEntry']:
        """Remove a request by ID and return it."""
        for i, e in enumerate(self.wait_queue):
            if e.request_id == request_id:
                return self.wait_queue.pop(i)
        return None

    def sort_queue(self):
        self.wait_queue.sort(key=lambda e: e.effective_priority())

# ── Main Node class ──────────────────────────────────────────────
class Node:
    def __init__(self):
        self.node_id = os.getenv("NODE_ID", "A")
        raw_peers = os.getenv("PEERS", "")
        self.all_peers = raw_peers.split(",") if raw_peers else []
        self.active_peers = set(self.all_peers)

        self.clock = 0
        self.slots: Dict[str, NodeSlot] = {slot: NodeSlot() for slot in TIME_SLOTS}

        self.lock = asyncio.Lock()
        self.ui_connections = []
        self.message_logs = []
        self.is_failed = False
        # Event dedup: set of emitted event_ids
        self._emitted_events: Set[str] = set()

    def _make_event_id(self) -> str:
        eid = str(uuid.uuid4())
        self._emitted_events.add(eid)
        return eid

    def _is_duplicate_event(self, event_id: str) -> bool:
        if not event_id:
            return False
        if event_id in self._emitted_events:
            return True
        self._emitted_events.add(event_id)
        # Cap the set size
        if len(self._emitted_events) > 5000:
            # Trim oldest (set is unordered, just clear half)
            trim = list(self._emitted_events)[:2500]
            self._emitted_events = set(trim)
        return False

    # ── UI broadcast helpers ─────────────────────────────────────
    async def broadcast_ui_update(self):
        slots_data = {}
        for slot_id, slot in self.slots.items():
            slots_data[slot_id] = {
                "state": slot.state if not self.is_failed else NodeState.FAILED,
                "deferred": slot.deferred_replies,
                "replies_received": list(slot.replies_received),
                "queue": [e.to_dict() for e in slot.wait_queue],
                "hold_remaining": max(0, round(slot.hold_expiry - time.time(), 1)) if slot.hold_expiry else None,
                "holder_id": slot.holder_id,
                "active_request_id": slot.active_request_id,
                "active_is_reschedule": slot.active_is_reschedule,
            }

        state_data = {
            "type": "STATE_UPDATE",
            "node_id": self.node_id,
            "clock": self.clock,
            "is_failed": self.is_failed,
            "slots": slots_data,
            "active_peers": list(self.active_peers),
        }
        await self._ws_send(json.dumps(state_data))

    async def add_log(self, text: str):
        log_msg = f"[T={self.clock}] {text}"
        logger.info(f"{self.node_id}: {log_msg}")
        msg_data = {"type": "LOG", "node_id": self.node_id, "message": log_msg}
        await self._ws_send(json.dumps(msg_data))

    async def _send_alert(self, alert_type: str, message: str, request_id: str = "",
                          slot_id: str = "", extra: dict = None):
        """Send a deduplicated alert-style notification to the UI."""
        event_id = self._make_event_id()
        alert_data = {
            "type": "ALERT",
            "event_id": event_id,
            "alert_type": alert_type,
            "node_id": self.node_id,
            "message": message,
            "request_id": request_id,
            "slot_id": slot_id,
        }
        if extra:
            alert_data.update(extra)
        await self._ws_send(json.dumps(alert_data))

    async def broadcast_message_event(self, msg_type: str, target_id: str, slot_id: str = ""):
        msg_data = {
            "type": "MESSAGE_EVENT",
            "source": self.node_id,
            "target": target_id,
            "msg_type": msg_type,
            "slot_id": slot_id,
        }
        await self._ws_send(json.dumps(msg_data))

    async def _ws_send(self, msg: str):
        to_remove = []
        for ws in self.ui_connections:
            try:
                await ws.send_text(msg)
            except Exception:
                to_remove.append(ws)
        for ws in to_remove:
            self.ui_connections.remove(ws)

    # ── Lamport clock ────────────────────────────────────────────
    async def tick(self):
        self.clock += 1
        await self.broadcast_ui_update()

    async def update_clock(self, received_clock: int):
        self.clock = max(self.clock, received_clock) + 1
        await self.broadcast_ui_update()

    # ── Peer helpers ─────────────────────────────────────────────
    def get_peer_url(self, peer_id: str) -> str:
        for peer in self.all_peers:
            if f"node-{peer_id.lower()}" in peer:
                return peer
            expected_port = str(8000 + ord(peer_id.upper()) - ord('A') + 1)
            if peer.endswith(expected_port) or f":{expected_port}" in peer:
                return peer
        return ""

    def get_peer_id_from_url(self, url: str) -> str:
        for p in ['A', 'B', 'C', 'D', 'E']:
            if f"node-{p.lower()}" in url:
                return p
            expected_port = str(8000 + ord(p) - ord('A') + 1)
            if url.endswith(expected_port) or f":{expected_port}" in url:
                return p
        return "UNKNOWN"

    # ── Smart slot recommendation engine ─────────────────────────
    #  Priority tiers:
    #    Tier 0 (best):  same node,  different time slot
    #    Tier 1:         different node, same time slot
    #    Tier 2:         different node, different time slot (closest first)
    TIER_SAME_NODE_DIFF_SLOT = 0
    TIER_DIFF_NODE_SAME_SLOT = 100
    TIER_DIFF_NODE_DIFF_SLOT = 200

    async def get_smart_recommendations(self, requested_slot: str, preference: str = "flexible", flex_range: int = 2) -> list:
        """Tiered alternatives: same-node-diff-slot > diff-node-same-slot > closest."""
        req_idx = SLOT_INDEX.get(requested_slot, 0)
        seen = set()  # (node_id, slot_id)
        candidates = []

        # ── Tier 0: Same node, different time slot ──
        for sid, slot in self.slots.items():
            if sid == requested_slot:
                continue
            key = (self.node_id, sid)
            if key in seen:
                continue
            idx = SLOT_INDEX[sid]
            dist = abs(idx - req_idx)
            if preference == "strict":
                continue
            if dist > flex_range:
                continue
            if slot.state == NodeState.IDLE:
                wait = len(slot.wait_queue) * (HOLD_TIMEOUT / 2)
                score = round(self.TIER_SAME_NODE_DIFF_SLOT + dist * 1.0 + wait * 0.5, 2)
                seen.add(key)
                candidates.append({
                    "node_id": self.node_id,
                    "slot_id": sid,
                    "score": score,
                    "estimated_wait": round(wait, 1),
                })

        # ── Tier 1 & 2: Query peers for same-slot and diff-slot options ──
        async with httpx.AsyncClient() as client:
            tasks = []
            for peer_url in list(self.active_peers):
                tasks.append(self._query_peer_slots(client, peer_url, requested_slot, req_idx, preference, flex_range))
            results = await asyncio.gather(*tasks)
            for r in results:
                for c in r:
                    key = (c["node_id"], c["slot_id"])
                    if key not in seen:
                        seen.add(key)
                        candidates.append(c)

        candidates.sort(key=lambda c: c["score"])
        return candidates[:5]

    async def _query_peer_slots(self, client, peer_url, requested_slot, req_idx, preference, flex_range) -> list:
        try:
            resp = await client.post(f"{peer_url}/api/slot_status", json={"slot_id": ""}, timeout=1.5)
            data = resp.json()
            peer_id = data.get("node_id", "?")
            slots_info = data.get("slots", {})
            results = []
            for sid, info in slots_info.items():
                idx = SLOT_INDEX.get(sid, 0)
                dist = abs(idx - req_idx)
                if info["state"] != NodeState.IDLE:
                    continue
                qlen = info.get("queue_length", 0)
                wait = qlen * (HOLD_TIMEOUT / 2)

                if sid == requested_slot:
                    # Tier 1: different node, same time slot
                    score = round(self.TIER_DIFF_NODE_SAME_SLOT + wait * 1.0, 2)
                else:
                    # Tier 2: different node, different time slot
                    if preference == "strict":
                        continue
                    if dist > flex_range:
                        continue
                    score = round(self.TIER_DIFF_NODE_DIFF_SLOT + dist * 3.0 + wait * 1.0, 2)

                results.append({
                    "node_id": peer_id,
                    "slot_id": sid,
                    "score": score,
                    "estimated_wait": round(wait, 1),
                })
            return results
        except Exception:
            return []

    # ── REQUEST critical section ─────────────────────────────────
    async def request_cs(self, slot_id: str, preference: str = "flexible", flex_range: int = 2,
                         request_id: str = "", original_timestamp: int = 0, is_reschedule: bool = False):
        if slot_id not in self.slots:
            return

        # ── De-queue from any previous WAITING slot before making a new request ──
        await self._dequeue_existing_waits(exclude_slot=slot_id)

        async with self.lock:
            if self.is_failed:
                return
            slot = self.slots[slot_id]
            if slot.state not in (NodeState.IDLE,):
                return

            # Generate or preserve request_id
            rid = request_id or str(uuid.uuid4())

            if is_reschedule and original_timestamp > 0:
                # Preserve original timestamp for priority
                await self.tick()
                slot.state = NodeState.REQUESTING
                slot.request_timestamp = self.clock
                slot.active_request_id = rid
                slot.active_original_ts = original_timestamp
                slot.active_is_reschedule = True
                await self.add_log(f"Requesting slot {slot_id} [RESCHEDULE, orig_ts={original_timestamp}] (ts={slot.request_timestamp})")
            else:
                await self.tick()
                slot.state = NodeState.REQUESTING
                slot.request_timestamp = self.clock
                slot.active_request_id = rid
                slot.active_original_ts = self.clock
                slot.active_is_reschedule = False
                await self.add_log(f"Requesting slot {slot_id} (ts={slot.request_timestamp})")

            slot.replies_received = set()
            await self.broadcast_ui_update()

        if not self.active_peers:
            await self.enter_cs(slot_id)
            return

        async with httpx.AsyncClient() as client:
            tasks = []
            for peer_url in list(self.active_peers):
                peer_id = self.get_peer_id_from_url(peer_url)
                tasks.append(self.send_request_to_peer(
                    client, peer_url, peer_id, slot_id, preference, flex_range,
                    rid, slot.active_original_ts, is_reschedule
                ))
            await asyncio.gather(*tasks)

    async def send_request_to_peer(self, client, peer_url, peer_id, slot_id,
                                    preference="flexible", flex_range=2,
                                    request_id="", original_timestamp=0, is_reschedule=False):
        try:
            slot = self.slots[slot_id]
            await self.add_log(f"Sent REQ to {peer_id} for {slot_id}")
            await self.broadcast_message_event("REQUEST", peer_id, slot_id)
            resp = await client.post(
                f"{peer_url}/api/request",
                json={
                    "timestamp": slot.request_timestamp,
                    "node_id": self.node_id,
                    "slot_id": slot_id,
                    "request_id": request_id,
                    "original_timestamp": original_timestamp,
                    "preference": preference,
                    "flex_range": flex_range,
                    "is_reschedule": is_reschedule,
                },
                timeout=2.0,
            )
            resp.raise_for_status()
        except Exception:
            async with self.lock:
                if peer_url in self.active_peers:
                    self.active_peers.remove(peer_url)
                    await self.add_log(f"Node {peer_id} presumed dead. Dropping from peers.")
                    await self.broadcast_ui_update()
                    await self.check_cs_entry(slot_id)

    # ── RECEIVE request ──────────────────────────────────────────
    async def receive_request(self, req: RequestMessage):
        async with self.lock:
            if self.is_failed:
                return
            await self.update_clock(req.timestamp)
            tag = " [RESCHED]" if req.is_reschedule else ""
            await self.add_log(f"Received REQ from {req.node_id} for {req.slot_id} (ts={req.timestamp}){tag}")

            slot = self.slots.get(req.slot_id)
            if not slot:
                return

            rid = req.request_id or str(uuid.uuid4())
            orig_ts = req.original_timestamp if req.original_timestamp > 0 else req.timestamp

            # If slot is CONFIRMED or HELD → queue the requester
            if slot.state in (NodeState.HELD, NodeState.CONFIRMED):
                # Dedup: if request_id already in queue, return current position
                if slot.has_request(rid):
                    pos = slot.queue_position_by_request(rid)
                    await self.add_log(f"Duplicate request {rid[:8]}… for {req.slot_id} (already pos #{pos})")
                    event_id = self._make_event_id()
                    asyncio.create_task(self.send_queue_response(
                        req.node_id, req.slot_id, "WAIT", pos, [], event_id, rid
                    ))
                    return

                # Also dedup by node_id
                if slot.has_node_in_queue(req.node_id):
                    pos = slot.queue_position(req.node_id)
                    await self.add_log(f"Node {req.node_id} already queued for {req.slot_id} (pos #{pos})")
                    event_id = self._make_event_id()
                    asyncio.create_task(self.send_queue_response(
                        req.node_id, req.slot_id, "WAIT", pos, [], event_id, rid
                    ))
                    return

                entry = QueueEntry(
                    req.node_id, req.timestamp, req.preference, req.flex_range,
                    request_id=rid, original_timestamp=orig_ts,
                    is_reschedule=req.is_reschedule
                )
                slot.wait_queue.append(entry)
                slot.sort_queue()
                pos = slot.queue_position(req.node_id)
                await self.add_log(f"Queued {req.node_id} for {req.slot_id} (position #{pos})")
                await self.broadcast_ui_update()

                alternatives = await self.get_smart_recommendations(req.slot_id, req.preference, req.flex_range)
                event_id = self._make_event_id()
                asyncio.create_task(self.send_queue_response(
                    req.node_id, req.slot_id, "WAIT", pos, alternatives, event_id, rid
                ))
                return

            defer = False
            if slot.state == NodeState.REQUESTING:
                if (slot.request_timestamp < req.timestamp) or \
                   (slot.request_timestamp == req.timestamp and self.node_id < req.node_id):
                    defer = True

            if defer:
                slot.deferred_replies.append(req.node_id)
                await self.add_log(f"Deferred REPLY to {req.node_id} for {req.slot_id}")
                await self.broadcast_ui_update()
            else:
                asyncio.create_task(self.send_reply(req.node_id, req.slot_id))

    # ── SEND reply ───────────────────────────────────────────────
    async def send_reply(self, target_id: str, slot_id: str):
        peer_url = self.get_peer_url(target_id)
        if not peer_url:
            return
        await self.add_log(f"Sent REPLY to {target_id} for {slot_id}")
        await self.broadcast_message_event("REPLY", target_id, slot_id)
        async with httpx.AsyncClient() as client:
            try:
                await client.post(
                    f"{peer_url}/api/reply",
                    json={"node_id": self.node_id, "slot_id": slot_id},
                    timeout=2.0,
                )
            except Exception:
                pass

    # ── SEND queue response ──────────────────────────────────────
    async def send_queue_response(self, target_id: str, slot_id: str, action: str,
                                   position: int, alternatives: list,
                                   event_id: str = "", request_id: str = ""):
        peer_url = self.get_peer_url(target_id)
        if not peer_url:
            return
        eid = event_id or self._make_event_id()
        await self.add_log(f"Sent QUEUE_RESP to {target_id} for {slot_id} (action={action}, pos=#{position})")
        await self.broadcast_message_event("QUEUE_RESPONSE", target_id, slot_id)
        async with httpx.AsyncClient() as client:
            try:
                await client.post(
                    f"{peer_url}/api/queue_response",
                    json={
                        "node_id": self.node_id,
                        "slot_id": slot_id,
                        "action": action,
                        "queue_position": position,
                        "alternatives": alternatives,
                        "event_id": eid,
                        "request_id": request_id,
                    },
                    timeout=2.0,
                )
            except Exception:
                pass

    # ── RECEIVE reply ────────────────────────────────────────────
    async def receive_reply(self, rep: ReplyMessage):
        async with self.lock:
            if self.is_failed:
                return
            slot = self.slots.get(rep.slot_id)
            if not slot:
                return
            slot.replies_received.add(rep.node_id)
            await self.add_log(f"Received REPLY from {rep.node_id} for {rep.slot_id}")
            await self.broadcast_ui_update()
            await self.check_cs_entry(rep.slot_id)

    # ── RECEIVE queue response ───────────────────────────────────
    async def receive_queue_response(self, msg: QueueResponseMessage):
        async with self.lock:
            if self.is_failed:
                return

            # Dedup by event_id
            if msg.event_id and self._is_duplicate_event(msg.event_id):
                return

            slot = self.slots.get(msg.slot_id)
            if not slot or slot.state != NodeState.REQUESTING:
                return

            await self.add_log(f"Received QUEUE_RESP from {msg.node_id}: {msg.action} for {msg.slot_id} (pos=#{msg.queue_position})")

            slot.state = NodeState.WAITING
            slot.replies_received.clear()

            for target_id in list(slot.deferred_replies):
                asyncio.create_task(self.send_reply(target_id, msg.slot_id))
            slot.deferred_replies.clear()

            await self.broadcast_ui_update()

            # Send deduplicated alert
            resched_tag = " (priority retained)" if slot.active_is_reschedule else ""
            await self._send_alert(
                "QUEUE",
                f"⏳ Queued for {msg.slot_id} (position #{msg.queue_position}){resched_tag}",
                request_id=msg.request_id or slot.active_request_id,
                slot_id=msg.slot_id,
                extra={
                    "queue_position": msg.queue_position,
                    "alternatives": msg.alternatives,
                    "is_reschedule": slot.active_is_reschedule,
                }
            )

    # ── RECEIVE auto-assign ──────────────────────────────────────
    async def receive_auto_assign(self, msg: AutoAssignMessage):
        async with self.lock:
            if self.is_failed:
                return

            if msg.event_id and self._is_duplicate_event(msg.event_id):
                return

            slot = self.slots.get(msg.slot_id)
            if not slot:
                return

            await self.add_log(f"🎉 Auto-assigned slot {msg.slot_id} from {msg.node_id}")

            # Preserve request metadata if the slot was in WAITING
            saved_rid = slot.active_request_id or msg.request_id or ""
            saved_orig_ts = slot.active_original_ts
            saved_is_reschedule = slot.active_is_reschedule

            slot.state = NodeState.IDLE
            slot.replies_received.clear()
            slot.deferred_replies.clear()
            await self.broadcast_ui_update()

            await self._send_alert(
                "AUTO_ASSIGN",
                f"🎉 Auto-assigned slot {msg.slot_id}",
                request_id=saved_rid,
                slot_id=msg.slot_id,
            )

        # Re-request with preserved identity
        await self.request_cs(msg.slot_id,
                              request_id=saved_rid,
                              original_timestamp=saved_orig_ts,
                              is_reschedule=saved_is_reschedule)

    # ── RECEIVE reschedule (distributed consistency) ─────────────
    async def receive_reschedule(self, msg: RescheduleMessage):
        """Handle UPDATE_REQUEST from peer: move a request from old slot queue to new slot queue."""
        async with self.lock:
            if self.is_failed:
                return

            # Remove from old slot queue
            old_slot = self.slots.get(msg.old_slot)
            if old_slot:
                old_slot.remove_request(msg.request_id)
                old_slot.sort_queue()

            # Insert into new slot queue with preserved priority
            new_slot = self.slots.get(msg.new_slot)
            if new_slot and not new_slot.has_request(msg.request_id):
                entry = QueueEntry(
                    msg.requester_node_id, self.clock, msg.preference, msg.flex_range,
                    request_id=msg.request_id, original_timestamp=msg.original_timestamp,
                    is_reschedule=True
                )
                new_slot.wait_queue.append(entry)
                new_slot.sort_queue()

            await self.add_log(f"Reschedule sync: {msg.request_id[:8]}… moved {msg.old_slot}→{msg.new_slot}")
            await self.broadcast_ui_update()

    # ── CHECK CS entry ───────────────────────────────────────────
    async def check_cs_entry(self, slot_id: str):
        slot = self.slots[slot_id]
        if slot.state == NodeState.REQUESTING:
            expected_replies = set(self.get_peer_id_from_url(p) for p in self.active_peers)
            if expected_replies.issubset(slot.replies_received):
                await self.enter_cs(slot_id)

    # ── ENTER critical section (soft-lock) ───────────────────────
    async def enter_cs(self, slot_id: str):
        slot = self.slots[slot_id]
        slot.state = NodeState.HELD
        slot.holder_id = self.node_id
        slot.hold_expiry = time.time() + HOLD_TIMEOUT

        resched_tag = " [RESCHEDULE – priority retained]" if slot.active_is_reschedule else ""
        await self.add_log(f"ENTERED CS: Soft-locked slot {slot_id} ({HOLD_TIMEOUT}s hold){resched_tag}")

        for target_id in list(slot.deferred_replies):
            entry = QueueEntry(target_id, self.clock)
            slot.wait_queue.append(entry)
            slot.sort_queue()
            pos = slot.queue_position(target_id)
            alternatives = await self.get_smart_recommendations(slot_id)
            event_id = self._make_event_id()
            asyncio.create_task(self.send_queue_response(target_id, slot_id, "WAIT", pos, alternatives, event_id))
        slot.deferred_replies.clear()

        await self.broadcast_ui_update()

        if slot._hold_task and not slot._hold_task.done():
            slot._hold_task.cancel()
        slot._hold_task = asyncio.create_task(self._hold_expiry_watcher(slot_id))

    async def _hold_expiry_watcher(self, slot_id: str):
        await asyncio.sleep(HOLD_TIMEOUT)
        async with self.lock:
            slot = self.slots.get(slot_id)
            if not slot or slot.state != NodeState.HELD:
                return
            slot.state = NodeState.CONFIRMED
            slot.hold_expiry = None
            await self.add_log(f"✅ Hold auto-confirmed for slot {slot_id}")
            await self.broadcast_ui_update()

            await self._send_alert(
                "CONFIRM",
                f"✅ Booking confirmed: {slot_id}",
                request_id=slot.active_request_id,
                slot_id=slot_id,
            )

    # ── CONFIRM hold (explicit) ──────────────────────────────────
    async def confirm_hold(self, slot_id: str):
        async with self.lock:
            slot = self.slots.get(slot_id)
            if not slot or slot.state != NodeState.HELD:
                return
            if slot._hold_task and not slot._hold_task.done():
                slot._hold_task.cancel()
            slot.state = NodeState.CONFIRMED
            slot.hold_expiry = None
            await self.add_log(f"✅ Slot {slot_id} explicitly confirmed")
            await self.broadcast_ui_update()

            await self._send_alert(
                "CONFIRM",
                f"✅ Booking confirmed: {slot_id}",
                request_id=slot.active_request_id,
                slot_id=slot_id,
            )

    # ── RELEASE slot ─────────────────────────────────────────────
    async def release_slot(self, slot_id: str):
        async with self.lock:
            if self.is_failed or slot_id not in self.slots:
                return
            slot = self.slots[slot_id]
            if slot.state not in (NodeState.HELD, NodeState.CONFIRMED):
                return

            if slot._hold_task and not slot._hold_task.done():
                slot._hold_task.cancel()

            slot.state = NodeState.IDLE
            slot.hold_expiry = None
            slot.holder_id = None
            slot.active_request_id = ""
            slot.active_original_ts = 0
            slot.active_is_reschedule = False
            await self.add_log(f"RELEASED slot {slot_id}")

            for target_id in list(slot.deferred_replies):
                asyncio.create_task(self.send_reply(target_id, slot_id))
            slot.deferred_replies.clear()
            slot.replies_received.clear()

            await self._auto_reassign(slot_id, slot)
            await self.broadcast_ui_update()

    async def _auto_reassign(self, slot_id: str, slot: NodeSlot):
        if not slot.wait_queue:
            return

        slot.sort_queue()
        next_entry = slot.wait_queue.pop(0)
        target_id = next_entry.node_id
        event_id = self._make_event_id()
        await self.add_log(f"Auto-reassigning slot {slot_id} to {target_id} (orig_ts={next_entry.original_timestamp})")

        asyncio.create_task(self._send_auto_assign(target_id, slot_id, event_id, next_entry.request_id))

        for i, entry in enumerate(slot.wait_queue):
            asyncio.create_task(self._send_queue_position_update(entry.node_id, slot_id, i + 1))

    async def _send_auto_assign(self, target_id: str, slot_id: str, event_id: str = "", request_id: str = ""):
        peer_url = self.get_peer_url(target_id)
        if not peer_url:
            return
        eid = event_id or self._make_event_id()
        await self.broadcast_message_event("AUTO_ASSIGN", target_id, slot_id)
        async with httpx.AsyncClient() as client:
            try:
                await client.post(
                    f"{peer_url}/api/auto_assign",
                    json={"node_id": self.node_id, "slot_id": slot_id,
                          "event_id": eid, "request_id": request_id},
                    timeout=2.0,
                )
            except Exception:
                pass

    async def _send_queue_position_update(self, target_id: str, slot_id: str, position: int):
        peer_url = self.get_peer_url(target_id)
        if not peer_url:
            return
        event_id = self._make_event_id()
        async with httpx.AsyncClient() as client:
            try:
                await client.post(
                    f"{peer_url}/api/queue_update",
                    json={
                        "node_id": self.node_id,
                        "slot_id": slot_id,
                        "queue_position": position,
                        "event_id": event_id,
                    },
                    timeout=2.0,
                )
            except Exception:
                pass

    # ── RECEIVE queue position update ────────────────────────────
    async def receive_queue_update(self, data: dict):
        async with self.lock:
            slot_id = data.get("slot_id", "")
            position = data.get("queue_position", 0)
            event_id = data.get("event_id", "")

            if event_id and self._is_duplicate_event(event_id):
                return

            slot = self.slots.get(slot_id)
            if not slot or slot.state != NodeState.WAITING:
                return

            await self.add_log(f"Queue position updated for {slot_id}: now #{position}")

            await self._send_alert(
                "QUEUE",
                f"⏳ Queue position updated for {slot_id}: now #{position}",
                request_id=slot.active_request_id,
                slot_id=slot_id,
                extra={"queue_position": position, "alternatives": []},
            )
            await self.broadcast_ui_update()
    # ── DE-QUEUE logic ───────────────────────────────────────────
    async def _dequeue_existing_waits(self, exclude_slot: str):
        """Find any slot (other than exclude_slot) where we are REQUESTING or WAITING, remove ourselves, and notify peers."""
        async with self.lock:
            for sid, slot in self.slots.items():
                if sid == exclude_slot:
                    continue
                if slot.state in (NodeState.REQUESTING, NodeState.WAITING):
                    old_state = slot.state
                    req_id = slot.active_request_id
                    
                    slot.state = NodeState.IDLE
                    slot.replies_received.clear()
                    slot.deferred_replies.clear()
                    slot.active_request_id = ""
                    slot.active_original_ts = 0
                    slot.active_is_reschedule = False
                    
                    if old_state == NodeState.WAITING:
                        await self.add_log(f"De-queueing from {sid} (was WAITING) to request {exclude_slot}")
                    else:
                        await self.add_log(f"Cancelling pending request for {sid} to request {exclude_slot}")
                        
                    # Also remove ourselves locally if somehow in our own queue
                    slot.wait_queue = [e for e in slot.wait_queue if e.node_id != self.node_id]
                    
                    # Notify peers
                    asyncio.create_task(self._send_dequeue(sid, req_id))
            await self.broadcast_ui_update()

    async def _send_dequeue(self, slot_id: str, request_id: str):
        async with httpx.AsyncClient() as client:
            for peer_url in list(self.active_peers):
                try:
                    await client.post(
                        f"{peer_url}/api/dequeue",
                        json={"node_id": self.node_id, "slot_id": slot_id, "request_id": request_id},
                        timeout=2.0,
                    )
                except Exception:
                    pass

    async def receive_dequeue(self, msg: DequeueMessage):
        async with self.lock:
            if self.is_failed:
                return
            slot = self.slots.get(msg.slot_id)
            if not slot:
                return

            original_len = len(slot.wait_queue)
            # Remove by request_id if available, otherwise by node_id
            if msg.request_id:
                slot.wait_queue = [e for e in slot.wait_queue if e.request_id != msg.request_id]
            else:
                slot.wait_queue = [e for e in slot.wait_queue if e.node_id != msg.node_id]

            if len(slot.wait_queue) < original_len:
                await self.add_log(f"Received DEQUEUE from {msg.node_id} for {msg.slot_id} (freed a spot in queue)")
                await self.broadcast_ui_update()

    # ── BROADCAST RESCHEDULE to peers ────────────────────────────
    async def _broadcast_reschedule(self, request_id: str, requester_node_id: str,
                                     old_slot: str, new_slot: str,
                                     original_timestamp: int, preference: str, flex_range: int):
        """Tell all peers to move a request from old_slot → new_slot in their queues."""
        async with httpx.AsyncClient() as client:
            for peer_url in list(self.active_peers):
                try:
                    await client.post(
                        f"{peer_url}/api/reschedule",
                        json={
                            "request_id": request_id,
                            "requester_node_id": requester_node_id,
                            "old_slot": old_slot,
                            "new_slot": new_slot,
                            "original_timestamp": original_timestamp,
                            "preference": preference,
                            "flex_range": flex_range,
                        },
                        timeout=2.0,
                    )
                except Exception:
                    pass

    # ── TRIGGER RESCHEDULE (from UI) ─────────────────────────────
    async def trigger_reschedule(self, old_slot: str, new_slot: str):
        """User-initiated reschedule: move this node's booking/queue from old_slot to new_slot."""
        async with self.lock:
            if self.is_failed:
                return

            old = self.slots.get(old_slot)
            if not old:
                return

            rid = old.active_request_id or str(uuid.uuid4())
            orig_ts = old.active_original_ts or self.clock

            # Cancel hold if any
            if old._hold_task and not old._hold_task.done():
                old._hold_task.cancel()

            # Release old slot
            old.state = NodeState.IDLE
            old.hold_expiry = None
            old.holder_id = None
            old.replies_received.clear()
            old.deferred_replies.clear()

            await self.add_log(f"Rescheduling {old_slot} → {new_slot} (preserving ts={orig_ts})")
            await self.broadcast_ui_update()

        # Broadcast reschedule to all peers for consistency
        await self._broadcast_reschedule(rid, self.node_id, old_slot, new_slot, orig_ts, "flexible", 2)

        # Request the new slot with preserved identity
        await self.request_cs(new_slot, request_id=rid, original_timestamp=orig_ts, is_reschedule=True)

    # ── SLOT STATUS (for peer queries) ───────────────────────────
    def get_slot_status(self) -> dict:
        load = sum(1 for s in self.slots.values() if s.state in (NodeState.HELD, NodeState.CONFIRMED))
        result = {}
        for sid, slot in self.slots.items():
            result[sid] = {
                "state": slot.state if not self.is_failed else NodeState.FAILED,
                "load": load,
                "queue_length": len(slot.wait_queue),
                "holder_id": slot.holder_id,
            }
        return result

    # ── FAIL node ────────────────────────────────────────────────
    async def fail_node(self):
        async with self.lock:
            self.is_failed = True
            await self.add_log("Node manually FAILED")

            slots_to_reassign = []
            for slot_id, slot in self.slots.items():
                if slot.state in (NodeState.HELD, NodeState.CONFIRMED):
                    slots_to_reassign.append((slot_id, list(slot.wait_queue)))

                if slot._hold_task and not slot._hold_task.done():
                    slot._hold_task.cancel()

                slot.state = NodeState.IDLE
                slot.deferred_replies.clear()
                slot.replies_received.clear()
                slot.hold_expiry = None
                slot.holder_id = None
                slot.active_request_id = ""
                slot.active_original_ts = 0
                slot.active_is_reschedule = False

            await self.broadcast_ui_update()

        for slot_id, queue in slots_to_reassign:
            if queue:
                queue.sort(key=lambda e: e.effective_priority())
                next_entry = queue.pop(0)
                event_id = self._make_event_id()
                asyncio.create_task(self._send_auto_assign(
                    next_entry.node_id, slot_id, event_id, next_entry.request_id
                ))

    # ── RECOVER node ─────────────────────────────────────────────
    async def recover_node(self):
        async with self.lock:
            self.is_failed = False
            await self.add_log("Node RECOVERED. Broadcasting.")
            self.active_peers = set(self.all_peers)
            for slot in self.slots.values():
                slot.wait_queue.clear()
            await self.broadcast_ui_update()

        async with httpx.AsyncClient() as client:
            for peer_url in self.all_peers:
                try:
                    await client.post(
                        f"{peer_url}/api/recover",
                        json={"node_id": self.node_id, "is_active": True},
                        timeout=2.0,
                    )
                except Exception:
                    pass

    async def receive_recover(self, msg: RecoverMessage):
        async with self.lock:
            if msg.node_id == self.node_id:
                return
            peer_url = self.get_peer_url(msg.node_id)
            if peer_url and peer_url not in self.active_peers:
                self.active_peers.add(peer_url)
                await self.add_log(f"Peer {msg.node_id} came back online")
                for slot in self.slots.values():
                    slot.wait_queue = [e for e in slot.wait_queue if e.node_id != msg.node_id]
                await self.broadcast_ui_update()

    # ── RESET node ───────────────────────────────────────────────
    async def reset_node(self):
        async with self.lock:
            self.clock = 0
            self.is_failed = False
            self.active_peers = set(self.all_peers)
            self.message_logs.clear()
            self._emitted_events.clear()
            for slot_id in self.slots:
                old_slot = self.slots[slot_id]
                if old_slot._hold_task and not old_slot._hold_task.done():
                    old_slot._hold_task.cancel()
                self.slots[slot_id] = NodeSlot()
            await self.add_log("Network RESET manually triggered.")
            await self.broadcast_ui_update()

    # ── Load balancer (backward compat) ──────────────────────────
    async def get_load_balance_suggestion(self, slot_id: str) -> str:
        if not self.is_failed and self.slots[slot_id].state == NodeState.IDLE:
            return self.node_id
        return ""


node_instance = Node()
