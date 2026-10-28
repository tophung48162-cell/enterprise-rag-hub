from celery import Celery

from app.config import get_settings

settings = get_settings()
celery_app = Celery(
    "enterprise_rag_hub",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["workers.tasks"],
)
celery_app.conf.update(
    timezone="UTC",
    enable_utc=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_track_started=True,
    task_time_limit=180,
    task_soft_time_limit=150,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    result_expires=3600,
)
