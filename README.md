# SEPIA LLM Experimets

SEPIA LLM experiments is a repository to explore LLM application in the SEPIA assistant framework. The focus is on locally run, fast performing LLMs, no Open-AI or Google servers etc.

## Components

- SEPIA Web UI for LLM experiments
- llama.cpp server to host models

## Resources

- [llama.cpp](https://github.com/ggerganov/llama.cpp) - The legendary tool that basically kickstarted on-device LLM experiments by Georgi Gerganov. Includes `llama-server`, an easy way to host open LLMs in your network.
- [Meta's LLaMA](https://ai.meta.com/blog/meta-llama-3/) - One of the most popular LLMs that is available in many sizes and versions. LLaMA 3.1 8B is going to be our work horse in many cases, due to performance and license.
  - [LLaMA 3.1 8B Instruct](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct) - The original 3.1 8B model, hosted on Huggingface. Amazing performance for the size and ok-ish license.
  - [LLaMA 3.2 3B Instruct](https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct) - The smaller 3.2 3B model. Good performance, less resources, worse license ^^.
- [Google's Gemma 2](https://blog.google/technology/developers/google-gemma-2/) - Interesting models in different sizes from Google.
  - [Gemma 2 9B it](https://huggingface.co/google/gemma-2-9b-it) - A small 9B model with very good performance and license (Apache 2.0? I'm not sure tbh).
  - [Gemma 2 2B it](https://huggingface.co/google/gemma-2-2b-it) - An even smaller 2B model with solid performance for very restricted devices (Raspberry Pi 5 etc.).
- [Mistral 7B](https://mistral.ai/news/announcing-mistral-7b/) - An open 7B model with small size, very good performance and Apache 2.0 license.
  - [Mistral 7B Instruct v0.3](https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3) - The instruction tuned 7B v0.3 model. Solid, fast and open.
- [Microsoft's Phi 3](https://azure.microsoft.com/en-us/blog/introducing-phi-3-redefining-whats-possible-with-slms/) - Interesting models in different sizes and formats from Microsoft. 
  - [Phi 3 3.8B](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf) - Phi 3 mini with 3.8B parameters, in GGUF format, directly from Microsoft.
- [TinyLlama 1.1B](https://github.com/jzhang38/TinyLlama) - A very small, open LLM with 1.1B parameters. Good for experiments on Raspberry Pi etc.
  - [TinyLlama 1.1 B Chat v1.0](https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0) - A fine tuned version for chats (instruction).
 
**PLEASE NOTE:** Before you use any of the mentioned models in a **commercial** environment please **check the licenses carefully!** It is a bit hard to find out the details sometimes!

