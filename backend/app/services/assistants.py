from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db_models import Assistant, AssistantKnowledgeBase, KnowledgeBase, ModelConfig
from app.errors import ApiError
from app.schemas import AssistantInput, AssistantOut
from app.services.configs import get_model


def get_assistant(db: Session, assistant_id: str) -> Assistant:
    assistant = db.get(Assistant, assistant_id)
    if not assistant:
        raise ApiError(404, "ASSISTANT_NOT_FOUND", "问答应用不存在")
    return assistant


def assistant_kb_ids(db: Session, assistant_id: str) -> list[str]:
    return list(
        db.scalars(
            select(AssistantKnowledgeBase.kb_id)
            .where(AssistantKnowledgeBase.assistant_id == assistant_id)
            .order_by(AssistantKnowledgeBase.position)
        ).all()
    )


def assistant_out(db: Session, assistant: Assistant) -> AssistantOut:
    return AssistantOut(
        id=assistant.id,
        name=assistant.name,
        description=assistant.description,
        llm_model_id=assistant.llm_model_id,
        kb_ids=assistant_kb_ids(db, assistant.id),
        system_prompt=assistant.system_prompt,
        top_k=assistant.top_k,
        candidate_k=assistant.candidate_k,
        similarity_threshold=assistant.similarity_threshold,
        rerank_enabled=assistant.rerank_enabled,
        published=assistant.published,
        managed=assistant.managed,
        created_at=assistant.created_at,
        updated_at=assistant.updated_at,
    )


def validate_assistant(db: Session, payload: AssistantInput) -> tuple[ModelConfig, list[KnowledgeBase]]:
    model = get_model(db, payload.llm_model_id)
    if model.capability != "LLM":
        raise ApiError(422, "MODEL_CAPABILITY_MISMATCH", "问答应用必须选择 LLM 模型")
    if len(set(payload.kb_ids)) != len(payload.kb_ids):
        raise ApiError(422, "ASSISTANT_KB_DUPLICATED", "问答应用不能重复关联知识库")
    knowledge_bases = [db.get(KnowledgeBase, kb_id) for kb_id in payload.kb_ids]
    if any(knowledge_base is None for knowledge_base in knowledge_bases):
        raise ApiError(404, "KNOWLEDGE_BASE_NOT_FOUND", "关联的知识库不存在")
    resolved = [item for item in knowledge_bases if item is not None]
    if payload.published:
        if any(not item.published for item in resolved):
            raise ApiError(409, "ASSISTANT_KB_NOT_PUBLISHED", "发布前请允许全部关联知识库用于问答")
        if any(not item.active_index_version_id for item in resolved):
            raise ApiError(409, "ASSISTANT_ACTIVE_INDEX_REQUIRED", "全部关联知识库都需要活动索引版本")
        if payload.rerank_enabled and any(not item.rerank_model_id for item in resolved):
            raise ApiError(409, "ASSISTANT_RERANK_REQUIRED", "启用重排前请为全部知识库配置 Rerank 模型")
    return model, resolved


def replace_assistant_kbs(db: Session, assistant_id: str, kb_ids: list[str]) -> None:
    db.query(AssistantKnowledgeBase).filter(AssistantKnowledgeBase.assistant_id == assistant_id).delete()
    for position, kb_id in enumerate(kb_ids):
        db.add(AssistantKnowledgeBase(assistant_id=assistant_id, kb_id=kb_id, position=position))
