import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from app.node import (
    node_instance,
    RequestMessage,
    ReplyMessage,
    RecoverMessage
)

app = FastAPI(title=f"Node {node_instance.node_id}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    # Initial status broadcast
    asyncio.create_task(node_instance.broadcast_ui_update())

@app.post("/api/request")
async def handle_request(req: RequestMessage):
    await node_instance.receive_request(req)
    return {"status": "ok"}

@app.post("/api/reply")
async def handle_reply(rep: ReplyMessage):
    await node_instance.receive_reply(rep)
    return {"status": "ok"}

@app.post("/api/recover")
async def handle_recover(msg: RecoverMessage):
    await node_instance.receive_recover(msg)
    return {"status": "ok"}

# Internal endpoints for UI triggers
@app.post("/api/trigger_booking")
async def trigger_booking():
    asyncio.create_task(node_instance.request_cs())
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

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    node_instance.ui_connections.append(websocket)
    await node_instance.broadcast_ui_update()
    try:
        while True:
            # Keep connection alive
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        node_instance.ui_connections.remove(websocket)
