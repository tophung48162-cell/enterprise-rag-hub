from fastapi import APIRouter

from app.api.v1 import assistants, chat, config, health, indexing, knowledge, ocr, retrieval

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(assistants.router)
api_router.include_router(chat.router)
api_router.include_router(config.router)
api_router.include_router(ocr.router)
api_router.include_router(knowledge.router)
api_router.include_router(indexing.router)
api_router.include_router(retrieval.router)
