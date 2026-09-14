import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import { tierColor } from "../tiers";

export default function RelationshipGraph({ graph, onSelectVendor }) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !graph) return;

    const elements = [
      ...graph.nodes.map((n) => ({
        data: { id: n.id, label: n.label, score: n.score, tier: n.tier },
      })),
      ...graph.edges.map((e, i) => ({
        data: {
          id: `e${i}`,
          source: e.source,
          target: e.target,
          type: e.type,
          detail: e.detail,
        },
      })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: "node",
          style: {
            "background-color": (ele) => tierColor(ele.data("tier")),
            "label": "data(label)",
            "color": "#e6e9f2",
            "font-size": 10,
            "text-valign": "bottom",
            "text-margin-y": 6,
            "width": (ele) => 24 + Math.min(30, ele.data("score") / 3),
            "height": (ele) => 24 + Math.min(30, ele.data("score") / 3),
            "border-width": 2,
            "border-color": "#0e1420",
          },
        },
        {
          selector: "edge",
          style: {
            "width": 2,
            "line-color": (ele) => (ele.data("type") === "shared_address" ? "#e63965" : "#3a4257"),
            "curve-style": "bezier",
            "opacity": 0.7,
          },
        },
        {
          selector: ".faded",
          style: { opacity: 0.15 },
        },
      ],
      layout: { name: "cose", animate: false, padding: 40, nodeRepulsion: 8000 },
    });

    cy.on("tap", "node", (evt) => {
      onSelectVendor?.(evt.target.id());
    });

    cy.on("mouseover", "node", (evt) => {
      const node = evt.target;
      cy.elements().addClass("faded");
      node.removeClass("faded");
      node.neighborhood().removeClass("faded");
    });
    cy.on("mouseout", "node", () => {
      cy.elements().removeClass("faded");
    });

    cyRef.current = cy;
    return () => cy.destroy();
  }, [graph, onSelectVendor]);

  return (
    <div className="graph-wrapper">
      <div className="graph-legend">
        <span><i className="dot" style={{ background: "#e63965" }} /> Immediate Review</span>
        <span><i className="dot" style={{ background: "#e0a12e" }} /> Scheduled Review</span>
        <span><i className="dot" style={{ background: "#4c8bf5" }} /> Monitor</span>
        <span className="legend-sep" />
        <span><i className="line" style={{ background: "#e63965" }} /> Shared address</span>
      </div>
      <div className="graph-canvas" ref={containerRef} />
    </div>
  );
}
