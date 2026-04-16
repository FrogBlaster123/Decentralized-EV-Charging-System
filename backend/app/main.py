import asyncio
from pydantic import BaseModel
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.node import (
    node_instance,
    RequestMessage,
    ReplyMessage,
    RecoverMessage,
    QueueResponseMessage,
    AutoAssignMessage,
    SlotStatusRequest,
    RescheduleMessage,
    DequeueMessage,
)

app = FastAPI(title=f"Node {node_instance.node_id}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SlotPayload(BaseModel):
    slot_id: str
    preference: str = "flexible"
    flex_range: int = 2

class ReschedulePayload(BaseModel):
    old_slot: str
    new_slot: str

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(node_instance.broadcast_ui_update())

# ── Inter-node protocol endpoints ────────────────────────────────

@app.post("/api/request")
async def handle_request(req: RequestMessage):
    if node_instance.is_failed:
        raise HTTPException(status_code=503, detail="Node is offline")
    await node_instance.receive_request(req)
    return {"status": "ok"}

@app.post("/api/reply")
async def handle_reply(rep: ReplyMessage):
    if node_instance.is_failed:
        raise HTTPException(status_code=503, detail="Node is offline")
    await node_instance.receive_reply(rep)
    return {"status": "ok"}

@app.post("/api/queue_response")
async def handle_queue_response(msg: QueueResponseMessage):
    if node_instance.is_failed:
        raise HTTPException(status_code=503, detail="Node is offline")
    await node_instance.receive_queue_response(msg)
    return {"status": "ok"}

@app.post("/api/auto_assign")
async def handle_auto_assign(msg: AutoAssignMessage):
    if node_instance.is_failed:
        raise HTTPException(status_code=503, detail="Node is offline")
    await node_instance.receive_auto_assign(msg)
    return {"status": "ok"}

@app.post("/api/slot_status")
async def handle_slot_status(req: SlotStatusRequest):
    return {
        "node_id": node_instance.node_id,
        "slots": node_instance.get_slot_status(),
    }

@app.post("/api/queue_update")
async def handle_queue_update(data: dict):
    if node_instance.is_failed:
        raise HTTPException(status_code=503, detail="Node is offline")
    await node_instance.receive_queue_update(data)
    return {"status": "ok"}

@app.post("/api/reschedule")
async def handle_reschedule(msg: RescheduleMessage):
    if node_instance.is_failed:
        raise HTTPException(status_code=503, detail="Node is offline")
    await node_instance.receive_reschedule(msg)
    return {"status": "ok"}

@app.post("/api/recover")
async def handle_recover(msg: RecoverMessage):
    if node_instance.is_failed:
        raise HTTPException(status_code=503, detail="Node is offline")
    await node_instance.receive_recover(msg)
    return {"status": "ok"}

@app.post("/api/dequeue")
async def handle_dequeue(msg: DequeueMessage):
    if node_instance.is_failed:
        raise HTTPException(status_code=503, detail="Node is offline")
    await node_instance.receive_dequeue(msg)
    return {"status": "ok"}

# ── UI trigger endpoints ─────────────────────────────────────────

@app.post("/api/trigger_booking")
async def trigger_booking(payload: SlotPayload):
    asyncio.create_task(node_instance.request_cs(
        payload.slot_id,
        preference=payload.preference,
        flex_range=payload.flex_range,
    ))
    return {"status": "ok"}

@app.post("/api/trigger_release")
async def trigger_release(payload: SlotPayload):
    asyncio.create_task(node_instance.release_slot(payload.slot_id))
    return {"status": "ok"}

@app.post("/api/trigger_confirm")
async def trigger_confirm(payload: SlotPayload):
    asyncio.create_task(node_instance.confirm_hold(payload.slot_id))
    return {"status": "ok"}

@app.post("/api/trigger_reschedule")
async def trigger_reschedule(payload: ReschedulePayload):
    asyncio.create_task(node_instance.trigger_reschedule(payload.old_slot, payload.new_slot))
    return {"status": "ok"}

@app.post("/api/trigger_fail")
async def trigger_fail():
    await node_instance.fail_node()
    return {"status": "ok"}

@app.post("/api/trigger_recover")
async def trigger_recover():
    await node_instance.recover_node()
    return {"status": "ok"}

@app.post("/api/reset")
async def trigger_reset():
    await node_instance.reset_node()
    return {"status": "ok"}

# ── WebSocket ────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    node_instance.ui_connections.append(websocket)
    await node_instance.broadcast_ui_update()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        node_instance.ui_connections.remove(websocket)
