import asyncio
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.db_models import (
    Assistant,
    Citation,
    Conversation,
    Message,
    QueryRun,
    RunKnowledgeBase,
    utc_now,
)
from app.errors import ApiError
from app.providers.gateway import ModelGateway
from app.schemas import AssistantInput, ChatRequest, CitationOut, RetrievalRequest, RetrievalResultOut
from app.security import decrypt_secret
from app.services.assistants import assistant_kb_ids, get_assistant, validate_assistant
from app.services.configs import get_provider
from app.services.observability import TraceRecorder, capture_context_snapshot, create_trace_root, safe_error
from app.services.retrieval import retrieve_knowledge


@dataclass(frozen=True)
class PreparedChat:
    conversation_id: str
    assistant_id: str
    user_message_id: str
    answer_message_id: str
    run_id: str
    trace_id: str
    query: str
    role_context: str


def prepare_chat(db: Session, conversation_id: str, payload: ChatRequest) -> PreparedChat:
    query = payload.query.strip()
    if not query:
        raise ApiError(422, "EMPTY_CHAT_QUERY", "问题不能为空")
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise ApiError(404, "CONVERSATION_NOT_FOUND", "会话不存在")
    assistant = get_assistant(db, conversation.assistant_id)
    if not assistant.published:
        raise ApiError(409, "ASSISTANT_NOT_PUBLISHED", "问答应用发布后才能开始对话")
    kb_ids = assistant_kb_ids(db, assistant.id)
    settings = AssistantInput(
        name=assistant.name,
        description=assistant.description,
        llm_model_id=assistant.llm_model_id,
        kb_ids=kb_ids,
        system_prompt=assistant.system_prompt,
        top_k=assistant.top_k,
        candidate_k=assistant.candidate_k,
        similarity_threshold=assistant.similarity_threshold,
        rerank_enabled=assistant.rerank_enabled,
        published=assistant.published,
    )
    model, _ = validate_assistant(db, settings)
    provider = get_provider(db, model.provider_id)
    if not model.enabled or not provider.enabled:
        raise ApiError(409, "CHAT_MODEL_DISABLED", "问答模型或服务商已停用")

    user_message = Message(conversation_id=conversation.id, role="user", content=query, status="ready")
    answer_message = Message(conversation_id=conversation.id, role="assistant", content="", status="running")
    run = QueryRun(
        conversation_id=conversation.id,
        assistant_id=assistant.id,
        llm_model_id=assistant.llm_model_id,
        query=query,
        role_context=payload.role_context,
        status="running",
    )
    db.add_all([user_message, answer_message, run])
    db.flush()
    db.add_all([RunKnowledgeBase(run_id=run.id, kb_id=kb_id) for kb_id in kb_ids])
    trace_root = create_trace_root(db, run, name=assistant.name, assistant_id=assistant.id)
    if conversation.title == "新对话":
        conversation.title = query[:60]
    conversation.updated_at = utc_now()
    db.commit()
    return PreparedChat(
        conversation_id=conversation.id,
        assistant_id=assistant.id,
        user_message_id=user_message.id,
        answer_message_id=answer_message.id,
        run_id=run.id,
        trace_id=trace_root.trace_id,
        query=query,
        role_context=payload.role_context,
    )


