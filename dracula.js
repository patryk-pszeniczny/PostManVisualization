(function () {
  function safeGetHeader(name) {
    try { return pm.response.headers.get(name) || ""; } catch (e) { return ""; }
  }

  function isLikelyJson(contentType, text) {
    if ((contentType || "").toLowerCase().includes("application/json")) return true;
    const t = (text || "").trim();
    return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
  }

  function tryParseJson() {
    const contentType = safeGetHeader("Content-Type");
    const raw = pm.response.text();

    if (!isLikelyJson(contentType, raw)) return { ok: false, raw, contentType };

    try {
      const json = pm.response.json();
      return { ok: true, json, raw, contentType };
    } catch (e) {
      // sometimes header says json but body isn't valid
      return { ok: false, raw, contentType, error: String(e) };
    }
  }

  function typeOf(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    const t = typeof v;
    if (t === "object") return "object";
    if (t === "number") return Number.isFinite(v) ? "number" : "number";
    if (t === "boolean") return "boolean";
    if (t === "string") {
      const s = v;
      // quick timestamp-ish detection
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) || !isNaN(Date.parse(s))) return "date";
      if (/^https?:\/\/\S+$/i.test(s)) return "url";
      return "string";
    }
    return t;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function shorten(str, n) {
    str = String(str);
    if (str.length <= n) return str;
    return str.slice(0, n - 1) + "…";
  }

  function formatValue(v) {
    const t = typeOf(v);
    if (t === "null") return { html: `<span class="muted italic">null</span>`, raw: "null" };
    if (t === "boolean") return { html: `<span class="badge b-bool">${v}</span>`, raw: String(v) };
    if (t === "number") return { html: `<span class="badge b-num">${v}</span>`, raw: String(v) };
    if (t === "date") {
      try {
        const d = new Date(v);
        const out = isNaN(d.getTime()) ? String(v) : d.toLocaleString();
        return { html: `<span class="badge b-date" title="${escapeHtml(String(v))}">${escapeHtml(out)}</span>`, raw: String(v) };
      } catch (e) {
        return { html: `<span class="badge b-date">${escapeHtml(String(v))}</span>`, raw: String(v) };
      }
    }
    if (t === "url") {
      const url = String(v);
      return { html: `<a class="link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shorten(url, 80))}</a>`, raw: url };
    }
    if (t === "string") {
      const s = String(v);
      const display = escapeHtml(shorten(s, 140));
      const title = escapeHtml(s);
      return { html: `<span class="text" title="${title}">"${display}"</span>`, raw: s };
    }
    if (t === "array") return { html: `<span class="badge b-arr">Array(${v.length})</span>`, raw: "" };
    if (t === "object") return { html: `<span class="badge b-obj">Object</span>`, raw: "" };
    return { html: `<span class="muted">${escapeHtml(String(v))}</span>`, raw: String(v) };
  }

  function countNodes(value, limit = 5000) {
    let count = 0;
    const seen = new Set();

    function walk(v) {
      if (count >= limit) return;
      const t = typeOf(v);
      count++;

      if (t === "object" || t === "array") {
        if (v && typeof v === "object") {
          if (seen.has(v)) return;
          seen.add(v);
        }
        if (t === "array") {
          for (let i = 0; i < v.length; i++) walk(v[i]);
        } else {
          for (const k of Object.keys(v)) walk(v[k]);
        }
      }
    }
    walk(value);
    return count;
  }

  const template = `
  <style>
    :root{
      --bg0:#0f111a;      /* Dracula-ish */
      --bg1:#171a26;
      --bg2:#1f2333;
      --card:#1b1f2e;
      --border:#2a2f45;
      --text:#f8f8f2;
      --muted:#a6accd;
      --pink:#ff79c6;
      --purple:#bd93f9;
      --cyan:#8be9fd;
      --green:#50fa7b;
      --yellow:#f1fa8c;
      --orange:#ffb86c;
      --red:#ff5555;
      --blue:#6272a4;
      --shadow: 0 10px 30px rgba(0,0,0,0.45);
      --radius: 14px;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial;
    }

    *{ box-sizing:border-box; }
    body{
      margin:0;
      padding:18px;
      font-family:var(--sans);
      color:var(--text);
      background: radial-gradient(1200px 600px at 30% 0%, rgba(189,147,249,0.18), transparent 60%),
                  radial-gradient(900px 600px at 70% 0%, rgba(139,233,253,0.14), transparent 60%),
                  linear-gradient(180deg, var(--bg0), var(--bg1));
      min-height:100vh;
    }

    .container{ max-width: 1100px; margin:0 auto; }

    .header{
      background: linear-gradient(180deg, rgba(31,35,51,0.9), rgba(23,26,38,0.9));
      border:1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 18px 14px;
      box-shadow: var(--shadow);
      overflow:hidden;
      position:relative;
    }

    .header::before{
      content:"";
      position:absolute;
      inset:-1px;
      background: linear-gradient(90deg, rgba(255,121,198,0.35), rgba(189,147,249,0.35), rgba(139,233,253,0.25));
      filter: blur(24px);
      opacity:0.35;
      z-index:0;
    }

    .header-inner{ position:relative; z-index:1; display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start; justify-content:space-between;}
    .title{ display:flex; flex-direction:column; gap:6px; }
    .title h1{
      margin:0;
      font-size: 22px;
      letter-spacing:0.2px;
      display:flex;
      align-items:center;
      gap:10px;
    }
    .title .sub{
      color: var(--muted);
      font-size: 13px;
      line-height: 1.3;
      font-family: var(--mono);
      opacity:0.95;
      word-break: break-word;
    }

    .controls{
      display:flex;
      gap:10px;
      align-items:center;
      flex-wrap:wrap;
      justify-content:flex-end;
    }

    .search{
      display:flex;
      align-items:center;
      gap:8px;
      background: rgba(15,17,26,0.55);
      border:1px solid var(--border);
      border-radius: 12px;
      padding: 10px 12px;
      min-width: 260px;
    }
    .search input{
      width: 100%;
      border:0;
      outline:none;
      background:transparent;
      color:var(--text);
      font-size: 13px;
      font-family: var(--mono);
    }
    .btn{
      border:1px solid var(--border);
      background: rgba(15,17,26,0.55);
      color: var(--text);
      padding: 10px 12px;
      border-radius: 12px;
      cursor:pointer;
      font-size: 13px;
      font-family: var(--mono);
      transition: 120ms ease;
      user-select:none;
    }
    .btn:hover{ border-color: rgba(139,233,253,0.6); box-shadow: 0 0 0 3px rgba(139,233,253,0.12); }

    .grid{
      margin-top: 14px;
      display:grid;
      grid-template-columns: 1fr;
      gap: 14px;
    }

    .card{
      background: linear-gradient(180deg, rgba(27,31,46,0.92), rgba(23,26,38,0.92));
      border:1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow:hidden;
    }

    .card-head{
      padding: 14px 16px;
      border-bottom: 1px solid rgba(42,47,69,0.9);
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:12px;
      flex-wrap:wrap;
    }

    .card-title{
      margin:0;
      font-size: 14px;
      letter-spacing:0.2px;
      font-family: var(--mono);
      color: var(--muted);
      display:flex;
      align-items:center;
      gap:10px;
    }

    .summary{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      align-items:center;
    }

    .pill{
      display:inline-flex;
      align-items:center;
      gap:8px;
      padding: 6px 10px;
      border-radius: 999px;
      border:1px solid rgba(42,47,69,0.9);
      background: rgba(15,17,26,0.45);
      font-family: var(--mono);
      font-size: 12px;
      color: var(--text);
    }
    .pill .k{ color: var(--blue); }
    .pill .v{ color: var(--text); }

    .body{
      padding: 14px 16px 16px;
    }

    .kv{
      display:grid;
      grid-template-columns: 260px 1fr;
      gap: 10px 14px;
      align-items:start;
    }
    @media (max-width: 820px){
      .kv{ grid-template-columns: 1fr; }
    }

    .key{
      font-family: var(--mono);
      font-size: 13px;
      color: var(--cyan);
      word-break: break-word;
      display:flex;
      align-items:center;
      gap:10px;
    }
    .path{
      color: var(--blue);
      font-size: 12px;
      font-family: var(--mono);
    }
    .val{
      font-family: var(--mono);
      font-size: 13px;
      color: var(--text);
      word-break: break-word;
    }

    .node{
      border:1px solid rgba(42,47,69,0.85);
      background: rgba(15,17,26,0.35);
      border-radius: 12px;
      padding: 10px 12px;
    }
    .node + .node{ margin-top: 10px; }

    details{
      border:1px solid rgba(42,47,69,0.75);
      background: rgba(15,17,26,0.28);
      border-radius: 12px;
      padding: 10px 12px;
    }
    details + details{ margin-top: 10px; }

    summary{
      cursor:pointer;
      list-style:none;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      user-select:none;
      font-family: var(--mono);
    }
    summary::-webkit-details-marker{ display:none; }

    .sum-left{
      display:flex;
      align-items:center;
      gap:10px;
      min-width:0;
    }
    .caret{
      width: 10px;
      height: 10px;
      border-right:2px solid var(--muted);
      border-bottom:2px solid var(--muted);
      transform: rotate(-45deg);
      transition: 120ms ease;
      margin-right: 2px;
      opacity:0.9;
      flex: 0 0 auto;
    }
    details[open] .caret{ transform: rotate(45deg); }

    .sum-title{
      color: var(--pink);
      overflow:hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 520px;
    }
    .sum-meta{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }

    .badge{
      display:inline-flex;
      align-items:center;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      border:1px solid rgba(42,47,69,0.9);
      background: rgba(15,17,26,0.55);
      color: var(--text);
      font-family: var(--mono);
      line-height: 1.3;
    }
    .b-obj{ color: var(--purple); }
    .b-arr{ color: var(--cyan); }
    .b-str{ color: var(--yellow); }
    .b-num{ color: var(--orange); }
    .b-bool{ color: var(--green); }
    .b-null{ color: var(--muted); }
    .b-date{ color: var(--purple); }
    .b-err{ color: var(--red); border-color: rgba(255,85,85,0.55); }

    .muted{ color: var(--muted); }
    .italic{ font-style: italic; }
    .text{ color: var(--yellow); }
    a.link{ color: var(--cyan); text-decoration:none; }
    a.link:hover{ text-decoration: underline; }

    pre.raw{
      margin:0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--mono);
      font-size: 12px;
      color: var(--text);
      background: rgba(15,17,26,0.45);
      border:1px solid rgba(42,47,69,0.85);
      border-radius: 12px;
      padding: 12px;
      max-height: 60vh;
      overflow:auto;
    }

    .hint{
      font-size: 12px;
      color: var(--muted);
      font-family: var(--mono);
      margin-top: 10px;
      opacity:0.95;
    }

    .hidden{ display:none !important; }
    .hit{ outline: 2px solid rgba(139,233,253,0.55); box-shadow: 0 0 0 4px rgba(139,233,253,0.12); border-radius: 10px; }
  </style>

  <div class="container">
    <div class="header">
      <div class="header-inner">
        <div class="title">
          <h1>🧪 API Visualizer <span class="badge b-obj">Dracula</span></h1>
          <div class="sub">{{meta.method}} {{meta.url}} · <span class="muted">{{meta.contentType}}</span></div>
        </div>

        <div class="controls">
          <div class="search">
            <span class="muted">🔎</span>
            <input id="searchInput" placeholder="Search keys/values… (e.g. user.id, status=200, 'john')" />
          </div>
          <button class="btn" id="expandAll">Expand all</button>
          <button class="btn" id="collapseAll">Collapse all</button>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-head">
          <h2 class="card-title">📌 Summary</h2>
          <div class="summary">
            <span class="pill"><span class="k">Status</span> <span class="v">{{meta.status}} {{meta.statusText}}</span></span>
            <span class="pill"><span class="k">Time</span> <span class="v">{{meta.responseTime}}ms</span></span>
            <span class="pill"><span class="k">Size</span> <span class="v">{{meta.size}}</span></span>
            <span class="pill"><span class="k">Root</span> <span class="v">{{meta.rootType}}</span></span>
            <span class="pill"><span class="k">Nodes</span> <span class="v">{{meta.nodes}}</span></span>
          </div>
        </div>
        <div class="body">
          {{#if meta.jsonOk}}
            <div id="treeRoot">
              {{{htmlTree}}}
            </div>
          {{else}}
            <div class="node">
              <div class="key"><span class="badge b-err">Not JSON</span> <span class="muted">{{meta.parseError}}</span></div>
              <div style="margin-top:10px;">
                <pre class="raw">{{meta.raw}}</pre>
              </div>
            </div>
          {{/if}}
        </div>
      </div>

      {{#if meta.jsonOk}}
      <div class="card">
        <div class="card-head">
          <h2 class="card-title">📄 Raw (pretty)</h2>
          <div class="summary">
            <span class="pill"><span class="k">Hint</span> <span class="v">CTRL/⌘+F</span></span>
          </div>
        </div>
        <div class="body">
          <pre class="raw">{{meta.pretty}}</pre>
        </div>
      </div>
      {{/if}}
    </div>
  </div>

  <script>
    (function(){
      const input = document.getElementById('searchInput');
      const expandBtn = document.getElementById('expandAll');
      const collapseBtn = document.getElementById('collapseAll');

      function setAll(open){
        document.querySelectorAll('details').forEach(d => d.open = open);
      }

      function clearHits(){
        document.querySelectorAll('.hit').forEach(el => el.classList.remove('hit'));
        document.querySelectorAll('.hidden').forEach(el => el.classList.remove('hidden'));
      }

      function applySearch(q){
        clearHits();
        q = (q || '').trim().toLowerCase();
        if(!q) return;

        // mark nodes that contain text match
        const nodes = document.querySelectorAll('[data-search]');
        let any = false;

        nodes.forEach(n => {
          const hay = (n.getAttribute('data-search') || '').toLowerCase();
          if(hay.includes(q)){
            any = true;
            n.classList.add('hit');

            // ensure all parents expanded
            let p = n.parentElement;
            while(p){
              if(p.tagName === 'DETAILS') p.open = true;
              p = p.parentElement;
            }
          } else {
            // hide non matching leaf nodes (but not containers)
            if(n.getAttribute('data-leaf') === '1'){
              n.classList.add('hidden');
            }
          }
        });

        // if nothing found, do nothing special
        if(!any) {
          clearHits();
        }
      }

      if(expandBtn) expandBtn.addEventListener('click', () => setAll(true));
      if(collapseBtn) collapseBtn.addEventListener('click', () => setAll(false));

      let t = null;
      if(input){
        input.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(() => applySearch(input.value), 120);
        });
      }
    })();
  </script>
  `;
  function renderTree(value, path, depth, maxDepth, maxArrayItems) {
    const t = typeOf(value);

    // stop runaway
    if (depth > maxDepth) {
      return `
        <div class="node" data-search="${escapeHtml(path)}" data-leaf="1">
          <div class="key">${escapeHtml(path)} <span class="badge b-err">maxDepth</span></div>
          <div class="val"><span class="muted italic">Depth limit reached</span></div>
        </div>`;
    }

    // Leaf node
    if (t !== "object" && t !== "array") {
      const fv = formatValue(value);
      const search = `${path} ${t} ${fv.raw}`;
      return `
        <div class="node" data-search="${escapeHtml(search)}" data-leaf="1">
          <div class="kv">
            <div class="key">${escapeHtml(path)} <span class="badge b-${t === "string" ? "str" : t === "null" ? "null" : t === "boolean" ? "bool" : t === "number" ? "num" : t === "date" ? "date" : "obj"}">${escapeHtml(t)}</span></div>
            <div class="val">${fv.html}</div>
          </div>
        </div>`;
    }

    // Container node
    if (t === "array") {
      const len = value.length;
      const title = `${path} [${len}]`;
      let childrenHtml = "";
      const limit = Math.min(len, maxArrayItems);
      for (let i = 0; i < limit; i++) {
        const childPath = `${path}[${i}]`;
        childrenHtml += renderTree(value[i], childPath, depth + 1, maxDepth, maxArrayItems);
      }
      if (len > limit) {
        childrenHtml += `
          <div class="node" data-search="${escapeHtml(path)}" data-leaf="1">
            <div class="key">${escapeHtml(path)} <span class="badge b-arr">array</span></div>
            <div class="val"><span class="muted italic">Showing ${limit}/${len} items (increase maxArrayItems in script)</span></div>
          </div>`;
      }

      const search = `${path} array ${len}`;
      return `
        <details data-search="${escapeHtml(search)}">
          <summary>
            <div class="sum-left">
              <span class="caret"></span>
              <span class="sum-title">${escapeHtml(title)}</span>
            </div>
            <div class="sum-meta">
              <span class="badge b-arr">array</span>
              <span class="badge">${len} items</span>
            </div>
          </summary>
          <div style="margin-top:10px;">
            ${childrenHtml || `<div class="node" data-search="${escapeHtml(path)} empty" data-leaf="1"><div class="key">${escapeHtml(path)}</div><div class="val"><span class="muted italic">Empty array</span></div></div>`}
          </div>
        </details>`;
    }

    // object
    const keys = Object.keys(value);
    const title = `${path} {${keys.length}}`;
    let childrenHtml = "";
    for (const k of keys) {
      const childPath = path === "$" ? `$.${k}` : `${path}.${k}`;
      childrenHtml += renderTree(value[k], childPath, depth + 1, maxDepth, maxArrayItems);
    }

    const search = `${path} object ${keys.join(" ")}`;
    return `
      <details data-search="${escapeHtml(search)}" open>
        <summary>
          <div class="sum-left">
            <span class="caret"></span>
            <span class="sum-title">${escapeHtml(title)}</span>
          </div>
          <div class="sum-meta">
            <span class="badge b-obj">object</span>
            <span class="badge">${keys.length} keys</span>
          </div>
        </summary>
        <div style="margin-top:10px;">
          ${childrenHtml || `<div class="node" data-search="${escapeHtml(path)} empty" data-leaf="1"><div class="key">${escapeHtml(path)}</div><div class="val"><span class="muted italic">Empty object</span></div></div>`}
        </div>
      </details>`;
  }

  const parsed = tryParseJson();

  const meta = {
    jsonOk: parsed.ok,
    method: (pm.request && pm.request.method) ? pm.request.method : "REQUEST",
    url: (pm.request && pm.request.url) ? pm.request.url.toString() : "",
    contentType: parsed.contentType || "",
    status: pm.response.code,
    statusText: pm.response.status,
    responseTime: pm.response.responseTime,
    size: (typeof pm.response.size === "function" ? (pm.response.size().body || 0) : 0) + " B",
    parseError: parsed.error ? parsed.error : (parsed.ok ? "" : "Body is not JSON (or invalid JSON)"),
    raw: parsed.raw || "",
    rootType: parsed.ok ? typeOf(parsed.json) : "text",
    nodes: parsed.ok ? countNodes(parsed.json) : 0,
    pretty: ""
  };

  let htmlTree = "";

  if (parsed.ok) {
    const maxDepth = 12;
    const maxArrayItems = 200;
    htmlTree = renderTree(parsed.json, "$", 0, maxDepth, maxArrayItems);

    try {
      meta.pretty = JSON.stringify(parsed.json, null, 2);
    } catch (e) {
      meta.pretty = String(parsed.raw || "");
    }
  }

  pm.visualizer.set(template, { meta, htmlTree });
})();
