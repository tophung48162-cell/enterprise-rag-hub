import httpx
import pytest
import respx

from app.errors import ApiError
from app.providers.gateway import ModelGateway
from tests.conftest import make_provider_model


@pytest.mark.asyncio
async def test_llm_connection_uses_chat_and_reads_usage():
    provider, model = make_provider_model("LLM")
    with respx.mock:
        route = respx.post("https://provider.example.com/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": "OK"}}],
                    "usage": {"prompt_tokens": 8, "completion_tokens": 1},
                },
            )
        )
        result = await ModelGateway().test_model(provider, model, "secret")
    assert route.called
    assert route.calls[0].request.headers["Authorization"] == "Bearer secret"
    assert result.input_tokens == 8
    assert result.output_tokens == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(("kind", "expected_path"), [("tongyi", "reranks"), ("openrouter", "rerank")])
async def test_rerank_uses_provider_specific_endpoint(kind, expected_path):
    provider, model = make_provider_model("Rerank", kind)
    with respx.mock:
        route = respx.post(f"https://provider.example.com/v1/{expected_path}").mock(
            return_value=httpx.Response(200, json={"results": [{"index": 0, "relevance_score": 0.9}]})
        )
        await ModelGateway().test_model(provider, model, "secret")
    assert route.called


@pytest.mark.asyncio
async def test_rerank_reads_tongyi_nested_results():
    provider, model = make_provider_model("Rerank", "tongyi")
    with respx.mock:
        route = respx.post("https://provider.example.com/v1/reranks").mock(
            return_value=httpx.Response(
                200,
                json={
                    "output": {
                        "results": [{"index": 1, "relevance_score": 0.95}, {"index": 0, "relevance_score": 0.2}]
                    }
                },
            )
        )
        result = await ModelGateway().rerank(provider, model, "secret", "查询", ["甲", "乙"], 2)
    assert route.called
    assert result.scores == [(1, 0.95), (0, 0.2)]


@pytest.mark.asyncio
async def test_rerank_rejects_invalid_result_index():
    provider, model = make_provider_model("Rerank", "openrouter")
    with respx.mock:
        respx.post("https://provider.example.com/v1/rerank").mock(
            return_value=httpx.Response(200, json={"results": [{"index": 8, "relevance_score": 0.9}]})
        )
        with pytest.raises(ApiError) as caught:
            await ModelGateway().rerank(provider, model, "secret", "查询", ["甲"], 1)
    assert caught.value.code == "RERANK_RESPONSE_INVALID"


@pytest.mark.asyncio
async def test_rerank_provider_failure_is_sanitized():
    provider, model = make_provider_model("Rerank", "openrouter")
    with respx.mock:
        respx.post("https://provider.example.com/v1/rerank").mock(
            return_value=httpx.Response(500, json={"error": "rerank-secret"})
        )
        with pytest.raises(ApiError) as caught:
            await ModelGateway().rerank(provider, model, "rerank-secret", "查询", ["甲"], 1)
    assert caught.value.code == "RERANK_PROVIDER_FAILED"
    assert caught.value.retryable is True
    assert "rerank-secret" not in str(caught.value)


@pytest.mark.asyncio
async def test_rate_limit_is_retryable_and_does_not_leak_key():
    provider, model = make_provider_model("Embedding")
    with respx.mock:
        respx.post("https://provider.example.com/v1/embeddings").mock(
            return_value=httpx.Response(429, json={"error": "secret must not leak"})
        )
        with pytest.raises(ApiError) as caught:
            await ModelGateway().test_model(provider, model, "very-secret-key")
    assert caught.value.retryable is True
    assert "very-secret-key" not in str(caught.value)
    assert "secret must not leak" not in caught.value.message


@pytest.mark.asyncio
async def test_stream_chat_uses_langchain_stream_usage_and_returns_provider_tokens(monkeypatch):
    from langchain_core.messages import AIMessageChunk, HumanMessage

    captured = {}

    class FakeChat:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def astream(self, messages):
            assert messages[0].content == "问题"
            yield AIMessageChunk(content="第一段")
            yield AIMessageChunk(
                content="",
                usage_metadata={"input_tokens": 11, "output_tokens": 5, "total_tokens": 16},
            )

    monkeypatch.setattr("app.providers.gateway.ChatOpenAI", FakeChat)
    provider, model = make_provider_model("LLM")
    chunks = [
        chunk
        async for chunk in ModelGateway().stream_chat(provider, model, "chat-secret", [HumanMessage(content="问题")])
    ]
    assert captured["streaming"] is True
    assert captured["stream_usage"] is True
    assert captured["max_retries"] == 0
    assert chunks[0].text == "第一段"
    assert chunks[1].input_tokens == 11
    assert chunks[1].output_tokens == 5
    assert chunks[1].total_tokens == 16
    assert chunks[1].usage_source == "provider"


def install_embedding_transport(monkeypatch, handler):
    import httpx2
    from langchain_openai import OpenAIEmbeddings

    clients = []

    def factory(**kwargs):
        client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
        clients.append(client)
        return OpenAIEmbeddings(**kwargs, http_async_client=client)

    monkeypatch.setattr("app.providers.gateway.OpenAIEmbeddings", factory)
    return clients


@pytest.mark.asyncio
async def test_embedding_build_uses_langchain_openai_endpoint_and_parses_vectors(monkeypatch):
    import httpx2

    provider, model = make_provider_model("Embedding")
    requests = []

    def handler(request):
        requests.append(request)
        return httpx2.Response(
            200,
            json={
                "data": [
                    {"index": 0, "embedding": [0.1, 0.2]},
                    {"index": 1, "embedding": [0.3, 0.4]},
                ]
            },
        )

    clients = install_embedding_transport(monkeypatch, handler)
    result = await ModelGateway().embed_documents(provider, model, "embedding-secret", ["第一段", "第二段"])
    await clients[0].aclose()
    assert len(requests) == 1
    assert requests[0].url.path == "/v1/embeddings"
    assert requests[0].headers["Authorization"] == "Bearer embedding-secret"
    assert result.vectors == [[0.1, 0.2], [0.3, 0.4]]
    assert result.input_tokens is None
    assert result.usage_source == "unavailable"


@pytest.mark.asyncio
async def test_embedding_provider_failure_is_sanitized_and_retryable(monkeypatch):
    import httpx2

    provider, model = make_provider_model("Embedding")

    def handler(request):
        return httpx2.Response(500, json={"error": "embedding-secret"}, request=request)

    clients = install_embedding_transport(monkeypatch, handler)
    with pytest.raises(ApiError) as caught:
        await ModelGateway().embed_documents(provider, model, "embedding-secret", ["文本"])
    await clients[0].aclose()
    assert caught.value.code == "EMBEDDING_PROVIDER_FAILED"
    assert caught.value.retryable is True
    assert "embedding-secret" not in str(caught.value)
