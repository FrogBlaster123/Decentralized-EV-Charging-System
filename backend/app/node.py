import asyncio
import httpx
import os
import json
import logging

from pydantic import BaseModel
from typing import List, Dict, Optional, Set

logger = logging.getLogger("uvicorn.error")

TIME_SLOTS = ["10:00-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00", "18:00-20:00"]

class RequestMessage(BaseModel):
    timestamp: int
    node_id: str
    slot_id: str

class ReplyMessage(BaseModel):
    node_id: str
    slot_id: str

class RecoverMessage(BaseModel):
    node_id: str
    is_active: bool

class NodeState:
    IDLE = "IDLE"
    REQUESTING = "REQUESTING"
    HELD = "HELD"
    FAILED = "FAILED"

class NodeSlot:
    def __init__(self):
        self.state = NodeState.IDLE
        self.request_timestamp = 0
        self.deferred_replies: List[str] = []
        self.replies_received: Set[str] = set()

class LoadBalanceRequest(BaseModel):
    slot_id: str

class Node:
    def __init__(self):
        self.node_id = os.getenv("NODE_ID", "A")
        raw_peers = os.getenv("PEERS", "")
        self.all_peers = raw_peers.split(",") if raw_peers else []
        self.active_peers = set(self.all_peers)
        
        self.clock = 0
        # Instead of global state, each slot has its own state
        self.slots: Dict[str, NodeSlot] = {slot: NodeSlot() for slot in TIME_SLOTS}
        
        # Asyncio lock to prevent race conditions during state checks
        self.lock = asyncio.Lock()
        
        # Websocket connections to the UI
        self.ui_connections = []
        self.message_logs = []
        self.is_failed = False

    async def broadcast_ui_update(self):
        slots_data = {}
        for slot_id, slot in self.slots.items():
            slots_data[slot_id] = {
                "state": slot.state if not self.is_failed else NodeState.FAILED,
                "deferred": slot.deferred_replies,
                "replies_received": list(slot.replies_received)
            }
            
        state_data = {
            "type": "STATE_UPDATE",
            "node_id": self.node_id,
            "clock": self.clock,
            "is_failed": self.is_failed,
            "slots": slots_data,
            "active_peers": list(self.active_peers),
        }
        to_remove = []
        msg = json.dumps(state_data)
        for ws in self.ui_connections:
            try:
                await ws.send_text(msg)
            except Exception:
                to_remove.append(ws)
        for ws in to_remove:
            self.ui_connections.remove(ws)

    async def add_log(self, text: str):
        log_msg = f"[T={self.clock}] {text}"
        logger.info(f"{self.node_id}: {log_msg}")
        msg_data = {
            "type": "LOG",
            "node_id": self.node_id,
            "message": log_msg
        }
        msg = json.dumps(msg_data)
        to_remove = []
        for ws in self.ui_connections:
            try:
                await ws.send_text(msg)
            except Exception:
                to_remove.append(ws)
        for ws in to_remove:
            self.ui_connections.remove(ws)

    async def broadcast_message_event(self, msg_type: str, target_id: str, slot_id: str = ""):
        msg_data = {
            "type": "MESSAGE_EVENT",
            "source": self.node_id,
            "target": target_id,
            "msg_type": msg_type,
            "slot_id": slot_id
        }
        msg = json.dumps(msg_data)
        to_remove = []
        for ws in self.ui_connections:
            try:
                await ws.send_text(msg)
            except Exception:
                to_remove.append(ws)
        for ws in to_remove:
            self.ui_connections.remove(ws)

    async def tick(self):
        self.clock += 1
        await self.broadcast_ui_update()

    async def update_clock(self, received_clock: int):
        self.clock = max(self.clock, received_clock) + 1
        await self.broadcast_ui_update()

    def get_peer_url(self, peer_id: str) -> str:
        for peer in self.all_peers:
            if f"node-{peer_id.lower()}" in peer:
                return peer
            # Localhost port mapping support (A=8001, B=8002, etc.)
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

    async def request_cs(self, slot_id: str):
        if slot_id not in self.slots:
            return
            
        async with self.lock:
            if self.is_failed:
                return
            slot = self.slots[slot_id]
            if slot.state != NodeState.IDLE:
                return
            
            await self.tick()
            slot.state = NodeState.REQUESTING
            slot.request_timestamp = self.clock
            slot.replies_received = set()
            await self.add_log(f"Requesting slot {slot_id} (ts={slot.request_timestamp})")
            await self.broadcast_ui_update()
            
        if not self.active_peers:
            await self.enter_cs(slot_id)
            return

        async with httpx.AsyncClient() as client:
            tasks = []
            for peer_url in list(self.active_peers):
                peer_id = self.get_peer_id_from_url(peer_url)
                tasks.append(self.send_request_to_peer(client, peer_url, peer_id, slot_id))
            
            await asyncio.gather(*tasks)

    async def send_request_to_peer(self, client: httpx.AsyncClient, peer_url: str, peer_id: str, slot_id: str):
        try:
            await self.add_log(f"Sent REQ to {peer_id} for {slot_id}")
            await self.broadcast_message_event("REQUEST", peer_id, slot_id)
            resp = await client.post(
                f"{peer_url}/api/request", 
                json={"timestamp": self.slots[slot_id].request_timestamp, "node_id": self.node_id, "slot_id": slot_id},
                timeout=2.0
            )
            resp.raise_for_status()
        except Exception as e:
            # Node failed
            async with self.lock:
                if peer_url in self.active_peers:
                    self.active_peers.remove(peer_url)
                    await self.add_log(f"Node {peer_id} presumed dead. Dropping from peers.")
                    await self.broadcast_ui_update()
                    await self.check_cs_entry(slot_id)

    async def receive_request(self, req: RequestMessage):
        async with self.lock:
            if self.is_failed:
                return
            await self.update_clock(req.timestamp)
            await self.add_log(f"Received REQ from {req.node_id} for {req.slot_id} (ts={req.timestamp})")
            
            slot = self.slots.get(req.slot_id)
            if not slot:
                return
                
            defer = False
            if slot.state == NodeState.HELD:
                # INSTANT DENY, booking is permanent
                await self.add_log(f"DENYING {req.node_id} for {req.slot_id} (Already HELD)")
                asyncio.create_task(self.send_deny(req.node_id, req.slot_id))
                return
            elif slot.state == NodeState.REQUESTING:
                # Tie breaker: lower timestamp wins, then lower ID
                if (slot.request_timestamp < req.timestamp) or \
                   (slot.request_timestamp == req.timestamp and self.node_id < req.node_id):
                    defer = True
            
            if defer:
                slot.deferred_replies.append(req.node_id)
                await self.add_log(f"Deferred REPLY to {req.node_id} for {req.slot_id}")
                await self.broadcast_ui_update()
            else:
                asyncio.create_task(self.send_reply(req.node_id, req.slot_id))

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
                    timeout=2.0
                )
            except Exception:
                pass

    async def send_deny(self, target_id: str, slot_id: str):
        peer_url = self.get_peer_url(target_id)
        if not peer_url:
            return
        
        await self.add_log(f"Sent DENY to {target_id} for {slot_id}")
        await self.broadcast_message_event("DENY", target_id, slot_id)
        async with httpx.AsyncClient() as client:
            try:
                await client.post(
                    f"{peer_url}/api/deny",
                    json={"node_id": self.node_id, "slot_id": slot_id},
                    timeout=2.0
                )
            except Exception:
                pass

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

    async def receive_deny(self, rep: ReplyMessage):
        async with self.lock:
            if self.is_failed:
                return
            
            slot = self.slots.get(rep.slot_id)
            if not slot or slot.state != NodeState.REQUESTING:
                return
                
            await self.add_log(f"Received DENY from {rep.node_id} for {rep.slot_id}. Canceling booking.")
            
            # Abort request
            slot.state = NodeState.IDLE
            
            # We must gracefully give up and allow others we deferred to proceed
            for target_id in list(slot.deferred_replies):
                asyncio.create_task(self.send_reply(target_id, rep.slot_id))
            
            slot.deferred_replies.clear()
            slot.replies_received.clear()
            
            await self.broadcast_ui_update()
            
            # Tell UI to redirect
            msg_data = {
                "type": "BOOKING_DENIED",
                "node_id": self.node_id,
                "slot_id": rep.slot_id
            }
            msg = json.dumps(msg_data)
            to_remove = []
            for ws in self.ui_connections:
                try:
                    await ws.send_text(msg)
                except Exception:
                    to_remove.append(ws)
            for ws in to_remove:
                self.ui_connections.remove(ws)

    async def check_cs_entry(self, slot_id: str):
        slot = self.slots[slot_id]
        if slot.state == NodeState.REQUESTING:
            expected_replies = set(self.get_peer_id_from_url(p) for p in self.active_peers)
            if expected_replies.issubset(slot.replies_received):
                # We have all necessary replies
                await self.enter_cs(slot_id)

    async def enter_cs(self, slot_id: str):
        slot = self.slots[slot_id]
        slot.state = NodeState.HELD
        await self.add_log(f"ENTERED CS: Booked slot {slot_id}")
        
        # Deny anyone we originally deferred since we will hold this forever
        for target_id in list(slot.deferred_replies):
            asyncio.create_task(self.send_deny(target_id, slot_id))
        slot.deferred_replies.clear()
        
        await self.broadcast_ui_update()
        
        # Bookings are now permanent. No auto-exit.

    async def release_slot(self, slot_id: str):
        # Manually clear a booking
        async with self.lock:
            if self.is_failed or slot_id not in self.slots:
                return
            slot = self.slots[slot_id]
            if slot.state != NodeState.HELD:
                return
            
            slot.state = NodeState.IDLE
            await self.add_log(f"RELEASED slot {slot_id}")
            
            for target_id in list(slot.deferred_replies):
                asyncio.create_task(self.send_reply(target_id, slot_id))
                
            slot.deferred_replies.clear()
            slot.replies_received.clear()
            await self.broadcast_ui_update()

    async def fail_node(self):
        async with self.lock:
            self.is_failed = True
            await self.add_log("Node manually FAILED")
            for slot_id, slot in self.slots.items():
                slot.state = NodeState.IDLE
                slot.deferred_replies.clear()
                slot.replies_received.clear()
            await self.broadcast_ui_update()

    async def recover_node(self):
        async with self.lock:
            self.is_failed = False
            await self.add_log("Node RECOVERED. Broadcasting.")
            self.active_peers = set(self.all_peers)
            await self.broadcast_ui_update()
        
        async with httpx.AsyncClient() as client:
            for peer_url in self.all_peers:
                try:
                    await client.post(f"{peer_url}/api/recover", json={"node_id": self.node_id, "is_active": True}, timeout=2.0)
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
                await self.broadcast_ui_update()

    async def reset_node(self):
        async with self.lock:
            self.clock = 0
            self.is_failed = False
            self.active_peers = set(self.all_peers)
            self.message_logs.clear()
            for slot_id in self.slots:
                self.slots[slot_id] = NodeSlot()
            await self.add_log("Network RESET manually triggered.")
            await self.broadcast_ui_update()

    # Load balancer checks if slot is free here, or finds a neighbor
    async def get_load_balance_suggestion(self, slot_id: str) -> str:
        # Check self
        if not self.is_failed and self.slots[slot_id].state == NodeState.IDLE:
            return self.node_id
            
        # Check active peers status... we don't naturally have peer state in RA, 
        # but in a real system we would query them. Since our UI handles smart booking
        # centrally via knowledge of all nodes, we can just let UI do it, or we can ask peers.
        # This function can return an alternate node ID. We will return an empty string to mean "I'm full".
        return ""

node_instance = Node()
