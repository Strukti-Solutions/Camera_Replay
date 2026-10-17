FROM python:3.12-slim

# ffmpeg do apt: o worker o chama para montar o mp4 do clipe.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala só as dependências pinadas do pyproject.toml (sem instalar o pacote nem o extra dev).
COPY pyproject.toml ./
RUN python -c "import tomllib; print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/requisitos.txt \
    && pip install --no-cache-dir -r /tmp/requisitos.txt \
    && rm /tmp/requisitos.txt

COPY replay_worker ./replay_worker

# Usuário sem privilégio; sem porta exposta (o worker só fala com Postgres, R2 e câmeras).
RUN useradd --system --no-create-home --uid 10001 worker
USER worker

CMD ["python", "-m", "replay_worker.main"]
