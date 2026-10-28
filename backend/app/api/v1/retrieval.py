from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.v1.deps import get_gateway
from app.db import get_db
from app.providers.gateway import ModelGateway
from app.schemas import RetrievalOut, RetrievalRequest
from app.services.knowledge import get_knowledge_base
from app.services.retrieval import retrieve_knowledge

router = APIRouter(tags=["知识检索"])


@router.post("/knowledge-bases/{knowledge_base_id}/retrieval", response_model=RetrievalOut)
async def retrieve(
    knowledge_base_id: str,
    payload: RetrievalRequest,
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_gateway),
) -> RetrievalOut:
    knowledge_base = get_knowledge_base(db, knowledge_base_id)
    return await retrieve_knowledge(db, gateway, knowledge_base, payload)
