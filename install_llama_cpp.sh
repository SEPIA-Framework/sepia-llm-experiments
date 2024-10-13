#!/bin/bash
set -e
echo "Installing llama.cpp ..."
sudo apt update
sudo apt install -y --no-install-recommends git build-essential bc
if [ -n "$1" ] && [ "$1" == "BLAS" ]; then
	echo 'Checking OpenBLAS package'
	sudo apt install -y --no-install-recommends libopenblas-dev
else
	echo 'NOTE: You can use the argument "BLAS" to build with OpenBLAS support.'
	echo ''
fi
echo "Cloning ..."
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
echo "Running build process ..."
if [ -n "$1" ] && [ "$1" == "BLAS" ]; then
	make clean
	WHISPER_OPENBLAS=1 make
	WHISPER_OPENBLAS=1 make server
else
	make clean && make && make server
fi
echo "DONE"
