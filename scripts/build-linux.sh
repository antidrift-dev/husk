#!/bin/bash
set -e

echo "Building Husk for Linux via Docker..."

docker build -f Dockerfile.linux -t husk-linux-build .

# Extract artifacts from the image
CONTAINER=$(docker create husk-linux-build)
mkdir -p release/linux
docker cp "$CONTAINER:/app/release/" release/linux/
docker rm "$CONTAINER"

echo ""
echo "Done! Artifacts in release/linux/"
ls -lh release/linux/release/*.{AppImage,deb} 2>/dev/null || ls -lh release/linux/release/
