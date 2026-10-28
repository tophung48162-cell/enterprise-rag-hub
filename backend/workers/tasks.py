import asyncio
from datetime import UTC, datetime

from celery.exceptions import SoftTimeLimitExceeded

from app.db import SessionLocal
from app.db_models import OcrResult
from app.errors import ApiError
from app.providers.gateway import ModelGateway
from app.services.indexing import mark_index_failed, process_index_version
from app.services.ocr import process_queued_ocr
from app.storage import S3Storage
from workers.celery_app import celery_app


@celery_app.task(bind=True, name="ocr.recognize", max_retries=2, retry_backoff=True, retry_jitter=True)
def recognize_ocr(self, result_id: str) -> dict[str, str]:
    """Run one OCR request, retrying transient failures at most twice."""
    try:
        with SessionLocal() as db:
            result = asyncio.run(process_queued_ocr(db, S3Storage(), result_id))
            return {"result_id": result.id, "status": result.status}
    except ApiError as exc:
        if exc.retryable:
            raise self.retry(exc=exc) from exc
        return {"result_id": result_id, "status": "failed", "error_code": exc.code}
    except SoftTimeLimitExceeded:
        with SessionLocal() as db:
            result = db.get(OcrResult, result_id)
            if result and result.status != "ready":
                result.status = "failed"
                result.error_code = "OCR_TASK_TIMEOUT"
                result.completed_at = datetime.now(UTC)
                db.commit()
        return {"result_id": result_id, "status": "failed", "error_code": "OCR_TASK_TIMEOUT"}


@celery_app.task(bind=True, name="index.build", max_retries=2, retry_backoff=True, retry_jitter=True)
def build_index(self, version_id: str) -> dict[str, str]:
    """Build one immutable index version, retrying transient provider failures."""
    try:
        with SessionLocal() as db:
            version = asyncio.run(process_index_version(db, ModelGateway(), version_id))
            return {"version_id": version.id, "status": version.status}
    except ApiError as exc:
        if exc.retryable:
            raise self.retry(exc=exc) from exc
        return {"version_id": version_id, "status": "failed", "error_code": exc.code}
    except SoftTimeLimitExceeded:
        with SessionLocal() as db:
            mark_index_failed(db, version_id, "INDEX_TASK_TIMEOUT")
        return {"version_id": version_id, "status": "failed", "error_code": "INDEX_TASK_TIMEOUT"}
    except Exception:
        with SessionLocal() as db:
            mark_index_failed(db, version_id, "INDEX_TASK_FAILED")
        return {"version_id": version_id, "status": "failed", "error_code": "INDEX_TASK_FAILED"}
