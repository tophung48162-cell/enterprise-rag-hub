from collections.abc import Callable

from workers.celery_app import celery_app

OcrDispatcher = Callable[[str], None]


def dispatch_ocr_result(result_id: str) -> None:
    celery_app.send_task("ocr.recognize", args=[result_id])


def get_ocr_dispatcher() -> OcrDispatcher:
    return dispatch_ocr_result
