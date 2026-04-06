import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, TensorDataset


SEED = 42
SIGNAL_LENGTH = 100
CLASS_NAMES = [
    "Pure_Sinusoidal",
    "Sag",
    "Swell",
    "Interruption",
    "Transient",
    "Oscillatory_Transient",
    "Harmonics",
    "Harmonics_with_Sag",
    "Harmonics_with_Swell",
    "Flicker",
    "Flicker_with_Sag",
    "Flicker_with_Swell",
    "Sag_with_Oscillatory_Transient",
    "Swell_with_Oscillatory_Transient",
    "Sag_with_Harmonics",
    "Swell_with_Harmonics",
    "Notch",
]
LABEL_MAP = {name: idx for idx, name in enumerate(CLASS_NAMES)}

DATA_DIR = Path("archive/XPQRS")
OUTPUT_DIR = Path("pytorch_cnn_outputs")
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

TRAIN_RATIO = 0.8
VAL_RATIO = 0.1
TEST_RATIO = 0.1

BATCH_SIZE = 256
EPOCHS = 40
LEARNING_RATE = 1e-3
WEIGHT_DECAY = 1e-4
PATIENCE = 8


def set_seed(seed: int = SEED) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def load_dataset() -> tuple[np.ndarray, np.ndarray]:
    features = []
    labels = []

    for class_name in CLASS_NAMES:
        frame = pd.read_csv(DATA_DIR / f"{class_name}.csv", header=None)
        values = frame.to_numpy(dtype=np.float32)
        if values.shape[1] != SIGNAL_LENGTH:
            raise ValueError(f"{class_name} shape mismatch: {values.shape}")

        peaks = np.max(np.abs(values), axis=1, keepdims=True) + 1e-9
        normalized = values / peaks
        features.append(normalized)
        labels.append(np.full(len(normalized), LABEL_MAP[class_name], dtype=np.int64))

    x = np.vstack(features)[:, np.newaxis, :]
    y = np.concatenate(labels)
    return x.astype(np.float32), y


def stratified_split(
    x: np.ndarray, y: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    x_train, x_temp, y_train, y_temp = train_test_split(
        x,
        y,
        test_size=(VAL_RATIO + TEST_RATIO),
        random_state=SEED,
        stratify=y,
    )
    x_val, x_test, y_val, y_test = train_test_split(
        x_temp,
        y_temp,
        test_size=TEST_RATIO / (VAL_RATIO + TEST_RATIO),
        random_state=SEED,
        stratify=y_temp,
    )
    return x_train, y_train, x_val, y_val, x_test, y_test


def make_loader(x: np.ndarray, y: np.ndarray, shuffle: bool) -> DataLoader:
    dataset = TensorDataset(
        torch.tensor(x, dtype=torch.float32),
        torch.tensor(y, dtype=torch.long),
    )
    return DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=shuffle)


