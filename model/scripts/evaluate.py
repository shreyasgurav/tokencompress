import json
import numpy as np
from pathlib import Path
from sklearn.feature_extraction.text import TfidfVectorizer
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
from tqdm import tqdm

MODEL_DIR = Path("output/tokencompress-base")

def tfidf_baseline_predict(sentence: str, context: str) -> int:
    # Very rough Python equivalent of the TypeScript tf-idf logic
    # Treat context as the "document"
    try:
        vectorizer = TfidfVectorizer(stop_words='english')
        vectorizer.fit([context])
        
        # score the sentence
        words = sentence.lower().split()
        score = 0
        feature_names = vectorizer.get_feature_names_out()
        vocab = dict(zip(feature_names, vectorizer.idf_))
        
        for w in words:
            if w in vocab:
                score += vocab[w]
                
        # Heuristics
        import re
        if re.search(r'\d', sentence):
            score += 2.0
            
        # Normalize and threshold roughly
        # This is a very rough mock for baseline purposes
        if score > 3.0:
            return 1
        return 0
    except ValueError:
        return 0

def compute_f1_metrics(y_true, y_pred):
    from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
    return (
        accuracy_score(y_true, y_pred),
        precision_score(y_true, y_pred, zero_division=0),
        recall_score(y_true, y_pred, zero_division=0),
        f1_score(y_true, y_pred, zero_division=0)
    )

def main():
    if not MODEL_DIR.exists():
        print(f"Model directory {MODEL_DIR} not found. Please train the model first.")
        return
        
    print(f"Loading DeBERTa model from {MODEL_DIR}...")
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), use_fast=False)
    model = AutoModelForSequenceClassification.from_pretrained(str(MODEL_DIR))
    model.eval()
    
    val_file = Path("data/processed/validation.jsonl")
    if not val_file.exists():
        print(f"Validation file {val_file} not found.")
        return
        
    y_true = []
    y_pred_tfidf = []
    y_pred_deberta = []
    
    with open(val_file, "r") as f:
        lines = f.readlines()
        
    print(f"Evaluating on {len(lines)} examples...")
    for line in tqdm(lines):
        obj = json.loads(line)
        sent = obj["sentence"]
        ctx = obj["context"]
        label = obj["label"]
        
        y_true.append(label)
        
        # TF-IDF
        y_pred_tfidf.append(tfidf_baseline_predict(sent, ctx))
        
        # DeBERTa
        text = f"[SENTENCE] {sent} [CONTEXT] {ctx}"
        inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
        with torch.no_grad():
            outputs = model(**inputs)
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
            score = probs[0][1].item()
            y_pred_deberta.append(1 if score > 0.5 else 0)
            
    tf_acc, tf_prec, tf_rec, tf_f1 = compute_f1_metrics(y_true, y_pred_tfidf)
    db_acc, db_prec, db_rec, db_f1 = compute_f1_metrics(y_true, y_pred_deberta)
    
    print("\nEvaluation on validation set:")
    print(f"{'':<15} {'Accuracy':<10} {'Precision':<10} {'Recall':<10} {'F1':<10}")
    print(f"{'TF-IDF Baseline':<15} {tf_acc:.3f}      {tf_prec:.3f}      {tf_rec:.3f}      {tf_f1:.3f}")
    print(f"{'DeBERTa':<15} {db_acc:.3f}      {db_prec:.3f}      {db_rec:.3f}      {db_f1:.3f}")
    
    diff_acc = (db_acc - tf_acc) * 100
    diff_prec = (db_prec - tf_prec) * 100
    diff_rec = (db_rec - tf_rec) * 100
    diff_f1 = (db_f1 - tf_f1) * 100
    
    print(f"\nImprovement:    +{diff_acc:.1f}pp     +{diff_prec:.1f}pp     +{diff_rec:.1f}pp     +{diff_f1:.1f}pp")
    
    if diff_f1 >= 10.0:
        print("\nDeBERTa is ready for integration.")
    else:
        print("\nWARNING: DeBERTa improvement is less than 10pp.")

if __name__ == "__main__":
    main()
