from pypdf import PdfReader
from .base import BaseProcessor


class PdfProcessor(BaseProcessor):
    def extract_text(self, file_path: str) -> list[tuple[str, int | None]]:
        reader = PdfReader(file_path)
        pages = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                pages.append((text, i + 1))
        return pages

    def supported_mime_types(self) -> list[str]:
        return ["application/pdf"]
