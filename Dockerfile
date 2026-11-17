FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DISPATCHOS_DATA_DIR=/var/data
WORKDIR /app
COPY . /app
EXPOSE 10000
CMD ["sh", "-c", "python app.py --host 0.0.0.0 --port ${PORT:-10000}"]
