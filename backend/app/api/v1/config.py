from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.deps import get_gateway
from app.db import get_db
from app.db_models import KnowledgeBase, ModelConfig, OcrResult, Provider
from app.errors import ApiError
from app.providers.gateway import ModelGateway
from app.schemas import (
    ModelCreate,
    ModelOut,
    ModelPatch,
    ProviderCreate,
    ProviderOut,
    ProviderPatch,
    TestResult,
)
from app.security import decrypt_secret, encrypt_secret
from app.services.configs import get_model, get_provider, list_models, list_providers

router = APIRouter(tags=["模型服务"])


def provider_out(provider: Provider) -> ProviderOut:
    return ProviderOut(
        id=provider.id,
        kind=provider.kind,
        name=provider.name,
        base_url=provider.base_url,
        configured=bool(provider.secret_ciphertext),
        enabled=provider.enabled,
    )


def model_out(model: ModelConfig) -> ModelOut:
    return ModelOut(
        id=model.id,
        provider_id=model.provider_id,
        remote_model_id=model.remote_model_id,
        capability=model.capability,
        dimensions=model.dimensions,
        enabled=model.enabled,
    )


@router.get("/providers", response_model=list[ProviderOut])
def providers(db: Session = Depends(get_db)) -> list[ProviderOut]:
    return [provider_out(item) for item in list_providers(db)]


@router.post("/providers", response_model=ProviderOut, status_code=201)
def create_provider(payload: ProviderCreate, db: Session = Depends(get_db)) -> ProviderOut:
    provider = Provider(
        kind=payload.kind,
        name=payload.name,
        base_url=str(payload.base_url).rstrip("/"),
        secret_ciphertext=encrypt_secret(payload.api_key),
    )
    db.add(provider)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(409, "PROVIDER_NAME_EXISTS", "服务商名称已存在") from exc
    return provider_out(provider)


@router.patch("/providers/{provider_id}", response_model=ProviderOut)
def patch_provider(provider_id: str, payload: ProviderPatch, db: Session = Depends(get_db)) -> ProviderOut:
    provider = get_provider(db, provider_id)
    values = payload.model_dump(exclude_unset=True)
    if "name" in values:
        provider.name = values["name"].strip()
    if "base_url" in values:
        provider.base_url = str(values["base_url"]).rstrip("/")
    if "api_key" in values:
        provider.secret_ciphertext = encrypt_secret(values["api_key"])
    if "enabled" in values:
        provider.enabled = values["enabled"]
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(409, "PROVIDER_NAME_EXISTS", "服务商名称已存在") from exc
    return provider_out(provider)


@router.delete("/providers/{provider_id}", status_code=204)
def delete_provider(provider_id: str, db: Session = Depends(get_db)) -> None:
    provider = get_provider(db, provider_id)
    count = db.scalar(select(func.count(ModelConfig.id)).where(ModelConfig.provider_id == provider.id))
    if count:
        raise ApiError(409, "PROVIDER_IN_USE", "请先移除该服务商下的模型配置")
    db.delete(provider)
    db.commit()


@router.post("/providers/{provider_id}/test", response_model=TestResult)
async def test_provider(
    provider_id: str,
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_gateway),
) -> TestResult:
    provider = get_provider(db, provider_id)
    result = await gateway.test_provider(provider, decrypt_secret(provider.secret_ciphertext))
    return TestResult(success=True, duration_ms=result.duration_ms)


@router.get("/models", response_model=list[ModelOut])
def models(db: Session = Depends(get_db)) -> list[ModelOut]:
    return [model_out(item) for item in list_models(db)]


@router.post("/models", response_model=ModelOut, status_code=201)
def create_model(payload: ModelCreate, db: Session = Depends(get_db)) -> ModelOut:
    get_provider(db, payload.provider_id)
    if payload.capability == "Embedding" and not payload.dimensions:
        raise ApiError(422, "EMBEDDING_DIMENSIONS_REQUIRED", "Embedding 模型必须配置向量维度")
    if payload.capability != "Embedding" and payload.dimensions is not None:
        raise ApiError(422, "DIMENSIONS_NOT_APPLICABLE", "仅 Embedding 模型可配置向量维度")
    model = ModelConfig(**payload.model_dump())
    db.add(model)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(409, "MODEL_CONFIG_EXISTS", "相同服务商、能力和模型 ID 的配置已存在") from exc
    return model_out(model)


@router.patch("/models/{model_id}", response_model=ModelOut)
def patch_model(model_id: str, payload: ModelPatch, db: Session = Depends(get_db)) -> ModelOut:
    model = get_model(db, model_id)
    if payload.enabled is not None:
        model.enabled = payload.enabled
    db.commit()
    return model_out(model)


@router.delete("/models/{model_id}", status_code=204)
def delete_model(model_id: str, db: Session = Depends(get_db)) -> None:
    model = get_model(db, model_id)
    used = db.scalar(select(func.count(OcrResult.id)).where(OcrResult.model_config_id == model.id))
    knowledge_used = db.scalar(
        select(func.count(KnowledgeBase.id)).where(
            or_(KnowledgeBase.embedding_model_id == model.id, KnowledgeBase.rerank_model_id == model.id)
        )
    )
    if used or knowledge_used:
        raise ApiError(409, "MODEL_IN_USE", "模型已有知识库配置或处理记录，不能删除")
    db.delete(model)
    db.commit()


@router.post("/models/{model_id}/test", response_model=TestResult)
async def test_model(
    model_id: str,
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_gateway),
) -> TestResult:
    model = get_model(db, model_id)
    provider = get_provider(db, model.provider_id)
    result = await gateway.test_model(provider, model, decrypt_secret(provider.secret_ciphertext))
    return TestResult(
        success=True,
        duration_ms=result.duration_ms,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
    )
