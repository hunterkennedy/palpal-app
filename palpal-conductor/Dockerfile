FROM python:3.12-slim AS ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends wget xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && wget -q https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    && tar -xf ffmpeg-release-amd64-static.tar.xz \
    && mv ffmpeg-*-static/ffmpeg /usr/local/bin/ffmpeg \
    && rm -rf ffmpeg-release-amd64-static.tar.xz ffmpeg-*-static

FROM python:3.12-slim

WORKDIR /app

# nodejs required at runtime for yt-dlp JS extraction (--js-runtimes node)
RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser

COPY --chown=appuser:appgroup . .

ENV PYTHONUNBUFFERED=1

USER appuser

CMD ["python", "main.py"]
