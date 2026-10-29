import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.v1.deps import get_gateway
from app.db import get_db
from app.providers.gateway import ModelGateway
from app.schemas import ChatRequest
from app.services.chat import prepare_chat, stream_grounded_chat

router = APIRouter(tags=["在线问答"])


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"


@router.post("/conversations/{conversation_id}/messages/stream")
async def stream_message(
    conversation_id: str,
    payload: ChatRequest,
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_gateway),
) -> StreamingResponse:
    prepared = prepare_chat(db, conversation_id, payload)

    async def events() -> AsyncIterator[str]:
        async for event, data in stream_grounded_chat(prepared, gateway):
            yield _sse(event, data)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