def _citation_out(citation: Citation) -> CitationOut:
    return CitationOut(
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


def _history(db: Session, prepared: PreparedChat) -> list[BaseMessage]:
    rows = list(
        db.scalars(
            select(Message)
            .where(
                Message.conversation_id == prepared.conversation_id,
                Message.id != prepared.user_message_id,
                Message.status == "ready",
            )
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(12)
        ).all()
    )
    rows.reverse()
    return [HumanMessage(content=row.content) if row.role == "user" else AIMessage(content=row.content) for row in rows]


def _finalize(
    db: Session,
    prepared: PreparedChat,
    *,
    status: str,
    answer: str,
    input_tokens: int | None,
    output_tokens: int | None,
    total_tokens: int | None,
    first_token_ms: int | None,
    total_ms: int,
    error_code: str | None = None,
) -> None:
    run = db.get(QueryRun, prepared.run_id)
    message = db.get(Message, prepared.answer_message_id)
    conversation = db.get(Conversation, prepared.conversation_id)
    if not run or not message:
        return
    run.status = status
    run.answer = answer
    run.input_tokens = input_tokens
    run.output_tokens = output_tokens
    run.total_tokens = total_tokens
    run.usage_source = (
        "provider" if any(value is not None for value in (input_tokens, output_tokens, total_tokens)) else "unavailable"
    )
    run.first_token_ms = first_token_ms
    run.total_ms = total_ms
    run.error_code = error_code
    message.content = answer
    message.status = "ready" if status == "succeeded" else status
    if conversation:
        conversation.updated_at = utc_now()
    db.commit()


async def stream_grounded_chat(
    prepared: PreparedChat,
    gateway: ModelGateway,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    started = time.perf_counter()
    answer = ""
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    first_token_ms: int | None = None
    yield "meta", {
        "conversation_id": prepared.conversation_id,
        "assistant_id": prepared.assistant_id,
        "user_message_id": prepared.user_message_id,
        "answer_message_id": prepared.answer_message_id,
        "run_id": prepared.run_id,
        "trace_id": prepared.trace_id,
    }
    with SessionLocal() as db:
        recorder = TraceRecorder(db, prepared.run_id)
        try:
            config_span = recorder.start(
                "LoadConfig",
                summary="加载已发布应用与活动索引配置",
                input_text=f"assistant_id={prepared.assistant_id}",
            )
            assistant = db.get(Assistant, prepared.assistant_id)
            if not assistant:
                raise ApiError(404, "ASSISTANT_NOT_FOUND", "问答应用不存在")
            kb_ids = assistant_kb_ids(db, assistant.id)
            from app.db_models import KnowledgeBase

            knowledge_bases = [db.get(KnowledgeBase, kb_id) for kb_id in kb_ids]
            if any(knowledge_base is None for knowledge_base in knowledge_bases):
                raise ApiError(409, "ASSISTANT_KB_NOT_FOUND", "应用关联的知识库已不可用")
            recorder.finish(
                config_span,
                "succeeded",
                output=f"Top K={assistant.top_k} · candidate K={assistant.candidate_k} · {len(kb_ids)} 个知识库",
                attributes={"kb_ids": kb_ids, "rerank": assistant.rerank_enabled},
            )

            ranked: list[tuple[RetrievalResultOut, str]] = []
            for knowledge_base in knowledge_bases:
                if knowledge_base is None:
                    continue
                retrieval_span = recorder.start(
                    f"Retrieval · {knowledge_base.name}",
                    summary="向量召回与可选 Rerank",
                    input_text="当前用户问题 · 原文采集未开启",
                )
                try:
                    retrieval = await retrieve_knowledge(
                        db,
                        gateway,
                        knowledge_base,
                        RetrievalRequest(
                            query=prepared.query,
                            top_k=assistant.top_k,
                            candidate_k=assistant.candidate_k,
                            similarity_threshold=assistant.similarity_threshold,
                            rerank=assistant.rerank_enabled,
                        ),
                        trace=recorder,
                        parent_span_id=retrieval_span.span.id,
                    )
                except Exception as exc:
                    code, message, _ = safe_error(exc, "RETRIEVAL_FAILED", "知识检索失败")
                    recorder.finish(retrieval_span, "failed", output=message, error_code=code)
                    raise
                ranked.extend((result, knowledge_base.name) for result in retrieval.results)
                recorder.finish(
                    retrieval_span,
                    "succeeded",
                    output=f"候选 {retrieval.candidate_count} 个 · 返回 {len(retrieval.results)} 个",
                    attributes={
                        "index_version_id": retrieval.index_version_id,
                        "candidate_count": retrieval.candidate_count,
                    },
                )

            merge_span = recorder.start("MergeAndRank", summary="多知识库合并、评分排序与引用快照")
            ranked.sort(
                key=lambda item: -(item[0].rerank_score if item[0].rerank_score is not None else item[0].vector_score)
            )
            selected = ranked[: assistant.top_k]
            citations: list[Citation] = []
            for ordinal, (result, _) in enumerate(selected, start=1):
                citation = Citation(
                    message_id=prepared.answer_message_id,
                    chunk_id=result.chunk_id,
                    ordinal=ordinal,
                    document_name=result.document_name,
                    title=result.title,
                    snapshot_text=result.text,
                    page_number=result.page_number,
                    vector_score=result.vector_score,
                    rerank_score=result.rerank_score,
                )
                db.add(citation)
                citations.append(citation)
            run = db.get(QueryRun, prepared.run_id)
            if run:
                run.citation_count = len(citations)
            db.flush()
            recorder.finish(
                merge_span,
                "succeeded",
                output=f"最终保留 {len(selected)} 个知识片段",
                attributes={"citation_ids": [citation.chunk_id for citation in citations]},
            )
            yield "citations", {
                "items": [_citation_out(citation).model_dump(mode="json") for citation in citations]
            }

            context_span = recorder.start("BuildContext", summary="构造最终模型上下文与引用编号")
            context = "\n\n".join(
                f"[{index}] 知识库：{kb_name}\n文档：{result.document_name}\n标题：{result.title}\n原文：{result.text}"
                for index, (result, kb_name) in enumerate(selected, start=1)
            ) or "（本次未检索到达到阈值的资料。）"
            system = SystemMessage(
                content=(
                    f"{assistant.system_prompt}\n\n"
                    "回答约束：只能依据提供的知识原文和对话历史作答；资料不足时明确说明不知道，"
                    "不得编造事实。使用资料中的事实时，在对应句末标注 [序号]。不要输出未提供的引用编号。"
                )
            )
            prompt = HumanMessage(content=f"知识原文：\n{context}\n\n用户问题：{prepared.query}")
            from app.services.configs import get_model

            model_config = get_model(db, assistant.llm_model_id)
            provider = get_provider(db, model_config.provider_id)
            history = _history(db, prepared)
            messages: list[BaseMessage] = [system, *history, prompt]
            snapshot = capture_context_snapshot(
                db,
                run_id=prepared.run_id,
                span_id=context_span.span.id,
                messages=messages,
                metadata={
                    "history_message_count": len(history),
                    "history_limit": 12,
                    "citation_count": len(citations),
                    "context_characters": len(context),
                    "dynamic_budget_enabled": False,
                },
            )
            recorder.finish(
                context_span,
                "succeeded",
                output=f"{len(messages)} 条模型消息 · {len(citations)} 个引用编号 · 完整快照已保存",
                attributes={
                    "message_count": len(messages),
                    "history_message_count": len(history),
                    "context_characters": len(context),
                    "dynamic_budget_enabled": False,
                    "full_snapshot_captured": True,
                    "context_snapshot_id": snapshot.id,
                    "context_hash": snapshot.metadata_json["context_hash"],
                },
            )

            llm_span = recorder.start(
                "LLM · stream_chat",
                kind="model",
                summary="LangChain ChatOpenAI 流式生成",
                input_text=f"System + {len(history)} 条历史 + {len(citations)} 个知识片段 + 当前问题",
                attributes={"stream": True, "full_input_captured": True, "context_snapshot_id": snapshot.id},
                provider=provider,
                model=model_config,
            )
            async for chunk in gateway.stream_chat(
                provider,
                model_config,
                decrypt_secret(provider.secret_ciphertext),
                messages,
            ):
                if chunk.input_tokens is not None:
                    input_tokens = chunk.input_tokens
                if chunk.output_tokens is not None:
                    output_tokens = chunk.output_tokens
                if chunk.total_tokens is not None:
                    total_tokens = chunk.total_tokens
                if not chunk.text:
                    continue
                if first_token_ms is None:
                    first_token_ms = round((time.perf_counter() - started) * 1000)
                answer += chunk.text
                yield "token", {"text": chunk.text}
            if not answer.strip():
                raise ApiError(502, "LLM_EMPTY_RESPONSE", "模型未返回可用回答，请重试", retryable=True)
            if total_tokens is None and input_tokens is not None and output_tokens is not None:
                total_tokens = input_tokens + output_tokens
            recorder.finish(
                llm_span,
                "succeeded",
                output=f"流式回答完成 · {len(answer)} 字符 · 全文见问答消息",
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                first_token_ms=first_token_ms,
            )
            if total_tokens is None:
                recorder.record_event(
                    code="USAGE_UNAVAILABLE",
                    message="LLM 服务商未返回 Token；运行保持成功，用量与成本标记未知。",
                    category="可观测自身",
                    severity="warning",
                    retryable=False,
                    span_id=llm_span.span.id,
                )

            elapsed = round((time.perf_counter() - started) * 1000)
            persist_span = recorder.start("PersistResult", summary="持久化回答、引用和服务商用量")
            _finalize(
                db,
                prepared,
                status="succeeded",
                answer=answer,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                first_token_ms=first_token_ms,
                total_ms=elapsed,
            )
            recorder.finish(persist_span, "succeeded", output="QueryRun、消息与引用已提交")
            recorder.finish_root("succeeded", output=f"回答成功 · {len(citations)} 条引用", duration_ms=elapsed)
            yield "done", {
                "run_id": prepared.run_id,
                "message_id": prepared.answer_message_id,
                "status": "succeeded",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
                "usage_source": (
                    "provider"
                    if any(value is not None for value in (input_tokens, output_tokens, total_tokens))
                    else "unavailable"
                ),
                "first_token_ms": first_token_ms,
                "total_ms": elapsed,
                "citation_count": len(citations),
            }
        except asyncio.CancelledError:
            db.rollback()
            recorder.close_open(
                "stopped",
                code="CHAT_STOPPED",
                message="用户主动停止生成，已保留调用链与已产生用量。",
                category="Harness",
                severity="warning",
                retryable=False,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                first_token_ms=first_token_ms,
            )
            _finalize(
                db,
                prepared,
                status="stopped",
                answer=answer,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                first_token_ms=first_token_ms,
                total_ms=round((time.perf_counter() - started) * 1000),
                error_code="CHAT_STOPPED",
            )
            raise
        except Exception as exc:
            db.rollback()
            code, message, retryable = safe_error(exc, "CHAT_GENERATION_FAILED", "问答生成失败，请稍后重试")
            recorder.close_open(
                "failed",
                code=code,
                message=message,
                category=(
                    "模型调用"
                    if any(token in code for token in ("PROVIDER", "LLM", "EMBEDDING", "RERANK"))
                    else "Harness"
                ),
                severity="error",
                retryable=retryable,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                first_token_ms=first_token_ms,
            )
            _finalize(
                db,
                prepared,
                status="failed",
                answer=answer,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                first_token_ms=first_token_ms,
                total_ms=round((time.perf_counter() - started) * 1000),
                error_code=code,
            )
            yield "error", {"code": code, "message": message, "run_id": prepared.run_id}
