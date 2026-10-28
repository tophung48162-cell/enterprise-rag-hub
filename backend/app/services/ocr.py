import hashlib
import time
import uuid
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db_models import ModelConfig, OcrResult, Provider
from app.errors import ApiError
from app.security import decrypt_secret
from app.services.configs import get_model, get_provider
from app.storage import ObjectStorage

MIME_BY_FORMAT = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}
OCR_PROMPT = "请准确提取图片中的全部文字和表格内容，保持原有阅读顺序，只输出识别内容，不要补充解释或虚构信息。"


def validate_image(data: bytes) -> str:
    if not data:
        raise ApiError(422, "EMPTY_FILE", "不能处理空图片")
    if len(data) > get_settings().ocr_max_file_bytes:
        raise ApiError(413, "OCR_FILE_TOO_LARGE", "OCR 图片超过服务端大小限制")
    try:
        with Image.open(BytesIO(data)) as image:
            image.verify()
            mime = MIME_BY_FORMAT.get(image.format or "")
    except (UnidentifiedImageError, OSError) as exc:
        raise ApiError(422, "INVALID_IMAGE", "文件不是有效的 PNG、JPEG 或 WEBP 图片") from exc
    if not mime:
        raise ApiError(422, "UNSUPPORTED_IMAGE", "仅支持 PNG、JPEG 或 WEBP 图片")
    return mime


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "\n".join(
            str(block.get("text", "")) if isinstance(block, dict) else str(block)
            for block in content
        ).strip()
    return str(content).strip()


def _ocr_model(db: Session, model_id: str) -> tuple[ModelConfig, Provider]:
    model = get_model(db, model_id)
    provider = get_provider(db, model.provider_id)
    if not model.enabled or not provider.enabled:
        raise ApiError(409, "OCR_MODEL_DISABLED", "OCR 模型或服务商已停用")
    if model.capability != "LLM" or provider.kind != "tongyi" or "ocr" not in model.remote_model_id.lower():
        raise ApiError(422, "OCR_MODEL_UNSUPPORTED", "请选择通义百炼的 OCR 模型配置")
    return model, provider


def prepare_ocr(
    db: Session,
    storage: ObjectStorage,
    *,
    data: bytes,
    file_name: str,
    model_config_id: str,
    retry_of_id: str | None = None,
    initial_status: str = "processing",
) -> tuple[OcrResult, str]:
    """Validate and persist the original before any queue or provider call."""
    mime = validate_image(data)
    model, _ = _ocr_model(db, model_config_id)
    safe_name = Path(file_name).name.replace("\x00", "")[:255] or f"image.{mime.split('/')[1]}"
    result = OcrResult(
        id=str(uuid.uuid4()),
        model_config_id=model.id,
        retry_of_id=retry_of_id,
        file_name=safe_name,
        sha256=hashlib.sha256(data).hexdigest(),
        object_key="pending",
        status=initial_status,
    )
    result.object_key = f"ocr/{result.id}/{safe_name}"
    try:
        storage.put_bytes(result.object_key, data, mime)
    except (BotoCoreError, ClientError, OSError) as exc:
        raise ApiError(503, "OBJECT_STORAGE_UNAVAILABLE", "原图保存失败，请检查对象存储", retryable=True) from exc
    db.add(result)
    db.commit()
    return result, mime


