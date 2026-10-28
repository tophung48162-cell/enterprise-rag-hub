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
