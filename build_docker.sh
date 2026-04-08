#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATE_DIR="$(date +%F)"
RELEASE_DIR="${ROOT_DIR}/release/${DATE_DIR}"
IMAGE_NAME="${IMAGE_NAME:-platformclaw-knox-adapter}"
IMAGE_TAG="${IMAGE_TAG:-${DATE_DIR}}"
FULL_IMAGE_NAME="${IMAGE_NAME}:${IMAGE_TAG}"
TAR_NAME="${IMAGE_NAME}_${IMAGE_TAG}.tar"
TAR_PATH="${RELEASE_DIR}/${TAR_NAME}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_command docker
require_command corepack

mkdir -p "${RELEASE_DIR}"

echo "[build] image      : ${FULL_IMAGE_NAME}"
echo "[build] release dir: ${RELEASE_DIR}"
echo "[build] tar path   : ${TAR_PATH}"

echo "[build] running type check"
(cd "${ROOT_DIR}" && corepack pnpm check)

docker build -t "${FULL_IMAGE_NAME}" -f "${ROOT_DIR}/Dockerfile" "${ROOT_DIR}"
docker save -o "${TAR_PATH}" "${FULL_IMAGE_NAME}"

if [[ ! -s "${TAR_PATH}" ]]; then
  echo "[error] tar file was not created correctly: ${TAR_PATH}" >&2
  exit 1
fi

echo "[done] docker image tar created"
echo "[done] ${TAR_PATH}"
