import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect


def test_initial_migration_upgrades_clean_database_and_matches_models(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    database = tmp_path / "migration.db"
    env = os.environ.copy()
    env["HUB_DATABASE_URL"] = f"sqlite:///{database}"

    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    engine = create_engine(env["HUB_DATABASE_URL"])
    inspector = inspect(engine)
    assert {"providers", "model_configs", "ocr_results", "knowledge_bases", "documents", "chunks"}.issubset(
        inspector.get_table_names()
    )
    assert inspector.get_columns("ocr_results")[0]["name"] == "id"
    assert {column["name"] for column in inspector.get_columns("providers")} >= {
        "secret_ciphertext",
        "created_at",
        "updated_at",
    }
    foreign_keys = inspector.get_foreign_keys("ocr_results")
    assert foreign_keys[0]["referred_table"] == "model_configs"
    engine.dispose()

    subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        cwd=backend,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
