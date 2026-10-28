"""Add versioned vector indexes and immutable chunk embeddings.

Revision ID: 0003_vector_indexes
Revises: 0002_knowledge
Create Date: 2026-10-28
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "0003_vector_indexes"
down_revision: str | Sequence[str] | None = "0002_knowledge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "index_versions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("kb_id", sa.String(length=36), nullable=False),
        sa.Column("embedding_model_id", sa.String(length=36), nullable=False),
        sa.Column("dimensions", sa.Integer(), nullable=False),
        sa.Column("chunk_size", sa.Integer(), nullable=False),
        sa.Column("chunk_overlap", sa.Integer(), nullable=False),
        sa.Column("chunk_strategy", sa.String(length=32), nullable=False),
        sa.Column("source_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("total_chunks", sa.Integer(), nullable=False),
        sa.Column("embedded_chunks", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("usage_source", sa.String(length=32), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["embedding_model_id"], ["model_configs.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["kb_id"], ["knowledge_bases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "chunk_embeddings",
        sa.Column("chunk_id", sa.String(length=36), nullable=False),
        sa.Column("index_version_id", sa.String(length=36), nullable=False),
        sa.Column("source_text", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("embedding", Vector().with_variant(sa.JSON(), "sqlite"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["index_version_id"], ["index_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("chunk_id", "index_version_id"),
    )
    with op.batch_alter_table("knowledge_bases") as batch:
        batch.add_column(sa.Column("active_index_version_id", sa.String(length=36), nullable=True))
        batch.create_foreign_key(
            "fk_knowledge_bases_active_index_version_id_index_versions",
            "index_versions",
            ["active_index_version_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("knowledge_bases") as batch:
        batch.drop_constraint("fk_knowledge_bases_active_index_version_id_index_versions", type_="foreignkey")
        batch.drop_column("active_index_version_id")
    op.drop_table("chunk_embeddings")
    op.drop_table("index_versions")
