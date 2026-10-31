"""Add index build traces and immutable chat context snapshots.

Revision ID: 0006_build_context
Revises: 0005_observability
Create Date: 2026-10-31
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_build_context"
down_revision: str | Sequence[str] | None = "0005_observability"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("observability_spans") as batch:
        batch.add_column(sa.Column("build_id", sa.String(length=36), nullable=True))
        batch.alter_column("run_id", existing_type=sa.String(length=36), nullable=True)
        batch.create_foreign_key(
            "fk_observability_spans_build_id",
            "index_versions",
            ["build_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch.create_index("ix_observability_spans_build_id", ["build_id"])

    with op.batch_alter_table("model_calls") as batch:
        batch.add_column(sa.Column("build_id", sa.String(length=36), nullable=True))
        batch.alter_column("run_id", existing_type=sa.String(length=36), nullable=True)
        batch.create_foreign_key(
            "fk_model_calls_build_id",
            "index_versions",
            ["build_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch.create_index("ix_model_calls_build_id", ["build_id"])

    with op.batch_alter_table("error_events") as batch:
        batch.add_column(sa.Column("build_id", sa.String(length=36), nullable=True))
        batch.alter_column("run_id", existing_type=sa.String(length=36), nullable=True)
        batch.create_foreign_key(
            "fk_error_events_build_id",
            "index_versions",
            ["build_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch.create_index("ix_error_events_build_id", ["build_id"])

    op.create_table(
        "context_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("span_id", sa.String(length=36), nullable=False),
        sa.Column("messages_json", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["query_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["span_id"], ["observability_spans.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("span_id"),
    )
    op.create_index("ix_context_snapshots_run_id", "context_snapshots", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_context_snapshots_run_id", table_name="context_snapshots")
    op.drop_table("context_snapshots")
    op.execute("DELETE FROM error_events WHERE build_id IS NOT NULL")
    op.execute("DELETE FROM model_calls WHERE build_id IS NOT NULL")
    op.execute("DELETE FROM observability_spans WHERE build_id IS NOT NULL")

    with op.batch_alter_table("error_events") as batch:
        batch.drop_index("ix_error_events_build_id")
        batch.drop_constraint("fk_error_events_build_id", type_="foreignkey")
        batch.drop_column("build_id")
        batch.alter_column("run_id", existing_type=sa.String(length=36), nullable=False)

    with op.batch_alter_table("model_calls") as batch:
        batch.drop_index("ix_model_calls_build_id")
        batch.drop_constraint("fk_model_calls_build_id", type_="foreignkey")
        batch.drop_column("build_id")
        batch.alter_column("run_id", existing_type=sa.String(length=36), nullable=False)

    with op.batch_alter_table("observability_spans") as batch:
        batch.drop_index("ix_observability_spans_build_id")
        batch.drop_constraint("fk_observability_spans_build_id", type_="foreignkey")
        batch.drop_column("build_id")
        batch.alter_column("run_id", existing_type=sa.String(length=36), nullable=False)
