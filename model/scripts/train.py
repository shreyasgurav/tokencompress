import os
import sys
import torch
import json
from pathlib import Path
from datasets import Dataset, DatasetDict
import datasets.config
datasets.config.TORCHVISION_AVAILABLE = False
sys.modules.pop("torchvision", None)
from transformers import AutoTokenizer, AutoModelForSequenceClassification, TrainingArguments, Trainer

if torch.backends.mps.is_available():
    print("✓ Apple Silicon MPS detected — using M2 GPU")
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
import evaluate
import numpy as np
import torch.nn as nn

class WeightedTrainer(Trainer):
    def __init__(self, pos_weight, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pos_weight = pos_weight

    def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
        labels = inputs.pop("labels")
        outputs = model(**inputs)
        logits = outputs.logits
        weight = torch.tensor([1.0, self.pos_weight], dtype=logits.dtype, device=logits.device)
        loss = nn.CrossEntropyLoss(weight=weight)(logits, labels)
        return (loss, outputs) if return_outputs else loss

os.environ["TOKENIZERS_PARALLELISM"] = "false"
MAX_LENGTH = 256 # RoBERTa base can easily handle longer context
MODEL_NAME = "roberta-base"
OUTPUT_DIR = Path("output/tokencompress-base")
CHECKPOINT_DIR = Path("checkpoints")

def load_jsonl(path: Path):
    data = {"text": [], "label": []}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            obj = json.loads(line)
            # Format: [SENTENCE] {sentence} [CONTEXT] {context}
            text = f"[SENTENCE] {obj['sentence']} [CONTEXT] {obj['context']}"
            data["text"].append(text)
            data["label"].append(obj["label"])
    
    pos = sum(1 for x in data["label"] if x == 1)
    neg = sum(1 for x in data["label"] if x == 0)
    
    return Dataset.from_dict(data), pos, neg

def compute_metrics(eval_pred):
    metric_f1 = evaluate.load("f1")
    metric_acc = evaluate.load("accuracy")
    metric_prec = evaluate.load("precision")
    metric_rec = evaluate.load("recall")
    
    logits, labels = eval_pred
    predictions = np.argmax(logits, axis=-1)
    
    f1 = metric_f1.compute(predictions=predictions, references=labels)["f1"]
    acc = metric_acc.compute(predictions=predictions, references=labels)["accuracy"]
    prec = metric_prec.compute(predictions=predictions, references=labels)["precision"]
    rec = metric_rec.compute(predictions=predictions, references=labels)["recall"]
    
    return {
        "accuracy": acc,
        "f1": f1,
        "precision": prec,
        "recall": rec
    }

def main():
    print(f"Loading datasets...")
    train_ds, pos, neg = load_jsonl(Path("data/processed/training.jsonl"))
    val_ds, _, _ = load_jsonl(Path("data/processed/validation.jsonl"))
    
    pos_weight = neg / pos if pos > 0 else 1.0
    print(f"Class ratio — neg: {neg}, pos: {pos}, weight: {pos_weight:.2f}")
    
    dataset = DatasetDict({
        "train": train_ds,
        "validation": val_ds
    })
    
    print(f"Loading tokenizer: {MODEL_NAME}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, use_fast=False)
    
    def tokenize_function(examples):
        return tokenizer(examples["text"], padding="max_length", truncation=True, max_length=256)
        
    print("Tokenizing datasets...")
    tokenized_datasets = dataset.map(tokenize_function, batched=True)
    
    print(f"Loading model: {MODEL_NAME}")
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME, 
        num_labels=2
    )
    
    training_args = TrainingArguments(
        output_dir="/content/checkpoints",
        num_train_epochs=3,
        per_device_train_batch_size=16,
        per_device_eval_batch_size=32,
        learning_rate=2e-5,
        warmup_steps=500,
        weight_decay=0.01,
        evaluation_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        greater_is_better=True,
        fp16=True, # DistilRoBERTa loves fp16!
        dataloader_num_workers=0,
        logging_steps=100,
        max_grad_norm=1.0,
        report_to="none"
    )
    
    trainer = WeightedTrainer(
        pos_weight=pos_weight,
        model=model,
        args=training_args,
        train_dataset=tokenized_datasets["train"],
        eval_dataset=tokenized_datasets["validation"],
        compute_metrics=compute_metrics,
        processing_class=tokenizer
    )
    
    print("Starting training...")
    trainer.train()
    
    print(f"Saving best model to {OUTPUT_DIR}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(OUTPUT_DIR))
    tokenizer.save_pretrained(str(OUTPUT_DIR))
    
    # Sanity Check
    print("\nSanity check on sample sentences:")
    test_sentences = [
        ("The deployment failed at 3am.", "We were monitoring the system. The deployment failed at 3am. It caused a massive outage."),
        ("Sure, I can help you with that.", "Hello there. Sure, I can help you with that. Let's look at the problem."),
        ("We decided to use PostgreSQL.", "We reviewed many databases. We decided to use PostgreSQL. It fits our relational data needs."),
        ("As I mentioned earlier,", "As I mentioned earlier, the issue is resolved."),
        ("Error: connection refused on port 5432.", "The logs showed a crash. Error: connection refused on port 5432. We restarted the instance.")
    ]
    
    import torch
    model.eval()
    for sent, ctx in test_sentences:
        text = f"[SENTENCE] {sent} [CONTEXT] {ctx}"
        inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
        inputs = {k: v.to(model.device) for k, v in inputs.items()}
        with torch.no_grad():
            outputs = model(**inputs)
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
            score = probs[0][1].item()
            label = "important ✓" if score > 0.5 else "filler ✓"
            print(f"  \"{sent[:40]:<40}\" → {score:.2f} ({label})")

if __name__ == "__main__":
    main()
