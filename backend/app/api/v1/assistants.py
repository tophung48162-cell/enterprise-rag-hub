from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.db_models import (
    Assistant,
    Citation,
    Conversation,
    Message,
    ModelConfig,
    QueryRun,
    RunKnowledgeBase,
)
from app.errors import ApiError
from app.schemas import (
    AssistantInput,
    AssistantOut,
    AssistantPatch,
    CitationOut,
    ConversationDetailOut,
    ConversationOut,
    MessageOut,
    QueryRunOut,
)
from app.services.assistants import (
    assistant_kb_ids,
    assistant_out,
    get_assistant,
    replace_assistant_kbs,
    validate_assistant,
)

router = APIRouter(tags=["问答应用"])


@router.get("/assistants", response_model=list[AssistantOut])
def list_assistants(db: Session = Depends(get_db)) -> list[AssistantOut]:
    assistants = db.scalars(select(Assistant).order_by(Assistant.created_at.desc())).all()
    return [assistant_out(db, assistant) for assistant in assistants]


@router.post("/assistants", response_model=AssistantOut, status_code=201)
def create_assistant(payload: AssistantInput, db: Session = Depends(get_db)) -> AssistantOut:
    payload.name = payload.name.strip()
    if not payload.name:
        raise ApiError(422, "EMPTY_ASSISTANT_NAME", "应用名称不能为空")
    validate_assistant(db, payload)
    assistant = Assistant(**payload.model_dump(exclude={"kb_ids"}))
    try:
        db.add(assistant)
        db.flush()
        replace_assistant_kbs(db, assistant.id, payload.kb_ids)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(409, "ASSISTANT_NAME_EXISTS", "问答应用名称已存在") from exc
    return assistant_out(db, assistant)


@router.patch("/assistants/{assistant_id}", response_model=AssistantOut)
def patch_assistant(assistant_id: str, payload: AssistantPatch, db: Session = Depends(get_db)) -> AssistantOut:
    assistant = get_assistant(db, assistant_id)
    values = payload.model_dump(exclude_unset=True)
    merged = AssistantInput(
        name=values.get("name", assistant.name).strip(),
        description=values.get("description", assistant.description),
        llm_model_id=values.get("llm_model_id", assistant.llm_model_id),
        kb_ids=values.get("kb_ids", assistant_kb_ids(db, assistant.id)),
        system_prompt=values.get("system_prompt", assistant.system_prompt),
        top_k=values.get("top_k", assistant.top_k),
        candidate_k=values.get("candidate_k", assistant.candidate_k),
        similarity_threshold=values.get("similarity_threshold", assistant.similarity_threshold),
        rerank_enabled=values.get("rerank_enabled", assistant.rerank_enabled),
        published=values.get("published", assistant.published),
    )
    if not merged.name:
        raise ApiError(422, "EMPTY_ASSISTANT_NAME", "应用名称不能为空")
    validate_assistant(db, merged)
    for key, value in merged.model_dump(exclude={"kb_ids"}).items():
        setattr(assistant, key, value)
    try:
        if "kb_ids" in values:
            replace_assistant_kbs(db, assistant.id, merged.kb_ids)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(409, "ASSISTANT_NAME_EXISTS", "问答应用名称已存在") from exc
    return assistant_out(db, assistant)


