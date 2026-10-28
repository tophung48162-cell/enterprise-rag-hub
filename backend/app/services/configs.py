from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db_models import ModelConfig, Provider
from app.errors import ApiError


def get_provider(db: Session, provider_id: str) -> Provider:
    provider = db.get(Provider, provider_id)
    if not provider:
        raise ApiError(404, "PROVIDER_NOT_FOUND", "服务商不存在")
    return provider


def get_model(db: Session, model_id: str) -> ModelConfig:
    model = db.get(ModelConfig, model_id)
    if not model:
        raise ApiError(404, "MODEL_NOT_FOUND", "模型配置不存在")
    return model


def list_providers(db: Session) -> list[Provider]:
    return list(db.scalars(select(Provider).order_by(Provider.created_at)).all())


def list_models(db: Session) -> list[ModelConfig]:
    return list(db.scalars(select(ModelConfig).order_by(ModelConfig.created_at)).all())
