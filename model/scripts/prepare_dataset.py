import json
import re
import os
import glob
from pathlib import Path
from datasets import load_dataset
import nltk
from nltk.tokenize import word_tokenize
from tqdm import tqdm
import random
import ssl

# Bypass SSL verification for NLTK download on macOS
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

# Ensure nltk tokenizer is available
try:
    nltk.data.find('tokenizers/punkt')
    nltk.data.find('tokenizers/punkt_tab')
except LookupError:
    nltk.download('punkt')
    nltk.download('punkt_tab')

def compute_f1(sentence: str, summary: str) -> float:
    # Tokenize, lowercase, remove non-alphanumeric
    def get_tokens(text):
        return set(w.lower() for w in word_tokenize(text) if w.isalnum())
    
    sent_tokens = get_tokens(sentence)
    summ_tokens = get_tokens(summary)
    
    if not sent_tokens or not summ_tokens:
        return 0.0
        
    intersection = sent_tokens.intersection(summ_tokens)
    if not intersection:
        return 0.0
        
    precision = len(intersection) / len(sent_tokens)
    recall = len(intersection) / len(summ_tokens)
    
    if precision + recall == 0:
        return 0.0
        
    f1 = 2 * (precision * recall) / (precision + recall)
    return f1

def get_context(sentences: list, index: int) -> str:
    start = max(0, index - 2)
    end = min(len(sentences), index + 3)
    return " ".join(sentences[start:end])

def process_hf_dataset(dataset_name: str, split: str, source_name: str):
    print(f"Loading {dataset_name} ({split})...")
    ds = load_dataset(dataset_name, split=split)
    
    positive = 0
    negative = 0
    examples = []
    
    for row in tqdm(ds, desc=f"Processing {source_name}"):
        dialogue = row['dialogue']
        summary = row['summary']
        
        # Split into sentences (simple newline/period split for dialogues, or nltk)
        sentences = nltk.sent_tokenize(dialogue)
        
        for i, sent in enumerate(sentences):
            f1 = compute_f1(sent, summary)
            label = None
            if f1 > 0.3:
                label = 1
                positive += 1
            elif f1 < 0.1:
                label = 0
                negative += 1
                
            if label is not None:
                context = get_context(sentences, i)
                examples.append({
                    "sentence": sent,
                    "context": context,
                    "label": label,
                    "source": source_name,
                    "f1_score": round(f1, 4)
                })
                
    return examples, positive, negative

def heuristic_label(sentence: str, i: int, total_sents: int) -> int:
    sent_lower = sentence.lower()
    
    # Heuristic 1: Contains number or percentage
    if re.search(r'\d+%?', sentence):
        return 1
        
    # Heuristic 2: Contains error/decision/warning words
    important_words = ['error', 'decision', 'warning', 'failed', 'critical', 'decided', 'use', 'choose']
    if any(w in sent_lower for w in important_words):
        return 1
        
    # Heuristic 3: First or last sentence in a turn
    if i == 0 or i == total_sents - 1:
        return 1
        
    # Heuristic 4: Length < 5 words
    words = word_tokenize(sentence)
    if len(words) < 5:
        return 0
        
    # Heuristic 5: Filler words
    filler_patterns = ['sure', 'let me', 'i can', 'here is', 'as mentioned', 'i will', 'got it', 'okay']
    if any(sent_lower.startswith(f) for f in filler_patterns):
        return 0
        
    return 1

def process_local_exports():
    downloads_path = str(Path.home() / "Downloads" / "ChatGPT-*.md")
    files = glob.glob(downloads_path)
    
    examples = []
    positive = 0
    negative = 0
    
    for filepath in files:
        print(f"Processing local file: {filepath}")
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Basic split by speaker (assume markdown headers or **User**)
        turns = re.split(r'\n(?=## |\*\*User\*\*|\*\*ChatGPT\*\*|User:|Assistant:)', content)
        
        for turn in turns:
            sentences = nltk.sent_tokenize(turn)
            for i, sent in enumerate(sentences):
                label = heuristic_label(sent, i, len(sentences))
                if label == 1:
                    positive += 1
                else:
                    negative += 1
                    
                context = get_context(sentences, i)
                examples.append({
                    "sentence": sent.strip(),
                    "context": context.strip(),
                    "label": label,
                    "source": "local_chat",
                    "f1_score": 1.0 if label == 1 else 0.0 # Dummy score for local
                })
                
    return examples, positive, negative

def main():
    out_dir = Path("data/processed")
    out_dir.mkdir(parents=True, exist_ok=True)
    
    all_examples = []
    
    # 1. SAMSum
    samsum_ex, samsum_pos, samsum_neg = process_hf_dataset("knkarthick/samsum", "train", "samsum")
    all_examples.extend(samsum_ex)
    
    # 2. DialogSum
    dialog_ex, dialog_pos, dialog_neg = process_hf_dataset("knkarthick/dialogsum", "train", "dialogsum")
    all_examples.extend(dialog_ex)
    
    # 3. Local Chat Exports
    local_ex, local_pos, local_neg = process_local_exports()
    all_examples.extend(local_ex)
    
    # Shuffle
    random.seed(42)
    random.shuffle(all_examples)
    
    # Split 90/10 Train/Val
    val_size = int(len(all_examples) * 0.1)
    val_examples = all_examples[:val_size]
    train_examples = all_examples[val_size:]
    
    total_pos = samsum_pos + dialog_pos + local_pos
    total_neg = samsum_neg + dialog_neg + local_neg
    total = total_pos + total_neg
    ratio_pos = (total_pos / total) * 100 if total > 0 else 0
    ratio_neg = (total_neg / total) * 100 if total > 0 else 0
    
    stats_str = f"""
Dataset statistics:
  SAMSum:        {samsum_pos:,} positive  /  {samsum_neg:,} negative
  DialogSum:     {dialog_pos:,} positive  /  {dialog_neg:,} negative
  Chat exports:  {local_pos:,} positive    /  {local_neg:,} negative
  ─────────────────────────────────────────────────
  Total:         {total_pos:,} positive /  {total_neg:,} negative
  Ratio:         {ratio_pos:.1f}% positive, {ratio_neg:.1f}% negative
"""
    print(stats_str)
    
    with open(out_dir / "stats.json", "w") as f:
        json.dump({
            "SAMSum": {"pos": samsum_pos, "neg": samsum_neg},
            "DialogSum": {"pos": dialog_pos, "neg": dialog_neg},
            "Local": {"pos": local_pos, "neg": local_neg},
            "Total": {"pos": total_pos, "neg": total_neg}
        }, f, indent=2)
        
    with open(out_dir / "training.jsonl", "w") as f:
        for ex in train_examples:
            f.write(json.dumps(ex) + "\n")
            
    with open(out_dir / "validation.jsonl", "w") as f:
        for ex in val_examples:
            f.write(json.dumps(ex) + "\n")
            
    print(f"Saved to {out_dir}/training.jsonl ({len(train_examples):,} examples)")
    print(f"Saved to {out_dir}/validation.jsonl ({len(val_examples):,} examples)")

if __name__ == "__main__":
    main()
