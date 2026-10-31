"""Record real upload and chunking activities for knowledge build traces.

Revision ID: 0007_knowledge_activities
Revises: 0006_build_context
Create Date: 2026-10-31
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_knowledge_activities"
down_revision: str | Sequence[str] | None = "0006_build_context"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "knowledge_activities",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("kb_id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=True),
        sa.Column("stage", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=500), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("input_text", sa.Text(), nullable=False),
        sa.Column("output_text", sa.Text(), nullable=False),
        sa.Column("attributes_json", sa.JSON(), nullable=False),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["kb_id"], ["knowledge_bases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_knowledge_activities_document_id", "knowledge_activities", ["document_id"])
    op.create_index("ix_knowledge_activities_kb_id", "knowledge_activities", ["kb_id"])
    op.create_index("ix_knowledge_activities_stage", "knowledge_activities", ["stage"])


def downgrade() -> None:
    op.drop_index("ix_knowledge_activities_stage", table_name="knowledge_activities")
    op.drop_index("ix_knowledge_activities_kb_id", table_name="knowledge_activities")
    op.drop_index("ix_knowledge_activities_document_id", table_name="knowledge_activities")
    op.drop_table("knowledge_activities")