def conversation_out(conversation: Conversation) -> ConversationOut:
    return ConversationOut(
        id=conversation.id,
        assistant_id=conversation.assistant_id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


def get_conversation(db: Session, conversation_id: str) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise ApiError(404, "CONVERSATION_NOT_FOUND", "会话不存在")
    return conversation


@router.get("/assistants/{assistant_id}/conversations", response_model=list[ConversationOut])
def list_conversations(assistant_id: str, db: Session = Depends(get_db)) -> list[ConversationOut]:
    get_assistant(db, assistant_id)
    conversations = db.scalars(
        select(Conversation)
        .where(Conversation.assistant_id == assistant_id)
        .order_by(Conversation.updated_at.desc())
    ).all()
    return [conversation_out(conversation) for conversation in conversations]


@router.post("/assistants/{assistant_id}/conversations", response_model=ConversationOut, status_code=201)
def create_conversation(assistant_id: str, db: Session = Depends(get_db)) -> ConversationOut:
    assistant = get_assistant(db, assistant_id)
    if not assistant.published:
        raise ApiError(409, "ASSISTANT_NOT_PUBLISHED", "问答应用发布后才能开始对话")
    conversation = Conversation(assistant_id=assistant.id, title="新对话")
    db.add(conversation)
    db.commit()
    return conversation_out(conversation)


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailOut)
def conversation_detail(conversation_id: str, db: Session = Depends(get_db)) -> ConversationDetailOut:
    conversation = get_conversation(db, conversation_id)
    messages = db.scalars(
        select(Message).where(Message.conversation_id == conversation.id).order_by(Message.created_at, Message.id)
    ).all()
    message_items = []
    for message in messages:
        citations = db.scalars(
            select(Citation).where(Citation.message_id == message.id).order_by(Citation.ordinal)
        ).all()
        message_items.append(
            MessageOut(
                id=message.id,
                role=message.role,
                content=message.content,
                status=message.status,
                created_at=message.created_at,
                citations=[
                    CitationOut(
                        id=citation.id,
                        chunk_id=citation.chunk_id,
                        ordinal=citation.ordinal,
                        document_name=citation.document_name,
                        title=citation.title,
                        snapshot_text=citation.snapshot_text,
                        page_number=citation.page_number,
                        vector_score=citation.vector_score,
                        rerank_score=citation.rerank_score,
                    )
                    for citation in citations
                ],
            )
        )
    return ConversationDetailOut(**conversation_out(conversation).model_dump(), messages=message_items)


@router.delete("/conversations/{conversation_id}", status_code=204)
def remove_conversation(conversation_id: str, db: Session = Depends(get_db)) -> None:
    conversation = get_conversation(db, conversation_id)
    message_ids = select(Message.id).where(Message.conversation_id == conversation.id)
    run_ids = select(QueryRun.id).where(QueryRun.conversation_id == conversation.id)
    db.execute(delete(Citation).where(Citation.message_id.in_(message_ids)))
    db.execute(delete(RunKnowledgeBase).where(RunKnowledgeBase.run_id.in_(run_ids)))
    db.execute(delete(QueryRun).where(QueryRun.conversation_id == conversation.id))
    db.execute(delete(Message).where(Message.conversation_id == conversation.id))
    db.delete(conversation)
    db.commit()


def query_run_out(db: Session, run: QueryRun) -> QueryRunOut:
    assistant = db.get(Assistant, run.assistant_id)
    model = db.get(ModelConfig, run.llm_model_id)
    kb_ids = list(db.scalars(select(RunKnowledgeBase.kb_id).where(RunKnowledgeBase.run_id == run.id)).all())
    return QueryRunOut(
        id=run.id,
        conversation_id=run.conversation_id,
        assistant_id=run.assistant_id,
        assistant_name=assistant.name if assistant else "已删除应用",
        kb_ids=kb_ids,
        query=run.query,
        answer=run.answer,
        role_context=run.role_context,
        status=run.status,
        llm_model=model.remote_model_id if model else "已删除模型",
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        total_tokens=run.total_tokens,
        usage_source=run.usage_source,
        first_token_ms=run.first_token_ms,
        total_ms=run.total_ms,
        citation_count=run.citation_count,
        error_code=run.error_code,
        created_at=run.created_at,
    )


@router.get("/query-runs", response_model=list[QueryRunOut])
def list_query_runs(
    kb_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[QueryRunOut]:
    statement = select(QueryRun).order_by(QueryRun.created_at.desc()).limit(200)
    if kb_id:
        statement = statement.join(RunKnowledgeBase, RunKnowledgeBase.run_id == QueryRun.id).where(
            RunKnowledgeBase.kb_id == kb_id
        )
    runs = db.scalars(statement).all()
    return [query_run_out(db, run) for run in runs]
