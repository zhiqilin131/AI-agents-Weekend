FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    CHROMA_PERSIST_DIR=/data/chroma

WORKDIR /app

# Build/runtime deps for native Python wheels and packaging.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Ensure modern build tooling (hatchling backend is declared in pyproject).
RUN pip install --upgrade pip setuptools wheel

# Install project with all optional groups needed for deploy/runtime checks.
COPY . .
RUN pip install -e ".[dev,web,decision,deploy]"

# Railway volume mount target for Chroma persistence.
RUN mkdir -p /data/chroma

EXPOSE 8765

CMD uvicorn foresight_x.ui.api_server:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2

