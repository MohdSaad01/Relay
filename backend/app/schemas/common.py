"""Shared response schemas used across the API."""

from typing import Any

from pydantic import BaseModel, Field


class ApiResponse(BaseModel):
    """Standard response envelope used by all API endpoints."""

    success: bool
    message: str
    data: Any = Field(default_factory=dict)
