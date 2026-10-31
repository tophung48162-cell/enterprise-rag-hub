from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import (
    ObservabilityErrorOut,
    ObservabilityRunDetailOut,
    ObservabilityRunOut,
    ObservabilitySummaryOut,
)
from app.services.observability_query import get_run_detail, get_summary, list_errors, list_runs

router = APIRouter(prefix="/observability", tags=["可观测"])


@router.get("/summary", response_model=ObservabilitySummaryOut)
def observability_summary(db: Session = Depends(get_db)) -> ObservabilitySummaryOut:
    return get_summary(db)


@router.get("/runs", response_model=list[ObservabilityRunOut])
def observability_runs(
    kind: Literal["all", "chat", "build"] = "all",
    status: str | None = None,
    provider: str | None = None,
    search: str | None = None,
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[ObservabilityRunOut]:
    return list_runs(db, kind=kind, status=status, provider=provider, search=search, limit=limit)


@router.get("/runs/{run_id}", response_model=ObservabilityRunDetailOut)
def observability_run(run_id: str, db: Session = Depends(get_db)) -> ObservabilityRunDetailOut:
    return get_run_detail(db, run_id)


@router.get("/errors", response_model=list[ObservabilityErrorOut])
def observability_errors(
    limit: int = Query(default=200, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[ObservabilityErrorOut]:
    return list_errors(db, limit=limit)
