# Video Cut resolver: Python + yt-dlp (+ curl_cffi) + ffmpeg.
# Python base so pip is native — apt only installs ffmpeg, which keeps the build
# from failing on Debian's externally-managed-python / pip conflicts.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir yt-dlp curl_cffi \
 # Fail the build loudly if impersonation support didn't install, instead of
 # silently shipping an image that 403s on Cloudflare sites.
 && yt-dlp --version \
 && python -c "import curl_cffi; print('curl_cffi', curl_cffi.__version__)"

WORKDIR /app
COPY server.py ./

ENV PORT=8787
EXPOSE 8787
CMD ["python", "server.py"]
