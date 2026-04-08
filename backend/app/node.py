import asyncio
import httpx
import os
import json
import logging

from pydantic import BaseModel
from typing import List, Dict, Optional

logger = logging.getLogger("uvicorn.error")

class RequestMessage(BaseModel):
    timestamp: int
    node_id: str

class ReplyMessage(BaseModel):
    node_id: str

class RecoverMessage(BaseModel):
    node_id: str
    is_active: bool

class NodeState:
    IDLE = "IDLE"
    REQUESTING = "REQUESTING"
    HELD = "HELD"
    FAILED = "FAILED"

class Node:
    def __init__(self):
        self.node_id = os.getenv("NODE_ID", "A")
        raw_peers = os.getenv("PEERS", "")
        self.all_peers = raw_peers.split(",") if raw_peers else []
        self.active_peers = set(self.all_peers)
        
        self.clock = 0
        self.state = NodeState.IDLE
        self.request_timestamp = 0
        
        self.deferred_replies: List[str] = []
        self.replies_received: set = set()
        
        # Asyncio lock to prevent race conditions during state checks
        self.lock = asyncio.Lock()
        
        # Websocket connections to the UI
        self.ui_connections = []
        self.message_logs = []
        
        # Simulated critical section delay
        self.cs_delay = 5.0
        self.is_failed = False

    async def broadcast_ui_update(self):
        state_data = {
            "type": "STATE_UPDATE",
            "node_id": self.node_id,
            "clock": self.clock,
            "state": self.state if not self.is_failed else NodeState.FAILED,
            "deferred": self.deferred_replies,
            "active_peers": list(self.active_peers),
            "replies_received": list(self.replies_received)
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

    async def broadcast_message_event(self, msg_type: str, target_id: str):
        msg_data = {
            "type": "MESSAGE_EVENT",
            "source": self.node_id,
            "target": target_id,
            "msg_type": msg_type
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
        # Assuming peers are in the format "http://node-b:PORT"
        # We can find the matching peer or parse from active_peers
        for peer in self.all_peers:
            if f"node-{peer_id.lower()}" in peer:
                return peer
        return ""

    def get_peer_id_from_url(self, url: str) -> str:
        # Simplistic parsing "http://node-b:8002" -> "B"
        for p in ['a', 'b', 'c', 'd', 'e']:
            if f"node-{p}" in url:
                return p.upper()
        return "UNKNOWN"

    async def request_cs(self):
        async with self.lock:
            if self.is_failed:
                return
            if self.state != NodeState.IDLE:
                return
            
            await self.tick()
            self.state = NodeState.REQUESTING
            self.request_timestamp = self.clock
            self.replies_received = set()
            await self.add_log(f"Requesting critical section (ts={self.request_timestamp})")
            await self.broadcast_ui_update()
            
        if not self.active_peers:
            await self.enter_cs()
            return

        async with httpx.AsyncClient() as client:
            tasks = []
            for peer_url in list(self.active_peers):
                peer_id = self.get_peer_id_from_url(peer_url)
                tasks.append(self.send_request_to_peer(client, peer_url, peer_id))
            
            await asyncio.gather(*tasks)

    async def send_request_to_peer(self, client: httpx.AsyncClient, peer_url: str, peer_id: str):
        try:
            await self.add_log(f"Sent REQUEST to {peer_id}")
            await self.broadcast_message_event("REQUEST", peer_id)
            resp = await client.post(
                f"{peer_url}/api/request", 
                json={"timestamp": self.request_timestamp, "node_id": self.node_id},
                timeout=2.0
            )
            resp.raise_for_status()
        except Exception as e:
            # Node failed
            async with self.lock:
                if peer_url in self.active_peers:
                    self.active_peers.remove(peer_url)
                    await self.add_log(f"Node {peer_id} failed. Removed from active peers. {str(e)}")
                    await self.broadcast_ui_update()
                    await self.check_cs_entry()

    async def receive_request(self, req: RequestMessage):
        async with self.lock:
            if self.is_failed:
                return
            await self.update_clock(req.timestamp)
            await self.add_log(f"Received REQUEST from {req.node_id} (ts={req.timestamp})")
            
            defer = False
            if self.state == NodeState.HELD:
                defer = True
            elif self.state == NodeState.REQUESTING:
                # Tie breaker: lower timestamp wins, then lower ID
                if (self.request_timestamp < req.timestamp) or \
                   (self.request_timestamp == req.timestamp and self.node_id < req.node_id):
                    defer = True
            
            if defer:
                self.deferred_replies.append(req.node_id)
                await self.add_log(f"Deferred REPLY to {req.node_id}")
                await self.broadcast_ui_update()
            else:
                asyncio.create_task(self.send_reply(req.node_id))

    async def send_reply(self, target_id: str):
        peer_url = self.get_peer_url(target_id)
        if not peer_url:
            return
        
        await self.add_log(f"Sent REPLY to {target_id}")
        await self.broadcast_message_event("REPLY", target_id)
        async with httpx.AsyncClient() as client:
            try:
                await client.post(
                    f"{peer_url}/api/reply",
                    json={"node_id": self.node_id},
                    timeout=2.0
                )
            except Exception:
                pass # If it fails, target might be dead

    async def receive_reply(self, rep: ReplyMessage):
        async with self.lock:
            if self.is_failed:
                return
            
            self.replies_received.add(rep.node_id)
            await self.add_log(f"Received REPLY from {rep.node_id}")
            await self.broadcast_ui_update()
            await self.check_cs_entry()

    async def check_cs_entry(self):
        if self.state == NodeState.REQUESTING:
            expected_replies = set(self.get_peer_id_from_url(p) for p in self.active_peers)
            if expected_replies.issubset(self.replies_received):
                # We have all necessary replies
                await self.enter_cs()

    async def enter_cs(self):
        self.state = NodeState.HELD
        await self.add_log("ENTERED Critical Section (Booking Slot)")
        await self.broadcast_ui_update()
        
        # Simulate time in critical section
        asyncio.create_task(self.cs_routine())

    async def cs_routine(self):
        await asyncio.sleep(self.cs_delay)
        async with self.lock:
            if not self.is_failed:
                await self.exit_cs()

    async def exit_cs(self):
        self.state = NodeState.IDLE
        await self.add_log("EXITED Critical Section")
        
        # Send deferred replies
        for target_id in self.deferred_replies:
            asyncio.create_task(self.send_reply(target_id))
            
        self.deferred_replies.clear()
        self.replies_received.clear()
        await self.broadcast_ui_update()

    async def fail_node(self):
        async with self.lock:
            self.is_failed = True
            await self.add_log("Node manually FAILED")
            # Clear state
            self.state = NodeState.IDLE
            self.deferred_replies.clear()
            self.replies_received.clear()
            await self.broadcast_ui_update()

    async def recover_node(self):
        async with self.lock:
            self.is_failed = False
            await self.add_log("Node RECOVERED. Broadcasting recovery.")
            self.active_peers = set(self.all_peers)
            await self.broadcast_ui_update()
        
        async with httpx.AsyncClient() as client:
            for peer_url in self.all_peers:
                try:
                    await client.post(f"{peer_url}/api/recover", json={"node_id": self.node_id, "is_active": True}, timeout=2.0)
                except Exception:
                    # Ignore offline peers during recovery
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
            self.state = NodeState.IDLE
            self.request_timestamp = 0
            self.deferred_replies.clear()
            self.replies_received.clear()
            self.is_failed = False
            self.active_peers = set(self.all_peers)
            self.message_logs.clear()
            await self.add_log("Network RESET manually triggered.")
            await self.broadcast_ui_update()

node_instance = Node()
