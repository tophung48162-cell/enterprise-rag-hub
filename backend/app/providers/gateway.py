import time
from dataclasses import dataclass
from math import isfinite
from typing import Any

import httpx
from langchain_openai import OpenAIEmbeddings

from app.config import get_settings
from app.db_models import ModelConfig, Provider
from app.errors import ApiError


@dataclass
class GatewayResult:
    duration_ms: int
    input_tokens: int | None = None
    output_tokens: int | None = None


@dataclass
class EmbeddingResult:
    vectors: list[list[float]]
    duration_ms: int
    input_tokens: int | None = None
    usage_source: str = "unavailable"


@dataclass
class RerankResult:
    scores: list[tuple[int, float]]
    duration_ms: int


def _endpoint(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _usage(payload: dict[str, Any]) -> tuple[int | None, int | None]:
    usage = payload.get("usage") or {}
    input_tokens = usage.get("prompt_tokens") or usage.get("input_tokens")
    output_tokens = usage.get("completion_tokens") or usage.get("output_tokens")
    return input_tokens, output_tokens


class ModelGateway:
    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self.client = client

    async def _request(
        self, provider: Provider, method: str, path: str, api_key: str, **kwargs: Any
    ) -> tuple[dict[str, Any], int]:
        started = time.perf_counter()
        try:
            async with self.client or httpx.AsyncClient(timeout=60.0, trust_env=False) as client:
                response = await client.request(
                    method,
                    _endpoint(provider.base_url, path),
                    headers={"Authorization": f"Bearer {api_key}"},
                    **kwargs,
                )
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPStatusError as exc:
            retryable = exc.response.status_code == 429 or exc.response.status_code >= 500
            raise ApiError(
                502,
                "PROVIDER_REQUEST_REJECTED",
                f"服务商返回 HTTP {exc.response.status_code}",
                retryable=retryable,
            ) from exc
        except (httpx.RequestError, ValueError) as exc:
            raise ApiError(504, "PROVIDER_UNAVAILABLE", "无法连接模型服务商", retryable=True) from exc
        return payload, round((time.perf_counter() - started) * 1000)

    async def embed_documents(
        self, provider: Provider, model: ModelConfig, api_key: str, texts: list[str]
    ) -> EmbeddingResult:
        if not texts:
            return EmbeddingResult(vectors=[], duration_ms=0)
        started = time.perf_counter()
        embeddings = OpenAIEmbeddings(
            model=model.remote_model_id,
            api_key=api_key,
            base_url=provider.base_url,
            timeout=get_settings().http_timeout_seconds,
            max_retries=0,
            chunk_size=min(64, len(texts)),
            check_embedding_ctx_length=False,
        )
        try:
            vectors = await embeddings.aembed_documents(texts)
        except Exception as exc:
            raise ApiError(
                502,
                "EMBEDDING_PROVIDER_FAILED",
                "Embedding 服务商调用失败，请检查模型配置后重试",
                retryable=True,
            ) from exc
        duration = round((time.perf_counter() - started) * 1000)
        return EmbeddingResult(vectors=vectors, duration_ms=duration)

    async def rerank(
        self,
        provider: Provider,
        model: ModelConfig,
        api_key: str,
        query: str,
        documents: list[str],
        top_n: int,
    ) -> RerankResult:
        if not documents:
            return RerankResult(scores=[], duration_ms=0)
        try:
            payload, duration = await self._request(
                provider,
                "POST",
                "reranks" if provider.kind == "tongyi" else "rerank",
                api_key,
                json={
                    "model": model.remote_model_id,
                    "query": query,
                    "documents": documents,
                    "top_n": min(top_n, len(documents)),
                },
            )
        except ApiError as exc:
            raise ApiError(
                502,
                "RERANK_PROVIDER_FAILED",
                "Rerank 服务商调用失败，请检查模型配置后重试",
                retryable=exc.retryable,
            ) from exc
        items = payload.get("results")
        if items is None and isinstance(payload.get("output"), dict):
            items = payload["output"].get("results")
        if not isinstance(items, list):
            raise ApiError(502, "RERANK_RESPONSE_INVALID", "Rerank 服务商返回格式不正确")
        scores: list[tuple[int, float]] = []
        seen: set[int] = set()
        for item in items:
            index = item.get("index") if isinstance(item, dict) else None
            score = item.get("relevance_score") if isinstance(item, dict) else None
            if (
                type(index) is not int
                or isinstance(score, bool)
                or not isinstance(score, int | float)
                or not isfinite(score)
                or not 0 <= index < len(documents)
                or index in seen
            ):
                raise ApiError(502, "RERANK_RESPONSE_INVALID", "Rerank 服务商返回格式不正确")
            scores.append((index, float(score)))
            seen.add(index)
        return RerankResult(scores=scores, duration_ms=duration)

    async def test_provider(self, provider: Provider, api_key: str) -> GatewayResult:
        _, duration = await self._request(provider, "GET", "models", api_key)
        return GatewayResult(duration_ms=duration)

    async def test_model(
        self, provider: Provider, model: ModelConfig, api_key: str
    ) -> GatewayResult:
        if model.capability == "LLM":
            payload, duration = await self._request(
                provider,
                "POST",
                "chat/completions",
                api_key,
                json={
                    "model": model.remote_model_id,
                    "messages": [{"role": "user", "content": "Reply with OK."}],
                    "max_tokens": 3,
                    "stream": False,
                },
            )
        elif model.capability == "Embedding":
            payload, duration = await self._request(
                provider,
                "POST",
                "embeddings",
                api_key,
                json={"model": model.remote_model_id, "input": "connection test"},
            )
        elif model.capability == "Rerank":
            payload, duration = await self._request(
                provider,
                "POST",
                "reranks" if provider.kind == "tongyi" else "rerank",
                api_key,
                json={
                    "model": model.remote_model_id,
                    "query": "connection test",
                    "documents": ["connection test"],
                    "top_n": 1,
                },
            )
        else:
            raise ApiError(422, "MODEL_CAPABILITY_UNSUPPORTED", "不支持的模型能力")
        input_tokens, output_tokens = _usage(payload)
        return GatewayResult(duration, input_tokens, output_tokens)
