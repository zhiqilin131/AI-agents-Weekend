FROM python:3.11-slim

# Slime voice-command: cloud ASR fits small Railway RAM (needs OPENAI_API_KEY). For local Whisper in Docker: ASR_PROVIDER=faster_whisper.
#
# Persist EVERYTHING user-specific under /data (mount a Railway volume here). Without FORESIGHT_DATA_DIR on /data,
# profile + shadow threads + traces default to ./data inside the image and are wiped on every redeploy.
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FORESIGHT_DATA_DIR=/data \
    CHROMA_PERSIST_DIR=/data/chroma \
    ASR_PROVIDER=openai

WORKDIR /app

# Build/runtime deps for native Python wheels and packaging.
# ffmpeg: required for faster-whisper to decode browser WebM/Opus from Slime push-to-talk.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Ensure modern build tooling (hatchling backend is declared in pyproject).
RUN pip install --upgrade pip setuptools wheel

# Install project with all optional groups needed for deploy/runtime checks.
COPY . .
RUN pip install -e ".[dev,web,decision,deploy]"

# Railway (or any host): attach a persistent volume mounted at /data so profile/, chat_threads/, chroma/, etc. survive redeploys.
RUN mkdir -p /data/chroma

EXPOSE 8765

# Single worker by default: each worker loads ASR (faster-whisper); two workers doubles RAM on small Railway plans.
CMD uvicorn foresight_x.ui.api_server:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${UVICORN_WORKERS:-1}

