from abc import ABC, abstractmethod
from ..models.document import Chunk


class BaseProcessor(ABC):
    @abstractmethod
    def extract_text(self, file_path: str) -> list[tuple[str, int | None]]:
        """Return list of (text, page_number) tuples."""
        ...

    @abstractmethod
    def supported_mime_types(self) -> list[str]:
        ...
