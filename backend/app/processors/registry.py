import mimetypes
from .base import BaseProcessor
from .pdf import PdfProcessor
from .docx import DocxProcessor
from .txt import TxtProcessor
from .markdown import MarkdownProcessor

_processors: list[BaseProcessor] = [
    PdfProcessor(),
    DocxProcessor(),
    MarkdownProcessor(),
    TxtProcessor(),  # fallback last
]

_mime_map: dict[str, BaseProcessor] = {}
for _p in _processors:
    for _mime in _p.supported_mime_types():
        _mime_map[_mime] = _p


def get_processor(filename: str, content_type: str | None = None) -> BaseProcessor:
    mime = content_type or mimetypes.guess_type(filename)[0] or "text/plain"
    # Normalize common variations
    lower = filename.lower()
    if lower.endswith(".md") or lower.endswith(".markdown"):
        mime = "text/markdown"
    elif lower.endswith(".docx"):
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif lower.endswith(".doc"):
        # Old .doc format: fall back to text extraction via antiword/textutil if available,
        # otherwise treat as binary and raise a clear error
        mime = "__doc_legacy__"

    processor = _mime_map.get(mime)
    if processor is None:
        if mime == "__doc_legacy__":
            raise ValueError(
                "不支持旧版 .doc 格式（Word 97-2003）。请将文件另存为 .docx 后重新上传。"
            )
        processor = _mime_map["text/plain"]
    return processor
