# ============================================================
# Stage 1 — builder: compiles Python deps with full toolchain.
# Discarded after pip install; nothing here ships in the final image.
# ============================================================
FROM python:3.11-slim AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

# Compile-time deps for pycairo, manimpango, onnxruntime wheels, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    make \
    pkg-config \
    python3-dev \
    libcairo2-dev \
    libpango1.0-dev \
    && rm -rf /var/lib/apt/lists/*

# Use a venv so the runtime stage just COPIES the whole tree, no path patching.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ============================================================
# Stage 2 — runtime: slim Python + runtime libs + venv copy.
# ============================================================
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive \
    PATH="/opt/venv/bin:$PATH"

# Runtime libraries only — no -dev packages, no compilers.
# TeX trimmed to what Manim actually needs (drops texlive-fonts-extra and
# texlive-science which together are ~700 MB and unused by MathTex/Tex).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-fonts-recommended \
    cm-super \
    dvipng \
    dvisvgm \
    wget \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Bring over the Python venv (manim CLI, flask, piper-tts, etc.)
COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

COPY app.py .
COPY utils/ ./utils/

RUN mkdir -p /app/output /app/temp /app/audio /app/voices && \
    chmod 777 /app/output /app/temp /app/audio /app/voices

# Pre-download Piper TTS voice (en_GB-jenny_dioco-medium, ~63 MB).
# Skipped silently on network failure — app.py will retry at first /tts call.
RUN wget -q -O /app/voices/en_GB-jenny_dioco-medium.onnx \
    https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx \
    && wget -q -O /app/voices/en_GB-jenny_dioco-medium.onnx.json \
    https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx.json \
    || echo "⚠️  Voice model download failed at build time — will retry at runtime"

RUN useradd -m -u 1000 renderer && \
    chown -R renderer:renderer /app

USER renderer

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

CMD ["python", "-u", "app.py"]
