(function () {
  function safeGetHeader(name) { try { return pm.response.headers.get(name) || ""; } catch (e) { return ""; } }
  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function shorten(str, n) { str = String(str); return str.length <= n ? str : str.slice(0, n - 1) + "…"; }
  function typeOf(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    const t = typeof v;
    if (t === "object") return "object";
    if (t === "number") return "number";
    if (t === "boolean") return "boolean";
    if (t === "string") {
      const s = v;
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) || !isNaN(Date.parse(s))) return "date";
      if (/^https?:\/\/\S+$/i.test(s)) return "url";
      return "string";
    }
    return t;
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
    try { return { ok: true, json: pm.response.json(), raw, contentType }; }
    catch (e) { return { ok: false, raw, contentType, error: String(e) }; }
  }
  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!isFinite(n) || n <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let v = n, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    const out = i === 0 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toString();
    return out + " " + units[i];
  }
  function countNodes(value, limit = 8000) {
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
        if (t === "array") for (let i = 0; i < v.length; i++) walk(v[i]);
        else for (const k of Object.keys(v)) walk(v[k]);
      }
    }
    walk(value);
    return count;
  }
  function pathShort(path) {
    if (path === "$") return "root";
    if (path.startsWith("$.")) return path.slice(2);
    if (path.startsWith("$")) return path.slice(1);
    return path;
  }
  function displayLabel(path) {
    if (path === "$") return "root";
    let p = path.startsWith("$.") ? path.slice(2) : path.startsWith("$") ? path.slice(1) : path;
    const tokens = [];
    let buf = "";
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (ch === ".") { if (buf) { tokens.push(buf); buf = ""; } continue; }
      if (ch === "[") {
        if (buf) { tokens.push(buf); buf = ""; }
        let j = i, br = "";
        while (j < p.length && p[j] !== "]") { br += p[j]; j++; }
        if (j < p.length) br += "]";
        tokens.push(br);
        i = j;
        continue;
      }
      buf += ch;
    }
    if (buf) tokens.push(buf);
    return tokens[tokens.length - 1] || "root";
  }
  function formatValue(v) {
    const t = typeOf(v);
    if (t === "null") return { html: `<span class="muted italic">null</span>`, raw: "null", kind: "null" };
    if (t === "boolean") return { html: `<span class="badge b-bool">${v}</span>`, raw: String(v), kind: "bool" };
    if (t === "number") return { html: `<span class="badge b-num">${v}</span>`, raw: String(v), kind: "num" };
    if (t === "date") {
      try {
        const d = new Date(v);
        const out = isNaN(d.getTime()) ? String(v) : d.toLocaleString();
        return { html: `<span class="badge b-date" title="${escapeHtml(String(v))}">${escapeHtml(out)}</span>`, raw: String(v), kind: "date" };
      } catch (e) {
        return { html: `<span class="badge b-date">${escapeHtml(String(v))}</span>`, raw: String(v), kind: "date" };
      }
    }
    if (t === "url") {
      const url = String(v);
      return { html: `<a class="link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shorten(url, 90))}</a>`, raw: url, kind: "url" };
    }
    if (t === "string") {
      const s = String(v);
      return { html: `<span class="text" title="${escapeHtml(s)}">"${escapeHtml(shorten(s, 160))}"</span>`, raw: s, kind: "str" };
    }
    if (t === "array") return { html: `<span class="badge b-arr">Array(${v.length})</span>`, raw: "", kind: "arr" };
    if (t === "object") return { html: `<span class="badge b-obj">Object</span>`, raw: "", kind: "obj" };
    return { html: `<span class="muted">${escapeHtml(String(v))}</span>`, raw: String(v), kind: "oth" };
  }
  function statusClass(code) {
    const c = Number(code || 0);
    if (c >= 200 && c < 300) return "ok";
    if (c >= 300 && c < 400) return "warn";
    if (c >= 400 && c < 600) return "err";
    return "unk";
  }
  function quoteCurl(s) {
    s = String(s);
    if (!s.length) return "''";
    return "'" + s.replaceAll("'", "'\"'\"'") + "'";
  }
  function buildCurl() {
    try {
      const method = pm.request && pm.request.method ? pm.request.method : "GET";
      const url = pm.request && pm.request.url ? pm.request.url.toString() : "";
      const parts = ["curl", "-X", method, quoteCurl(url)];
      const reqHeaders = (pm.request && pm.request.headers && pm.request.headers.all) ? pm.request.headers.all() : [];
      reqHeaders.forEach(h => {
        const k = String(h.key || "");
        const v = String(h.value || "");
        const lk = k.toLowerCase();
        if (!k || !v) return;
        if (lk === "host" || lk === "content-length") return;
        parts.push("-H", quoteCurl(k + ": " + v));
      });
      if (pm.request && pm.request.body) {
        const b = pm.request.body;
        if (b.mode === "raw" && typeof b.raw === "string" && b.raw.trim().length) {
          parts.push("--data-raw", quoteCurl(b.raw));
        } else if (b.mode === "urlencoded" && Array.isArray(b.urlencoded) && b.urlencoded.length) {
          const form = b.urlencoded.map(p => encodeURIComponent(p.key) + "=" + encodeURIComponent(p.value)).join("&");
          parts.push("--data", quoteCurl(form));
        } else if (b.mode === "formdata" && Array.isArray(b.formdata) && b.formdata.length) {
          b.formdata.forEach(p => { if (p && p.key) parts.push("-F", quoteCurl(p.key + "=" + (p.value || ""))); });
        }
      }
      return parts.join(" ");
    } catch (e) { return ""; }
  }
  function headersAllSafe(hdrs) { try { return hdrs && hdrs.all ? hdrs.all() : []; } catch (e) { return []; } }
  function renderHeadersTable(title, rows, tableKey) {
    const body = (rows || []).map(r => {
      const k = escapeHtml(r.key || r.name || "");
      const v = escapeHtml(r.value || "");
      const search = (r.key || "") + " " + (r.value || "");
      return `<tr data-search="${escapeHtml(search)}"><td class="td k clickcopy" data-copy="${escapeHtml(String(r.key || ""))}">${k}</td><td class="td v clickcopy" data-copy="${escapeHtml(String(r.value || ""))}">${v}</td></tr>`;
    }).join("");
    return `
      <div class="card">
        <div class="card-head">
          <h2 class="card-title">${escapeHtml(title)}</h2>
          <div class="summary">
            <span class="pill"><span class="k">Count</span> <span class="v">${(rows || []).length}</span></span>
          </div>
        </div>
        <div class="body">
          <div class="tableBar">
            <div class="search mini">
              <span class="muted">🔎</span>
              <input class="viewSearch" data-target="${escapeHtml(tableKey)}" placeholder="Search…" />
            </div>
          </div>
          <div class="tableWrap">
            <table class="table">
              <thead><tr><th class="th">Key</th><th class="th">Value</th></tr></thead>
              <tbody id="${escapeHtml(tableKey)}Tbody">${body || `<tr><td class="td muted" colspan="2">No data</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }
  function isPlainObject(o) { return o && typeof o === "object" && !Array.isArray(o); }
  function isArrayOfObjects(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return false;
    const n = Math.min(arr.length, 60);
    let ok = 0;
    for (let i = 0; i < n; i++) if (isPlainObject(arr[i])) ok++;
    return (ok / n) >= 0.75;
  }
  function collectColumns(rows, maxCols) {
    const freq = {};
    const sample = Math.min(rows.length, 250);
    for (let i = 0; i < sample; i++) {
      const r = rows[i];
      if (!isPlainObject(r)) continue;
      Object.keys(r).forEach(k => { freq[k] = (freq[k] || 0) + 1; });
    }
    return Object.keys(freq).sort((a, b) => (freq[b] - freq[a]) || a.localeCompare(b)).slice(0, maxCols);
  }
  function safeInspectJson(val, limitChars) {
    try {
      const s = JSON.stringify(val, null, 2);
      if (s.length <= limitChars) return s;
      return s.slice(0, limitChars) + "\n…(truncated)…";
    } catch (e) { return String(val); }
  }
  function renderObjectTable(tableId, title, rows, totalCount, truncated) {
    const cols = collectColumns(rows, 12);
    const head = cols.map(c => `<th class="th">${escapeHtml(c)}</th>`).join("");
    const body = rows.map((r, idx) => {
      const tds = cols.map(c => {
        const v = r ? r[c] : undefined;
        const vt = typeOf(v);
        const path = `${title}[${idx}].${c}`;
        if (vt === "object" || vt === "array") {
          const badge = vt === "array" ? `Array(${(v || []).length})` : "Object";
          const inspect = escapeHtml(safeInspectJson(v, 9000));
          return `<td class="td"><span class="cell inspect" data-inspect="${inspect}" data-title="${escapeHtml(path)}"><span class="badge ${vt === "array" ? "b-arr" : "b-obj"}">${escapeHtml(badge)}</span></span></td>`;
        }
        const fv = formatValue(v);
        const raw = fv.raw;
        const copy = raw == null ? "" : String(raw);
        const search = `${c} ${copy}`;
        return `<td class="td"><span class="cell clickcopy" data-copy="${escapeHtml(copy)}" data-search="${escapeHtml(search)}">${fv.html}</span></td>`;
      }).join("");
      const rowSearch = cols.map(c => {
        const v = r ? r[c] : "";
        const vt = typeOf(v);
        if (vt === "object" || vt === "array") return c + ":" + vt;
        return c + ":" + String(v);
      }).join(" ");
      return `<tr class="tr" data-rowsearch="${escapeHtml(rowSearch)}">${tds}</tr>`;
    }).join("");
    const note = truncated ? `<span class="pill warn"><span class="k">Note</span> <span class="v">Showing ${rows.length}/${totalCount}</span></span>` : `<span class="pill"><span class="k">Rows</span> <span class="v">${totalCount}</span></span>`;
    return `
      <div class="card tableCard" data-tableid="${escapeHtml(tableId)}">
        <div class="card-head">
          <h2 class="card-title">📊 ${escapeHtml(title)}</h2>
          <div class="summary">
            ${note}
            <span class="pill"><span class="k">Cols</span> <span class="v">${cols.length}</span></span>
          </div>
        </div>
        <div class="body">
          <div class="tableBar">
            <div class="search mini">
              <span class="muted">🔎</span>
              <input class="tableSearch" data-tableid="${escapeHtml(tableId)}" placeholder="Search in table…" />
            </div>
            <div class="pager">
              <button class="btn small" data-action="prev" data-tableid="${escapeHtml(tableId)}">Prev</button>
              <span class="pill"><span class="k">Page</span> <span class="v" id="pageInfo_${escapeHtml(tableId)}">1</span></span>
              <button class="btn small" data-action="next" data-tableid="${escapeHtml(tableId)}">Next</button>
              <select class="select" data-tableid="${escapeHtml(tableId)}" id="pageSize_${escapeHtml(tableId)}">
                <option value="25">25</option>
                <option value="50" selected>50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
          <div class="tableWrap">
            <table class="table" id="table_${escapeHtml(tableId)}">
              <thead><tr>${head}</tr></thead>
              <tbody>${body || `<tr><td class="td muted" colspan="${cols.length}">No rows</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  function renderTree(value, path, depth, maxDepth, maxArrayItems) {
    const t = typeOf(value);
    const label = displayLabel(path);
    const pShort = pathShort(path);

    if (depth > maxDepth) {
      return `
        <div class="node" data-search="${escapeHtml(path)}" data-leaf="1">
          <div class="key clickcopy" data-copy="${escapeHtml(path)}" title="${escapeHtml(path)}">
            <span class="klabel">${escapeHtml(label)}</span>
            <span class="kpath hidden">${escapeHtml(pShort)}</span>
            <span class="badge b-err">maxDepth</span>
          </div>
          <div class="val"><span class="muted italic">Depth limit reached</span></div>
        </div>`;
    }

    if (t !== "object" && t !== "array") {
      const fv = formatValue(value);
      const search = `${path} ${t} ${fv.raw}`;
      const cls = (t === "string" ? "b-str" : t === "null" ? "b-null" : t === "boolean" ? "b-bool" : t === "number" ? "b-num" : t === "date" ? "b-date" : "b-obj");
      const rawCopy = fv.raw == null ? "" : String(fv.raw);
      return `
        <div class="node" data-search="${escapeHtml(search)}" data-leaf="1">
          <div class="kv">
            <div class="key clickcopy" data-copy="${escapeHtml(path)}" title="${escapeHtml(path)}">
              <span class="klabel">${escapeHtml(label)}</span>
              <span class="kpath hidden">${escapeHtml(pShort)}</span>
              <span class="badge ${cls}">${escapeHtml(t)}</span>
            </div>
            <div class="val clickcopy" data-copy="${escapeHtml(rawCopy)}" title="Click to copy value">${fv.html}</div>
          </div>
        </div>`;
    }

    if (t === "array") {
      const len = value.length;
      const title = (path === "$") ? `root [${len}]` : `${label} [${len}]`;
      let childrenHtml = "";
      const limit = Math.min(len, maxArrayItems);
      for (let i = 0; i < limit; i++) {
        const childPath = `${path}[${i}]`;
        childrenHtml += renderTree(value[i], childPath, depth + 1, maxDepth, maxArrayItems);
      }
      if (len > limit) {
        childrenHtml += `
          <div class="node" data-search="${escapeHtml(path)}" data-leaf="1">
            <div class="key clickcopy" data-copy="${escapeHtml(path)}" title="${escapeHtml(path)}">
              <span class="klabel">${escapeHtml(label)}</span>
              <span class="kpath hidden">${escapeHtml(pShort)}</span>
              <span class="badge b-arr">array</span>
            </div>
            <div class="val"><span class="muted italic">Showing ${limit}/${len} items</span></div>
          </div>`;
      }
      const search = `${path} array ${len}`;
      return `
        <details data-search="${escapeHtml(search)}" data-node="1">
          <summary title="${escapeHtml(path)}" class="clickcopy" data-copy="${escapeHtml(path)}">
            <div class="sum-left">
              <span class="caret"></span>
              <span class="sum-title">
                <span class="klabel">${escapeHtml(title)}</span>
                <span class="kpath hidden">${escapeHtml((path === "$" ? "root" : pShort) + " [" + len + "]")}</span>
              </span>
            </div>
            <div class="sum-meta">
              <span class="badge b-arr">array</span>
              <span class="badge">${len} items</span>
            </div>
          </summary>
          <div style="margin-top:10px;">
            ${childrenHtml || `
              <div class="node" data-search="${escapeHtml(path)} empty" data-leaf="1">
                <div class="key clickcopy" data-copy="${escapeHtml(path)}" title="${escapeHtml(path)}">
                  <span class="klabel">${escapeHtml(label)}</span>
                  <span class="kpath hidden">${escapeHtml(pShort)}</span>
                </div>
                <div class="val"><span class="muted italic">Empty array</span></div>
              </div>`}
          </div>
        </details>`;
    }

    const keys = Object.keys(value);
    const title = (path === "$") ? `root {${keys.length}}` : `${label} {${keys.length}}`;
    let childrenHtml = "";
    for (const k of keys) {
      const childPath = path === "$" ? `$.${k}` : `${path}.${k}`;
      childrenHtml += renderTree(value[k], childPath, depth + 1, maxDepth, maxArrayItems);
    }
    const search = `${path} object ${keys.join(" ")}`;
    return `
      <details data-search="${escapeHtml(search)}" data-node="1" open>
        <summary title="${escapeHtml(path)}" class="clickcopy" data-copy="${escapeHtml(path)}">
          <div class="sum-left">
            <span class="caret"></span>
            <span class="sum-title">
              <span class="klabel">${escapeHtml(title)}</span>
              <span class="kpath hidden">${escapeHtml((path === "$" ? "root" : pShort) + " {" + keys.length + "}")}</span>
            </span>
          </div>
          <div class="sum-meta">
            <span class="badge b-obj">object</span>
            <span class="badge">${keys.length} keys</span>
          </div>
        </summary>
        <div style="margin-top:10px;">
          ${childrenHtml || `
            <div class="node" data-search="${escapeHtml(path)} empty" data-leaf="1">
              <div class="key clickcopy" data-copy="${escapeHtml(path)}" title="${escapeHtml(path)}">
                <span class="klabel">${escapeHtml(label)}</span>
                <span class="kpath hidden">${escapeHtml(pShort)}</span>
              </div>
              <div class="val"><span class="muted italic">Empty object</span></div>
            </div>`}
        </div>
      </details>`;
  }

  const parsed = tryParseJson();

  const reqName = (pm.info && pm.info.requestName) ? pm.info.requestName : "";
  const reqMethod = (pm.request && pm.request.method) ? pm.request.method : "REQUEST";
  const reqUrl = (pm.request && pm.request.url) ? pm.request.url.toString() : "";
  const respCode = pm.response.code;
  const respStatus = pm.response.status;

  const respSizeBytes = (typeof pm.response.size === "function" ? (pm.response.size().body || 0) : 0);

  let reqBodyMode = "";
  let reqBodyText = "";
  try {
    if (pm.request && pm.request.body) {
      reqBodyMode = pm.request.body.mode || "";
      const b = pm.request.body;
      if (b.mode === "raw") reqBodyText = typeof b.raw === "string" ? b.raw : "";
      else if (b.mode === "urlencoded" && Array.isArray(b.urlencoded)) reqBodyText = b.urlencoded.map(p => (p.key || "") + "=" + (p.value || "")).join("\n");
      else if (b.mode === "formdata" && Array.isArray(b.formdata)) reqBodyText = b.formdata.map(p => (p.key || "") + "=" + (p.value || "")).join("\n");
    }
  } catch (e) {}

  const meta = {
    jsonOk: parsed.ok,
    name: reqName,
    method: reqMethod,
    url: reqUrl,
    contentType: parsed.contentType || "",
    status: respCode,
    statusText: respStatus,
    statusClass: statusClass(respCode),
    responseTime: pm.response.responseTime,
    size: formatBytes(respSizeBytes),
    parseError: parsed.error ? parsed.error : (parsed.ok ? "" : "Body is not JSON (or invalid JSON)"),
    raw: parsed.raw || "",
    rootType: parsed.ok ? typeOf(parsed.json) : "text",
    nodes: parsed.ok ? countNodes(parsed.json) : 0,
    pretty: "",
    curl: buildCurl(),
    reqBodyMode: reqBodyMode,
    reqBodyText: reqBodyText
  };

  let htmlTree = "";
  let htmlTables = "";
  let hasTables = false;

  if (parsed.ok) {
    const maxDepth = 14;
    const maxArrayItems = 250;
    htmlTree = renderTree(parsed.json, "$", 0, maxDepth, maxArrayItems);
    try { meta.pretty = JSON.stringify(parsed.json, null, 2); } catch (e) { meta.pretty = String(parsed.raw || ""); }

    const tableRowLimit = 500;
    const tables = [];
    if (Array.isArray(parsed.json) && isArrayOfObjects(parsed.json)) {
      const rows = parsed.json.slice(0, tableRowLimit);
      tables.push({ id: "root", title: "root", rows, total: parsed.json.length, truncated: parsed.json.length > tableRowLimit });
    } else if (isPlainObject(parsed.json)) {
      const keys = Object.keys(parsed.json);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = parsed.json[k];
        if (Array.isArray(v) && isArrayOfObjects(v)) {
          const rows = v.slice(0, tableRowLimit);
          tables.push({ id: "k_" + k, title: k, rows, total: v.length, truncated: v.length > tableRowLimit });
          if (tables.length >= 3) break;
        }
      }
    }
    if (tables.length) {
      hasTables = true;
      htmlTables = tables.map(t => renderObjectTable(t.id, t.title, t.rows, t.total, t.truncated)).join("");
    }
  }

  const respHeaders = headersAllSafe(pm.response.headers);
  const reqHeaders = headersAllSafe(pm.request && pm.request.headers);

  const htmlRespHeaders = renderHeadersTable("🧾 Response Headers", respHeaders, "respHeaders");
  const htmlReqHeaders = renderHeadersTable("📤 Request Headers", reqHeaders, "reqHeaders");

  const template = `
  <style>
    :root{
      --bg0:#0f111a; --bg1:#171a26; --bg2:#1f2333;
      --border:#2a2f45; --text:#f8f8f2; --muted:#a6accd;
      --pink:#ff79c6; --purple:#bd93f9; --cyan:#8be9fd; --green:#50fa7b;
      --yellow:#f1fa8c; --orange:#ffb86c; --red:#ff5555; --blue:#6272a4;
      --shadow: 0 10px 30px rgba(0,0,0,0.45); --radius: 14px;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial;
    }
    *{ box-sizing:border-box; }
    body{
      margin:0; padding:18px; font-family:var(--sans); color:var(--text);
      background: radial-gradient(1200px 600px at 30% 0%, rgba(189,147,249,0.18), transparent 60%),
                  radial-gradient(900px 600px at 70% 0%, rgba(139,233,253,0.14), transparent 60%),
                  linear-gradient(180deg, var(--bg0), var(--bg1));
      min-height:100vh;
    }
    .container{ max-width: 1200px; margin:0 auto; }
    .header{
      background: linear-gradient(180deg, rgba(31,35,51,0.9), rgba(23,26,38,0.9));
      border:1px solid var(--border); border-radius: var(--radius);
      padding: 18px 18px 14px; box-shadow: var(--shadow);
      overflow:hidden; position:relative;
    }
    .header::before{
      content:""; position:absolute; inset:-1px;
      background: linear-gradient(90deg, rgba(255,121,198,0.35), rgba(189,147,249,0.35), rgba(139,233,253,0.25));
      filter: blur(24px); opacity:0.35; z-index:0;
    }
    .header-inner{ position:relative; z-index:1; display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start; justify-content:space-between;}
    .title{ display:flex; flex-direction:column; gap:6px; min-width: 320px; }
    .title h1{ margin:0; font-size: 22px; letter-spacing:0.2px; display:flex; align-items:center; gap:10px; }
    .title .sub{ color: var(--muted); font-size: 13px; line-height: 1.3; font-family: var(--mono); opacity:0.95; word-break: break-word; }
    .controls{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
    .search{
      display:flex; align-items:center; gap:8px;
      background: rgba(15,17,26,0.55); border:1px solid var(--border);
      border-radius: 12px; padding: 10px 12px; min-width: 260px;
    }
    .search input{ width:100%; border:0; outline:none; background:transparent; color:var(--text); font-size: 13px; font-family: var(--mono); }
    .search.mini{ min-width: 220px; padding: 9px 11px; border-radius: 12px; }
    .btn{
      border:1px solid var(--border); background: rgba(15,17,26,0.55);
      color: var(--text); padding: 10px 12px; border-radius: 12px;
      cursor:pointer; font-size: 13px; font-family: var(--mono);
      transition: 120ms ease; user-select:none;
    }
    .btn:hover{ border-color: rgba(139,233,253,0.6); box-shadow: 0 0 0 3px rgba(139,233,253,0.12); }
    .btn.small{ padding: 8px 10px; border-radius: 10px; font-size: 12px; }
    .tabs{ display:flex; gap:8px; flex-wrap:wrap; }
    .tab{
      border:1px solid rgba(42,47,69,0.9); background: rgba(15,17,26,0.45);
      padding: 9px 12px; border-radius: 12px; cursor:pointer;
      font-family: var(--mono); font-size: 13px; color: var(--text);
      transition: 120ms ease; user-select:none;
    }
    .tab:hover{ border-color: rgba(189,147,249,0.55); box-shadow: 0 0 0 3px rgba(189,147,249,0.12); }
    .tab.active{ border-color: rgba(255,121,198,0.65); box-shadow: 0 0 0 3px rgba(255,121,198,0.12); }
    .grid{ margin-top: 14px; display:grid; grid-template-columns: 1fr; gap: 14px; }
    .card{
      background: linear-gradient(180deg, rgba(27,31,46,0.92), rgba(23,26,38,0.92));
      border:1px solid var(--border); border-radius: var(--radius);
      box-shadow: var(--shadow); overflow:hidden;
    }
    .card-head{
      padding: 14px 16px; border-bottom: 1px solid rgba(42,47,69,0.9);
      display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;
    }
    .card-title{
      margin:0; font-size: 14px; letter-spacing:0.2px;
      font-family: var(--mono); color: var(--muted);
      display:flex; align-items:center; gap:10px;
    }
    .summary{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .pill{
      display:inline-flex; align-items:center; gap:8px;
      padding: 6px 10px; border-radius: 999px;
      border:1px solid rgba(42,47,69,0.9); background: rgba(15,17,26,0.45);
      font-family: var(--mono); font-size: 12px; color: var(--text);
    }
    .pill.ok{ border-color: rgba(80,250,123,0.55); }
    .pill.warn{ border-color: rgba(241,250,140,0.55); }
    .pill.err{ border-color: rgba(255,85,85,0.55); }
    .pill .k{ color: var(--blue); }
    .pill .v{ color: var(--text); }
    .body{ padding: 14px 16px 16px; }
    .kv{ display:grid; grid-template-columns: 260px 1fr; gap: 10px 14px; align-items:start; }
    @media (max-width: 820px){ .kv{ grid-template-columns: 1fr; } }
    .key{
      font-family: var(--mono); font-size: 13px; color: var(--cyan);
      word-break: break-word; display:flex; align-items:center; gap:10px;
    }
    .val{ font-family: var(--mono); font-size: 13px; color: var(--text); word-break: break-word; }
    .node{ border:1px solid rgba(42,47,69,0.85); background: rgba(15,17,26,0.35); border-radius: 12px; padding: 10px 12px; }
    .node + .node{ margin-top: 10px; }
    details{ border:1px solid rgba(42,47,69,0.75); background: rgba(15,17,26,0.28); border-radius: 12px; padding: 10px 12px; }
    details + details{ margin-top: 10px; }
    summary{
      cursor:pointer; list-style:none; display:flex; align-items:center; justify-content:space-between;
      gap:12px; user-select:none; font-family: var(--mono);
    }
    summary::-webkit-details-marker{ display:none; }
    .sum-left{ display:flex; align-items:center; gap:10px; min-width:0; }
    .caret{
      width: 10px; height: 10px;
      border-right:2px solid var(--muted); border-bottom:2px solid var(--muted);
      transform: rotate(-45deg); transition: 120ms ease; margin-right: 2px; opacity:0.9; flex: 0 0 auto;
    }
    details[open] .caret{ transform: rotate(45deg); }
    .sum-title{ color: var(--pink); overflow:hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 720px; }
    .sum-meta{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
    .badge{
      display:inline-flex; align-items:center; padding: 3px 8px; border-radius: 999px;
      font-size: 12px; border:1px solid rgba(42,47,69,0.9);
      background: rgba(15,17,26,0.55); color: var(--text);
      font-family: var(--mono); line-height: 1.3;
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
      margin:0; white-space: pre-wrap; word-break: break-word;
      font-family: var(--mono); font-size: 12px; color: var(--text);
      background: rgba(15,17,26,0.45); border:1px solid rgba(42,47,69,0.85);
      border-radius: 12px; padding: 12px; max-height: 60vh; overflow:auto;
    }
    .hidden{ display:none !important; }
    .hit{ outline: 2px solid rgba(139,233,253,0.55); box-shadow: 0 0 0 4px rgba(139,233,253,0.12); border-radius: 10px; }
    .clickcopy{ cursor: copy; }
    .tableBar{ display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; margin-bottom: 10px; }
    .pager{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .select{
      border:1px solid rgba(42,47,69,0.9); background: rgba(15,17,26,0.45);
      color: var(--text); padding: 8px 10px; border-radius: 10px;
      font-family: var(--mono); font-size: 12px; outline:none;
    }
    .tableWrap{ overflow:auto; border:1px solid rgba(42,47,69,0.85); border-radius: 12px; background: rgba(15,17,26,0.28); }
    .table{ width:100%; border-collapse: collapse; font-family: var(--mono); font-size: 12px; }
    .th{
      position: sticky; top: 0;
      background: rgba(23,26,38,0.95);
      border-bottom: 1px solid rgba(42,47,69,0.9);
      text-align:left; padding: 10px;
      color: var(--muted);
    }
    .td{ padding: 10px; border-bottom: 1px solid rgba(42,47,69,0.6); vertical-align: top; }
    .td.k{ color: var(--cyan); width: 260px; }
    .td.v{ color: var(--text); }
    .cell{ display:inline-flex; gap:8px; align-items:center; }
    .inspect{ cursor: pointer; }
    .modal{
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display:flex; align-items:center; justify-content:center;
      padding: 18px; z-index: 9999;
    }
    .modalCard{
      width: min(980px, 100%);
      border:1px solid rgba(42,47,69,0.9);
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(27,31,46,0.98), rgba(23,26,38,0.98));
      box-shadow: var(--shadow);
      overflow:hidden;
    }
    .modalHead{
      padding: 12px 14px;
      border-bottom: 1px solid rgba(42,47,69,0.9);
      display:flex; align-items:center; justify-content:space-between; gap:10px;
      font-family: var(--mono); color: var(--muted);
    }
    .toast{
      position: fixed; right: 18px; bottom: 18px;
      background: rgba(15,17,26,0.92);
      border:1px solid rgba(42,47,69,0.9);
      border-radius: 12px;
      padding: 10px 12px;
      font-family: var(--mono); font-size: 12px;
      color: var(--text);
      box-shadow: var(--shadow);
      z-index: 10000;
      opacity: 0;
      transform: translateY(6px);
      transition: 160ms ease;
      pointer-events:none;
      max-width: 520px;
      word-break: break-word;
    }
    .toast.show{ opacity: 1; transform: translateY(0); }
    .kpath{ color: var(--blue); }
  </style>

  <div class="container">
    <div class="header">
      <div class="header-inner">
        <div class="title">
          <h1>🧪 API Visualizer <span class="badge b-obj">Dracula+</span></h1>
          <div class="sub">{{meta.method}} {{meta.url}} {{#if meta.name}}· <span class="muted">{{meta.name}}</span>{{/if}}</div>
          <div class="summary" style="margin-top:6px;">
            <span class="pill {{meta.statusClass}}"><span class="k">Status</span> <span class="v">{{meta.status}} {{meta.statusText}}</span></span>
            <span class="pill"><span class="k">Time</span> <span class="v">{{meta.responseTime}}ms</span></span>
            <span class="pill"><span class="k">Size</span> <span class="v">{{meta.size}}</span></span>
            <span class="pill"><span class="k">Root</span> <span class="v">{{meta.rootType}}</span></span>
            <span class="pill"><span class="k">Nodes</span> <span class="v">{{meta.nodes}}</span></span>
          </div>
        </div>

        <div class="controls">
          <div class="tabs" id="tabs">
            <button class="tab active" data-view="tree" type="button">Tree</button>
            <button class="tab" data-view="table" type="button">Table</button>
            <button class="tab" data-view="headers" type="button">Headers</button>
            <button class="tab" data-view="request" type="button">Request</button>
            <button class="tab" data-view="raw" type="button">Raw</button>
          </div>

          <div class="search">
            <span class="muted">🔎</span>
            <input id="globalSearch" placeholder="Search (current view)…  Ctrl+K" />
          </div>

          <button class="btn" id="togglePaths" type="button">Paths</button>
          <button class="btn" id="copyJson" type="button">Copy JSON</button>
          <button class="btn" id="copyCurl" type="button">Copy cURL</button>
          <button class="btn" id="expandAll" type="button">Expand</button>
          <button class="btn" id="collapseAll" type="button">Collapse</button>
        </div>
      </div>
    </div>

    <div class="grid">
      <div id="view_tree" class="view">
        <div class="card">
          <div class="card-head">
            <h2 class="card-title">🌲 Tree</h2>
            <div class="summary">
              <span class="pill"><span class="k">Type</span> <span class="v">{{meta.contentType}}</span></span>
            </div>
          </div>
          <div class="body">
            {{#if meta.jsonOk}}
              <div id="treeRoot">{{{htmlTree}}}</div>
            {{else}}
              <div class="node">
                <div class="key"><span class="badge b-err">Not JSON</span> <span class="muted">{{meta.parseError}}</span></div>
                <div style="margin-top:10px;"><pre class="raw" id="rawText">{{meta.raw}}</pre></div>
              </div>
            {{/if}}
          </div>
        </div>
      </div>

      <div id="view_table" class="view hidden">
        <div class="card">
          <div class="card-head">
            <h2 class="card-title">📊 Tables</h2>
            <div class="summary">
              <span class="pill"><span class="k">Detected</span> <span class="v">{{meta.tablesCount}}</span></span>
            </div>
          </div>
          <div class="body">
            {{#if meta.hasTables}}
              {{{htmlTables}}}
            {{else}}
              <div class="node">
                <div class="key"><span class="badge b-err">No tables</span> <span class="muted">No array-of-objects found at root or first-level keys.</span></div>
                <div class="val"><span class="muted italic">Tip: Table view triggers when payload contains an array of objects.</span></div>
              </div>
            {{/if}}
          </div>
        </div>
      </div>

      <div id="view_headers" class="view hidden">
        ${htmlRespHeaders}
      </div>

      <div id="view_request" class="view hidden">
        ${htmlReqHeaders}
        <div class="card">
          <div class="card-head">
            <h2 class="card-title">🧩 Request Body</h2>
            <div class="summary">
              <span class="pill"><span class="k">Mode</span> <span class="v">{{meta.reqBodyMode}}</span></span>
            </div>
          </div>
          <div class="body">
            <pre class="raw" id="reqBody"></pre>
          </div>
        </div>
        <div class="card">
          <div class="card-head">
            <h2 class="card-title">🧷 cURL</h2>
          </div>
          <div class="body">
            <pre class="raw" id="curlText">{{meta.curl}}</pre>
          </div>
        </div>
      </div>

      <div id="view_raw" class="view hidden">
        <div class="card">
          <div class="card-head">
            <h2 class="card-title">📄 Raw (pretty)</h2>
            <div class="summary"><span class="pill"><span class="k">Hint</span> <span class="v">CTRL/⌘+F</span></span></div>
          </div>
          <div class="body">
            {{#if meta.jsonOk}}
              <pre class="raw" id="prettyJson">{{meta.pretty}}</pre>
            {{else}}
              <pre class="raw" id="rawOnly">{{meta.raw}}</pre>
            {{/if}}
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="modal" class="modal hidden">
    <div class="modalCard">
      <div class="modalHead">
        <div id="modalTitle">Inspect</div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn small" id="modalCopy" type="button">Copy</button>
          <button class="btn small" id="modalClose" type="button">Close</button>
        </div>
      </div>
      <div style="padding: 14px;">
        <pre class="raw" id="modalBody"></pre>
      </div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    (function(){
      const HAS_TABLES = ${JSON.stringify(!!hasTables)};
      const TABLES_COUNT = ${JSON.stringify(hasTables ? (htmlTables ? (htmlTables.match(/data-tableid=/g) || []).length : 0) : 0)};
      const REQ_BODY = ${JSON.stringify(meta.reqBodyText || "")};

      const tabs = document.getElementById("tabs");
      const search = document.getElementById("globalSearch");
      const expandBtn = document.getElementById("expandAll");
      const collapseBtn = document.getElementById("collapseAll");
      const togglePathsBtn = document.getElementById("togglePaths");
      const copyJsonBtn = document.getElementById("copyJson");
      const copyCurlBtn = document.getElementById("copyCurl");

      const toast = document.getElementById("toast");
      function showToast(msg){
        if(!toast) return;
        toast.textContent = msg;
        toast.classList.add("show");
        clearTimeout(showToast._t);
        showToast._t = setTimeout(() => toast.classList.remove("show"), 1100);
      }

      async function copyToClipboard(text){
        text = String(text || "");
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
          }
        } catch(e){}
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          ta.style.top = "-9999px";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(ta);
          return ok;
        } catch(e){}
        return false;
      }

      function setView(view){
        document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
        const el = document.getElementById("view_" + view);
        if(el) el.classList.remove("hidden");
        document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
        if(search) search.value = "";
        clearHighlights();
      }

      function clearHighlights(){
        document.querySelectorAll(".hit").forEach(el => el.classList.remove("hit"));
        document.querySelectorAll("[data-search].hidden").forEach(el => el.classList.remove("hidden"));
        document.querySelectorAll("tr.hidden").forEach(el => {});
      }

      function activeViewName(){
        const t = document.querySelector(".tab.active");
        return t ? t.dataset.view : "tree";
      }

      function setAllDetails(open){
        const view = activeViewName();
        const root = document.getElementById("view_" + view);
        if(!root) return;
        root.querySelectorAll("details").forEach(d => d.open = open);
      }

      function filterTree(q){
        const root = document.getElementById("treeRoot");
        if(!root) return;
        const nodes = root.querySelectorAll("[data-search]");
        nodes.forEach(n => { n.classList.remove("hit"); n.classList.remove("hidden"); n.classList.remove("match"); });
        q = (q || "").trim().toLowerCase();
        if(!q) return;

        let matches = [];
        nodes.forEach(n => {
          const hay = (n.getAttribute("data-search") || "").toLowerCase();
          if(hay.includes(q)) { n.classList.add("match"); matches.push(n); }
        });
        if(matches.length === 0) return;

        nodes.forEach(n => n.classList.add("hidden"));

        matches.forEach(m => {
          m.classList.remove("hidden");
          m.classList.add("hit");
          let p = m.parentElement;
          while(p && p !== root){
            if(p.hasAttribute && p.hasAttribute("data-search")) p.classList.remove("hidden");
            if(p.tagName === "DETAILS") p.open = true;
            p = p.parentElement;
          }
        });
      }

      function filterTbody(tbodyId, q){
        const tbody = document.getElementById(tbodyId);
        if(!tbody) return;
        q = (q || "").trim().toLowerCase();
        const rows = tbody.querySelectorAll("tr[data-search]");
        rows.forEach(r => {
          const hay = (r.getAttribute("data-search") || "").toLowerCase();
          r.classList.toggle("hidden", q && !hay.includes(q));
        });
      }

      function tableState(id){
        const key = "__table_" + id;
        if(!tableState[key]) tableState[key] = { q: "", page: 1, pageSize: 50 };
        return tableState[key];
      }

      function paginateTable(id){
        const table = document.getElementById("table_" + id);
        if(!table) return;
        const st = tableState(id);
        const pageSizeSel = document.getElementById("pageSize_" + id);
        if(pageSizeSel) st.pageSize = Number(pageSizeSel.value || 50);

        const rows = Array.from(table.querySelectorAll("tbody tr.tr"));
        const q = (st.q || "").trim().toLowerCase();
        const filtered = rows.filter(r => {
          if(!q) return true;
          const hay = (r.getAttribute("data-rowsearch") || "").toLowerCase();
          return hay.includes(q);
        });

        const totalPages = Math.max(1, Math.ceil(filtered.length / st.pageSize));
        if(st.page > totalPages) st.page = totalPages;
        if(st.page < 1) st.page = 1;

        rows.forEach(r => r.classList.add("hidden"));
        const start = (st.page - 1) * st.pageSize;
        const slice = filtered.slice(start, start + st.pageSize);
        slice.forEach(r => r.classList.remove("hidden"));

        const pi = document.getElementById("pageInfo_" + id);
        if(pi) pi.textContent = st.page + "/" + totalPages + " (" + filtered.length + ")";
      }

      function filterCurrentView(q){
        const view = activeViewName();
        if(view === "tree") filterTree(q);
        else if(view === "headers") filterTbody("respHeadersTbody", q);
        else if(view === "request") filterTbody("reqHeadersTbody", q);
        else if(view === "table") {
          document.querySelectorAll(".tableCard").forEach(card => {
            const id = card.getAttribute("data-tableid");
            const st = tableState(id);
            st.q = q || "";
            st.page = 1;
            paginateTable(id);
          });
        }
      }

      if(tabs){
        tabs.addEventListener("click", (e) => {
          const btn = e.target.closest(".tab");
          if(!btn) return;
          const v = btn.dataset.view;
          if(v === "table" && !HAS_TABLES){ showToast("No tables detected"); return; }
          setView(v);
        });
      }

      if(expandBtn) expandBtn.addEventListener("click", () => setAllDetails(true));
      if(collapseBtn) collapseBtn.addEventListener("click", () => setAllDetails(false));

      let pathsOn = false;
      function applyPaths(){
        document.querySelectorAll(".kpath").forEach(el => el.classList.toggle("hidden", !pathsOn));
        document.querySelectorAll(".klabel").forEach(el => el.classList.toggle("hidden", pathsOn));
        showToast(pathsOn ? "Paths ON" : "Paths OFF");
      }
      if(togglePathsBtn) togglePathsBtn.addEventListener("click", () => { pathsOn = !pathsOn; applyPaths(); });

      if(copyJsonBtn) copyJsonBtn.addEventListener("click", async () => {
        const el = document.getElementById("prettyJson");
        const txt = el ? el.textContent : "";
        const ok = await copyToClipboard(txt);
        showToast(ok ? "Copied JSON" : "Copy failed");
      });

      if(copyCurlBtn) copyCurlBtn.addEventListener("click", async () => {
        const el = document.getElementById("curlText");
        const txt = el ? el.textContent : "";
        const ok = await copyToClipboard(txt);
        showToast(ok ? "Copied cURL" : "Copy failed");
      });

      if(search){
        let t = null;
        search.addEventListener("input", () => {
          clearTimeout(t);
          t = setTimeout(() => filterCurrentView(search.value), 120);
        });
      }

      const reqBodyEl = document.getElementById("reqBody");
      if(reqBodyEl) reqBodyEl.textContent = REQ_BODY;

      document.addEventListener("keydown", (e) => {
        if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k"){
          e.preventDefault();
          if(search) search.focus();
        }
        if(e.key === "Escape"){
          const modal = document.getElementById("modal");
          if(modal && !modal.classList.contains("hidden")){
            modal.classList.add("hidden");
            return;
          }
          if(search && search.value){
            search.value = "";
            clearHighlights();
            filterCurrentView("");
          }
        }
      });

      document.addEventListener("click", async (e) => {
        const cc = e.target.closest(".clickcopy");
        if(cc && cc.dataset.copy !== undefined){
          const ok = await copyToClipboard(cc.dataset.copy);
          if(ok) showToast("Copied");
          return;
        }
        const inspect = e.target.closest(".inspect");
        if(inspect && inspect.dataset.inspect !== undefined){
          const modal = document.getElementById("modal");
          const body = document.getElementById("modalBody");
          const title = document.getElementById("modalTitle");
          if(body) body.textContent = inspect.dataset.inspect || "";
          if(title) title.textContent = inspect.dataset.title || "Inspect";
          if(modal) modal.classList.remove("hidden");
          return;
        }
      });

      const modal = document.getElementById("modal");
      const modalClose = document.getElementById("modalClose");
      const modalCopy = document.getElementById("modalCopy");
      if(modalClose) modalClose.addEventListener("click", () => modal.classList.add("hidden"));
      if(modal) modal.addEventListener("click", (e) => { if(e.target === modal) modal.classList.add("hidden"); });
      if(modalCopy) modalCopy.addEventListener("click", async () => {
        const body = document.getElementById("modalBody");
        const txt = body ? body.textContent : "";
        const ok = await copyToClipboard(txt);
        showToast(ok ? "Copied" : "Copy failed");
      });

      document.querySelectorAll(".tableSearch").forEach(inp => {
        inp.addEventListener("input", () => {
          const id = inp.getAttribute("data-tableid");
          const st = tableState(id);
          st.q = inp.value || "";
          st.page = 1;
          paginateTable(id);
        });
      });

      document.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-tableid");
          const st = tableState(id);
          const action = btn.getAttribute("data-action");
          if(action === "prev") st.page--;
          if(action === "next") st.page++;
          paginateTable(id);
        });
      });

      document.querySelectorAll(".select").forEach(sel => {
        sel.addEventListener("change", () => {
          const id = sel.getAttribute("data-tableid");
          const st = tableState(id);
          st.page = 1;
          paginateTable(id);
        });
      });

      if(HAS_TABLES){
        document.querySelectorAll(".tableCard").forEach(card => {
          const id = card.getAttribute("data-tableid");
          paginateTable(id);
        });
      }
    })();
  </script>
  `;

  const payload = {
    meta: Object.assign({}, meta, {
      hasTables: !!hasTables,
      tablesCount: hasTables ? (htmlTables ? (htmlTables.match(/data-tableid=/g) || []).length : 0) : 0
    }),
    htmlTree: htmlTree,
    htmlTables: htmlTables
  };

  pm.visualizer.set(template, payload);
})();
