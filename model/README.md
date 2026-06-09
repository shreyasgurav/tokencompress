# TokenCompress Sentence Importance Model

This directory contains the Python ML pipeline for training the `deberta-v3-small` sentence importance model. This model replaces the rule-based TF-IDF heuristics in `tokencompress` with an accurate semantic scorer for conversational texts and dense prose.

## Hardware Requirements

- **OS**: macOS / Linux / Windows
- **Compute**: Works on CPU (inference), but a GPU or MPS-enabled Mac is strongly recommended for training.
  - Training on CPU: ~2-4 hours.
  - Training on GPU/MPS: ~20-40 minutes.
- **Memory**: Minimum 8GB RAM.

## Setup

Set up a Python virtual environment to avoid polluting your system Python:

```bash
cd model
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Running the Pipeline

Follow these steps in order to download data, train the model, evaluate it, and export it for use in TypeScript:

### 1. Prepare the Dataset
Downloads SAMSum and DialogSum from HuggingFace, extracts sentences, and computes F1 overlap scores against human summaries to label sentences as important (1) or not important (0). Also parses local `ChatGPT-*.md` exports in `~/Downloads/`.

```bash
python scripts/prepare_dataset.py
```
*Expected output: `data/processed/training.jsonl` (20,000+ examples) and `validation.jsonl`.*

### 2. Train the Model
Fine-tunes `microsoft/deberta-v3-small` for binary sequence classification.

```bash
python scripts/train.py
```
*Expected output: `output/tokencompress-base/` containing the best PyTorch checkpoint.*

### 3. Evaluate the Model
Runs the fine-tuned DeBERTa model against the validation set and compares its F1 score with the legacy TF-IDF scorer.

```bash
python scripts/evaluate.py
```
*Target: DeBERTa should beat TF-IDF F1 score by at least 10 percentage points.*

### 4. Export to ONNX
Converts the PyTorch model to a highly optimized ONNX format for fast execution in Node.js via `onnxruntime-node`.

```bash
python scripts/export_onnx.py
```
*Expected output: `output/tokencompress-base/onnx/model.onnx` (~87MB).*

## TypeScript Integration

Once the ONNX model is generated, it can be loaded directly from the `tokencompress` TypeScript library using `onnxruntime-node` without requiring any Python dependencies.
