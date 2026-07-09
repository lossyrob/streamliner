(function () {
  const workstreams = [
    {
      id: "docs",
      title: "Documentation System",
      kind: "Product foundation",
      health: "Ready for formation",
      status: "shaped",
      progress: 72,
      x: 80,
      y: 90,
      summary: "Defines design, architecture, and user-guide doc families plus discovery conventions.",
      imports: [],
      exports: ["docs-taxonomy", "docs-discovery"],
      nodes: [
        { id: "docs-taxonomy", label: "Doc taxonomy", type: "export", status: "done", x: 34, y: 82 },
        { id: "docs-discovery", label: "Discovery contract", type: "export", status: "active", x: 210, y: 82 },
        { id: "user-guide", label: "User guide shape", type: "task", status: "planned", x: 122, y: 172 }
      ],
      milestones: [
        { id: "docs-taxonomy", kind: "export", label: "Docs taxonomy", x: 360, note: "Design / architecture / guide split" },
        { id: "docs-discovery", kind: "export", label: "Discovery convention", x: 640, note: "Paths and references available" }
      ]
    },
    {
      id: "session-launch",
      title: "Session Launching",
      kind: "Runtime substrate",
      health: "Mainline",
      status: "mainline",
      progress: 88,
      x: 80,
      y: 395,
      summary: "Provides API-first launch pipeline and context package seams for worker sessions.",
      imports: [],
      exports: ["api-pipeline"],
      nodes: [
        { id: "api-pipeline", label: "API-first launch", type: "export", status: "done", x: 34, y: 82 },
        { id: "context-seam", label: "Context package seam", type: "task", status: "done", x: 210, y: 82 },
        { id: "launch-claim", label: "Launch claims", type: "task", status: "active", x: 122, y: 172 }
      ],
      milestones: [
        { id: "api-pipeline", kind: "export", label: "API launch pipeline", x: 460, note: "Worker launch substrate" },
        { id: "context-seam", kind: "export", label: "Context package seam", x: 760, note: "Node role can attach" }
      ]
    },
    {
      id: "distribution",
      title: "CLI / Distribution #40",
      kind: "Integration",
      health: "Preview risk",
      status: "preview",
      progress: 41,
      x: 520,
      y: 360,
      summary: "Installs helpers and exports the stable command surface for orchestrator-driven worker launch.",
      imports: ["api-pipeline"],
      exports: ["launch-node"],
      nodes: [
        { id: "api-pipeline-import", label: "Import launch API", type: "import", status: "done", x: 34, y: 82 },
        { id: "launch-node", label: "streamliner launch-node", type: "export", status: "active", x: 210, y: 82 },
        { id: "doctor", label: "Install / doctor", type: "task", status: "planned", x: 122, y: 172 }
      ],
      milestones: [
        { id: "api-pipeline-import", kind: "import", label: "Consumes launch pipeline", x: 650, note: "From Session Launching" },
        { id: "launch-node", kind: "export", label: "launch-node command", x: 980, note: "Preview command contract" }
      ]
    },
    {
      id: "agent-skills",
      title: "Agent and Skill Context",
      kind: "Role context",
      health: "Ready for formation",
      status: "shaped",
      progress: 68,
      x: 990,
      y: 170,
      summary: "Defines Streamliner role context for designer, formation, orchestrator, and node worker sessions.",
      imports: ["docs-taxonomy", "launch-node"],
      exports: ["role-context", "closure-review"],
      nodes: [
        { id: "docs-taxonomy-import", label: "Import docs taxonomy", type: "import", status: "done", x: 34, y: 82 },
        { id: "launch-node-import", label: "Import launch-node", type: "import", status: "blocked", x: 210, y: 82 },
        { id: "role-context", label: "Role-context model", type: "export", status: "active", x: 34, y: 172 },
        { id: "closure-review", label: "Closure review", type: "export", status: "planned", x: 210, y: 172 }
      ],
      milestones: [
        { id: "docs-taxonomy-import", kind: "import", label: "Docs taxonomy import", x: 780, note: "Needs doc family terms" },
        { id: "launch-node-import", kind: "import", label: "launch-node import", x: 1110, note: "Blocked on CLI preview" },
        { id: "role-context", kind: "export", label: "Role context model", x: 1390, note: "Feeds workers and hot work" }
      ]
    },
    {
      id: "hot-work",
      title: "Worker Hot Work",
      kind: "Operating behavior",
      health: "Ready for formation",
      status: "shaped",
      progress: 64,
      x: 990,
      y: 500,
      summary: "Supports builder-directed hot work, mess accounting, and reconciliation after node closeout.",
      imports: ["role-context"],
      exports: ["hot-work-summary"],
      nodes: [
        { id: "role-context-import", label: "Import worker role", type: "import", status: "active", x: 34, y: 82 },
        { id: "hot-work-summary", label: "Hot work narrative", type: "export", status: "active", x: 210, y: 82 },
        { id: "reconcile", label: "Reconciliation flow", type: "task", status: "planned", x: 122, y: 172 }
      ],
      milestones: [
        { id: "role-context-import", kind: "import", label: "Worker role import", x: 1330, note: "From Agent/Skill Context" },
        { id: "hot-work-summary", kind: "export", label: "Hot work summary", x: 1620, note: "Feeds reconciliation" }
      ]
    },
    {
      id: "dependencies",
      title: "Multi-Workstream Dependencies",
      kind: "Data semantics",
      health: "Shaped",
      status: "shaped",
      progress: 76,
      x: 520,
      y: 720,
      summary: "Defines project-scoped imports, exports, checkpoints, gates, and availability states.",
      imports: ["hot-work-summary"],
      exports: ["dependency-schema"],
      nodes: [
        { id: "hot-work-summary-import", label: "Import hot-work signal", type: "import", status: "planned", x: 34, y: 82 },
        { id: "dependency-schema", label: "Import/export schema", type: "export", status: "active", x: 210, y: 82 },
        { id: "project-frame", label: "Project frame", type: "task", status: "active", x: 122, y: 172 }
      ],
      milestones: [
        { id: "hot-work-summary-import", kind: "import", label: "Hot-work signal import", x: 1210, note: "Reconciliation affects edges" },
        { id: "dependency-schema", kind: "export", label: "Dependency schema", x: 1520, note: "Minimum renderable semantics" }
      ]
    },
    {
      id: "canvas",
      title: "Work Geometry Canvas",
      kind: "Visualization",
      health: "Now shaping",
      status: "active",
      progress: 18,
      x: 1300,
      y: 760,
      summary: "Renders project-scoped workstreams, external dependencies, blocked edges, and export availability.",
      imports: ["dependency-schema"],
      exports: ["project-canvas"],
      nodes: [
        { id: "dependency-schema-import", label: "Import dependency semantics", type: "import", status: "blocked", x: 34, y: 82 },
        { id: "project-canvas", label: "Project canvas", type: "export", status: "planned", x: 210, y: 82 },
        { id: "single-badges", label: "Single graph badges", type: "task", status: "planned", x: 122, y: 172 }
      ],
      milestones: [
        { id: "dependency-schema-import", kind: "import", label: "Dependency schema import", x: 1660, note: "Needs dependency workstream" },
        { id: "project-canvas", kind: "export", label: "Project canvas", x: 1940, note: "First useful visualization" }
      ]
    }
  ];

  const edges = [
    {
      id: "launch-api-to-cli",
      from: { workstream: "session-launch", node: "api-pipeline", export: "api-pipeline" },
      to: { workstream: "distribution", node: "api-pipeline-import", import: "api-pipeline" },
      label: "API launch pipeline",
      state: "mainline",
      risk: "Low"
    },
    {
      id: "cli-to-agent",
      from: { workstream: "distribution", node: "launch-node", export: "launch-node" },
      to: { workstream: "agent-skills", node: "launch-node-import", import: "launch-node" },
      label: "streamliner launch-node",
      state: "preview",
      risk: "Command contract not validated"
    },
    {
      id: "docs-to-agent",
      from: { workstream: "docs", node: "docs-taxonomy", export: "docs-taxonomy" },
      to: { workstream: "agent-skills", node: "docs-taxonomy-import", import: "docs-taxonomy" },
      label: "Docs taxonomy",
      state: "validated",
      risk: "Low"
    },
    {
      id: "agent-to-hot-work",
      from: { workstream: "agent-skills", node: "role-context", export: "role-context" },
      to: { workstream: "hot-work", node: "role-context-import", import: "role-context" },
      label: "Worker role context",
      state: "proposed",
      risk: "Role content not implemented"
    },
    {
      id: "hot-work-to-deps",
      from: { workstream: "hot-work", node: "hot-work-summary", export: "hot-work-summary" },
      to: { workstream: "dependencies", node: "hot-work-summary-import", import: "hot-work-summary" },
      label: "Reconciliation signal",
      state: "proposed",
      risk: "Narrative-only for first slice"
    },
    {
      id: "deps-to-canvas",
      from: { workstream: "dependencies", node: "dependency-schema", export: "dependency-schema" },
      to: { workstream: "canvas", node: "dependency-schema-import", import: "dependency-schema" },
      label: "Import/export schema",
      state: "branch-local",
      risk: "Canvas blocked until schema exists"
    }
  ];

  const byId = Object.fromEntries(workstreams.map((workstream) => [workstream.id, workstream]));

  window.workGeometryMock = { workstreams, edges, byId };
})();
