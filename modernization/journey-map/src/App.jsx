import React, { useMemo, useState } from "react";
import ReactFlow, { Background, Controls, Handle, Position } from "reactflow";
import "reactflow/dist/style.css";
import { journeys, DISPOSITIONS, LAYERS, CONVERSION_SEAM, srcUrl } from "./journeys.js";

// Dark-themed per-layer accents (node text is light, so keep backgrounds dark).
const LAYER_STYLE = {
  document: { bg: "#0b1220" },
  posting: { bg: "#1a1407", border: "#d97706" },
  gl: { bg: "#0a1426", border: "#2563eb" },
  deployable: { bg: "#08160f", border: "#1f9d55" },
  downstream: { bg: "#140e22", border: "#7c3aed" },
};

function DocNode({ data }) {
  const dispColor = DISPOSITIONS[data.disposition].color;
  const ls = LAYER_STYLE[data.layer] || {};
  const border = ls.border || (data.layer === "document" ? dispColor : "#cbd5e1");
  return (
    <div className="doc-node" style={{ borderColor: border, background: ls.bg }} onClick={data.onClick}>
      <Handle type="target" position={Position.Left} />
      <div className="doc-node__label">{data.label}</div>
      <div className="doc-node__cls">{data.cls}</div>
      {data.table && <div className="doc-node__table">{data.table}</div>}
      {data.lines ? <div className="doc-node__lines">{data.lines.toLocaleString()} LOC</div> : null}
      {data.oracle && <div className="doc-node__flag">Oracle SQL ⚠</div>}
      {data.constructs?.length ? (
        <div className="doc-node__chips">
          {data.constructs.slice(0, 2).map((construct) => (
            <span key={`${data.id}-${construct.name}-${construct.line}`} className="doc-node__chip">
              {construct.name}
            </span>
          ))}
          {data.constructs.length > 2 ? <span className="doc-node__chip doc-node__chip--more">+{data.constructs.length - 2}</span> : null}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { doc: DocNode };

const sourceLabel = (file, line) => `${file.split("/").pop()}:${line}`;

function ConstructTable({ constructs }) {
  if (!constructs?.length) return null;

  return (
    <table className="constructs">
      <thead>
        <tr>
          <th>Construct</th>
          <th>→ Postgres action</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {constructs.map((construct) => (
          <tr key={`${construct.file}-${construct.line}-${construct.name}`}>
            <td className="constructs__name">{construct.name}</td>
            <td>{construct.action}</td>
            <td>
              <a className="src-link" href={srcUrl(construct.file, construct.line)} target="_blank" rel="noreferrer">
                {sourceLabel(construct.file, construct.line)} ↗
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function App() {
  const [activeId, setActiveId] = useState(journeys[0].id);
  const [selected, setSelected] = useState(null);
  const journey = journeys.find((j) => j.id === activeId);

  const { nodes, edges } = useMemo(() => {
    // Lay out by layer: spread each layer's nodes horizontally at its row Y.
    const byLayer = {};
    journey.nodes.forEach((n) => {
      (byLayer[n.layer] = byLayer[n.layer] || []).push(n);
    });
    // gl + posting share a row; deployable + downstream share a row — offset within.
    const colX = (layer, i) => {
      if (layer === "gl") return 1180;
      if (layer === "downstream") return 1180;
      if (layer === "deployable") return 720;
      return i * 235; // document spine + posting
    };
    const nodes = journey.nodes.map((n) => {
      const peers = byLayer[n.layer];
      const idxInLayer = peers.indexOf(n);
      return {
        id: n.id,
        type: "doc",
        position: { x: colX(n.layer, idxInLayer), y: LAYERS[n.layer].y + (n.layer === "posting" ? 0 : 0) },
        data: { ...n, disposition: journey.disposition, onClick: () => setSelected(n) },
      };
    });
    const edges = journey.edges.map(([s, t]) => ({
      id: `${s}-${t}`,
      source: s,
      target: t,
      animated: true,
      style: { stroke: "#94a3b8" },
    }));
    return { nodes, edges };
  }, [journey]);

  return (
    <div className="app">
      <header className="app__header">
        <h1>iDempiere — User Journey Migration Map</h1>
        <p className="app__sub">
          Legacy Oracle/COTS ERP · journeys rediscovered from source · document spine → posting engine
          (<code>Doc_*</code>) → <code>Fact_Acct</code> → downstream · color = migration disposition
        </p>
      </header>

      <div className="legend">
        {Object.entries(DISPOSITIONS).map(([k, v]) => (
          <span key={k} className="legend__item">
            <i style={{ background: v.color }} /> {v.label}
            <small>— {v.hint}</small>
          </span>
        ))}
      </div>

      <div className="tabs">
        {journeys.map((j) => (
          <button
            key={j.id}
            className={"tab" + (j.id === activeId ? " tab--active" : "")}
            style={{ borderBottomColor: j.id === activeId ? DISPOSITIONS[j.disposition].color : "transparent" }}
            onClick={() => { setActiveId(j.id); setSelected(null); }}
          >
            <span className="tab__dot" style={{ background: DISPOSITIONS[j.disposition].color }} />
            {j.name}
          </button>
        ))}
      </div>

      <div className="body">
        <div className="canvas">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}>
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="panel">
          <div className="panel__badge" style={{ background: DISPOSITIONS[journey.disposition].color }}>
            {DISPOSITIONS[journey.disposition].label}
          </div>
          <h2>{journey.name}</h2>
          <p className="panel__summary">{journey.summary}</p>

          <h3>Decision drivers</h3>
          <table className="metrics">
            <tbody>
              <tr><td>Oracle coupling</td><td>{journey.metrics.oracleCoupling}</td></tr>
              <tr><td>Complexity</td><td>{journey.metrics.complexity}</td></tr>
              <tr><td>Data volume</td><td>{journey.metrics.dataVolume}</td></tr>
              <tr><td>Blast radius</td><td>{journey.metrics.blastRadius}</td></tr>
            </tbody>
          </table>

          <h3>Rationale</h3>
          <p className="panel__rationale">{journey.rationale}</p>

          {journey.approach ? (
            <section className="panel-card">
              <div className="panel-card__head">
                <h3>Recommended approach</h3>
                {journey.approach.priority ? <span className="panel-card__badge">{journey.approach.priority}</span> : null}
              </div>
              <p className="panel__note">{journey.approach.sequencing}</p>
              <ol className="approach">
                {journey.approach.slices.map((step) => (
                  <li key={step.title} className="approach__item">
                    <div className="approach__top">
                      <span className="approach__title">{step.title}</span>
                      <span className="approach__effort">{step.effort}</span>
                    </div>
                    <p>{step.detail}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <details className="seam" open>
            <summary>Oracle→PostgreSQL conversion seam <span>shared across all journeys</span></summary>
            <p className="panel__note">
              One runtime translation layer rewrites the Oracle-specific SQL constructs below before the journey logic reaches PostgreSQL.
            </p>
            <ConstructTable constructs={CONVERSION_SEAM} />
          </details>

          {selected ? (
            <div className="node-detail">
              <h3>{selected.label} — <code>{selected.cls}</code></h3>
              {selected.action ? <p className="node-detail__action">{selected.action}</p> : null}
              <ConstructTable constructs={selected.constructs} />
              <ul>
                {selected.table && <li>Tables: <code>{selected.table}</code></li>}
                {selected.lines ? <li>Source size: {selected.lines.toLocaleString()} lines (measured)</li> : null}
                {selected.note && <li>{selected.note}</li>}
                {selected.oracle && <li className="oracle">Oracle coupling: {selected.oracle}</li>}
              </ul>
              <div className="node-detail__links">
                {selected.file ? (
                  <a className="src-link" href={srcUrl(selected.file, selected.line)} target="_blank" rel="noreferrer">
                    View source ↗
                  </a>
                ) : null}
                {selected.convFile && (
                  <a className="src-link src-link--alt" href={srcUrl(selected.convFile, selected.convLine)} target="_blank" rel="noreferrer">
                    SQL conversion layer ↗
                  </a>
                )}
              </div>
            </div>
          ) : (
            <p className="hint">Click any node — document, posting class, GL sink, the migrated service, or a downstream consumer — to inspect its class, tables, line count and source.</p>
          )}
        </aside>
      </div>

      <footer className="app__footer">
        Generated by Devin from the iDempiere codebase · line counts measured from source · stand-in for a legacy Oracle/COTS ERP
      </footer>
    </div>
  );
}
