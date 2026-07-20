import uuid
from ..models.document import Chunk, ChunkMetadata


_SEPARATORS = ["\n\n", "\n", "。", ".", " ", ""]


def _split_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Recursive character splitter. Guaranteed to terminate."""
    if len(text) <= chunk_size:
        return [text.strip()] if text.strip() else []

    # Try each separator in priority order
    for sep in _SEPARATORS:
        if sep == "":
            # Last resort: hard cut at chunk_size boundaries
            chunks: list[str] = []
            start = 0
            while start < len(text):
                end = min(start + chunk_size, len(text))
                piece = text[start:end].strip()
                if piece:
                    chunks.append(piece)
                start = end - chunk_overlap if end < len(text) else end
            return chunks

        if sep not in text:
            continue

        # Split by this separator and merge parts into chunk_size windows
        parts = text.split(sep)
        chunks = []
        current_parts: list[str] = []
        current_len = 0

        for part in parts:
            part_len = len(part) + (len(sep) if current_parts else 0)
            if current_len + part_len > chunk_size and current_parts:
                chunk_text = sep.join(current_parts).strip()
                if chunk_text:
                    chunks.append(chunk_text)
                # Keep overlap: drop leading parts until we're under overlap budget
                while current_parts and current_len > chunk_overlap:
                    removed = current_parts.pop(0)
                    current_len -= len(removed) + len(sep)
                    current_len = max(0, current_len)
            current_parts.append(part)
            current_len += part_len

        if current_parts:
            chunk_text = sep.join(current_parts).strip()
            if chunk_text:
                chunks.append(chunk_text)

        if chunks:
            return chunks

    return [text.strip()]


def chunk_document(
    document_id: str,
    filename: str,
    pages: list[tuple[str, int | None]],
    chunk_size: int = 2000,
    chunk_overlap: int = 256,
) -> list[Chunk]:
    chunks: list[Chunk] = []
    chunk_index = 0

    for page_text, page_num in pages:
        # Extract heading from first line if markdown-style
        heading: str | None = None
        first_line = page_text.split("\n", 1)[0].strip()
        if first_line.startswith("#"):
            heading = first_line.lstrip("#").strip()

        pieces = _split_text(page_text, chunk_size, chunk_overlap)
        search_start = 0

        for piece in pieces:
            char_start = page_text.find(piece, search_start)
            if char_start == -1:
                char_start = search_start
            char_end = char_start + len(piece)
            search_start = max(search_start, char_end - chunk_overlap)

            chunk_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{document_id}:{chunk_index}"))
            chunks.append(Chunk(
                id=chunk_id,
                document_id=document_id,
                content=piece,
                metadata=ChunkMetadata(
                    document_id=document_id,
                    filename=filename,
                    page=page_num,
                    char_start=char_start,
                    char_end=char_end,
                    chunk_index=chunk_index,
                    heading=heading,
                ),
            ))
            chunk_index += 1

    return chunks
