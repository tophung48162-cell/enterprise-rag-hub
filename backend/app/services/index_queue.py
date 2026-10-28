from collections.abc import Callable

from workers.celery_app import celery_app

IndexDispatcher = Callable[[str], None]


def dispatch_index_version(version_id: str) -> None:
    celery_app.send_task("index.build", args=[version_id])


def get_index_dispatcher() -> IndexDispatcher:
    return dispatch_index_version
