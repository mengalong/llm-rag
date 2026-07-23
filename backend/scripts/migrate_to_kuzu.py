#!/usr/bin/env python3
"""Migrate all GraphML snapshots (and current knowledge_graph.graphml) to Kuzu format.

Usage:
    cd backend && conda run --no-capture-output -n llm-rag python -m scripts.migrate_to_kuzu
"""
import asyncio
import json
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("migrate_to_kuzu")


def _graphml_to_kuzu(graphml_path: str, kuzu_path: str) -> tuple[int, int]:
    """Convert a single GraphML file to a Kuzu database directory.
    Returns (node_count, edge_count).
    """
    import networkx as nx
    import kuzu
    import pandas as pd

    logger.info("  Reading %s ...", graphml_path)
    g = nx.read_graphml(graphml_path)
    nx_nodes = g.number_of_nodes()
    nx_edges = g.number_of_edges()
    logger.info("  nx: %d nodes, %d edges", nx_nodes, nx_edges)

    if Path(kuzu_path).exists():
        if Path(kuzu_path).is_dir():
            import shutil
            shutil.rmtree(kuzu_path)
        else:
            Path(kuzu_path).unlink()

    db = kuzu.Database(kuzu_path)
    conn = kuzu.Connection(db)

    conn.execute(
        "CREATE NODE TABLE Entity("
        "id STRING PRIMARY KEY, label STRING, type STRING, "
        "document_ids STRING, chunk_ids STRING)"
    )
    conn.execute(
        "CREATE REL TABLE Relation("
        "FROM Entity TO Entity, "
        "rel_id STRING, relation STRING, weight DOUBLE, chunk_ids STRING)"
    )

    if nx_nodes > 0:
        for nid, data in g.nodes(data=True):
            conn.execute(
                "CREATE (:Entity {id: $id, label: $label, type: $type, "
                "document_ids: $di, chunk_ids: $ci})",
                {
                    "id": str(nid),
                    "label": str(data.get("label", nid)),
                    "type": str(data.get("type", "ENTITY")),
                    "di": str(data.get("document_ids", "[]")),
                    "ci": str(data.get("chunk_ids", "[]")),
                },
            )

    if nx_edges > 0:
        for u, v, data in g.edges(data=True):
            conn.execute(
                "MATCH (a:Entity {id: $u}), (b:Entity {id: $v}) "
                "CREATE (a)-[:Relation {rel_id: $rid, relation: $rel, "
                "weight: $w, chunk_ids: $ci}]->(b)",
                {
                    "u": str(u), "v": str(v),
                    "rid": str(data.get("id", f"{u}_{v}")),
                    "rel": str(data.get("relation", "co-occurs")),
                    "w": float(data.get("weight", 1.0)),
                    "ci": str(data.get("chunk_ids", "[]")),
                },
            )

    # Verify
    res = conn.execute("MATCH (e:Entity) RETURN count(e)")
    kuzu_nodes = res.get_next()[0] if res.has_next() else 0
    res2 = conn.execute("MATCH ()-[r:Relation]->() RETURN count(r)")
    kuzu_edges = res2.get_next()[0] if res2.has_next() else 0

    if kuzu_nodes != nx_nodes or kuzu_edges != nx_edges:
        logger.warning(
            "  COUNT MISMATCH: nx=%d/%d kuzu=%d/%d",
            nx_nodes, nx_edges, kuzu_nodes, kuzu_edges,
        )
    else:
        logger.info("  kuzu: %d nodes, %d edges ✓", kuzu_nodes, kuzu_edges)

    return kuzu_nodes, kuzu_edges


def main():
    graphs_dir = Path(__file__).parent.parent / "data" / "graphs"
    snapshots_dir = graphs_dir / "snapshots"
    snapshots_dir.mkdir(parents=True, exist_ok=True)

    results = []

    # 1. Migrate all snapshot graphml files
    graphml_snaps = sorted(snapshots_dir.glob("*.graphml"))
    logger.info("Found %d GraphML snapshots to migrate", len(graphml_snaps))
    for graphml_file in graphml_snaps:
        stem = graphml_file.stem  # e.g. v7_20260723_062129
        kuzu_path = str(snapshots_dir / f"{stem}.kuzu")
        if Path(kuzu_path).exists():
            logger.info("Skipping %s (kuzu dir already exists)", stem)
            results.append((stem, "skipped", 0, 0))
            continue
        logger.info("Migrating snapshot: %s", stem)
        try:
            n, e = _graphml_to_kuzu(str(graphml_file), kuzu_path)
            results.append((stem, "ok", n, e))
        except Exception as ex:
            logger.error("  FAILED: %s", ex)
            results.append((stem, "failed", 0, 0))

    # 2. Migrate current knowledge_graph.graphml
    live_graphml = graphs_dir / "knowledge_graph.graphml"
    live_kuzu = graphs_dir / "knowledge_graph.kuzu"
    if live_graphml.exists():
        if live_kuzu.exists():
            logger.info("knowledge_graph.kuzu already exists — skipping live migration")
            results.append(("knowledge_graph (live)", "skipped", 0, 0))
        else:
            logger.info("Migrating live graph: knowledge_graph.graphml")
            try:
                n, e = _graphml_to_kuzu(str(live_graphml), str(live_kuzu))
                results.append(("knowledge_graph (live)", "ok", n, e))
            except Exception as ex:
                logger.error("  FAILED: %s", ex)
                results.append(("knowledge_graph (live)", "failed", 0, 0))
    else:
        logger.info("knowledge_graph.graphml not found — initialising empty Kuzu DB")
        import kuzu
        live_kuzu.mkdir(parents=True, exist_ok=True)
        db = kuzu.Database(str(live_kuzu))
        conn = kuzu.Connection(db)
        conn.execute(
            "CREATE NODE TABLE Entity("
            "id STRING PRIMARY KEY, label STRING, type STRING, "
            "document_ids STRING, chunk_ids STRING)"
        )
        conn.execute(
            "CREATE REL TABLE Relation("
            "FROM Entity TO Entity, "
            "rel_id STRING, relation STRING, weight DOUBLE, chunk_ids STRING)"
        )
        results.append(("knowledge_graph (live)", "created empty", 0, 0))

    # Summary
    print("\n" + "=" * 64)
    print("  Migration Summary")
    print("=" * 64)
    for name, status, n, e in results:
        print(f"  {status:12s}  {name}  ({n} nodes, {e} edges)")
    print("=" * 64)
    failed = [r for r in results if r[1] == "failed"]
    if failed:
        print(f"\n  {len(failed)} migrations FAILED. Check logs above.")
        sys.exit(1)
    else:
        print("\n  All migrations completed.")
        print("  Original .graphml files are kept as backup.")
        print("  To remove them after verification:")
        print("    find backend/data/graphs -name '*.graphml' -delete")
    print()


if __name__ == "__main__":
    main()
