import { createServer } from "node:http";

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Streamliner App-native spike</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--background-color-default, #ffffff);
      color: var(--text-color-default, #1f2328);
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--text-body-medium, 14px);
      line-height: var(--leading-body-medium, 20px);
    }
    main { max-width: 1100px; margin: 0 auto; padding: 24px; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    h1 {
      margin: 0 0 4px;
      font-size: var(--text-title-large, 26px);
      line-height: var(--leading-title-large, 32px);
      font-weight: var(--font-weight-semibold, 600);
    }
    p { margin: 0; color: var(--text-color-muted, #656d76); }
    button {
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 6px;
      padding: 7px 12px;
      background: var(--background-color-default, #ffffff);
      color: var(--text-color-default, #1f2328);
      font: inherit;
      cursor: pointer;
    }
    button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      margin: 18px 0;
      padding: 12px;
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 8px;
    }
    code {
      font-family: var(--font-mono, "SFMono-Regular", Consolas, monospace);
      font-size: var(--text-code-inline, 12px);
    }
    .graph { display: grid; gap: 12px; }
    .node {
      border: 1px solid var(--border-color-default, #d0d7de);
      border-left: 4px solid var(--true-color-blue, #0969da);
      border-radius: 8px;
      padding: 14px 16px;
      background: var(--background-color-default, #ffffff);
    }
    .node.gate { border-left-color: var(--true-color-red, #cf222e); }
    .node-head { display: flex; justify-content: space-between; gap: 16px; }
    .node h2 { margin: 0; font-size: var(--text-title-medium, 18px); }
    .badge {
      white-space: nowrap;
      border-radius: 999px;
      padding: 2px 9px;
      background: var(--true-color-blue-muted, #ddf4ff);
      color: var(--text-color-default, #1f2328);
      font-size: var(--text-caption, 12px);
      font-weight: var(--font-weight-semibold, 600);
    }
    .gate .badge { background: var(--true-color-red-muted, #ffebe9); }
    .deps { margin-top: 8px; color: var(--text-color-muted, #656d76); }
    .binding { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-color-default, #d0d7de); }
    .error { color: var(--true-color-red, #cf222e); white-space: pre-wrap; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1 id="title">Streamliner App-native spike</h1>
        <p id="summary">Loading exact-revision projection...</p>
      </div>
      <button id="refresh" type="button">Refresh</button>
    </header>
    <section class="meta" aria-label="Artifact provenance">
      <span>Revision <code id="revision">-</code></span>
      <span>Bindings <strong id="bindings">-</strong></span>
      <span>Updated <time id="updated">-</time></span>
    </section>
    <section id="graph" class="graph" aria-live="polite"></section>
    <p id="error" class="error" role="alert"></p>
  </main>
  <script>
    const graph = document.querySelector("#graph");
    const error = document.querySelector("#error");

    function text(tag, value, className) {
      const element = document.createElement(tag);
      element.textContent = value;
      if (className) element.className = className;
      return element;
    }

    function render(projection) {
      error.textContent = "";
      document.querySelector("#title").textContent = projection.workstream.title;
      document.querySelector("#summary").textContent = projection.workstream.summary;
      document.querySelector("#revision").textContent = projection.artifact.revision.slice(0, 12);
      document.querySelector("#bindings").textContent =
        projection.summary.preparedCount + projection.summary.claimedCount + projection.summary.completedCount;
      document.querySelector("#updated").textContent = new Date(projection.generatedAt).toLocaleTimeString();
      graph.replaceChildren();
      for (const node of projection.nodes) {
        const card = document.createElement("article");
        card.className = "node " + node.type;
        const heading = document.createElement("div");
        heading.className = "node-head";
        heading.append(text("h2", node.title));
        heading.append(text("span", node.runtimeStatus, "badge"));
        card.append(heading, text("p", node.summary));
        const dependencies = node.dependencies.length
          ? "Depends on: " + node.dependencies.map((item) => item.title + (item.complete ? " [done]" : "")).join(", ")
          : "No dependencies";
        card.append(text("div", dependencies, "deps"));
        if (node.binding) {
          card.append(text(
            "div",
            "App binding: " + node.binding.status + " | " + node.binding.launchId,
            "binding",
          ));
        }
        graph.append(card);
      }
    }

    async function load(refresh = false) {
      try {
        const response = await fetch(refresh ? "/api/refresh" : "/api/projection", {
          method: refresh ? "POST" : "GET",
        });
        if (!response.ok) throw new Error(await response.text());
        render(await response.json());
      } catch (failure) {
        error.textContent = failure.message;
      }
    }

    document.querySelector("#refresh").addEventListener("click", () => load(true));
    const events = new EventSource("/events");
    events.addEventListener("projection", (event) => render(JSON.parse(event.data)));
    load();
  </script>
</body>
</html>`;

function sendJson(response, statusCode, value) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    response.end(`${JSON.stringify(value)}\n`);
}

export async function createCanvasServer({ getProjection }) {
    const eventStreams = new Set();
    const broadcast = (projection) => {
        const payload = `event: projection\ndata: ${JSON.stringify(projection)}\n\n`;
        for (const response of eventStreams) {
            response.write(payload);
        }
    };
    const server = createServer((request, response) => {
        const route = new URL(request.url || "/", "http://127.0.0.1").pathname;
        if (request.method === "GET" && route === "/") {
            response.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
            });
            response.end(HTML);
            return;
        }
        if (request.method === "GET" && route === "/health") {
            sendJson(response, 200, { ok: true, binding: "127.0.0.1" });
            return;
        }
        if (request.method === "GET" && route === "/events") {
            response.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-store",
                Connection: "keep-alive",
            });
            response.write(": connected\n\n");
            eventStreams.add(response);
            request.on("close", () => eventStreams.delete(response));
            return;
        }
        if (
            (request.method === "GET" && route === "/api/projection")
            || (request.method === "POST" && route === "/api/refresh")
        ) {
            try {
                const projection = getProjection();
                if (request.method === "POST") {
                    broadcast(projection);
                }
                sendJson(response, 200, projection);
            } catch (error) {
                sendJson(response, 500, { error: error.message });
            }
            return;
        }
        sendJson(response, 404, { error: "Not found" });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Loopback canvas server did not expose a TCP port.");
    }
    return {
        url: `http://127.0.0.1:${address.port}/`,
        broadcast,
        close: () => new Promise((resolve, reject) => {
            for (const response of eventStreams) {
                response.end();
            }
            eventStreams.clear();
            server.close((error) => error ? reject(error) : resolve());
        }),
    };
}
