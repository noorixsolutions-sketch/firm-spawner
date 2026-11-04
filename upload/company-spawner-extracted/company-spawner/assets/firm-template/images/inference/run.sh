#!/bin/sh
# Serves MODEL_FILE from MODEL_REPO on :8000 (OpenAI-compatible). Same path in container and bare mode.
set -eu
: "${MODEL_REPO:?MODEL_REPO required}"
: "${MODEL_FILE:?MODEL_FILE required}"
MODELS_DIR="${MODELS_DIR:-/models}"
mkdir -p "$MODELS_DIR"
MODEL_PATH="$MODELS_DIR/$MODEL_FILE"

if [ ! -f "$MODEL_PATH" ]; then
  if [ -n "${HF_TOKEN:-}" ]; then
    curl -fL -C - -H "Authorization: Bearer $HF_TOKEN" -o "$MODEL_PATH.part" \
      "https://huggingface.co/$MODEL_REPO/resolve/main/$MODEL_FILE"
  else
    curl -fL -C - -o "$MODEL_PATH.part" \
      "https://huggingface.co/$MODEL_REPO/resolve/main/$MODEL_FILE"
  fi
  mv "$MODEL_PATH.part" "$MODEL_PATH"
fi

BIN="${LLAMA_BIN:-$(command -v llama-server || true)}"
if [ -z "$BIN" ]; then
  # bare mode (Colab/Kaggle): build once from source at the pinned ref
  : "${LLAMA_CPP_REF:?LLAMA_CPP_REF required to build llama-server in bare mode}"
  [ -d /tmp/llama.cpp ] || git clone https://github.com/ggml-org/llama.cpp /tmp/llama.cpp
  ( cd /tmp/llama.cpp && git checkout "$LLAMA_CPP_REF" \
    && cmake -B build -DGGML_CUDA=ON -DBUILD_SHARED_LIBS=OFF \
    && cmake --build build --config Release --target llama-server -j"$(nproc)" )
  BIN=/tmp/llama.cpp/build/bin/llama-server
fi
exec "$BIN" --model "$MODEL_PATH" --host 0.0.0.0 --port 8000 --ctx-size "${FIRM_CTX:-8192}"
