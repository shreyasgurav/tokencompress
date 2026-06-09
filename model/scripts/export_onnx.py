import os
import time
from pathlib import Path
from optimum.onnxruntime import ORTModelForSequenceClassification
from transformers import AutoTokenizer

MODEL_DIR = Path("output/tokencompress-base")
ONNX_DIR = Path("output/tokencompress-base/onnx")

def main():
    if not MODEL_DIR.exists():
        print(f"Model directory {MODEL_DIR} not found. Please train the model first.")
        return
        
    print(f"Loading PyTorch model from {MODEL_DIR}...")
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), use_fast=True)
    
    print(f"Exporting to ONNX format...")
    ONNX_DIR.mkdir(parents=True, exist_ok=True)
    
    # Export using optimum
    model = ORTModelForSequenceClassification.from_pretrained(
        str(MODEL_DIR),
        export=True
    )
    
    model.save_pretrained(str(ONNX_DIR))
    tokenizer.save_pretrained(str(ONNX_DIR))
    
    # Verify inference
    print("\nVerifying ONNX inference...")
    
    test_sentence = "[SENTENCE] The deployment failed at 3am. [CONTEXT] We were monitoring the system. The deployment failed at 3am. It caused a massive outage."
    
    inputs = tokenizer(test_sentence, return_tensors="pt")
    
    start_time = time.time()
    outputs = model(**inputs)
    end_time = time.time()
    
    ms_taken = (end_time - start_time) * 1000
    
    onnx_file = ONNX_DIR / "model.onnx"
    file_size_mb = onnx_file.stat().st_size / (1024 * 1024) if onnx_file.exists() else 0
    
    print("\nONNX export complete:")
    print(f"  Model size:     {file_size_mb:.1f} MB")
    print(f"  Inference time: {ms_taken:.1f}ms per sentence (CPU)")
    print(f"  Output path:    {ONNX_DIR}/model.onnx")
    print("\nReady to integrate into tokencompress TypeScript library.")

if __name__ == "__main__":
    main()
