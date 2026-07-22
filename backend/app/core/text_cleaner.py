"""Text cleaning utilities for document pre-processing.

Removes code blocks, function signatures, file paths, and other
technical noise before NER extraction, so that spaCy focuses on
natural-language content rather than source code.
"""
from __future__ import annotations
import re


# Patterns that mark "code-heavy" lines to be stripped
_CODE_LINE_PATTERNS = [
    re.compile(r'^\s*//'),                              # single-line comment
    re.compile(r'^\s*/\*'),                             # block comment start
    re.compile(r'^\s*\*'),                              # block comment body
    re.compile(r'^\s*#\s*(?:import|include|define)'),   # preprocessor
    re.compile(r'[a-zA-Z_]\w*\s*[\(\{]'),              # function/method call or def
    re.compile(r'[a-zA-Z_]\w*\.[a-zA-Z_]\w*'),        # dot-notation (obj.method)
    re.compile(r'^\s*(?:const|let|var|function|class|import|export|return|if|for|while)\b'),
    re.compile(r'^\s*\w+\s*=\s*(?:new\s+\w+|\w+\(|{|\[|\"|\')'),  # assignment
    re.compile(r'<[a-zA-Z][^>]{0,60}>'),               # HTML/JSX tags
    re.compile(r'```'),                                 # markdown code fence
    re.compile(r'^\s*[a-zA-Z_]\w*\s*:\s*\w'),         # YAML/JSON key: value
]

_FENCED_CODE = re.compile(r'```.*?```', re.DOTALL)
_INLINE_CODE  = re.compile(r'`[^`]+`')
_URL          = re.compile(r'https?://\S+')
_FILEPATH     = re.compile(r'(?:^|[\s(])(?:[./\\][\w./\\-]+\.\w{1,6})')


def _is_code_line(line: str) -> bool:
    """Return True if the line looks like source code rather than prose."""
    stripped = line.strip()
    if not stripped:
        return False
    for pat in _CODE_LINE_PATTERNS:
        if pat.search(stripped):
            return True
    # High density of special chars typical in code
    special = sum(1 for c in stripped if c in '(){}[];=<>|&^%$@#\\/')
    if len(stripped) > 0 and special / len(stripped) > 0.25:
        return True
    return False


def clean_for_ner(text: str) -> str:
    """Remove code blocks and technical noise, keep natural-language sentences.

    Call this before passing chunk content to spaCy NER.
    """
    # Remove fenced code blocks first
    text = _FENCED_CODE.sub(' ', text)
    # Remove inline code spans
    text = _INLINE_CODE.sub(' ', text)
    # Remove URLs
    text = _URL.sub(' ', text)
    # Remove bare file paths
    text = _FILEPATH.sub(' ', text)

    # Filter out code-like lines, keep prose lines
    lines = text.splitlines()
    kept = []
    for line in lines:
        if not _is_code_line(line):
            kept.append(line)
        # else: drop the line silently

    result = '\n'.join(kept)
    # Collapse multiple blank lines
    result = re.sub(r'\n{3,}', '\n\n', result)
    return result.strip()
