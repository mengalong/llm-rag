import re
from .base import BaseProcessor


class MarkdownProcessor(BaseProcessor):
    def extract_text(self, file_path: str) -> list[tuple[str, int | None]]:
        with open(file_path, encoding="utf-8", errors="replace") as f:
            content = f.read()

        # Split on headings to preserve structure as segments
        heading_pattern = re.compile(r"^(#{1,6}\s+.+)$", re.MULTILINE)
        parts = heading_pattern.split(content)

        segments: list[tuple[str, int | None]] = []
        buffer: list[str] = []

        for part in parts:
            if heading_pattern.match(part):
                if buffer:
                    text = "\n".join(buffer).strip()
                    if text:
                        segments.append((text, None))
                buffer = [part]
            else:
                buffer.append(part)

        if buffer:
            text = "\n".join(buffer).strip()
            if text:
                segments.append((text, None))

        return segments if segments else [(content, None)]

    def supported_mime_types(self) -> list[str]:
        return ["text/markdown", "text/x-markdown"]
