"""Graph configuration loader — reads graph_config.yaml on first access.

Usage:
    from .graph_config import graph_cfg
    valid_types = graph_cfg.valid_entity_types
"""
from __future__ import annotations
import re
from pathlib import Path
from typing import Any

import yaml

_CONFIG_PATH = Path(__file__).parent.parent.parent / "graph_config.yaml"
_config_cache: dict[str, Any] | None = None
_config_mtime: float = 0.0


def _load() -> dict[str, Any]:
    global _config_cache, _config_mtime
    try:
        mtime = _CONFIG_PATH.stat().st_mtime
    except FileNotFoundError:
        return {}
    if _config_cache is None or mtime != _config_mtime:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            _config_cache = yaml.safe_load(f) or {}
        _config_mtime = mtime
    return _config_cache


class _GraphConfig:
    """Thin accessor around graph_config.yaml with sensible defaults."""

    @property
    def _ex(self) -> dict:
        return _load().get("extraction", {})

    @property
    def _ef(self) -> dict:
        return _load().get("entity_filter", {})

    @property
    def _lef(self) -> dict:
        return _load().get("llm_entity_filter", {})

    @property
    def _ret(self) -> dict:
        return _load().get("retrieval", {})

    # ── Extraction strategy ────────────────────────────────────────

    @property
    def builder_strategy(self) -> str:
        return str(self._ex.get("strategy", "ner_llm"))

    @property
    def ner_model(self) -> str:
        return str(self._ex.get("ner_model", "zh_core_web_sm"))

    @property
    def graph_llm_base_url(self) -> str:
        return str(self._ex.get("graph_llm_base_url", "") or "")

    @property
    def graph_llm_api_key(self) -> str:
        """Per-strategy LLM API key override (empty → use settings.effective_graph_llm_api_key)."""
        return ""  # reserved for future per-strategy key config

    # ── Entity filter ──────────────────────────────────────────────

    @property
    def valid_entity_types(self) -> set[str]:
        default = {'PERSON', 'ORG', 'GPE', 'PRODUCT', 'LOC', 'WORK_OF_ART', 'EVENT', 'FAC', 'NORP'}
        return set(self._ef.get("valid_types", default))

    @property
    def min_length(self) -> int:
        return int(self._ef.get("min_length", 2))

    @property
    def min_english_length(self) -> int:
        return int(self._ef.get("min_english_length", 6))

    @property
    def programming_stopwords(self) -> set[str]:
        default = {'id', 'type', 'name', 'text', 'view', 'data', 'item', 'list',
                   'node', 'path', 'url', 'key', 'val', 'str', 'int', 'bool',
                   'true', 'false', 'null', 'none', 'self', 'this', 'args'}
        return set(w.lower() for w in self._ef.get("programming_stopwords", default))

    def is_valid_entity(self, text: str, label: str) -> bool:
        if label not in self.valid_entity_types:
            return False
        if len(text) < self.min_length:
            return False
        if text.isdigit():
            return False
        # numbers mixed with punctuation: "1." "（3）"
        if re.fullmatch(r'[\d\s\.\、\。\，\,\(\)\（\）\【\】]+', text):
            return False
        # pure English word: apply stricter length or stopword check
        if re.fullmatch(r'[a-zA-Z]+', text):
            if len(text) < self.min_english_length:
                return False
            if text.lower() in self.programming_stopwords:
                return False
        # camelCase starting with lowercase (tabId, webContents, onClick)
        if re.match(r'^[a-z]+[A-Z]', text):
            return False
        return True

    # ── LLM entity filter ─────────────────────────────────────────

    @property
    def llm_skip_dot_notation(self) -> bool:
        return bool(self._lef.get("skip_dot_notation", True))

    @property
    def llm_skip_camel_case(self) -> bool:
        return bool(self._lef.get("skip_camel_case", True))

    @property
    def llm_max_length(self) -> int:
        return int(self._lef.get("max_length", 40))

    @property
    def llm_min_english_length(self) -> int:
        return int(self._lef.get("min_english_length", self.min_english_length))

    @property
    def llm_enum_separators(self) -> list[str]:
        return list(self._lef.get("enum_separators", ["、", "，", "；"]))

    @property
    def llm_enum_split_min_length(self) -> int:
        return int(self._lef.get("enum_split_min_length", 10))

    def is_valid_llm_entity(self, text: str) -> bool:
        """Filter LLM-extracted entity labels before adding to graph."""
        if not text or len(text) < 2:
            return False
        if len(text) > self.llm_max_length:
            return False
        # dot.notation chain calls (MultiWindowManager.closeLeftSidebar)
        if self.llm_skip_dot_notation and re.search(r'[a-zA-Z]\.[a-zA-Z]', text):
            return False
        # CamelCase identifiers (LoggerManager, SQLiteManager)
        if self.llm_skip_camel_case and re.search(r'[a-z][A-Z]', text):
            return False
        # Pure English word shorter than threshold
        if re.fullmatch(r'[a-zA-Z]+', text) and len(text) < self.llm_min_english_length:
            return False
        return True

    def split_llm_entity(self, text: str) -> list[str]:
        """Split enumeration text into individual entities.

        '煤炭地质保障、矿山安全、灾害治理' → ['煤炭地质保障', '矿山安全', '灾害治理']
        """
        if len(text) < self.llm_enum_split_min_length:
            return [text]
        for sep in self.llm_enum_separators:
            if sep in text:
                parts = [p.strip() for p in text.split(sep) if p.strip()]
                if len(parts) > 1:
                    return parts
        return [text]

    # ── Retrieval ──────────────────────────────────────────────────

    @property
    def fuzzy_max_results(self) -> int:
        return int(self._ret.get("fuzzy_max_results", 5))

    @property
    def graph_neighbor_limit(self) -> int:
        return int(self._ret.get("graph_neighbor_limit", 5))

    @property
    def graph_chunk_limit(self) -> int:
        return int(self._ret.get("graph_chunk_limit", 10))

    @property
    def stop_words(self) -> set[str]:
        defaults = {
            '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
            '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
            '看', '好', '自己', '这', '那', '里', '来', '下', '什么', '怎么', '哪些',
            '如何', '为什么', '可以', '能', '吗', '呢', '啊', '吧', '过', '把',
            '被', '让', '给', '从', '向', '跟', '与', '及', '或', '而', '但',
        }
        return set(self._ret.get("stop_words", defaults))


graph_cfg = _GraphConfig()
