from app.core.chunker import chunk_document, _split_text


def test_split_text_basic():
    text = "第一段。\n\n第二段。\n\n第三段内容比较长，需要单独成段。"
    parts = _split_text(text, chunk_size=20, chunk_overlap=5)
    assert len(parts) >= 2
    # Each part should be smaller than total text, showing splitting occurred
    for p in parts:
        assert len(p) < len(text)


def test_split_text_no_split_needed():
    text = "短文本"
    parts = _split_text(text, chunk_size=100, chunk_overlap=10)
    assert parts == ["短文本"]


def test_chunk_document_basic():
    pages = [("This is a test document.\n\nIt has multiple paragraphs.\n\nEach paragraph is separate.", 1)]
    chunks = chunk_document("doc1", "test.txt", pages, chunk_size=50, chunk_overlap=10)
    assert len(chunks) >= 1
    for c in chunks:
        assert c.document_id == "doc1"
        assert c.metadata.filename == "test.txt"
        assert c.metadata.page == 1
        assert len(c.content) > 0


def test_chunk_document_multi_page():
    pages = [
        ("Page one content here.", 1),
        ("Page two content here.", 2),
    ]
    chunks = chunk_document("doc2", "test.pdf", pages, chunk_size=200, chunk_overlap=20)
    pages_seen = {c.metadata.page for c in chunks}
    assert 1 in pages_seen
    assert 2 in pages_seen


def test_chunk_ids_unique():
    pages = [("A " * 200, 1)]
    chunks = chunk_document("doc3", "test.txt", pages, chunk_size=50, chunk_overlap=10)
    ids = [c.id for c in chunks]
    assert len(ids) == len(set(ids))


def test_chunk_document_heading_extraction():
    pages = [("## Introduction\n\nThis is the intro content.", None)]
    chunks = chunk_document("doc4", "test.md", pages, chunk_size=200, chunk_overlap=20)
    assert chunks[0].metadata.heading == "Introduction"
