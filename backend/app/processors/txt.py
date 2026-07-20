from .base import BaseProcessor


class TxtProcessor(BaseProcessor):
    def extract_text(self, file_path: str) -> list[tuple[str, int | None]]:
        with open(file_path, encoding="utf-8", errors="replace") as f:
            return [(f.read(), None)]

    def supported_mime_types(self) -> list[str]:
        return ["text/plain"]
