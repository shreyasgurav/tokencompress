import os
from optimum.onnxruntime import ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig
from pathlib import Path

onnx_dir = Path("model/output/tokencompress-base/onnx")
onnx_path = onnx_dir / "model.onnx"

print("Instantiating ORTQuantizer...")
quantizer = ORTQuantizer.from_pretrained(str(onnx_dir))

# Define quantization config for ARM64/Mac CPU
qconfig = AutoQuantizationConfig.arm64(is_static=False, per_channel=False)

print(f"Quantizing model in {onnx_dir}...")
quantizer.quantize(
    quantization_config=qconfig,
    save_dir=str(onnx_dir),
    file_suffix="quantized"
)
print("Quantization complete!")
