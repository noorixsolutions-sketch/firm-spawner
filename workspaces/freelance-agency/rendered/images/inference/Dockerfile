# firm-inference: llama.cpp server. Multi-stage so the runtime image carries no compiler.
# LLAMA_CPP_REF must be a commit SHA or release tag chosen at build time and recorded in versions.lock.
FROM nvidia/cuda:12.4.1-devel-ubuntu22.04 AS build
ARG LLAMA_CPP_REF
RUN test -n "$LLAMA_CPP_REF" || (echo "LLAMA_CPP_REF build-arg is required" && exit 1)
RUN apt-get update && apt-get install -y --no-install-recommends cmake git ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/ggml-org/llama.cpp /src && cd /src && git checkout "$LLAMA_CPP_REF" \
    && cmake -B build -DGGML_CUDA=ON -DBUILD_SHARED_LIBS=OFF \
    && cmake --build build --config Release --target llama-server -j"$(nproc)"

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 firm && mkdir -p /app /models && chown firm:firm /models
COPY --from=build /src/build/bin/llama-server /usr/local/bin/llama-server
COPY entry.sh run.sh /app/
RUN chmod +x /app/entry.sh /app/run.sh
USER firm
ENV RUN_MODE=auto MODELS_DIR=/models
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s --retries=5 CMD curl -fs http://localhost:8000/health || exit 1
ENTRYPOINT ["/app/entry.sh"]
