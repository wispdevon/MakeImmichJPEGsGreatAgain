FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server ./server
COPY userscript ./userscript
USER 10001:10001
EXPOSE 8099
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8099", "--no-access-log"]