class PQCNN(nn.Module):
    def __init__(self, n_classes: int) -> None:
        super().__init__()
        self.block1 = nn.Sequential(
            nn.Conv1d(1, 32, kernel_size=5, padding=2),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.Conv1d(32, 32, kernel_size=5, padding=2),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Dropout(0.2),
        )
        self.block2 = nn.Sequential(
            nn.Conv1d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Conv1d(64, 64, kernel_size=3, padding=1),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Dropout(0.2),
        )
        self.block3 = nn.Sequential(
            nn.Conv1d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.block1(x)
        x = self.block2(x)
        x = self.block3(x)
        return self.classifier(x)


def evaluate(model: nn.Module, loader: DataLoader, criterion: nn.Module) -> tuple[float, float, np.ndarray, np.ndarray]:
    model.eval()
    total_loss = 0.0
    total_correct = 0
    total_count = 0
    all_preds = []
    all_true = []

    with torch.no_grad():
        for xb, yb in loader:
            xb = xb.to(DEVICE)
            yb = yb.to(DEVICE)
            logits = model(xb)
            loss = criterion(logits, yb)
            preds = logits.argmax(dim=1)

            total_loss += loss.item() * len(yb)
            total_correct += (preds == yb).sum().item()
            total_count += len(yb)
            all_preds.extend(preds.cpu().numpy())
            all_true.extend(yb.cpu().numpy())

    return (
        total_loss / total_count,
        total_correct / total_count,
        np.asarray(all_true),
        np.asarray(all_preds),
    )


def save_reports(y_true: np.ndarray, y_pred: np.ndarray, metrics: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(CLASS_NAMES))))
    cm_df = pd.DataFrame(cm, index=CLASS_NAMES, columns=CLASS_NAMES)
    cm_df.to_csv(OUTPUT_DIR / "confusion_matrix.csv")

    report = classification_report(
        y_true,
        y_pred,
        labels=list(range(len(CLASS_NAMES))),
        target_names=CLASS_NAMES,
        output_dict=True,
        zero_division=0,
    )
    report_df = pd.DataFrame(report).transpose()
    report_df.to_csv(OUTPUT_DIR / "classification_report.csv")

    per_class_accuracy = np.divide(
        np.diag(cm),
        cm.sum(axis=1),
        out=np.zeros(len(CLASS_NAMES), dtype=np.float64),
        where=cm.sum(axis=1) != 0,
    )
    per_class_df = pd.DataFrame(
        {"class_name": CLASS_NAMES, "per_class_accuracy": per_class_accuracy}
    )
    per_class_df.to_csv(OUTPUT_DIR / "per_class_accuracy.csv", index=False)

    with open(OUTPUT_DIR / "metrics.json", "w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2)


def main() -> None:
    set_seed()
    x, y = load_dataset()
    x_train, y_train, x_val, y_val, x_test, y_test = stratified_split(x, y)

    train_loader = make_loader(x_train, y_train, shuffle=True)
    val_loader = make_loader(x_val, y_val, shuffle=False)
    test_loader = make_loader(x_test, y_test, shuffle=False)

    model = PQCNN(n_classes=len(CLASS_NAMES)).to(DEVICE)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", factor=0.5, patience=3
    )

    best_val_loss = float("inf")
    best_state = None
    patience_counter = 0
    final_train_acc = 0.0
    final_train_loss = 0.0
    final_val_acc = 0.0
    final_val_loss = 0.0

    for epoch in range(1, EPOCHS + 1):
        model.train()
        total_loss = 0.0
        total_correct = 0
        total_count = 0

        for xb, yb in train_loader:
            xb = xb.to(DEVICE)
            yb = yb.to(DEVICE)
            optimizer.zero_grad()
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()

            total_loss += loss.item() * len(yb)
            total_correct += (logits.argmax(dim=1) == yb).sum().item()
            total_count += len(yb)

        final_train_loss = total_loss / total_count
        final_train_acc = total_correct / total_count
        final_val_loss, final_val_acc, _, _ = evaluate(model, val_loader, criterion)
        scheduler.step(final_val_loss)

        if final_val_loss < best_val_loss:
            best_val_loss = final_val_loss
            best_state = {k: v.detach().cpu() for k, v in model.state_dict().items()}
            patience_counter = 0
        else:
            patience_counter += 1

        print(
            f"Epoch {epoch:02d}/{EPOCHS} "
            f"train_loss={final_train_loss:.4f} train_acc={final_train_acc:.4f} "
            f"val_loss={final_val_loss:.4f} val_acc={final_val_acc:.4f}"
        )

        if patience_counter >= PATIENCE:
            break

    if best_state is None:
        raise RuntimeError("Training did not produce a valid checkpoint.")

    model.load_state_dict(best_state)
    test_loss, test_acc, y_true, y_pred = evaluate(model, test_loader, criterion)

    metrics = {
        "split": {
            "train_ratio": TRAIN_RATIO,
            "val_ratio": VAL_RATIO,
            "test_ratio": TEST_RATIO,
            "train_samples": int(len(y_train)),
            "val_samples": int(len(y_val)),
            "test_samples": int(len(y_test)),
        },
        "train": {"loss": final_train_loss, "accuracy": final_train_acc},
        "validation": {"loss": final_val_loss, "accuracy": final_val_acc},
        "test": {"loss": test_loss, "accuracy": test_acc},
        "device": str(DEVICE),
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state": model.state_dict(),
            "n_classes": len(CLASS_NAMES),
            "classes": CLASS_NAMES,
            "metrics": metrics,
        },
        OUTPUT_DIR / "cnn_model.pt",
    )
    save_reports(y_true, y_pred, metrics)

    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
