FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # FFmpeg for video processing
    ffmpeg \
    # Cairo for graphics rendering
    libcairo2-dev \
    libpango1.0-dev \
    # Font support
    pkg-config \
    python3-dev \
    # LaTeX for mathematical formulas
    texlive \
    texlive-latex-extra \
    texlive-fonts-extra \
    texlive-latex-recommended \
    texlive-science \
    texlive-fonts-recommended \
    cm-super \
    dvipng \
    # Build tools
    gcc \
    g++ \
    make \
    # Utilities
    wget \
    curl \
    git \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first (for better caching)
COPY requirements.txt .

# Install Python dependencies
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .
COPY utils/ ./utils/

# Create necessary directories
RUN mkdir -p /app/output /app/temp /app/audio && \
    chmod 777 /app/output /app/temp /app/audio

# Create a non-root user
RUN useradd -m -u 1000 renderer && \
    chown -R renderer:renderer /app

# Switch to non-root user
USER renderer

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Run the application
CMD ["python", "-u", "app.py"]