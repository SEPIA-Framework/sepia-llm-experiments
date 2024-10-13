#!/bin/bash
cd llama.cpp
./llama-server -m ../models/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf -t 4 --n-gpu-layers 33 --ctx-size 16384 --n-predict 512 --system-prompt-file ../prompts/SEPIA_smart_home_test_example.txt --keep -1 --port 20733
