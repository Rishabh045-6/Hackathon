import json
import os
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn


SIGNAL_LENGTH = 100
TOP_K = 3


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


def load_artifacts() -> tuple[nn.Module, list[str]]:
    repo_root = Path(__file__).resolve().parents[1]
    model_path_value = os.environ.get("PYTORCH_MODEL_PATH", "cnn_model.pt").strip()
    model_path = Path(model_path_value)

    if not model_path.is_absolute():
        model_path = repo_root / model_path

    if not model_path.exists():
        legacy_model_path = repo_root / "pytorch_cnn_outputs" / "cnn_model.pt"
        if legacy_model_path.exists():
            model_path = legacy_model_path

    checkpoint = torch.load(model_path, map_location="cpu", weights_only=False)
    if "classes" in checkpoint:
        classes = [str(label) for label in checkpoint["classes"]]
    else:
        encoder = checkpoint.get("encoder")
        if encoder is None or not hasattr(encoder, "classes_"):
            raise KeyError("Checkpoint is missing class labels.")

        classes = [str(label) for label in encoder.classes_.tolist()]

    model = PQCNN(n_classes=checkpoint["n_classes"])
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    return model, classes


def read_signal() -> np.ndarray:
    payload = json.load(sys.stdin)
    signal = payload.get("signal")

    if not isinstance(signal, list) or len(signal) != SIGNAL_LENGTH:
        raise ValueError(f"'signal' must be a list of {SIGNAL_LENGTH} numeric values.")

    try:
        array = np.asarray(signal, dtype=np.float32)
    except (TypeError, ValueError) as exc:
        raise ValueError("'signal' must contain only numeric values.") from exc

    if array.shape != (SIGNAL_LENGTH,) or not np.isfinite(array).all():
        raise ValueError(f"'signal' must be a finite numeric array of length {SIGNAL_LENGTH}.")

    return array.reshape(1, 1, SIGNAL_LENGTH)


def main() -> None:
    try:
        model, classes = load_artifacts()
        signal = read_signal()
        with torch.no_grad():
            logits = model(torch.tensor(signal, dtype=torch.float32))
            probabilities = torch.softmax(logits, dim=1).cpu().numpy()[0]

        predicted_label = int(np.argmax(probabilities))
        confidence = float(probabilities[predicted_label])
        top_indices = np.argsort(probabilities)[::-1][:TOP_K]

        result = {
            "predicted_class": classes[predicted_label],
            "predicted_label": predicted_label,
            "confidence": confidence,
            "top_k": [
                {
                    "predicted_class": classes[int(index)],
                    "predicted_label": int(index),
                    "confidence": float(probabilities[int(index)]),
                }
                for index in top_indices
            ],
        }
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
