import { useState, useEffect, useMemo, useCallback } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./streamliner-theme.css";
import {
  parseWorkstreamDocument,
  buildWorkstreamViewModel,
} from "./workstream-view-model";
import { buildWorkstreamGraphLayout } from "./workstream-graph";
import type { WorkstreamDocument } from "./workstream-schema";
import { WorkstreamCanvas } from "./components/WorkstreamCanvas";
import { NodeInspector } from "./components/NodeInspector";
import { OperationalStatusStrip } from "./components/OperationalStatusStrip";
import { WorkstreamHeader } from "./components/WorkstreamHeader";

export default function App() {
  const [workstream, setWorkstream] = useState<WorkstreamDocument | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/example-project.json")
      .then((res) => res.text())
      .then((text) => {
        setWorkstream(parseWorkstreamDocument(text));
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  const viewModel = useMemo(() => {
    if (!workstream) return null;
    return buildWorkstreamViewModel(workstream);
  }, [workstream]);

  const layout = useMemo(() => {
    if (!workstream || !viewModel) return null;
    return buildWorkstreamGraphLayout(workstream, viewModel, selectedNodeId);
  }, [workstream, viewModel, selectedNodeId]);

  const selectedEntry = useMemo(() => {
    if (!selectedNodeId || !viewModel) return null;
    return (
      viewModel.derivedNodes.find((e) => e.node.id === selectedNodeId) ?? null
    );
  }, [selectedNodeId, viewModel]);

  const handleLoadFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const doc = parseWorkstreamDocument(text);
        setWorkstream(doc);
        setSelectedNodeId(null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
  }, []);

  if (error) {
    return (
      <div className="sl-root">
        <div className="sl-status-shell">
          <div className="sl-status-card">
            <h2 className="sl-status-title">Failed to load workstream</h2>
            <div className="sl-action-error">{error}</div>
            <label
              className="sl-action-btn"
              style={{ alignSelf: "flex-start" }}
            >
              Load a different file…
              <input
                type="file"
                accept=".json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLoadFile(file);
                }}
                style={{ display: "none" }}
              />
            </label>
          </div>
        </div>
      </div>
    );
  }

  if (!workstream || !viewModel || !layout) {
    return (
      <div className="sl-root">
        <div className="sl-status-shell">
          <div className="sl-status-card">
            <h2 className="sl-status-title">Loading…</h2>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sl-root">
      <WorkstreamHeader
        workstream={workstream}
        viewModel={viewModel}
        onLoadFile={handleLoadFile}
      />
      <OperationalStatusStrip viewModel={viewModel} />
      <div className="sl-body">
        <ReactFlowProvider>
          <WorkstreamCanvas
            layout={layout}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
          />
        </ReactFlowProvider>
        <div className="sl-sidebar">
          <NodeInspector
            entry={selectedEntry}
            layout={layout}
            workstream={workstream}
          />
        </div>
      </div>
    </div>
  );
}
