FROM python:3.12-slim

WORKDIR /app

# Install ffmpeg static binary (smaller than apt ffmpeg)
RUN apt-get update && apt-get install -y --no-install-recommends xz-utils wget nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && wget -q https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    && tar -xf ffmpeg-release-amd64-static.tar.xz \
    && mv ffmpeg-*-static/ffmpeg /usr/local/bin/ffmpeg \
    && rm -rf ffmpeg-release-amd64-static.tar.xz ffmpeg-*-static

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser

COPY --chown=appuser:appgroup . .

ENV PYTHONUNBUFFERED=1

USER appuser

CMD ["python", "main.py"]