async def _execute_ocr(
    db: Session,
    result: OcrResult,
    *,
    data: bytes,
    mime: str,
    model: ModelConfig,
    provider: Provider,
) -> OcrResult:
    result.status = "processing"
    result.error_code = None
    result.completed_at = None
    db.commit()
    started = time.perf_counter()
    try:
        import base64

        encoded = base64.b64encode(data).decode("ascii")
        chat = ChatOpenAI(
            model=model.remote_model_id,
            api_key=decrypt_secret(provider.secret_ciphertext),
            base_url=provider.base_url,
            timeout=get_settings().http_timeout_seconds,
            max_retries=0,
        )
        response = await chat.ainvoke(
            [
                HumanMessage(
                    content=[
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
                        {"type": "text", "text": OCR_PROMPT},
                    ]
                )
            ]
        )
        result.text = _message_text(response.content)
        if not result.text:
            raise ValueError("OCR provider returned empty content")
        usage = response.usage_metadata or {}
        result.input_tokens = usage.get("input_tokens")
        result.output_tokens = usage.get("output_tokens")
        result.usage_source = "provider" if usage else "unavailable"
        result.status = "ready"
    except Exception as exc:
        result.status = "failed"
        result.error_code = "OCR_PROVIDER_FAILED"
        result.duration_ms = round((time.perf_counter() - started) * 1000)
        result.completed_at = datetime.now(UTC)
        db.commit()
        raise ApiError(
            502,
            "OCR_PROVIDER_FAILED",
            "云端 OCR 识别失败，可稍后重试",
            retryable=True,
            details={"ocr_result_id": result.id},
        ) from exc
    result.duration_ms = round((time.perf_counter() - started) * 1000)
    result.completed_at = datetime.now(UTC)
    db.commit()
    return result


async def recognize_image(
    db: Session,
    storage: ObjectStorage,
    *,
    data: bytes,
    file_name: str,
    model_config_id: str,
    retry_of_id: str | None = None,
) -> OcrResult:
    result, mime = prepare_ocr(
        db,
        storage,
        data=data,
        file_name=file_name,
        model_config_id=model_config_id,
        retry_of_id=retry_of_id,
    )
    model, provider = _ocr_model(db, model_config_id)
    return await _execute_ocr(db, result, data=data, mime=mime, model=model, provider=provider)


async def process_queued_ocr(db: Session, storage: ObjectStorage, result_id: str) -> OcrResult:
    """Worker entry point; OcrResult remains authoritative across Redis restarts."""
    result = db.get(OcrResult, result_id)
    if not result:
        raise ApiError(404, "OCR_RESULT_NOT_FOUND", "OCR 处理记录不存在")
    if result.status == "ready":
        return result
    if result.status not in {"queued", "processing", "failed"}:
        raise ApiError(409, "OCR_TASK_NOT_PROCESSABLE", "OCR 记录当前不能由 Worker 处理")
    try:
        model, provider = _ocr_model(db, result.model_config_id)
        data = storage.get_bytes(result.object_key)
        mime = validate_image(data)
    except (BotoCoreError, ClientError, OSError) as exc:
        error = ApiError(503, "OBJECT_STORAGE_UNAVAILABLE", "无法读取原图，请检查对象存储", retryable=True)
        result.status = "failed"
        result.error_code = error.code
        result.completed_at = datetime.now(UTC)
        db.commit()
        raise error from exc
    except ApiError as exc:
        result.status = "failed"
        result.error_code = exc.code
        result.completed_at = datetime.now(UTC)
        db.commit()
        raise
    return await _execute_ocr(db, result, data=data, mime=mime, model=model, provider=provider)


async def retry_ocr(db: Session, storage: ObjectStorage, result_id: str) -> OcrResult:
    previous = db.get(OcrResult, result_id)
    if not previous:
        raise ApiError(404, "OCR_RESULT_NOT_FOUND", "OCR 处理记录不存在")
    if previous.status != "failed":
        raise ApiError(409, "OCR_RETRY_NOT_ALLOWED", "仅失败的 OCR 记录可以重试")
    try:
        data = storage.get_bytes(previous.object_key)
    except (BotoCoreError, ClientError, OSError) as exc:
        raise ApiError(503, "OBJECT_STORAGE_UNAVAILABLE", "无法读取原图，请检查对象存储", retryable=True) from exc
    return await recognize_image(
        db,
        storage,
        data=data,
        file_name=previous.file_name,
        model_config_id=previous.model_config_id,
        retry_of_id=previous.id,
    )
