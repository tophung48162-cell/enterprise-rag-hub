from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.db_models import OcrResult
from app.errors import ApiError
from app.schemas import OcrOut
from app.services.ocr import prepare_ocr, recognize_image, retry_ocr
from app.services.ocr_queue import OcrDispatcher, get_ocr_dispatcher
from app.storage import ObjectStorage, get_storage

router = APIRouter(prefix="/ocr", tags=["云端 OCR"])


@router.post("/recognize", response_model=OcrOut, status_code=201)
async def recognize(
    file: UploadFile = File(...),
    model_config_id: str = Form(...),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
) -> OcrResult:
    data = await file.read(get_settings().ocr_max_file_bytes + 1)
    await file.close()
    return await recognize_image(
        db,
        storage,
        data=data,
        file_name=file.filename or "image",
        model_config_id=model_config_id,
    )


@router.post("/recognize/async", response_model=OcrOut, status_code=202)
async def recognize_async(
    file: UploadFile = File(...),
    model_config_id: str = Form(...),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
    dispatch: OcrDispatcher = Depends(get_ocr_dispatcher),
) -> OcrResult:
    data = await file.read(get_settings().ocr_max_file_bytes + 1)
    await file.close()
    result, _ = prepare_ocr(
        db,
        storage,
        data=data,
        file_name=file.filename or "image",
        model_config_id=model_config_id,
        initial_status="queued",
    )
    try:
        dispatch(result.id)
    except Exception as exc:
        result.status = "failed"
        result.error_code = "OCR_QUEUE_UNAVAILABLE"
        result.completed_at = datetime.now(UTC)
        db.commit()
        raise ApiError(
            503,
            "OCR_QUEUE_UNAVAILABLE",
            "OCR 任务排队失败，请检查 Redis 和 Worker 后重试",
            retryable=True,
            details={"ocr_result_id": result.id},
        ) from exc
    return result


@router.get("/{result_id}", response_model=OcrOut)
def get_result(result_id: str, db: Session = Depends(get_db)) -> OcrResult:
    result = db.get(OcrResult, result_id)
    if not result:
        raise ApiError(404, "OCR_RESULT_NOT_FOUND", "OCR 处理记录不存在")
    return result


@router.post("/{result_id}/retry", response_model=OcrOut, status_code=201)
async def retry(
    result_id: str,
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
) -> OcrResult:
    return await retry_ocr(db, storage, result_id)
