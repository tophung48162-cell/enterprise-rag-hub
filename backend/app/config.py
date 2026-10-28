from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HUB_", env_file=".env", extra="ignore")

    app_name: str = "知枢企业知识中台 API"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://hub:hub@localhost:5432/hub"
    redis_url: str = "redis://localhost:6379/0"
    encryption_key: str = ""
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "hub"
    s3_secret_key: str = "hub-development"
    s3_bucket: str = "rag-hub"
    s3_region: str = "us-east-1"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:4173"])
    http_timeout_seconds: float = 60.0
    ocr_max_file_bytes: int = 10 * 1024 * 1024
    document_max_file_bytes: int = 50 * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
