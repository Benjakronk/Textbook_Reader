/* Textbook Reader — read-only markdown viewer for students.
 *
 * Loads data/index.json (file tree + metadata) and data/search.json
 * (per-file body text) at startup, then runs entirely in the browser.
 * Markdown sources are fetched on demand from content/.
 */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    sidebar:        $("#sidebar"),
    tree:           $("#tree"),
    search:         $("#search"),
    results:        $("#search-results"),
    recentList:     $("#recent-list"),
    bookmarkList:   $("#bookmark-list"),
    shelfList:      $("#shelf-list"),
    btnNewShelf:    $("#btn-new-shelf"),
    tagList:        $("#tag-list"),
    crumbs:         $("#crumbs"),
    tabbar:         $("#tabbar"),
    paneView:       $(".pane-view"),
    paneSide:       $("#pane-side"),
    view:           $("#view"),
    sideView:       $("#side-view"),
    sideTitle:      $(".side-title"),
    sideClose:      $(".side-close"),
    toc:            $("#toc"),
    statusMsg:      $("#status-msg"),
    statusMeta:     $("#status-meta"),
    btnLeftToggle:  $("#btn-left-toggle"),
    btnTocToggle:   $("#btn-toc-toggle"),
    btnSideToggle:  $("#btn-side-toggle"),
    btnTheme:       $("#btn-theme"),
    btnHelp:        $("#btn-help"),
    btnTts:         $("#btn-tts"),
    btnFocus:       $("#btn-focus"),
    btnPrint:       $("#btn-print"),
    btnBookmark:    $("#btn-bookmark"),
    btnShelfAdd:    $("#btn-shelf-add"),
    btnMarkRead:    $("#btn-mark-read"),
    btnLibrary:     $("#btn-library"),
    btnGraph:       $("#btn-graph"),
    modalRoot:      $("#modal-root"),
    graphRoot:      $("#graph-root"),
  };

  const state = {
    tree: [],
    files: {},                  // path → record
    flatFiles: [],              // ordered list for navigation
    bodies: {},                 // path → body text (from search.json)
    current: null,              // alias for primary pane's active tab: { path }
    tabs: [],                   // [{ path }] open documents in the primary pane
    activeIdx: -1,              // index into tabs of the active primary tab
    sideTab: null,              // { path } or null — single document in side pane
    sideOpen: false,            // side pane visible
    activePaneKey: "primary",   // "primary" | "side" — controls section-nav keys
    activeTagFilter: null,
    recent: JSON.parse(localStorage.getItem("tb.recent") || "[]"),
    bookmarks: JSON.parse(localStorage.getItem("tb.bookmarks") || "[]"),
    scrollPositions: JSON.parse(localStorage.getItem("tb.scroll") || "{}"),
    progress: JSON.parse(localStorage.getItem("tb.progress") || "{}"),
    shelves: (() => {
      try {
        const raw = JSON.parse(localStorage.getItem("tb.shelves") || "[]");
        if (!Array.isArray(raw)) return [];
        return raw
          .filter(s => s && typeof s === "object" && s.id && typeof s.name === "string")
          .map(s => ({ id: s.id, name: s.name, paths: Array.isArray(s.paths) ? s.paths.filter(p => typeof p === "string") : [], created: s.created || 0 }));
      } catch { return []; }
    })(),
    currentSubject: null, // path of subject overview currently shown, if any
    currentShelf: null,   // path of bookshelf view currently shown
    currentMyShelf: null, // id of personal shelf currently shown
    libraryOpen: false,   // top-level library view active
    graphOpen: false,
    leftCollapsed: localStorage.getItem("tb.leftCollapsed") === "1",
    tocCollapsed: localStorage.getItem("tb.tocCollapsed") === "1",
    focusMode: false,
    theme: localStorage.getItem("tb.theme") || "default",
    fontFamily: localStorage.getItem("tb.font") || "sans",
    fontSize: parseInt(localStorage.getItem("tb.fontSize") || "17", 10),
    width: parseInt(localStorage.getItem("tb.width") || "880", 10),
  };

  // ============================================================
  // Helpers
  // ============================================================
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const cssEscape = (s) => s.replace(/["\\]/g, "\\$&");

  function setStatus(msg, kind = "") {
    els.statusMsg.textContent = msg;
    els.statusMsg.className = kind;
  }

  function findFileByName(name) {
    const target = name.toLowerCase().replace(/\.(md|markdown|txt)$/i, "");
    for (const f of state.flatFiles) {
      const stem = f.path.replace(/\.(md|markdown|txt)$/i, "").toLowerCase();
      if (stem === target) return f;
    }
    for (const f of state.flatFiles) {
      const base = f.name.replace(/\.(md|markdown|txt)$/i, "").toLowerCase();
      if (base === target) return f;
    }
    return null;
  }

  function flatten(tree, out = []) {
    for (const node of tree) {
      if (node.type === "file") out.push(node);
      else if (node.type === "dir") flatten(node.children || [], out);
    }
    return out;
  }

  function persistRecent() {
    localStorage.setItem("tb.recent", JSON.stringify(state.recent));
  }
  function persistBookmarks() {
    localStorage.setItem("tb.bookmarks", JSON.stringify(state.bookmarks));
  }
  function persistScroll() {
    localStorage.setItem("tb.scroll", JSON.stringify(state.scrollPositions));
  }
  function persistProgress() {
    localStorage.setItem("tb.progress", JSON.stringify(state.progress));
  }
  function persistSession() {
    const sess = {
      tabs: state.tabs.map(t => ({ path: t.path })),
      activeIdx: state.activeIdx,
      sideTab: state.sideTab ? { path: state.sideTab.path } : null,
      sideOpen: state.sideOpen,
    };
    localStorage.setItem("tb.session", JSON.stringify(sess));
  }
  function loadSession() {
    try {
      const raw = localStorage.getItem("tb.session");
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (!v || !Array.isArray(v.tabs)) return null;
      v.tabs = v.tabs.filter(t => t && t.path && state.files[t.path]);
      if (v.sideTab && !state.files[v.sideTab.path]) v.sideTab = null;
      if (v.activeIdx < 0 || v.activeIdx >= v.tabs.length) v.activeIdx = v.tabs.length ? 0 : -1;
      return v;
    } catch { return null; }
  }

  // ============================================================
  // Pane / tab helpers
  // ============================================================
  function primaryPath() { return state.tabs[state.activeIdx] ? state.tabs[state.activeIdx].path : null; }
  function sidePath() { return state.sideTab ? state.sideTab.path : null; }
  function activePath() {
    return state.activePaneKey === "side" ? sidePath() : primaryPath();
  }
  function tabIndexOf(path) { return state.tabs.findIndex(t => t.path === path); }
  function getPaneScroller(key) {
    return key === "side" ? els.sideView : els.paneView;
  }
  function getPaneView(key) {
    return key === "side" ? els.sideView : els.view;
  }
  function setActivePaneKey(key) {
    state.activePaneKey = key;
    document.querySelectorAll(".pane").forEach(p => {
      p.dataset.active = p.dataset.pane === key ? "1" : "0";
    });
  }
  function syncCurrent() {
    // state.current always mirrors the primary pane's active tab so existing
    // UI (crumbs, bookmark, mark-read, lesson nav) follows the primary tab.
    const p = primaryPath();
    state.current = p ? { path: p } : null;
  }

  // ============================================================
  // Reading progress
  // ============================================================
  // Per-file progress record: { state: "read" | "partial" | "unread", scrollPct, lastRead }
  function getProgress(path) {
    return state.progress[path] || { state: "unread", scrollPct: 0, lastRead: 0 };
  }
  function setProgress(path, patch) {
    const cur = getProgress(path);
    state.progress[path] = { ...cur, ...patch, lastRead: Date.now() };
    persistProgress();
    refreshProgressIndicators(path);
  }
  function progressBadge(path) {
    const p = getProgress(path);
    if (p.state === "read") return `<span class="prog-badge read" title="Lest">✓</span>`;
    if (p.state === "partial") return `<span class="prog-badge partial" title="Påbegynt (${Math.round(p.scrollPct)}%)">◐</span>`;
    return "";
  }
  function refreshProgressIndicators(path) {
    if (!path) return;
    const row = els.tree.querySelector(`.row.file[data-path="${cssEscape(path)}"]`);
    if (row) {
      const existing = row.querySelector(".prog-badge");
      if (existing) existing.remove();
      const html = progressBadge(path);
      if (html) row.insertAdjacentHTML("beforeend", html);
    }
    if (state.currentSubject) renderSubjectView(state.currentSubject);
    if (els.btnMarkRead) updateMarkReadBtn();
  }
  function toggleReadStatus() {
    if (!state.current) return;
    const cur = getProgress(state.current.path);
    if (cur.state === "read") setProgress(state.current.path, { state: "partial", scrollPct: cur.scrollPct || 0 });
    else setProgress(state.current.path, { state: "read", scrollPct: 100 });
    setStatus(getProgress(state.current.path).state === "read" ? "Markert som lest." : "Markert som ulest.", "ok");
  }
  function updateMarkReadBtn() {
    const on = state.current && getProgress(state.current.path).state === "read";
    els.btnMarkRead.textContent = on ? "✓ Lest" : "Marker som lest";
    els.btnMarkRead.classList.toggle("active", !!on);
  }

  // ============================================================
  // Bootstrap — load JSON, initialize UI
  // ============================================================
  async function bootstrap() {
    applyTheme(state.theme);
    applyFontFamily(state.fontFamily);
    applyFontSize(state.fontSize);
    applyWidth(state.width);
    if (state.leftCollapsed) document.body.classList.add("left-collapsed");
    if (state.tocCollapsed) $(".pane-view").classList.add("toc-collapsed");

    if (window.mermaid) {
      mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });
    }

    let index, search;
    try {
      [index, search] = await Promise.all([
        fetch("data/index.json").then(r => r.json()),
        fetch("data/search.json").then(r => r.json()),
      ]);
    } catch (e) {
      setStatus(`Klarte ikke å laste innholdet: ${e.message}`, "err");
      els.view.innerHTML = `<div class="welcome"><h1>Innholdet kunne ikke lastes</h1>
        <p>Kjør <code>python build.py</code> for å bygge indeksen, og prøv på nytt.</p></div>`;
      return;
    }

    state.tree = index.tree || [];
    state.files = index.files || {};
    state.flatFiles = flatten(state.tree);
    state.bodies = search.bodies || {};

    registerServiceWorker(index.built || "dev");

    renderTree();
    renderRecent();
    renderBookmarks();
    renderShelfSidebar();
    renderTags();
    setupMarkdown();
    wireEvents();

    // Restore session (tabs + side pane) if any.
    const sess = loadSession();
    if (sess) {
      state.tabs = sess.tabs.map(t => ({ path: t.path }));
      state.activeIdx = sess.activeIdx;
      state.sideTab = sess.sideTab ? { path: sess.sideTab.path } : null;
      state.sideOpen = !!sess.sideOpen && !!state.sideTab;
    }
    syncCurrent();
    renderTabs();
    renderSidePane();
    setActivePaneKey("primary");

    // Open from URL hash, then session, then last position, then landing.
    const hash = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    if (hash === "$library") {
      openLibrary();
    } else if (hash.startsWith("$shelf/")) {
      openShelf(hash.slice("$shelf/".length));
    } else if (hash.startsWith("$myshelf/")) {
      openMyShelf(hash.slice("$myshelf/".length));
    } else if (hash.startsWith("@")) {
      openSubject(hash.slice(1));
    } else if (hash && state.files[hash]) {
      openFile(hash);
    } else if (state.tabs.length > 0 && state.activeIdx >= 0) {
      openFile(state.tabs[state.activeIdx].path);
    } else {
      const last = localStorage.getItem("tb.lastPath");
      if (last && state.files[last]) openFile(last);
      else {
        const landing = findLandingPage();
        if (landing) openFile(landing);
        else openLibrary();
      }
    }
    // If a side pane was restored, re-fetch and render its content.
    if (state.sideTab) {
      const sp = state.sideTab.path;
      fetchMarkdown(sp).then(md => renderMarkdown(md, "side")).catch(() => {});
    }
    setStatus(`${state.flatFiles.length} sider lastet.`);
  }

  function registerServiceWorker(buildId) {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
    const v = encodeURIComponent(buildId);
    navigator.serviceWorker.register(`sw.js?v=${v}`).catch(() => {
      // SW registration is best-effort; app still works without it.
    });
  }

  function findLandingPage() {
    const candidates = [
      "krle-forside.md", "forside.md", "index.md", "welcome.md", "start.md",
    ];
    for (const f of state.flatFiles) {
      const stem = f.path.split("/").pop().toLowerCase();
      if (candidates.includes(stem)) return f.path;
      if (/(^|\/)forside\.md$/i.test(f.path)) return f.path;
    }
    return null;
  }

  // ============================================================
  // File tree
  // ============================================================
  function renderTree() {
    els.tree.innerHTML = renderTreeNodes(state.tree);
    els.tree.querySelectorAll(".row.file").forEach((row) => {
      row.addEventListener("click", () => openFile(row.dataset.path));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openTreeContextMenu(e.clientX, e.clientY, row.dataset.path);
      });
      row.addEventListener("auxclick", (e) => {
        if (e.button === 1) { e.preventDefault(); openFile(row.dataset.path, { target: "newTab" }); }
      });
      // Drag a tree row to drop on a shelf in the sidebar.
      row.setAttribute("draggable", "true");
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/x-tb-path", row.dataset.path);
        e.dataTransfer.effectAllowed = "copyMove";
      });
    });
    els.tree.querySelectorAll(".row.dir").forEach((row) => {
      row.addEventListener("click", (e) => {
        const ul = row.parentElement.querySelector(":scope > ul");
        // Click on chevron just toggles expansion. Click elsewhere on the
        // row also expands AND opens the subject overview.
        const onChevron = e.target.closest(".icon");
        if (!onChevron) {
          openSubject(row.dataset.path);
          if (ul) { row.classList.remove("collapsed"); ul.style.display = ""; }
          return;
        }
        row.classList.toggle("collapsed");
        if (ul) ul.style.display = row.classList.contains("collapsed") ? "none" : "";
      });
    });
    applyTagFilter();
    highlightActive();
  }

  function renderTreeNodes(nodes) {
    if (!nodes.length) return "<div style='color:var(--text-mute);padding:8px'>Ingen filer ennå.</div>";
    const items = nodes.map((node) => {
      if (node.type === "dir") {
        return `<li>
          <div class="row dir" data-path="${escapeHtml(node.path)}" title="${escapeHtml(node.path)} — klikk for oversikt, pil for å skjule">
            <span class="icon">▾</span>
            <span class="label">${escapeHtml(node.name)}</span>
          </div>
          <ul>${renderTreeNodes(node.children || [])}</ul>
        </li>`;
      }
      const rec = state.files[node.path];
      const title = rec ? rec.title : node.name.replace(/\.(md|markdown|txt)$/i, "");
      return `<li>
        <div class="row file" data-path="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}">
          <span class="label">${escapeHtml(title)}</span>${progressBadge(node.path)}
        </div>
      </li>`;
    });
    return `<ul>${items.join("")}</ul>`;
  }

  function highlightActive() {
    els.tree.querySelectorAll(".row.file.active").forEach((r) => r.classList.remove("active"));
    if (!state.current) return;
    const row = els.tree.querySelector(`.row.file[data-path="${cssEscape(state.current.path)}"]`);
    if (row) {
      row.classList.add("active");
      // Open ancestor directories.
      let p = row.parentElement;
      while (p && p !== els.tree) {
        if (p.tagName === "UL") p.style.display = "";
        const dirRow = p.parentElement && p.parentElement.querySelector(":scope > .row.dir");
        if (dirRow) dirRow.classList.remove("collapsed");
        p = p.parentElement;
      }
      row.scrollIntoView({ block: "nearest" });
    }
  }

  // ============================================================
  // Markdown rendering pipeline
  // ============================================================
  const SAFE_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|news|irc|ircs|wiki|wiki-broken|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

  function setupMarkdown() {
    marked.setOptions({ breaks: false, gfm: true });
    marked.use({
      renderer: {
        code(code, infostring) {
          const lang = (infostring || "").trim().split(/\s+/)[0];
          if (lang === "mermaid") {
            return `<div class="mermaid">${escapeHtml(code)}</div>`;
          }
          let html;
          try {
            if (lang && hljs.getLanguage(lang)) {
              html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
            } else {
              html = hljs.highlightAuto(code).value;
            }
          } catch {
            html = escapeHtml(code);
          }
          return `<pre><code class="hljs language-${escapeHtml(lang)}">${html}</code></pre>`;
        },
        image(href, title, text) {
          const safe = resolveAsset(href);
          return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text || "")}"${title ? ` title="${escapeHtml(title)}"` : ""} loading="lazy" />`;
        },
      },
    });
  }

  function resolveAsset(href) {
    if (!href) return href;
    if (/^(https?:|data:|blob:)/i.test(href)) return href;
    if (!state.current) return href;
    const dir = state.current.path.split("/").slice(0, -1).join("/");
    const joined = (dir ? dir + "/" : "") + href.replace(/^\.\//, "");
    return "content/" + joined.split("/").map(encodeURIComponent).join("/");
  }

  function stripFrontmatterForRender(md) {
    return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  }

  function transformOutsideCode(md, fn) {
    const fenceRe = /^(\s*)(```|~~~)/;
    let inFence = false;
    const out = [];
    for (const line of md.split("\n")) {
      if (fenceRe.test(line)) { inFence = !inFence; out.push(line); continue; }
      if (inFence) { out.push(line); continue; }
      let acc = "";
      let i = 0;
      while (i < line.length) {
        const m = line.slice(i).match(/`[^`\n]+`/);
        if (!m) { acc += fn(line.slice(i)); break; }
        acc += fn(line.slice(i, i + m.index));
        acc += m[0];
        i += m.index + m[0].length;
      }
      out.push(acc);
    }
    return out.join("\n");
  }

  function transformWikiLinks(md) {
    return transformOutsideCode(md, (chunk) =>
      chunk.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_, target, label) => {
        const t = target.trim();
        const l = (label || t).trim();
        const hit = findFileByName(t);
        if (hit) return `[${l}](wiki:${encodeURIComponent(hit.path)})`;
        return `[${l}](wiki-broken:${encodeURIComponent(t)})`;
      })
    );
  }

  function transformEmbeds(md) {
    return transformOutsideCode(md, (chunk) =>
      chunk.replace(/!\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_, target, label) => {
        const t = target.trim();
        const l = (label || t).trim();
        return `\n\n<div class="embed" data-embed="${escapeHtml(t)}" data-label="${escapeHtml(l)}">Laster <code>${escapeHtml(t)}</code>…</div>\n\n`;
      })
    );
  }

  function transformCallouts(md) {
    const ICONS = { note: "📝", info: "ℹ️", tip: "💡", warning: "⚠️", danger: "⛔",
                    success: "✅", question: "❓", quote: "❝", abstract: "📘", example: "🧪" };
    return md.replace(
      /(^|\n)((?:>[ \t]*\[!(\w+)\][^\n]*\n)(?:(?:>[^\n]*\n?)*))/g,
      (_, lead, block) => {
        const lines = block.split("\n").filter(l => l.length);
        const head = lines[0].match(/^>[ \t]*\[!(\w+)\][ \t]*(.*)$/);
        if (!head) return lead + block;
        const t = head[1].toLowerCase();
        const title = (head[2] || head[1]).trim();
        const bodyLines = lines.slice(1).map(l => l.replace(/^>[ \t]?/, ""));
        const bodyMd = bodyLines.join("\n").trim();
        const bodyHtml = bodyMd ? marked.parse(bodyMd) : "";
        const icon = ICONS[t] || "📌";
        return `${lead}\n<div class="callout callout-${t}">
<div class="callout-title"><span class="callout-icon">${icon}</span> ${escapeHtml(title)}</div>
<div class="callout-body">${bodyHtml}</div>
</div>\n\n`;
      }
    );
  }

  function transformFootnotes(md) {
    const defs = new Map();
    const cleaned = md.replace(/^\[\^([^\]]+)\]:\s*(.+(?:\n[ \t]+.+)*)/gm, (_, id, text) => {
      defs.set(id, text.replace(/\n[ \t]+/g, " ").trim());
      return "";
    });
    if (defs.size === 0) return md;
    const used = new Map();
    const body = cleaned.replace(/\[\^([^\]]+)\]/g, (m, id) => {
      if (!defs.has(id)) return m;
      if (!used.has(id)) used.set(id, used.size + 1);
      const n = used.get(id);
      return `<sup class="footnote-ref"><a id="fnref-${id}" href="#fn-${id}">${n}</a></sup>`;
    });
    if (used.size === 0) return body;
    let foot = `\n\n<hr class="footnotes-sep">\n<ol class="footnotes">\n`;
    for (const [id] of used) {
      const text = defs.get(id);
      const inline = marked.parseInline ? marked.parseInline(text) : text;
      foot += `<li id="fn-${id}">${inline} <a href="#fnref-${id}" class="footnote-back" aria-label="Tilbake til tekst">↩</a></li>\n`;
    }
    foot += `</ol>\n`;
    return body + foot;
  }

  function transformPageBreaks(md) {
    return md.replace(/^[ \t]*(?:\\page(?:break)?|<!--\s*pagebreak\s*-->)[ \t]*$/gim,
      '\n\n<hr class="pagebreak" />\n\n');
  }

  function transformHighlight(md) {
    return md.replace(/==(?!\s)([^\n=]+?)(?<!\s)==/g, (_, t) => `<mark>${t}</mark>`);
  }

  function transformSubSup(md) {
    let out = md.replace(/(?<![~\\])~([^\s~][^~\n]*?[^\s~]|[^\s~])~(?!~)/g, (_, t) => `<sub>${t}</sub>`);
    out = out.replace(/(?<![\[\\])\^([^\s\^]+?)\^/g, (_, t) => `<sup>${t}</sup>`);
    return out;
  }

  function renderMarkdown(md, paneKey = "primary") {
    const root = getPaneView(paneKey);
    const body = stripFrontmatterForRender(md);
    const transformed = transformCallouts(
      transformEmbeds(
        transformWikiLinks(
          transformHighlight(
            transformSubSup(
              transformPageBreaks(transformFootnotes(body)))))));
    const rawHtml = marked.parse(transformed);
    const clean = DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ["target", "id"],
      ALLOWED_URI_REGEXP: SAFE_URI,
    });
    root.innerHTML = clean;

    hydrateEmbeds(root);
    wireWikiLinks(root);
    wireExternalLinks(root);
    addHeadingIds(root);

    if (window.renderMathInElement) {
      try {
        renderMathInElement(root, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\[", right: "\\]", display: true },
            { left: "\\(", right: "\\)", display: false },
          ],
          throwOnError: false,
        });
      } catch {}
    }

    if (window.mermaid) {
      root.querySelectorAll(".mermaid").forEach(async (el, i) => {
        try {
          const id = "mmd-svg-" + paneKey + "-" + Date.now() + "-" + i;
          const code = el.textContent;
          const { svg } = await mermaid.render(id, code);
          el.innerHTML = svg;
        } catch (err) {
          el.textContent = "Mermaid-feil: " + err.message;
          el.style.color = "var(--danger)";
        }
      });
    }

    if (paneKey === "primary") {
      renderTOC();
      updateStatusMeta();
      prepareTTS();
    }
  }

  function wireWikiLinks(root) {
    root.querySelectorAll('a[href^="wiki:"], a[href^="wiki-broken:"]').forEach((a) => {
      const href = a.getAttribute("href");
      const broken = href.startsWith("wiki-broken:");
      const target = decodeURIComponent(href.replace(/^wiki(-broken)?:/, ""));
      a.classList.add("wikilink");
      if (broken) {
        a.classList.add("broken");
        a.title = `Ingen side med navnet "${target}"`;
        a.addEventListener("click", (e) => e.preventDefault());
      } else {
        a.title = target;
        a.addEventListener("click", (e) => { e.preventDefault(); openFile(target); });
      }
    });
  }

  function wireExternalLinks(root) {
    root.querySelectorAll('a[href^="http://"], a[href^="https://"]').forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
  }

  function addHeadingIds(root) {
    let n = 0;
    root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
      n++;
      h.id = h.id || "h-" + n + "-" + (h.textContent || "").toLowerCase().replace(/[^\wæøå]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40);
    });
  }

  function hydrateEmbeds(root) {
    root.querySelectorAll(".embed[data-embed]").forEach(async (el) => {
      const target = el.dataset.embed;
      const label = el.dataset.label || target;
      const hit = findFileByName(target);
      if (!hit) {
        el.classList.add("broken");
        el.innerHTML = `<em>Manglende kilde:</em> <code>${escapeHtml(target)}</code>`;
        return;
      }
      try {
        const md = await fetchMarkdown(hit.path);
        const body = stripFrontmatterForRender(md);
        const transformed = transformCallouts(
          transformWikiLinks(transformHighlight(transformSubSup(transformPageBreaks(body)))));
        const html = DOMPurify.sanitize(marked.parse(transformed), {
          ADD_ATTR: ["target", "id"], ALLOWED_URI_REGEXP: SAFE_URI,
        });
        el.classList.remove("broken");
        el.innerHTML = `
          <div class="embed-head">
            <span class="embed-label">${escapeHtml(label)}</span>
            <a href="#" data-open class="embed-path">${escapeHtml(hit.path)}</a>
          </div>
          <div class="embed-body markdown-body">${html}</div>`;
        wireWikiLinks(el);
        wireExternalLinks(el);
        el.querySelector("[data-open]").addEventListener("click", (e) => {
          e.preventDefault(); openFile(hit.path);
        });
      } catch (err) {
        el.classList.add("broken");
        el.innerHTML = `<em>Klarte ikke å laste:</em> <code>${escapeHtml(target)}</code>`;
      }
    });
  }

  // ============================================================
  // TOC + scroll-spy
  // ============================================================
  function renderTOC() {
    const headings = els.view.querySelectorAll("h1, h2, h3, h4");
    if (!headings.length) {
      els.toc.innerHTML = "";
      return;
    }
    const items = ['<h5>Innhold</h5><ul>'];
    headings.forEach((h) => {
      const lvl = h.tagName.toLowerCase();
      items.push(`<li class="${lvl}" data-id="${escapeHtml(h.id)}">${escapeHtml(h.textContent)}</li>`);
    });
    items.push("</ul>");
    els.toc.innerHTML = items.join("");
    els.toc.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", () => {
        const t = els.view.querySelector("#" + (CSS.escape ? CSS.escape(li.dataset.id) : li.dataset.id));
        if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    setupScrollSpy();
  }

  let _scrollSpyHandler = null;
  function setupScrollSpy() {
    const scroller = $(".pane-view");
    if (!scroller) return;
    if (_scrollSpyHandler) scroller.removeEventListener("scroll", _scrollSpyHandler);
    const tocItems = Array.from(els.toc.querySelectorAll("li[data-id]"));
    if (!tocItems.length) return;
    const tocById = new Map(tocItems.map((li) => [li.dataset.id, li]));
    let raf = null;
    _scrollSpyHandler = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const top = scroller.getBoundingClientRect().top + 100;
        let active = null;
        const headings = els.view.querySelectorAll("h1, h2, h3, h4");
        for (const h of headings) {
          if (h.getBoundingClientRect().top <= top) active = h.id;
          else break;
        }
        tocItems.forEach((li) => li.classList.toggle("active", li.dataset.id === active));
        if (active) {
          const li = tocById.get(active);
          if (li) {
            const tocEl = els.toc;
            const liTop = li.offsetTop, liH = li.offsetHeight;
            const tocSt = tocEl.scrollTop, tocH = tocEl.clientHeight;
            if (liTop < tocSt) tocEl.scrollTop = Math.max(0, liTop - 20);
            else if (liTop + liH > tocSt + tocH) tocEl.scrollTop = liTop + liH - tocH + 20;
          }
        }
        // Persist scroll position + reading progress for the current file.
        if (state.current) {
          state.scrollPositions[state.current.path] = scroller.scrollTop;
          if (_scrollPersistTimer) clearTimeout(_scrollPersistTimer);
          _scrollPersistTimer = setTimeout(persistScroll, 500);
          updateAutoProgress(scroller);
        }
      });
    };
    scroller.addEventListener("scroll", _scrollSpyHandler, { passive: true });
  }
  let _scrollPersistTimer = null;

  function updateAutoProgress(scroller) {
    if (!state.current) return;
    const path = state.current.path;
    const total = scroller.scrollHeight - scroller.clientHeight;
    const pct = total > 0 ? Math.min(100, (scroller.scrollTop / total) * 100) : 100;
    const cur = getProgress(path);
    // Don't downgrade an explicit "read" or auto-finish.
    if (cur.state === "read") return;
    let nextState = cur.state;
    if (pct >= 90) nextState = "read";
    else if (pct >= 5) nextState = "partial";
    if (nextState !== cur.state || Math.abs((cur.scrollPct || 0) - pct) > 2) {
      setProgress(path, { state: nextState, scrollPct: pct });
    }
  }

  // ============================================================
  // Subject view (auto-generated overview for a folder)
  // ============================================================
  function findTreeNode(path) {
    const parts = path.split("/").filter(Boolean);
    let cur = { children: state.tree };
    for (const part of parts) {
      if (!cur.children) return null;
      cur = cur.children.find(c => c.name === part);
      if (!cur) return null;
    }
    return cur;
  }

  function collectFilesInSubject(node) {
    const out = [];
    function walk(n) {
      for (const c of n.children || []) {
        if (c.type === "file") out.push(c);
        else walk(c);
      }
    }
    walk(node);
    return out;
  }

  function progressSummary(files) {
    let read = 0, partial = 0;
    for (const f of files) {
      const p = getProgress(f.path);
      if (p.state === "read") read++;
      else if (p.state === "partial") partial++;
    }
    return { total: files.length, read, partial, unread: files.length - read - partial };
  }

  async function openSubject(path) {
    const node = findTreeNode(path);
    if (!node || node.type !== "dir") return;
    if (typeof ttsStop === "function") ttsStop();
    state.current = null;
    state.currentSubject = path;
    state.currentShelf = null;
    state.libraryOpen = false;
    document.body.classList.remove("library-mode");
    history.replaceState(null, "", "#" + encodeURI("@" + path));
    renderSubjectView(path);
    setStatus(`Oversikt: ${path}`);
    highlightActive();
  }

  function renderSubjectView(path) {
    const node = findTreeNode(path);
    if (!node) return;
    const directFiles = (node.children || []).filter(c => c.type === "file");
    const subDirs = (node.children || []).filter(c => c.type === "dir");
    const allFiles = collectFilesInSubject(node);
    const summary = progressSummary(allFiles);
    const totalWords = allFiles.reduce((n, f) => n + (state.files[f.path]?.word_count || 0), 0);
    const totalMin = Math.max(1, Math.round(totalWords / 220));

    const fileCard = (f) => {
      const rec = state.files[f.path] || {};
      const prog = getProgress(f.path);
      const pct = prog.state === "read" ? 100 : Math.round(prog.scrollPct || 0);
      const fm = rec.frontmatter || {};
      const summary = fm.summary || fm.sammendrag || "";
      const tags = (rec.tags || []).slice(0, 4);
      return `
        <a class="subj-card prog-${prog.state}" data-path="${escapeHtml(f.path)}" href="#${encodeURI(f.path)}">
          <div class="subj-card-head">
            <span class="subj-title">${escapeHtml(rec.title || f.name)}</span>
            <span class="subj-prog" title="${prog.state === 'read' ? 'Lest' : prog.state === 'partial' ? `Påbegynt (${pct}%)` : 'Ikke lest'}">${prog.state === 'read' ? '✓' : prog.state === 'partial' ? '◐' : '○'}</span>
          </div>
          ${summary ? `<div class="subj-summary">${escapeHtml(summary)}</div>` : ""}
          <div class="subj-meta">
            <span>${rec.word_count || 0} ord · ${Math.max(1, Math.round((rec.word_count || 0) / 220))} min</span>
            ${tags.length ? `<span class="subj-tags">${tags.map(t => `#${escapeHtml(t)}`).join(" ")}</span>` : ""}
          </div>
          ${prog.state === "partial" ? `<div class="subj-progbar"><span style="width:${pct}%"></span></div>` : ""}
        </a>`;
    };

    const subDirSection = (d) => {
      const files = collectFilesInSubject(d);
      const sum = progressSummary(files);
      const dirPath = d.path;
      return `
        <section class="subj-subsection">
          <h2 class="subj-subhead"><a class="subj-dir-link" data-dir="${escapeHtml(dirPath)}" href="#@${encodeURI(dirPath)}">${escapeHtml(d.name)}</a>
            <span class="subj-progress-pill">${sum.read}/${sum.total} lest</span>
          </h2>
          <div class="subj-grid">
            ${files.map(fileCard).join("")}
          </div>
        </section>`;
    };

    const html = `
      <div class="subject-view">
        <header class="subj-header">
          <div class="subj-crumbs">${path.split("/").map(escapeHtml).join(" / ")}</div>
          <h1 class="subj-title-big">${escapeHtml(node.name)}</h1>
          <div class="subj-stats">
            <span class="stat"><strong>${summary.read}</strong>/${summary.total} sider lest</span>
            <span class="stat"><strong>${summary.partial}</strong> påbegynt</span>
            <span class="stat"><strong>${totalMin}</strong> min total lesetid</span>
          </div>
          <div class="subj-progress-track">
            <span class="read-fill" style="width:${summary.total ? (summary.read / summary.total * 100) : 0}%"></span>
            <span class="partial-fill" style="width:${summary.total ? (summary.partial / summary.total * 100) : 0}%"></span>
          </div>
          ${continueButton(allFiles)}
        </header>
        ${directFiles.length ? `<div class="subj-grid">${directFiles.map(fileCard).join("")}</div>` : ""}
        ${subDirs.map(subDirSection).join("")}
      </div>`;

    els.view.innerHTML = html;
    els.toc.innerHTML = "";
    updateCrumbs();
    updateStatusMeta();

    els.view.querySelectorAll(".subj-card").forEach(a => {
      a.addEventListener("click", (e) => { e.preventDefault(); openFile(a.dataset.path); });
    });
    els.view.querySelectorAll(".subj-dir-link").forEach(a => {
      a.addEventListener("click", (e) => { e.preventDefault(); openSubject(a.dataset.dir); });
    });
    els.view.querySelectorAll("[data-resume]").forEach(b => {
      b.addEventListener("click", (e) => { e.preventDefault(); openFile(b.dataset.resume); });
    });

    const scroller = $(".pane-view");
    if (scroller) scroller.scrollTop = 0;
  }

  function continueButton(allFiles) {
    // Find the first unread or partial page (in lesson order) so the student can resume.
    const ordered = allFiles
      .map(f => state.files[f.path])
      .filter(Boolean)
      .sort((a, b) => {
        const ao = numericOrder(a), bo = numericOrder(b);
        if (ao !== bo) return ao - bo;
        return a.path.localeCompare(b.path, "nb");
      });
    let target = ordered.find(r => getProgress(r.path).state === "partial");
    if (!target) target = ordered.find(r => getProgress(r.path).state === "unread");
    if (!target) return "";
    return `<button class="subj-continue" data-resume="${escapeHtml(target.path)}">Fortsett der du slapp → <span>${escapeHtml(target.title)}</span></button>`;
  }

  // ============================================================
  // File open
  // ============================================================
  async function fetchMarkdown(path) {
    if (state.bodies[path]) return state.bodies[path];
    const r = await fetch("content/" + path.split("/").map(encodeURIComponent).join("/"));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  }

  // target: "current" (default) | "newTab" | "side"
  async function openFile(path, opts = {}) {
    const target = opts.target || "current";
    const rec = state.files[path];
    if (!rec) {
      setStatus(`Ukjent side: ${path}`, "err");
      return;
    }
    if (target === "side") return openInSidePane(path);
    try {
      const md = await fetchMarkdown(path);
      const existingIdx = tabIndexOf(path);
      if (existingIdx >= 0) {
        state.activeIdx = existingIdx;
      } else {
        state.tabs.push({ path });
        state.activeIdx = state.tabs.length - 1;
      }
      syncCurrent();
      setActivePaneKey("primary");
      state.currentSubject = null;
      state.currentShelf = null;
      state.libraryOpen = false;
      document.body.classList.remove("library-mode");
      localStorage.setItem("tb.lastPath", path);
      pushRecent(path);
      renderTabs();
      updateCrumbs();
      renderMarkdown(md, "primary");
      highlightActive();
      updateBookmarkBtn();
      updateMarkReadBtn();
      const scroller = els.paneView;
      const saved = state.scrollPositions[path];
      requestAnimationFrame(() => {
        scroller.scrollTop = typeof saved === "number" ? saved : 0;
      });
      const hash = "#" + encodeURI(path);
      if (location.hash !== hash) history.replaceState(null, "", hash);
      persistSession();
      setStatus(`Åpnet ${rec.title}`);
    } catch (e) {
      setStatus(`Klarte ikke å åpne: ${e.message}`, "err");
    }
  }

  async function openInSidePane(path) {
    const rec = state.files[path];
    if (!rec) { setStatus(`Ukjent side: ${path}`, "err"); return; }
    try {
      const md = await fetchMarkdown(path);
      state.sideTab = { path };
      state.sideOpen = true;
      setActivePaneKey("side");
      renderSidePane();
      renderMarkdown(md, "side");
      const saved = state.scrollPositions[path];
      requestAnimationFrame(() => {
        els.sideView.scrollTop = typeof saved === "number" ? saved : 0;
      });
      persistSession();
      setStatus(`Åpnet i sidepanel: ${rec.title}`);
    } catch (e) {
      setStatus(`Klarte ikke å åpne sidepanel: ${e.message}`, "err");
    }
  }

  function closeSidePane() {
    state.sideTab = null;
    state.sideOpen = false;
    setActivePaneKey("primary");
    renderSidePane();
    persistSession();
    if (state.tabs.length === 0) openLibrary();
  }

  function renderSidePane() {
    document.body.classList.toggle("side-open", state.sideOpen && !!state.sideTab);
    els.paneSide.classList.toggle("hidden", !(state.sideOpen && state.sideTab));
    els.btnSideToggle.classList.toggle("active", state.sideOpen && !!state.sideTab);
    if (state.sideTab) {
      const rec = state.files[state.sideTab.path];
      els.sideTitle.textContent = rec ? rec.title : state.sideTab.path;
      els.sideTitle.title = state.sideTab.path;
    } else {
      els.sideTitle.textContent = "";
      els.sideView.innerHTML = "";
    }
  }

  // ============================================================
  // Tabbar
  // ============================================================
  function renderTabs() {
    if (!state.tabs.length) {
      els.tabbar.innerHTML = "";
      return;
    }
    const html = state.tabs.map((t, i) => {
      const rec = state.files[t.path] || {};
      const title = rec.title || t.path.split("/").pop().replace(/\.(md|markdown|txt)$/i, "");
      return `
        <div class="tab${i === state.activeIdx ? " active" : ""}" data-idx="${i}" draggable="true" title="${escapeHtml(t.path)}">
          <span class="tab-title">${escapeHtml(title)}</span>
          <button class="tab-close" data-act="close" aria-label="Lukk fane">×</button>
        </div>`;
    }).join("");
    els.tabbar.innerHTML = html;
    els.tabbar.querySelectorAll(".tab").forEach((el) => {
      const idx = parseInt(el.dataset.idx, 10);
      el.addEventListener("click", (e) => {
        if (e.target.closest('[data-act="close"]')) return;
        setActiveTab(idx);
      });
      el.addEventListener("auxclick", (e) => {
        if (e.button === 1) { e.preventDefault(); closeTab(idx); }
      });
      el.querySelector('[data-act="close"]').addEventListener("click", (e) => {
        e.stopPropagation(); closeTab(idx);
      });
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openTabContextMenu(e.clientX, e.clientY, idx);
      });
      wireTabDrag(el, idx);
    });
  }

  async function setActiveTab(idx) {
    if (idx < 0 || idx >= state.tabs.length) return;
    if (idx === state.activeIdx && state.activePaneKey === "primary" && !state.libraryOpen && !state.currentSubject && !state.currentShelf) {
      // Already showing — nothing to do.
      return;
    }
    const path = state.tabs[idx].path;
    state.activeIdx = idx;
    await openFile(path); // openFile sees existing tab and re-renders.
  }

  function closeTab(idx) {
    if (idx < 0 || idx >= state.tabs.length) return;
    const wasActive = idx === state.activeIdx;
    state.tabs.splice(idx, 1);
    if (state.tabs.length === 0) {
      state.activeIdx = -1;
      syncCurrent();
      renderTabs();
      persistSession();
      if (state.sideTab) {
        // Side pane has content — show library underneath; user can still see side.
        openLibrary();
      } else {
        openLibrary();
      }
      return;
    }
    if (wasActive) {
      state.activeIdx = Math.min(idx, state.tabs.length - 1);
      const path = state.tabs[state.activeIdx].path;
      openFile(path);
    } else {
      if (idx < state.activeIdx) state.activeIdx--;
      syncCurrent();
      renderTabs();
      persistSession();
    }
  }

  function closeOtherTabs(keepIdx) {
    if (keepIdx < 0 || keepIdx >= state.tabs.length) return;
    const keep = state.tabs[keepIdx];
    state.tabs = [keep];
    state.activeIdx = 0;
    syncCurrent();
    renderTabs();
    persistSession();
    openFile(keep.path);
  }

  function closeAllTabs() {
    state.tabs = [];
    state.activeIdx = -1;
    syncCurrent();
    renderTabs();
    persistSession();
    openLibrary();
  }

  function moveTabToSide(idx) {
    if (idx < 0 || idx >= state.tabs.length) return;
    const path = state.tabs[idx].path;
    state.tabs.splice(idx, 1);
    if (state.activeIdx >= state.tabs.length) state.activeIdx = state.tabs.length - 1;
    syncCurrent();
    renderTabs();
    openInSidePane(path);
    if (state.tabs.length > 0 && state.activeIdx >= 0) {
      openFile(state.tabs[state.activeIdx].path);
    } else if (state.tabs.length === 0) {
      // Primary is now empty; leave the library view, but only if side closes later.
      // Keep showing the side pane's document; we'll add an "empty primary" hint.
      els.view.innerHTML = `<div class="welcome"><h2>Hovedpanelet er tomt</h2>
        <p>Velg en side fra menyen til venstre, eller flytt dokumentet i sidepanelet tilbake hit.</p></div>`;
      els.toc.innerHTML = "";
    }
  }

  function moveSideToPrimary() {
    if (!state.sideTab) return;
    const path = state.sideTab.path;
    closeSidePane();
    openFile(path);
  }

  // Drag-and-drop for tabs.
  function wireTabDrag(tabEl, idx) {
    tabEl.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/x-tb-tab", String(idx));
      e.dataTransfer.setData("text/x-tb-path", state.tabs[idx].path);
      e.dataTransfer.effectAllowed = "move";
      tabEl.classList.add("dragging");
    });
    tabEl.addEventListener("dragend", () => {
      tabEl.classList.remove("dragging");
      els.tabbar.querySelectorAll(".tab").forEach(t => t.classList.remove("drop-before", "drop-after"));
    });
    tabEl.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("text/x-tb-tab")) return;
      e.preventDefault();
      const rect = tabEl.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      els.tabbar.querySelectorAll(".tab").forEach(t => t.classList.remove("drop-before", "drop-after"));
      tabEl.classList.add(before ? "drop-before" : "drop-after");
    });
    tabEl.addEventListener("drop", (e) => {
      if (!e.dataTransfer.types.includes("text/x-tb-tab")) return;
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData("text/x-tb-tab"), 10);
      if (!Number.isFinite(from)) return;
      const rect = tabEl.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      let to = idx + (before ? 0 : 1);
      if (from === to || from === to - 1) {
        renderTabs();
        return;
      }
      const moved = state.tabs[from];
      state.tabs.splice(from, 1);
      if (from < to) to--;
      state.tabs.splice(to, 0, moved);
      const activePath = state.tabs[state.activeIdx] ? state.tabs[state.activeIdx].path : null;
      state.activeIdx = activePath ? state.tabs.findIndex(t => t.path === activePath) : -1;
      renderTabs();
      persistSession();
    });
  }

  // Side pane is also a drop target for tabs.
  function wireSidePaneDrop() {
    const target = els.paneSide;
    target.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("text/x-tb-tab")) return;
      e.preventDefault();
      target.classList.add("drop-active");
    });
    target.addEventListener("dragleave", () => target.classList.remove("drop-active"));
    target.addEventListener("drop", (e) => {
      target.classList.remove("drop-active");
      if (!e.dataTransfer.types.includes("text/x-tb-tab")) return;
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData("text/x-tb-tab"), 10);
      if (Number.isFinite(from)) moveTabToSide(from);
    });
  }

  // ============================================================
  // Context menus
  // ============================================================
  let _ctxMenuEl = null;
  function closeContextMenu() {
    if (_ctxMenuEl) { _ctxMenuEl.remove(); _ctxMenuEl = null; }
  }
  function openContextMenu(x, y, items) {
    closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.innerHTML = items.map(it => {
      if (it.sep) return "<hr>";
      const cls = it.danger ? "danger" : "";
      return `<button class="${cls}" data-act="${escapeHtml(it.id)}">${escapeHtml(it.label)}</button>`;
    }).join("");
    document.body.appendChild(menu);
    // Position; flip if too close to edge.
    menu.style.left = "0px"; menu.style.top = "0px";
    const r = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - r.width - 6);
    const py = Math.min(y, window.innerHeight - r.height - 6);
    menu.style.left = px + "px"; menu.style.top = py + "px";
    menu.querySelectorAll("button[data-act]").forEach(b => {
      b.addEventListener("click", () => {
        const item = items.find(i => i.id === b.dataset.act);
        closeContextMenu();
        if (item && item.run) item.run();
      });
    });
    _ctxMenuEl = menu;
    setTimeout(() => {
      document.addEventListener("click", closeContextMenu, { once: true, capture: true });
      document.addEventListener("contextmenu", closeContextMenu, { once: true, capture: true });
      window.addEventListener("blur", closeContextMenu, { once: true });
    }, 0);
  }

  function openTreeContextMenu(x, y, path) {
    const rec = state.files[path];
    if (!rec) return;
    const bookmarked = isBookmarked(path);
    const readState = getProgress(path).state;
    openContextMenu(x, y, [
      { id: "open",   label: "Åpne",                 run: () => openFile(path) },
      { id: "side",   label: "Åpne i sidepanel",     run: () => openFile(path, { target: "side" }) },
      { id: "newtab", label: "Åpne i ny fane",       run: () => openFile(path, { target: "newTab" }) },
      { sep: true },
      { id: "bm",     label: bookmarked ? "Fjern bokmerke" : "Bokmerk", run: () => toggleBookmarkFor(path) },
      { id: "mr",     label: readState === "read" ? "Marker som ulest" : "Marker som lest", run: () => toggleReadStatusFor(path) },
      { id: "shelf",  label: "Legg i bokhylle…",     run: () => openShelfPicker(path) },
    ]);
  }

  function openTabContextMenu(x, y, idx) {
    const tab = state.tabs[idx];
    if (!tab) return;
    openContextMenu(x, y, [
      { id: "open",   label: "Aktiver fane",       run: () => setActiveTab(idx) },
      { id: "side",   label: "Flytt til sidepanel", run: () => moveTabToSide(idx) },
      { sep: true },
      { id: "close",  label: "Lukk fane",          run: () => closeTab(idx), danger: true },
      { id: "others", label: "Lukk andre faner",   run: () => closeOtherTabs(idx) },
      { id: "all",    label: "Lukk alle faner",    run: () => closeAllTabs(), danger: true },
    ]);
  }

  // ============================================================
  // Text-to-speech (Web Speech API)
  // ============================================================
  const tts = {
    sentences: [],   // [{ id, text, els: [span,...], headingLevel?: int }]
    idx: -1,
    stopAt: Infinity, // exclusive upper bound (used by "Read this section")
    isPlaying: false,
    isPaused: false,
    rate: parseFloat(localStorage.getItem("tb.tts.rate") || "1.0") || 1.0,
    voiceURI: localStorage.getItem("tb.tts.voice") || "",
    voices: [],
    available: typeof window !== "undefined" && "speechSynthesis" in window,
    headingBtns: new WeakMap(), // heading element -> button
  };

  function ttsLoadVoices() {
    if (!tts.available) return;
    tts.voices = window.speechSynthesis.getVoices() || [];
  }
  if (tts.available) {
    ttsLoadVoices();
    window.speechSynthesis.onvoiceschanged = ttsLoadVoices;
  }

  // Pick a voice URI: prefer saved → Norwegian (nb/no) → Scandinavian fallback → default.
  function ttsPickVoice() {
    if (!tts.voices.length) return null;
    if (tts.voiceURI) {
      const v = tts.voices.find(v => v.voiceURI === tts.voiceURI);
      if (v) return v;
    }
    const nb = tts.voices.find(v => /^nb/i.test(v.lang));
    if (nb) return nb;
    const no = tts.voices.find(v => /^no/i.test(v.lang) || /norweg/i.test(v.name));
    if (no) return no;
    const scand = tts.voices.find(v => /^(nn|da|sv)/i.test(v.lang));
    if (scand) return scand;
    return tts.voices[0] || null;
  }

  // Split a string into sentences, returning [{text, endsSentence}] pieces.
  // Norwegian-friendly: handles common abbreviations and avoids splitting on decimals.
  const NB_ABBR = /\b(f\.eks|bl\.a|m\.m|m\.fl|osv|jf|nr|kap|s|pkt|ca|min|maks)\.\s*$/i;
  function findSentenceBoundaries(text) {
    // Returns array of indices (exclusive end positions) where a sentence ends.
    const ends = [];
    const re = /[.!?…](?:["'»)\]]+)?/g;
    let m;
    while ((m = re.exec(text))) {
      const endPos = m.index + m[0].length;
      // Don't split inside decimals like "3.14"
      if (m[0][0] === "." && /\d/.test(text[m.index - 1] || "") && /\d/.test(text[endPos] || "")) continue;
      // Need whitespace / end-of-string after — else not a sentence boundary.
      if (endPos < text.length && !/\s/.test(text[endPos])) continue;
      const head = text.slice(Math.max(0, endPos - 8), endPos);
      if (NB_ABBR.test(head)) continue;
      ends.push(endPos);
    }
    return ends;
  }

  function isSkipNode(el, root) {
    let p = el;
    while (p && p !== root) {
      const tag = p.tagName;
      if (tag === "CODE" || tag === "PRE" || tag === "SCRIPT" || tag === "STYLE") return true;
      if (p.classList && (p.classList.contains("katex") || p.classList.contains("mermaid") || p.classList.contains("heading-tts") || p.classList.contains("tts-piece"))) return true;
      p = p.parentNode;
    }
    return false;
  }

  // Walk a block element and wrap its text into <span class="tts-piece" data-sent="N"> spans.
  // Returns array of sentence groups: [{ id, text, els: [span,...] }]
  function wrapSentencesInBlock(block, startId) {
    const textNodes = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (isSkipNode(n.parentNode, block)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    if (!textNodes.length) return [];

    const groups = []; // local sentence groups
    let curId = startId;
    let curGroup = null;
    const ensureGroup = () => {
      if (!curGroup) {
        curGroup = { id: curId++, text: "", els: [] };
        groups.push(curGroup);
      }
      return curGroup;
    };

    for (const tn of textNodes) {
      const text = tn.nodeValue;
      const ends = findSentenceBoundaries(text);
      if (!ends.length) {
        const span = document.createElement("span");
        span.className = "tts-piece";
        span.textContent = text;
        tn.replaceWith(span);
        const g = ensureGroup();
        g.text += text;
        g.els.push(span);
        continue;
      }
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const e of ends) {
        const piece = text.slice(last, e);
        const span = document.createElement("span");
        span.className = "tts-piece";
        span.textContent = piece;
        frag.appendChild(span);
        const g = ensureGroup();
        g.text += piece;
        g.els.push(span);
        // Sentence ends here.
        curGroup = null;
        last = e;
      }
      const tail = text.slice(last);
      if (tail) {
        const span = document.createElement("span");
        span.className = "tts-piece";
        span.textContent = tail;
        frag.appendChild(span);
        const g = ensureGroup();
        g.text += tail;
        g.els.push(span);
      }
      tn.replaceWith(frag);
    }

    // Finalize: assign ids to spans, drop empty groups.
    const finalized = [];
    for (const g of groups) {
      if (!g.text.trim()) continue;
      g.id = finalized.length + startId;
      g.els.forEach(el => el.dataset.sent = String(g.id));
      finalized.push(g);
    }
    return finalized;
  }

  function prepareTTS() {
    if (!tts.available) return;
    ttsStop();
    tts.sentences = [];
    const root = els.view;
    if (!root) return;
    // Walk top-level speakable blocks in document order so sentences appear in reading order.
    const SPEAK = "h1,h2,h3,h4,h5,h6,p,li,blockquote,td,dt,dd,figcaption";
    const blocks = root.querySelectorAll(SPEAK);
    let nextId = 0;
    for (const block of blocks) {
      // Skip blocks inside skip-zones (e.g., a <p> inside a callout that's inside .mermaid — defensive).
      if (isSkipNode(block.parentNode, root)) continue;
      const startIdx = tts.sentences.length;
      const groups = wrapSentencesInBlock(block, nextId);
      nextId += groups.length;
      for (const g of groups) {
        // Tag heading sentences with their level so "section" stop can find the next heading.
        if (/^H[1-6]$/.test(block.tagName)) {
          g.headingLevel = +block.tagName[1];
          g.headingEl = block;
        }
        tts.sentences.push(g);
      }
      // Renumber to dense ids matching tts.sentences index.
      for (let i = startIdx; i < tts.sentences.length; i++) {
        tts.sentences[i].id = i;
        tts.sentences[i].els.forEach(el => el.dataset.sent = String(i));
      }
    }

    addHeadingTtsButtons(root);
  }

  // Returns the sentence id at an event target, or null if none.
  function sentenceIdFromEvent(e) {
    const piece = e.target.closest(".tts-piece");
    if (!piece) return null;
    const id = parseInt(piece.dataset.sent, 10);
    return Number.isFinite(id) ? id : null;
  }
  function enclosingHeadingForSentence(idx) {
    for (let i = idx; i >= 0; i--) {
      if (tts.sentences[i] && tts.sentences[i].headingEl) return tts.sentences[i].headingEl;
    }
    return null;
  }

  function addHeadingTtsButtons(root) {
    root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(h => {
      if (h.querySelector(".heading-tts")) return;
      const btn = document.createElement("button");
      btn.className = "heading-tts";
      btn.title = "Les opp denne seksjonen";
      btn.setAttribute("aria-label", "Les opp seksjonen");
      btn.textContent = "▶";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ttsPlaySection(h);
      });
      h.appendChild(btn);
      tts.headingBtns.set(h, btn);
    });
  }

  function ttsPlaySection(headingEl) {
    if (!tts.available || !tts.sentences.length) return;
    const headingLevel = +headingEl.tagName[1];
    // Find the first sentence inside this heading (or the first sentence after the heading).
    let startIdx = tts.sentences.findIndex(s => s.headingEl === headingEl);
    if (startIdx < 0) {
      // Fallback: the sentence whose first el comes after the heading in document order.
      const tw = document.createTreeWalker(els.view, NodeFilter.SHOW_ELEMENT);
      let after = false;
      while (tw.nextNode()) {
        if (tw.currentNode === headingEl) { after = true; continue; }
        if (after && tw.currentNode.classList && tw.currentNode.classList.contains("tts-piece")) {
          const id = parseInt(tw.currentNode.dataset.sent, 10);
          if (Number.isFinite(id)) { startIdx = id; break; }
        }
      }
    }
    if (startIdx < 0) return;
    // Find the next heading of same or higher level → stop boundary.
    let stopAt = tts.sentences.length;
    for (let j = startIdx + 1; j < tts.sentences.length; j++) {
      if (tts.sentences[j].headingLevel && tts.sentences[j].headingLevel <= headingLevel) {
        stopAt = j;
        break;
      }
    }
    ttsPlayFrom(startIdx, stopAt);
  }

  function ttsPlayFrom(idx, stopAt = Infinity) {
    if (!tts.available || !tts.sentences[idx]) return;
    window.speechSynthesis.cancel();
    tts.idx = idx;
    tts.stopAt = stopAt;
    tts.isPlaying = true;
    tts.isPaused = false;
    updateTtsButtonState();
    if (!_ttsPop) openTtsPop();
    speakCurrent();
  }

  function speakCurrent() {
    if (!tts.isPlaying) return;
    if (tts.idx >= tts.stopAt || tts.idx >= tts.sentences.length) {
      ttsStop();
      return;
    }
    const sent = tts.sentences[tts.idx];
    highlightSentence(tts.idx);
    const u = new SpeechSynthesisUtterance(sent.text);
    u.rate = tts.rate;
    u.lang = "nb-NO";
    const v = ttsPickVoice();
    if (v) { u.voice = v; u.lang = v.lang || u.lang; }
    u.onend = () => {
      if (!tts.isPlaying) return;
      tts.idx++;
      speakCurrent();
    };
    u.onerror = (e) => {
      // Cancel after explicit stop fires "interrupted" — silently exit.
      if (e.error === "interrupted" || e.error === "canceled") return;
      console.warn("TTS error:", e.error);
      ttsStop();
    };
    window.speechSynthesis.speak(u);
    updateTtsStatus();
  }

  function highlightSentence(idx) {
    els.view.querySelectorAll(".tts-piece.active").forEach(s => s.classList.remove("active"));
    const s = tts.sentences[idx]; if (!s) return;
    s.els.forEach(el => el.classList.add("active"));
    // Scroll first piece into view if off-screen.
    const first = s.firstEl || s.els[0];
    if (first) {
      const scroller = els.paneView;
      const r = first.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      if (r.top < sr.top + 40 || r.bottom > sr.bottom - 40) {
        first.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    // Highlight a currently-playing section's heading button.
    document.querySelectorAll(".heading-tts.playing").forEach(b => b.classList.remove("playing"));
    if (s.headingEl) {
      const btn = tts.headingBtns.get(s.headingEl);
      if (btn) btn.classList.add("playing");
    }
  }

  function ttsPause() {
    if (!tts.available || !tts.isPlaying) return;
    window.speechSynthesis.pause();
    tts.isPaused = true;
    updateTtsButtonState();
  }
  function ttsResume() {
    if (!tts.available) return;
    if (tts.isPaused) {
      window.speechSynthesis.resume();
      tts.isPaused = false;
      updateTtsButtonState();
    } else if (!tts.isPlaying && tts.sentences.length) {
      ttsPlayFrom(Math.max(0, tts.idx >= 0 ? tts.idx : 0));
    }
  }
  function ttsStop() {
    if (tts.available) window.speechSynthesis.cancel();
    tts.isPlaying = false;
    tts.isPaused = false;
    tts.idx = -1;
    tts.stopAt = Infinity;
    els.view && els.view.querySelectorAll(".tts-piece.active").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".heading-tts.playing").forEach(b => b.classList.remove("playing"));
    updateTtsButtonState();
    updateTtsStatus();
  }

  function updateTtsButtonState() {
    document.body.classList.toggle("tts-on", tts.isPlaying || tts.isPaused);
    if (!els.btnTts) return;
    els.btnTts.classList.toggle("active", tts.isPlaying || tts.isPaused);
    els.btnTts.textContent = tts.isPlaying && !tts.isPaused ? "⏸" : "🔊";
    els.btnTts.title = tts.isPlaying
      ? (tts.isPaused ? "Fortsett opplesing (TTS)" : "Pause opplesing (TTS)")
      : "Les opp (TTS)";
  }
  function updateTtsStatus() {
    if (!_ttsPop) return;
    const status = _ttsPop.querySelector(".tts-status");
    if (status) {
      if (tts.sentences.length === 0) status.textContent = "Ingen tekst tilgjengelig";
      else if (tts.isPlaying) status.textContent = `Setning ${tts.idx + 1} av ${tts.sentences.length}${tts.isPaused ? " — pauset" : ""}`;
      else status.textContent = `${tts.sentences.length} setninger`;
    }
  }

  // Popover.
  let _ttsPop = null;
  function toggleTtsPop() {
    if (_ttsPop) { closeTtsPop(); return; }
    if (!tts.available) {
      setStatus("Nettleseren støtter ikke opplesing.", "err");
      return;
    }
    openTtsPop();
  }
  function closeTtsPop() {
    if (_ttsPop) {
      if (_ttsPop._cleanup) _ttsPop._cleanup();
      _ttsPop.remove();
      _ttsPop = null;
    }
  }
  function openTtsPop() {
    const pop = document.createElement("div");
    pop.className = "tts-pop";
    ttsLoadVoices();
    const sortedVoices = tts.voices.slice().sort((a, b) => {
      const score = v => (/^nb/i.test(v.lang) ? 0 : /^(nn|no)/i.test(v.lang) ? 1 : /^(da|sv)/i.test(v.lang) ? 2 : /^en/i.test(v.lang) ? 3 : 4);
      const sa = score(a), sb = score(b);
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });
    const picked = ttsPickVoice();
    pop.innerHTML = `
      <h4>Les opp</h4>
      <div class="tts-row">
        <button class="tts-btn primary" data-act="play">▶ Spill av</button>
        <button class="tts-btn" data-act="pause">⏸ Pause</button>
        <button class="tts-btn" data-act="stop">■ Stopp</button>
      </div>
      <label>Hastighet <span class="tts-rate-val">${tts.rate.toFixed(1)}×</span></label>
      <input type="range" min="0.5" max="2.0" step="0.1" value="${tts.rate}" data-act="rate" />
      <label style="margin-top:8px">Stemme</label>
      <select data-act="voice">
        ${sortedVoices.length ? sortedVoices.map(v => `
          <option value="${escapeHtml(v.voiceURI)}"${picked && v.voiceURI === picked.voiceURI ? " selected" : ""}>${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>
        `).join("") : `<option value="">Ingen stemmer funnet</option>`}
      </select>
      <div class="tts-status">${tts.sentences.length} setninger</div>
    `;
    document.body.appendChild(pop);
    // Position under the topbar button.
    const br = els.btnTts.getBoundingClientRect();
    pop.style.top = (br.bottom + 6) + "px";
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 290, br.right - 280)) + "px";
    _ttsPop = pop;
    updateTtsStatus();

    pop.querySelector('[data-act="play"]').addEventListener("click", () => {
      if (tts.isPaused) ttsResume();
      else ttsPlayFrom(Math.max(0, tts.idx >= 0 ? tts.idx : 0));
    });
    pop.querySelector('[data-act="pause"]').addEventListener("click", () => ttsPause());
    pop.querySelector('[data-act="stop"]').addEventListener("click", () => ttsStop());
    const rate = pop.querySelector('[data-act="rate"]');
    rate.addEventListener("input", () => {
      tts.rate = parseFloat(rate.value);
      pop.querySelector(".tts-rate-val").textContent = tts.rate.toFixed(1) + "×";
      localStorage.setItem("tb.tts.rate", String(tts.rate));
      // If playing, restart current sentence at new rate.
      if (tts.isPlaying && !tts.isPaused) {
        const idx = tts.idx;
        const stopAt = tts.stopAt;
        window.speechSynthesis.cancel();
        tts.idx = idx; tts.stopAt = stopAt; tts.isPlaying = true;
        speakCurrent();
      }
    });
    pop.querySelector('[data-act="voice"]').addEventListener("change", (e) => {
      tts.voiceURI = e.target.value;
      localStorage.setItem("tb.tts.voice", tts.voiceURI);
      if (tts.isPlaying) {
        const idx = tts.idx, stopAt = tts.stopAt;
        window.speechSynthesis.cancel();
        tts.idx = idx; tts.stopAt = stopAt; tts.isPlaying = true;
        speakCurrent();
      }
    });
    // Close on outside primary-button click (ignore right-clicks so the context menu can open).
    setTimeout(() => {
      const onOutside = (e) => {
        if (e.button !== 0) return;
        if (_ttsPop && !_ttsPop.contains(e.target) && e.target !== els.btnTts) closeTtsPop();
      };
      document.addEventListener("mousedown", onOutside, { once: false });
      pop._cleanup = () => document.removeEventListener("mousedown", onOutside);
    }, 0);
  }
  // Path-targeted variants (so context menu acts on any path, not just state.current).
  function toggleBookmarkFor(path) {
    if (isBookmarked(path)) state.bookmarks = state.bookmarks.filter(x => x !== path);
    else state.bookmarks = [path, ...state.bookmarks];
    persistBookmarks();
    renderBookmarks();
    updateBookmarkBtn();
    setStatus(isBookmarked(path) ? "Bokmerke lagt til." : "Bokmerke fjernet.", "ok");
  }
  function toggleReadStatusFor(path) {
    const cur = getProgress(path);
    if (cur.state === "read") setProgress(path, { state: "partial", scrollPct: cur.scrollPct || 0 });
    else setProgress(path, { state: "read", scrollPct: 100 });
    updateMarkReadBtn();
  }

  function updateCrumbs() {
    if (!state.current) { els.crumbs.textContent = "Velg en side i menyen"; return; }
    const parts = state.current.path.split("/");
    els.crumbs.innerHTML = parts.map((p, i) => {
      const stem = p.replace(/\.(md|markdown|txt)$/i, "");
      return i === parts.length - 1
        ? `<strong>${escapeHtml(state.files[state.current.path].title || stem)}</strong>`
        : escapeHtml(stem);
    }).join('<span class="sep">/</span>');
  }

  function updateStatusMeta() {
    if (!state.current) { els.statusMeta.textContent = ""; return; }
    const rec = state.files[state.current.path];
    const words = rec ? rec.word_count : 0;
    const minutes = Math.max(1, Math.round(words / 220));
    els.statusMeta.textContent = `${words} ord · ${minutes} min lesing`;
  }

  // ============================================================
  // Recent / Bookmarks / Tags
  // ============================================================
  function pushRecent(path) {
    state.recent = [path, ...state.recent.filter(p => p !== path)].slice(0, 8);
    persistRecent();
    renderRecent();
  }
  function renderRecent() {
    const rows = state.recent.filter(p => state.files[p]);
    if (!rows.length) {
      els.recentList.innerHTML = "<li style='color:var(--text-mute);cursor:default'>Ingen ennå</li>";
      return;
    }
    els.recentList.innerHTML = rows.map(p => {
      const rec = state.files[p];
      return `<li data-path="${escapeHtml(p)}" title="${escapeHtml(p)}">${escapeHtml(rec.title)}</li>`;
    }).join("");
    els.recentList.querySelectorAll("li[data-path]").forEach(li =>
      li.addEventListener("click", () => openFile(li.dataset.path)));
  }

  function isBookmarked(path) { return state.bookmarks.includes(path); }
  function toggleBookmark() {
    if (!state.current) return;
    const p = state.current.path;
    if (isBookmarked(p)) state.bookmarks = state.bookmarks.filter(x => x !== p);
    else state.bookmarks = [p, ...state.bookmarks];
    persistBookmarks();
    renderBookmarks();
    updateBookmarkBtn();
    setStatus(isBookmarked(p) ? "Bokmerke lagt til." : "Bokmerke fjernet.", "ok");
  }
  function updateBookmarkBtn() {
    if (!els.btnBookmark) return;
    const on = state.current && isBookmarked(state.current.path);
    els.btnBookmark.textContent = on ? "★" : "☆";
    els.btnBookmark.classList.toggle("active", !!on);
    els.btnBookmark.title = on ? "Fjern bokmerke" : "Bokmerk denne siden";
  }
  function renderBookmarks() {
    const rows = state.bookmarks.filter(p => state.files[p]);
    if (!rows.length) {
      els.bookmarkList.innerHTML = "<li style='color:var(--text-mute);cursor:default'>Ingen ennå</li>";
      return;
    }
    els.bookmarkList.innerHTML = rows.map(p => {
      const rec = state.files[p];
      return `<li data-path="${escapeHtml(p)}" title="${escapeHtml(p)}">${escapeHtml(rec.title)}</li>`;
    }).join("");
    els.bookmarkList.querySelectorAll("li[data-path]").forEach(li =>
      li.addEventListener("click", () => openFile(li.dataset.path)));
  }

  function renderTags() {
    const counts = {};
    for (const rec of Object.values(state.files)) {
      for (const t of rec.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    const tags = Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    if (!tags.length) {
      els.tagList.innerHTML = "<li style='color:var(--text-mute);cursor:default'>Ingen ennå</li>";
      return;
    }
    els.tagList.innerHTML = tags.map(t =>
      `<li data-tag="${escapeHtml(t.tag)}" class="${state.activeTagFilter === t.tag ? 'active' : ''}">#${escapeHtml(t.tag)}<span class="count">${t.count}</span></li>`
    ).join("");
    els.tagList.querySelectorAll("li[data-tag]").forEach(li =>
      li.addEventListener("click", () => {
        state.activeTagFilter = state.activeTagFilter === li.dataset.tag ? null : li.dataset.tag;
        renderTags();
        applyTagFilter();
      }));
  }

  function applyTagFilter() {
    if (!state.activeTagFilter) {
      els.tree.querySelectorAll(".row").forEach(r => r.style.display = "");
      return;
    }
    const matched = new Set();
    for (const [path, rec] of Object.entries(state.files)) {
      if ((rec.tags || []).includes(state.activeTagFilter)) matched.add(path);
    }
    els.tree.querySelectorAll(".row.file").forEach(row => {
      row.style.display = matched.has(row.dataset.path) ? "" : "none";
    });
    // Hide empty directories.
    els.tree.querySelectorAll("li").forEach(li => {
      const dirRow = li.querySelector(":scope > .row.dir");
      if (!dirRow) return;
      const visibleFiles = Array.from(li.querySelectorAll(".row.file")).some(r => r.style.display !== "none");
      dirRow.style.display = visibleFiles ? "" : "none";
    });
  }

  // ============================================================
  // Search (in-browser, against state.bodies)
  // ============================================================
  let searchTimer = null;
  function onSearchInput() {
    const q = els.search.value.trim();
    if (searchTimer) clearTimeout(searchTimer);
    if (!q) {
      els.results.classList.add("hidden");
      els.tree.style.display = "";
      return;
    }
    searchTimer = setTimeout(() => runSearch(q), 160);
  }

  function runSearch(q) {
    const ql = q.toLowerCase();
    const results = [];
    for (const [path, rec] of Object.entries(state.files)) {
      const title = (rec.title || "").toLowerCase();
      const nameMatch = title.includes(ql) || path.toLowerCase().includes(ql);
      const body = state.bodies[path] || "";
      const snippets = [];
      const lower = body.toLowerCase();
      let from = 0, idx;
      while ((idx = lower.indexOf(ql, from)) !== -1 && snippets.length < 20) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(body.length, idx + q.length + 40);
        snippets.push(body.slice(start, end).replace(/\n/g, " "));
        from = idx + Math.max(1, q.length);
      }
      if (nameMatch || snippets.length) {
        results.push({ path, title: rec.title, name_match: nameMatch, snippets });
      }
    }
    results.sort((a, b) => (Number(b.name_match) - Number(a.name_match)) || a.path.localeCompare(b.path));
    renderSearchResults(q, results);
  }

  function renderSearchResults(q, results) {
    els.tree.style.display = "none";
    els.results.classList.remove("hidden");
    if (!results.length) {
      els.results.innerHTML = `<h4>Ingen treff for "${escapeHtml(q)}"</h4>`;
      return;
    }
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
    const totalHits = results.reduce((n, r) => n + Math.max(r.snippets.length, r.name_match ? 1 : 0), 0);
    const html = [`<h4>${totalHits} treff i ${results.length} ${results.length === 1 ? "fil" : "filer"}</h4>`];
    for (const r of results) {
      const safePath = escapeHtml(r.path);
      const safeTitle = escapeHtml(r.title);
      if (!r.snippets.length) {
        html.push(`<div class="hit" data-path="${safePath}" data-occ="-1"><div class="path">${safeTitle}</div></div>`);
        continue;
      }
      html.push(`<div class="hit-group"><div class="path" data-path="${safePath}" data-occ="-1">${safeTitle} <span class="hit-count">${r.snippets.length}</span></div>`);
      r.snippets.forEach((snippet, i) => {
        const safeSnip = escapeHtml(snippet).replace(re, (m) => `<mark>${m}</mark>`);
        html.push(`<div class="hit snip-hit" data-path="${safePath}" data-occ="${i}"><div class="snip">${safeSnip}</div></div>`);
      });
      html.push(`</div>`);
    }
    els.results.innerHTML = html.join("");
    els.results.querySelectorAll(".hit, .hit-group .path").forEach((el) => {
      el.addEventListener("click", async () => {
        const path = el.dataset.path;
        const occ = parseInt(el.dataset.occ, 10);
        await openFile(path);
        if (Number.isFinite(occ) && occ >= 0) jumpToOccurrence(q, occ);
      });
    });
  }

  function jumpToOccurrence(query, occIdx) {
    if (!query || !state.current) return;
    const ql = query.toLowerCase();
    const root = els.view;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentNode;
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        if (p && (p.tagName === "SCRIPT" || p.tagName === "STYLE")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    const offsets = [];
    let flat = "";
    while (walker.nextNode()) {
      const n = walker.currentNode;
      nodes.push(n); offsets.push(flat.length); flat += n.nodeValue;
    }
    const lower = flat.toLowerCase();
    let pos = -1, from = 0;
    for (let i = 0; i <= occIdx; i++) {
      pos = lower.indexOf(ql, from);
      if (pos < 0) return;
      from = pos + Math.max(1, ql.length);
    }
    const endPos = pos + query.length;
    const findNode = (p) => {
      let lo = 0, hi = nodes.length - 1, found = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] <= p) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      return found;
    };
    const sIdx = findNode(pos);
    const eIdx = findNode(endPos > pos ? endPos - 1 : pos);
    const range = document.createRange();
    range.setStart(nodes[sIdx], pos - offsets[sIdx]);
    range.setEnd(nodes[eIdx], endPos - offsets[eIdx]);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    const rect = range.getBoundingClientRect();
    const scroller = $(".pane-view");
    if (scroller && rect.height) {
      const scrollerRect = scroller.getBoundingClientRect();
      const target = scroller.scrollTop + (rect.top - scrollerRect.top) - scroller.clientHeight / 2 + rect.height / 2;
      scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }
  }

  // ============================================================
  // Lesson navigation (prev / next)
  // ============================================================
  function lessonOrder() {
    return state.flatFiles
      .map(f => state.files[f.path])
      .filter(Boolean)
      .sort((a, b) => {
        const ao = numericOrder(a), bo = numericOrder(b);
        if (ao !== bo) return ao - bo;
        return a.path.localeCompare(b.path, "nb");
      });
  }
  function numericOrder(rec) {
    const v = rec.frontmatter && rec.frontmatter.order;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  }

  // ============================================================
  // Theme & font & width
  // ============================================================
  const HLJS_CSS_BASE = "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/";
  const THEMES = {
    midnight: {
      name: "Midnight",
      best_for: "Generelt bruk i dempet lys — standard balanse av kontrast og varme.",
      hljs: "github-dark.min.css",
      vars: {
        bg: "#0e1116", "bg-elev": "#151a22", "bg-elev-2": "#1c222c",
        border: "#262d39", "border-strong": "#364150",
        text: "#d7dde7", "text-dim": "#8a93a4", "text-mute": "#5d6675",
        accent: "#5aa9ff", "accent-soft": "rgba(90,169,255,0.14)",
        danger: "#ff6b6b", warn: "#f0b86e", good: "#6ad19a",
        "code-bg": "#11161e",
        shadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
      },
    },
    daylight: {
      name: "Daylight",
      best_for: "Lyse omgivelser og utskriftsaktig lesning — papir-på-skjerm-følelse.",
      hljs: "github.min.css",
      vars: {
        bg: "#fafbfc", "bg-elev": "#ffffff", "bg-elev-2": "#f3f5f7",
        border: "#d8dde3", "border-strong": "#c1c8d0",
        text: "#1f2328", "text-dim": "#57606a", "text-mute": "#8b949e",
        accent: "#0969da", "accent-soft": "rgba(9,105,218,0.10)",
        danger: "#cf222e", warn: "#9a6700", good: "#1a7f37",
        "code-bg": "#f6f8fa",
        shadow: "0 4px 14px rgba(0, 0, 0, 0.10)",
      },
    },
    sepia: {
      name: "Sepia",
      best_for: "Lange leseøkter — varme, lave kontraster, mindre øyetretthet.",
      hljs: "atom-one-light.min.css",
      vars: {
        bg: "#f5ecd9", "bg-elev": "#fbf3df", "bg-elev-2": "#ede2c4",
        border: "#d9c9a3", "border-strong": "#b9a679",
        text: "#3a3026", "text-dim": "#685a45", "text-mute": "#8e7c64",
        accent: "#8b4513", "accent-soft": "rgba(139,69,19,0.12)",
        danger: "#a8302d", warn: "#b87a1a", good: "#5e7237",
        "code-bg": "#ebe1c8",
        shadow: "0 4px 14px rgba(96, 70, 32, 0.18)",
      },
    },
    solarized: {
      name: "Solarized Dark",
      best_for: "Lange kveldsøkter — nøye avstemt lavmettet palett for øyekomfort.",
      hljs: "base16/solarized-dark.min.css",
      vars: {
        bg: "#002b36", "bg-elev": "#073642", "bg-elev-2": "#0a4250",
        border: "#144b58", "border-strong": "#1a5c6b",
        text: "#93a1a1", "text-dim": "#839496", "text-mute": "#586e75",
        accent: "#2aa198", "accent-soft": "rgba(42,161,152,0.18)",
        danger: "#dc322f", warn: "#b58900", good: "#859900",
        "code-bg": "#003844",
        shadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
      },
    },
    nord: {
      name: "Nord",
      best_for: "Fokusert lesning — kjølige, dempede toner med myk men tydelig kontrast.",
      hljs: "nord.min.css",
      vars: {
        bg: "#2e3440", "bg-elev": "#3b4252", "bg-elev-2": "#434c5e",
        border: "#4c566a", "border-strong": "#5b6374",
        text: "#eceff4", "text-dim": "#d8dee9", "text-mute": "#9099aa",
        accent: "#88c0d0", "accent-soft": "rgba(136,192,208,0.18)",
        danger: "#bf616a", warn: "#ebcb8b", good: "#a3be8c",
        "code-bg": "#2a2f3a",
        shadow: "0 6px 20px rgba(0, 0, 0, 0.40)",
      },
    },
    contrast: {
      name: "Høy kontrast",
      best_for: "Tilgjengelighet og sterkt dagslys — maks lesbarhet, slitsomt over tid.",
      hljs: "monokai-sublime.min.css",
      vars: {
        bg: "#000000", "bg-elev": "#0a0a0a", "bg-elev-2": "#1a1a1a",
        border: "#555555", "border-strong": "#888888",
        text: "#ffffff", "text-dim": "#dddddd", "text-mute": "#aaaaaa",
        accent: "#00e5ff", "accent-soft": "rgba(0,229,255,0.20)",
        danger: "#ff5555", warn: "#ffeb3b", good: "#69f0ae",
        "code-bg": "#0d0d0d",
        shadow: "0 6px 20px rgba(0, 0, 0, 0.6)",
      },
    },
  };
  // Migrate legacy theme ids stored in localStorage.
  const LEGACY_THEME_MAP = { default: "midnight", light: "daylight", dawn: "midnight", forest: "nord" };
  const FONTS = [
    { id: "sans",   name: "Sans-serif",  family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif' },
    { id: "serif",  name: "Serif",       family: '"EB Garamond", Georgia, "Times New Roman", serif' },
    { id: "mono",   name: "Monospace",   family: '"JetBrains Mono", ui-monospace, monospace' },
    { id: "atkinson", name: "Atkinson Hyperlegible", family: '"Atkinson Hyperlegible", sans-serif' },
    { id: "dyslexic", name: "OpenDyslexic", family: '"OpenDyslexic", sans-serif' },
  ];

  function applyTheme(id) {
    let key = id;
    if (LEGACY_THEME_MAP[key]) key = LEGACY_THEME_MAP[key];
    if (!THEMES[key]) key = "midnight";
    const theme = THEMES[key];
    state.theme = key;
    const root = document.documentElement;
    root.removeAttribute("data-theme"); // legacy attribute no longer used
    for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty("--" + k, v);
    localStorage.setItem("tb.theme", key);
    const hljsLink = $("#hljs-theme");
    if (hljsLink) hljsLink.href = HLJS_CSS_BASE + theme.hljs;
  }

  function applyFontFamily(id) {
    const f = FONTS.find(x => x.id === id) || FONTS[0];
    state.fontFamily = f.id;
    document.documentElement.style.setProperty("--md-font-family", f.family);
    localStorage.setItem("tb.font", f.id);
  }

  function applyFontSize(px) {
    const v = Math.min(28, Math.max(12, px | 0));
    state.fontSize = v;
    document.documentElement.style.setProperty("--md-font-size", v + "px");
    localStorage.setItem("tb.fontSize", String(v));
  }

  function applyWidth(px) {
    const v = Math.min(1600, Math.max(440, px | 0));
    state.width = v;
    document.documentElement.style.setProperty("--md-max-width", v + "px");
    localStorage.setItem("tb.width", String(v));
  }

  function openThemePicker() {
    const themeCards = Object.entries(THEMES).map(([key, t]) => {
      const v = t.vars;
      const isActive = state.theme === key;
      return `
        <div class="theme-card${isActive ? " selected" : ""}" data-theme="${key}"
             style="background:${v.bg};color:${v.text};border-color:${v.border}">
          <div class="theme-name" style="color:${v.text}">
            <span>${escapeHtml(t.name)}</span>
            ${isActive ? '<span class="check">✓</span>' : ""}
          </div>
          <div class="theme-swatches">
            <span style="background:${v["bg-elev"]}"></span>
            <span style="background:${v["bg-elev-2"]}"></span>
            <span style="background:${v.accent}"></span>
            <span style="background:${v.good}"></span>
            <span style="background:${v.warn}"></span>
            <span style="background:${v.danger}"></span>
          </div>
          <div class="theme-sample" style="background:${v["code-bg"]};color:${v["text-dim"]};border:1px solid ${v.border}">
            <span style="color:${v.text}">eksempel</span> <span style="color:${v.accent}">aksent</span>
          </div>
          <div class="theme-desc" style="color:${v["text-dim"]}">${escapeHtml(t.best_for)}</div>
        </div>`;
    }).join("");
    const html = `
      <div class="modal wide" role="dialog">
        <h3 class="modal-title">Tema og skrift</h3>
        <div class="modal-body">
          <p style="color:var(--text-dim);font-size:12px;margin:0 0 8px">Tema</p>
          <div class="theme-grid">
            ${themeCards}
          </div>
          <p style="color:var(--text-dim);font-size:12px;margin:14px 0 6px">Skrift</p>
          <div class="font-grid">
            ${FONTS.map(f => `
              <div class="font-card${f.id === state.fontFamily ? " selected" : ""}" data-font="${f.id}">
                <span class="preview" style="font-family:${f.family.replace(/"/g, "&quot;")}">Aa Bb Cc Æø</span>
                <span class="name">${escapeHtml(f.name)}</span>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="modal-actions">
          <button class="primary" data-act="close">Lukk</button>
        </div>
      </div>`;
    els.modalRoot.innerHTML = html;
    els.modalRoot.classList.remove("hidden");
    const close = () => { els.modalRoot.classList.add("hidden"); els.modalRoot.innerHTML = ""; };
    els.modalRoot.addEventListener("click", (e) => { if (e.target === els.modalRoot) close(); }, { once: true });
    els.modalRoot.querySelectorAll(".theme-card").forEach(c => {
      c.addEventListener("click", () => {
        applyTheme(c.dataset.theme);
        els.modalRoot.querySelectorAll(".theme-card").forEach(x => {
          const on = x === c;
          x.classList.toggle("selected", on);
          const nameEl = x.querySelector(".theme-name");
          if (nameEl) {
            const label = nameEl.querySelector("span:first-child");
            const labelText = label ? label.textContent : nameEl.textContent;
            nameEl.innerHTML = `<span>${escapeHtml(labelText)}</span>${on ? '<span class="check">✓</span>' : ""}`;
          }
        });
      });
    });
    els.modalRoot.querySelectorAll(".font-card").forEach(c => {
      c.addEventListener("click", () => {
        applyFontFamily(c.dataset.font);
        els.modalRoot.querySelectorAll(".font-card").forEach(x => x.classList.toggle("selected", x === c));
      });
    });
    els.modalRoot.querySelector('[data-act="close"]').addEventListener("click", close);
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });
  }

  // ============================================================
  // Shortcuts / help modal
  // ============================================================
  const SHORTCUT_GROUPS = [
    { title: "Navigasjon", rows: [
      { keys: ["←"],           desc: "Forrige overskrift / seksjon" },
      { keys: ["→"],           desc: "Neste overskrift / seksjon" },
      { keys: ["Ctrl", "↑"],   desc: "Hopp til toppen av siden" },
      { keys: ["Ctrl", "↓"],   desc: "Hopp til bunnen av siden" },
    ]},
    { title: "Visning", rows: [
      { keys: ["F"],           desc: "Slå fokuslesemodus av/på" },
      { keys: ["F11"],         desc: "Fullskjerm i nettleseren" },
      { keys: ["C"],           desc: "Vis/skjul innholdsfortegnelsen" },
      { keys: ["Ctrl", "B"],   desc: "Vis/skjul sidemenyen" },
      { keys: ["T"],           desc: "Åpne tema- og skriftvelger" },
      { keys: ["Esc"],         desc: "Avslutt fokusmodus, bibliotek eller søk" },
    ]},
    { title: "Faner og sidepanel", rows: [
      { keys: ["Klikk"],       desc: "Tre/lenke åpner i ny fane (eller bytter hvis åpen)" },
      { keys: ["Midtklikk"],   desc: "Lukk fane (på fane) / Åpne i ny fane (i menyen)" },
      { keys: ["Høyreklikk"],  desc: "Meny: åpne, sidepanel, ny fane, bokmerk, lest, bokhylle" },
      { keys: ["Dra fane"],    desc: "Slipp i sidepanelet for å lese to dokumenter side om side" },
      { keys: ["⫼"],           desc: "Topplinjeknapp: åpne/lukk sidepanel" },
    ]},
    { title: "Min bokhylle", rows: [
      { keys: ["+"],           desc: "Knapp i sidemenyen: lag ny hylle" },
      { keys: ["📥"],          desc: "Topplinjeknapp: legg den åpne siden i en hylle" },
      { keys: ["Dra side"],    desc: "Slipp en side fra menyen på et hyllenavn i sidemenyen for å legge til" },
      { keys: ["Høyreklikk"],  desc: "Tre-element: meny inkluderer “Legg i bokhylle…”" },
      { keys: ["Rediger"],     desc: "Knapp i hyllevisning: dra bøker for å sortere, × for å fjerne" },
    ]},
    { title: "Bibliotekvisning", rows: [
      { keys: ["Klikk bok"],   desc: "Åpner forhåndsvisning av siden (frontmatter, lengde, status)" },
      { keys: ["Høyreklikk"],  desc: "Meny: åpne, sidepanel, ny fane, forhåndsvis, bokhylle" },
      { keys: ["Midtklikk"],   desc: "Åpne boken direkte i en ny fane" },
    ]},
    { title: "Opplesing (TTS)", rows: [
      { keys: ["🔊"],          desc: "Topplinjeknapp: åpne avspilleren (spill / pause / hastighet / stemme)" },
      { keys: ["▶"],           desc: "Knappen ved siden av en overskrift: les opp den seksjonen" },
      { keys: ["Klikk i tekst"], desc: "Mens opplesing pågår: klikk hvor som helst i teksten for å stoppe" },
      { keys: ["Mellomrom"],   desc: "Pause/fortsett opplesing" },
      { keys: ["Høyreklikk"],  desc: "I teksten: meny med “Les opp herfra”, seksjon, pause, stopp" },
    ]},
    { title: "Tekststørrelse og bredde", rows: [
      { keys: ["+"],           desc: "Større tekst" },
      { keys: ["-"],           desc: "Mindre tekst" },
      { keys: ["0"],           desc: "Tilbakestill tekststørrelse" },
      { keys: ["."],           desc: "Bredere tekstkolonne" },
      { keys: [","],           desc: "Smalere tekstkolonne" },
      { keys: ["9"],           desc: "Tilbakestill bredde" },
    ]},
    { title: "Søk", rows: [
      { keys: ["/"],           desc: "Hopp til søkefeltet" },
      { keys: ["Ctrl", "K"],   desc: "Hopp til søkefeltet" },
    ]},
  ];

  function openShortcutsModal() {
    const renderKey = (k) => `<kbd>${escapeHtml(k)}</kbd>`;
    const sections = SHORTCUT_GROUPS.map(g => `
      <section class="shortcut-section">
        <h4>${escapeHtml(g.title)}</h4>
        <ul class="shortcut-list">
          ${g.rows.map(r => `
            <li>
              <span class="shortcut-keys">${r.keys.map(renderKey).join('<span class="shortcut-plus">+</span>')}</span>
              <span class="shortcut-desc">${escapeHtml(r.desc)}</span>
            </li>`).join("")}
        </ul>
      </section>
    `).join("");
    const html = `
      <div class="modal wide" role="dialog">
        <h3 class="modal-title">Hurtigtaster og navigasjon</h3>
        <div class="modal-body">
          <p style="color:var(--text-dim);font-size:12.5px;margin:0 0 12px">
            Tastatursnarveier for å bla, justere visningen og søke. Knappene i topplinjen utfører de samme handlingene.
          </p>
          <div class="shortcut-grid">${sections}</div>
        </div>
        <div class="modal-actions">
          <button class="primary" data-act="close">Lukk</button>
        </div>
      </div>`;
    els.modalRoot.innerHTML = html;
    els.modalRoot.classList.remove("hidden");
    const close = () => { els.modalRoot.classList.add("hidden"); els.modalRoot.innerHTML = ""; };
    els.modalRoot.addEventListener("click", (e) => { if (e.target === els.modalRoot) close(); }, { once: true });
    els.modalRoot.querySelector('[data-act="close"]').addEventListener("click", close);
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });
  }

  // ============================================================
  // Library / bookshelf (3D dashboard)
  // ============================================================
  // Pick a deterministic spine color from a string (subject path or tag).
  function bookHue(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function bookColor(rec, fallbackSeed) {
    const fm = (rec && rec.frontmatter) || {};
    if (fm.color) return fm.color;
    const tag = (rec && rec.tags && rec.tags[0]) || "";
    const seed = tag || fallbackSeed || (rec && rec.path) || "x";
    const hue = bookHue(seed);
    return `hsl(${hue}, 38%, 38%)`;
  }
  // Stable lean variation based on path — purely visual.
  function bookLean(path) {
    let h = 5381;
    for (let i = 0; i < path.length; i++) h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
    // Roughly 1-in-6 books leans a bit.
    const leans = ["", "", "", "", "", "lean-l", "", "", "", "", "lean-r"];
    return leans[h % leans.length];
  }
  // Map word_count → physical dimensions of the book on the shelf. Log scale
  // so a 200-word page and a 5000-word page sit on the same shelf without
  // either looking ridiculous.
  function bookDims(rec) {
    const wc = (rec && rec.word_count) || 200;
    const lo = Math.log(60), hi = Math.log(6000);
    const t = Math.max(0, Math.min(1, (Math.log(Math.max(wc, 60)) - lo) / (hi - lo)));
    const h = Math.round(160 + t * 130);  // 160 → 290 px
    const w = Math.round(28 + t * 28);    // 28  → 56 px
    return { h, w };
  }

  // Real-text measurement via a hidden canvas — gives the actual pixel width
  // of a string in the spine font, instead of a per-character estimate that
  // breaks for bold weights / wide letters.
  const _measureCanvas = document.createElement("canvas");
  const _measureCtx = _measureCanvas.getContext("2d");
  const _spineFont = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif`;
  function measureLineWidth(text, fs, ls) {
    _measureCtx.font = `700 ${fs}px ${_spineFont}`;
    const w = _measureCtx.measureText(text).width;
    return w + Math.max(0, text.length - 1) * ls;
  }
  // Greedy word-wrap: returns true if `text` fits in ≤ `maxLines` lines, each
  // line ≤ `maxWidth`, at the given font-size and letter-spacing. A single
  // word that's too wide for any line at this size returns false (caller
  // tries a smaller fs or more lines).
  function textFitsLines(text, fs, ls, maxLines, maxWidth) {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    let lines = 1;
    let cur = "";
    for (const word of words) {
      if (measureLineWidth(word, fs, ls) > maxWidth) return false;
      const probe = cur ? cur + " " + word : word;
      if (measureLineWidth(probe, fs, ls) <= maxWidth) {
        cur = probe;
      } else {
        lines++;
        if (lines > maxLines) return false;
        cur = word;
      }
    }
    return true;
  }
  // Pick the largest font-size that lets `text` sit on the spine in ≤ N lines.
  // Tries 1, 2, 3 lines and picks whichever yields the biggest font (so single
  // words sprawl out big, long titles compact down without ellipsising).
  function fitTitle(text, bookH, bookW) {
    // Usable text rectangle after rotation: text wraps along longAxis, with
    // each line at most shortAxis thick (line-height budget).
    const longAxis = bookH - 24;
    const shortAxis = bookW - 6;
    const lineK = 1.14;
    const FS_MIN = 10.5;
    const FS_MAX = 26;

    let best = { fs: 0, lines: 1, ls: 0.2 };
    for (let lines = 1; lines <= 3; lines++) {
      // Cap font by line-height budget for this line count.
      const fsByHeight = shortAxis / (lines * lineK);
      let lo = FS_MIN, hi = Math.min(FS_MAX, fsByHeight);
      if (hi < FS_MIN) continue;
      // Binary search for the largest fs that still fits in ≤ `lines` lines.
      let found = 0;
      for (let i = 0; i < 16 && hi - lo > 0.25; i++) {
        const mid = (lo + hi) / 2;
        const ls = mid >= 18 ? 0.6 : mid >= 14 ? 0.35 : 0.18;
        if (textFitsLines(text, mid, ls, lines, longAxis)) { found = mid; lo = mid; }
        else hi = mid;
      }
      if (found > best.fs) {
        best = { fs: found, lines, ls: found >= 18 ? 0.6 : found >= 14 ? 0.35 : 0.18 };
      }
    }
    if (best.fs === 0) {
      // Title can't fit in 3 lines at min size — fall back to a wrapping clip.
      best = { fs: FS_MIN, lines: 3, ls: 0.18 };
    }
    return best;
  }

  // Top-level subjects = direct children of the content root that are dirs.
  function topLevelSubjects() {
    return state.tree.filter(n => n.type === "dir");
  }

  function bookHtml(file) {
    const rec = state.files[file.path] || {};
    const prog = getProgress(file.path);
    const lean = bookLean(file.path);
    const dims = bookDims(rec);
    const color = bookColor(rec, file.path);
    const title = rec.title || file.name.replace(/\.(md|markdown|txt)$/i, "");
    const fit = fitTitle(title, dims.h, dims.w);
    const titleClass = fit.lines === 1 ? "nowrap" : "wrap";
    const titleStyle =
      `font-size:${fit.fs.toFixed(1)}px;` +
      `letter-spacing:${fit.ls}px;` +
      (fit.lines > 1 ? `max-height:${(fit.lines * fit.fs * 1.12).toFixed(1)}px;` : "");
    const wc = rec.word_count || 0;
    const minutes = Math.max(1, Math.round(wc / 220));
    return `
      <a class="book ${lean} prog-${prog.state} ${prog.state}"
         href="#${encodeURI(file.path)}"
         data-path="${escapeHtml(file.path)}"
         style="--book-color:${color};--book-h:${dims.h}px;--book-w:${dims.w}px">
        <span class="spine"><span class="title-wrap"><span class="title ${titleClass}" style="${titleStyle}">${escapeHtml(title)}</span></span></span>
        <span class="tip">${escapeHtml(title)} · ${wc} ord · ${minutes} min</span>
      </a>`;
  }

  function shelfHtml(files, opts = {}) {
    if (!files.length) {
      return `<div class="shelf-scroll"><div class="shelf" style="color:var(--text-mute);justify-content:center;align-items:center">Ingen bøker enda</div></div>`;
    }
    const ordered = files.slice().sort((a, b) => {
      const ra = state.files[a.path], rb = state.files[b.path];
      const ao = numericOrder(ra), bo = numericOrder(rb);
      if (ao !== bo) return ao - bo;
      return (ra?.title || a.name).localeCompare(rb?.title || b.name, "nb");
    });
    return `<div class="shelf-scroll"><div class="shelf">${ordered.map(bookHtml).join("")}</div></div>`;
  }

  // ----- Library landing: every top-level subject as a shelf row. -----
  function renderLibrary() {
    if (typeof ttsStop === "function") ttsStop();
    state.libraryOpen = true;
    state.currentShelf = null;
    state.currentSubject = null;
    state.current = null;

    const subjects = topLevelSubjects();
    const sections = subjects.map(sub => {
      const allFiles = collectFilesInSubject(sub);
      const summary = progressSummary(allFiles);
      return `
        <section class="shelf-section">
          <div class="shelf-title">
            <h2>${escapeHtml(sub.name)}<span class="count">${allFiles.length} sider · ${summary.read} lest</span></h2>
            <a class="open-shelf" href="#$shelf/${encodeURI(sub.path)}" data-shelf="${escapeHtml(sub.path)}">Åpne hyllen →</a>
          </div>
          ${shelfHtml(allFiles)}
        </section>`;
    }).join("");

    // "Min Bokhylle" — personal shelves shown above the subject shelves.
    const personal = state.shelves.map(sh => {
      const files = sh.paths.filter(p => state.files[p]).map(p => ({ path: p, name: p.split("/").pop() }));
      return `
        <section class="shelf-section">
          <div class="shelf-title">
            <h2>${escapeHtml(sh.name)}<span class="count">${files.length} sider</span></h2>
            <a class="open-shelf" href="#$myshelf/${encodeURIComponent(sh.id)}" data-myshelf="${escapeHtml(sh.id)}">Åpne hyllen →</a>
          </div>
          ${files.length ? `<div class="shelf-scroll"><div class="shelf">${files.map(bookHtml).join("")}</div></div>` : `<div class="shelf-empty">Hyllen er tom.</div>`}
        </section>`;
    }).join("");
    const personalBlock = state.shelves.length
      ? `<section class="shelf-section" style="margin-bottom:6px">
           <div class="shelf-title">
             <h2 style="color:var(--accent)">Min bokhylle<span class="count">${state.shelves.length} ${state.shelves.length === 1 ? "hylle" : "hyller"}</span></h2>
             <a class="open-shelf" href="#" data-act="new-shelf">+ Ny hylle</a>
           </div>
         </section>
         ${personal}`
      : `<section class="shelf-section" style="margin-bottom:6px">
           <div class="shelf-title">
             <h2 style="color:var(--accent)">Min bokhylle<span class="count">tom</span></h2>
             <a class="open-shelf" href="#" data-act="new-shelf">+ Lag en hylle</a>
           </div>
           <div class="shelf-empty">Du har ingen egne hyller enda. Lag én for å samle sider — for eksempel "Til prøve" eller "Favoritter".</div>
         </section>`;

    const html = `
      <a href="#" class="library-exit" data-act="exit-library">× Lukk <kbd>Esc</kbd></a>
      <div class="library-view">
        <div class="library-stage">
          <header class="library-head">
            <h1>Biblioteket</h1>
            <div class="lib-sub">${subjects.length} fag · ${state.flatFiles.length} sider — klikk en bok for å åpne, eller "Åpne hyllen" for et helt fag.</div>
          </header>
          ${personalBlock}
          ${sections || `<p style="text-align:center;color:var(--text-mute)">Ingen fag funnet.</p>`}
        </div>
      </div>`;

    els.view.innerHTML = html;
    els.toc.innerHTML = "";
    els.crumbs.textContent = "Bibliotek";
    document.body.classList.add("library-mode");
    setStatus("Bibliotek åpnet.");
    highlightActive();
    wireLibraryExit(els.view);

    wireBookClicks(els.view);
    els.view.querySelectorAll(".open-shelf").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (a.dataset.act === "new-shelf") { promptNewShelf().then(sh => { if (sh) renderLibrary(); }); return; }
        if (a.dataset.myshelf) { openMyShelf(a.dataset.myshelf); return; }
        if (a.dataset.shelf) openShelf(a.dataset.shelf);
      });
    });
    const scroller = $(".pane-view");
    if (scroller) scroller.scrollTop = 0;

    history.replaceState(null, "", "#$library");
  }

  // ----- Single-subject bookshelf view: shelves grouped by sub-folder. -----
  function renderShelf(path) {
    const node = findTreeNode(path);
    if (!node || node.type !== "dir") return;
    if (typeof ttsStop === "function") ttsStop();
    state.libraryOpen = false;
    state.currentShelf = path;
    state.currentSubject = null;
    state.current = null;

    const directFiles = (node.children || []).filter(c => c.type === "file");
    const subDirs = (node.children || []).filter(c => c.type === "dir");
    const allFiles = collectFilesInSubject(node);
    const summary = progressSummary(allFiles);

    const subSections = subDirs.map(d => {
      const files = collectFilesInSubject(d);
      const sum = progressSummary(files);
      return `
        <section class="shelf-section">
          <div class="shelf-title">
            <h2>${escapeHtml(d.name)}<span class="count">${files.length} bøker · ${sum.read} lest</span></h2>
            <a class="open-shelf" href="#@${encodeURI(d.path)}" data-subj="${escapeHtml(d.path)}">Detaljvisning →</a>
          </div>
          ${shelfHtml(files)}
        </section>`;
    }).join("");

    const directSection = directFiles.length
      ? `<section class="shelf-section">
           <div class="shelf-title">
             <h2>I hovedmappen<span class="count">${directFiles.length} bøker</span></h2>
           </div>
           ${shelfHtml(directFiles)}
         </section>`
      : "";

    const html = `
      <a href="#" class="library-exit" data-act="exit-library">× Lukk <kbd>Esc</kbd></a>
      <div class="library-view">
        <div class="library-stage">
          <header class="library-head">
            <a class="lib-back" href="#$library">← Bibliotek</a>
            <h1>${escapeHtml(node.name)}</h1>
            <div class="lib-sub">${allFiles.length} sider · ${summary.read} lest · ${summary.partial} påbegynt</div>
          </header>
          ${directSection}
          ${subSections}
        </div>
      </div>`;

    els.view.innerHTML = html;
    els.toc.innerHTML = "";
    els.crumbs.textContent = `Bibliotek / ${node.name}`;
    document.body.classList.add("library-mode");
    setStatus(`Hylle: ${node.name}`);
    highlightActive();
    wireLibraryExit(els.view);

    wireBookClicks(els.view);
    els.view.querySelectorAll(".open-shelf").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openSubject(a.dataset.subj);
      });
    });
    els.view.querySelectorAll(".lib-back").forEach(a => {
      a.addEventListener("click", (e) => { e.preventDefault(); openLibrary(); });
    });
    const scroller = $(".pane-view");
    if (scroller) scroller.scrollTop = 0;

    history.replaceState(null, "", "#$shelf/" + encodeURI(path));
  }

  function bookContextMenuItems(path, extras = []) {
    const items = [
      { id: "open",   label: "Åpne",                 run: () => openFile(path) },
      { id: "side",   label: "Åpne i sidepanel",     run: () => openFile(path, { target: "side" }) },
      { id: "newtab", label: "Åpne i ny fane",       run: () => openFile(path, { target: "newTab" }) },
      { sep: true },
      { id: "preview", label: "Forhåndsvis",         run: () => openBookPreview(path) },
      { id: "shelf",   label: "Legg i bokhylle…",    run: () => openShelfPicker(path) },
    ];
    if (extras.length) items.push({ sep: true }, ...extras);
    return items;
  }
  function wireBookContextMenu(root, extrasFor) {
    root.querySelectorAll(".book").forEach(a => {
      a.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const path = a.dataset.path;
        const extras = extrasFor ? extrasFor(path) : [];
        openContextMenu(e.clientX, e.clientY, bookContextMenuItems(path, extras));
      });
      a.addEventListener("auxclick", (e) => {
        if (e.button === 1) { e.preventDefault(); openFile(a.dataset.path, { target: "newTab" }); }
      });
    });
  }
  function wireBookClicks(root, opts) {
    const o = opts || {};
    const previewMode = !(o.preview === false);
    root.querySelectorAll(".book").forEach(a => {
      a.addEventListener("click", (e) => {
        // Ignore clicks on the inline × remove button (used in MyShelf edit mode).
        if (e.target.closest(".remove-btn")) return;
        e.preventDefault();
        if (previewMode) openBookPreview(a.dataset.path);
        else openFile(a.dataset.path);
      });
    });
    wireBookContextMenu(root, o.contextExtrasFor);
  }

  // ----- Book preview modal -----
  function openBookPreview(path) {
    const rec = state.files[path] || {};
    const fm = rec.frontmatter || {};
    const title = rec.title || fm.title || path.split("/").pop().replace(/\.(md|markdown|txt)$/i, "");
    const summary = fm.summary || fm.sammendrag || fm.description || "";
    const tags = (rec.tags || []).slice();
    const wc = rec.word_count || 0;
    const minutes = Math.max(1, Math.round(wc / 220));
    const prog = getProgress(path);
    const progLabel = prog.state === "read" ? "✓ Lest" : prog.state === "partial" ? `◐ Påbegynt (${Math.round(prog.scrollPct || 0)} %)` : "○ Ikke lest";

    // Render any other frontmatter fields we don't already cover.
    const KNOWN = new Set(["title", "summary", "sammendrag", "description", "tags", "order", "color"]);
    const extraRows = Object.entries(fm)
      .filter(([k]) => !KNOWN.has(k))
      .map(([k, v]) => {
        let value = v;
        if (Array.isArray(v)) value = v.join(", ");
        else if (typeof v === "object" && v !== null) value = JSON.stringify(v);
        return `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(value))}</td></tr>`;
      });

    const innerHtml = `
      <h3 class="modal-title">${escapeHtml(title)}</h3>
      <div class="modal-body">
        ${summary ? `<p class="book-preview-summary">${escapeHtml(summary)}</p>` : ""}
        ${tags.length ? `<div class="book-preview-tags">${tags.map(t => `<span>#${escapeHtml(t)}</span>`).join(" ")}</div>` : ""}
        <div class="book-preview-meta">
          <span><strong>${wc.toLocaleString("nb-NO")}</strong> ord</span>
          <span>≈ <strong>${minutes}</strong> min lesetid</span>
          <span>${progLabel}</span>
        </div>
        <div class="book-preview-path"><code>${escapeHtml(path)}</code></div>
        ${extraRows.length ? `
          <table class="book-preview-fm">
            <tbody>${extraRows.join("")}</tbody>
          </table>` : ""}
        ${!summary && !tags.length && !extraRows.length
          ? `<p style="color:var(--text-mute);font-size:12.5px">Ingen frontmatter funnet for denne siden.</p>`
          : ""}
      </div>
      <div class="modal-actions">
        <button data-act="cancel">Avbryt</button>
        <button data-act="shelf">Legg i bokhylle…</button>
        <button class="primary" data-act="open">Åpne</button>
      </div>`;

    els.modalRoot.innerHTML = `<div class="modal" role="dialog">${innerHtml}</div>`;
    els.modalRoot.classList.remove("hidden");
    const close = () => { els.modalRoot.classList.add("hidden"); els.modalRoot.innerHTML = ""; document.removeEventListener("keydown", onEsc); };
    const onEsc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onEsc);
    els.modalRoot.addEventListener("click", (e) => { if (e.target === els.modalRoot) close(); }, { once: true });
    const m = els.modalRoot.querySelector(".modal");
    m.querySelector('[data-act="cancel"]').addEventListener("click", close);
    m.querySelector('[data-act="open"]').addEventListener("click", () => { close(); openFile(path); });
    m.querySelector('[data-act="shelf"]').addEventListener("click", () => { close(); openShelfPicker(path); });
    // Auto-focus the primary "Åpne" so Enter opens.
    setTimeout(() => m.querySelector('[data-act="open"]').focus(), 0);
  }
  function wireLibraryExit(root) {
    const btn = root.parentElement?.querySelector(".library-exit") ||
                document.querySelector(".library-exit");
    if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); exitLibrary(); });
  }

  function openLibrary() { renderLibrary(); }
  function openShelf(path) { renderShelf(path); }

  // ============================================================
  // Min Bokhylle — personal user-curated collections
  // ============================================================
  function persistShelves() {
    localStorage.setItem("tb.shelves", JSON.stringify(state.shelves));
  }
  function newShelfId() {
    return "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function findShelf(id) { return state.shelves.find(s => s.id === id) || null; }
  function createShelf(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const sh = { id: newShelfId(), name: trimmed, paths: [], created: Date.now() };
    state.shelves.push(sh);
    persistShelves();
    renderShelfSidebar();
    return sh;
  }
  function renameShelf(id, name) {
    const sh = findShelf(id); if (!sh) return;
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    sh.name = trimmed;
    persistShelves();
    renderShelfSidebar();
  }
  function deleteShelf(id) {
    state.shelves = state.shelves.filter(s => s.id !== id);
    persistShelves();
    renderShelfSidebar();
  }
  function addToShelf(id, path) {
    const sh = findShelf(id); if (!sh) return false;
    if (sh.paths.includes(path)) return false;
    sh.paths.push(path);
    persistShelves();
    renderShelfSidebar();
    return true;
  }
  function removeFromShelf(id, path) {
    const sh = findShelf(id); if (!sh) return;
    sh.paths = sh.paths.filter(p => p !== path);
    persistShelves();
    renderShelfSidebar();
  }
  function reorderShelf(id, from, to) {
    const sh = findShelf(id); if (!sh) return;
    if (from === to || from < 0 || from >= sh.paths.length) return;
    const [moved] = sh.paths.splice(from, 1);
    sh.paths.splice(to, 0, moved);
    persistShelves();
  }

  function renderShelfSidebar() {
    if (!state.shelves.length) {
      els.shelfList.innerHTML = `<li class="empty">Trykk + for å lage en hylle. Legg så til sider med 📥 i topplinjen, høyreklikk i menyen, eller dra en side hit.</li>`;
      return;
    }
    els.shelfList.innerHTML = state.shelves.map(sh => `
      <li class="shelf-row" data-id="${escapeHtml(sh.id)}" title="${escapeHtml(sh.name)} — ${sh.paths.length} sider">
        <span class="label">${escapeHtml(sh.name)}</span>
        <span class="count">${sh.paths.length}</span>
      </li>`).join("");
    els.shelfList.querySelectorAll("li.shelf-row").forEach(li => {
      const id = li.dataset.id;
      li.addEventListener("click", () => openMyShelf(id));
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, [
          { id: "open",   label: "Åpne hyllen",      run: () => openMyShelf(id) },
          { id: "rename", label: "Gi nytt navn…",    run: () => promptRenameShelf(id) },
          { sep: true },
          { id: "delete", label: "Slett hyllen",     run: () => confirmDeleteShelf(id), danger: true },
        ]);
      });
      // Drop a tree row's path onto a shelf to add.
      li.addEventListener("dragover", (e) => {
        if (!e.dataTransfer.types.includes("text/x-tb-path")) return;
        e.preventDefault();
        li.classList.add("drop-target");
      });
      li.addEventListener("dragleave", () => li.classList.remove("drop-target"));
      li.addEventListener("drop", (e) => {
        li.classList.remove("drop-target");
        const path = e.dataTransfer.getData("text/x-tb-path");
        if (path && state.files[path]) {
          const added = addToShelf(id, path);
          setStatus(added ? `Lagt til i "${findShelf(id).name}".` : `Allerede i "${findShelf(id).name}".`, "ok");
        }
      });
    });
  }

  async function promptRenameShelf(id) {
    const sh = findShelf(id); if (!sh) return;
    const name = await promptInput("Gi nytt navn til hyllen", "Navn", sh.name);
    if (name == null) return;
    renameShelf(id, name);
    if (state.currentMyShelf === id) openMyShelf(id);
  }
  async function confirmDeleteShelf(id) {
    const sh = findShelf(id); if (!sh) return;
    const ok = await confirmModal(`Slette "${sh.name}"?`, `Hyllen og dens ${sh.paths.length} sider fjernes fra Min bokhylle. Selve sidene slettes ikke.`);
    if (!ok) return;
    deleteShelf(id);
    if (state.currentMyShelf === id) {
      state.currentMyShelf = null;
      openLibrary();
    }
  }
  async function promptNewShelf(initial = "") {
    const name = await promptInput("Ny hylle", "Navn på hyllen", initial);
    if (name == null) return null;
    return createShelf(name);
  }

  // Minimal input/confirm modals (use existing modal-root).
  function showModalHtml(innerHtml, wireFn) {
    return new Promise((resolve) => {
      els.modalRoot.innerHTML = `<div class="modal" role="dialog">${innerHtml}</div>`;
      els.modalRoot.classList.remove("hidden");
      let resolved = false;
      const finish = (val) => {
        if (resolved) return;
        resolved = true;
        els.modalRoot.classList.add("hidden");
        els.modalRoot.innerHTML = "";
        document.removeEventListener("keydown", onEsc);
        resolve(val);
      };
      const onEsc = (e) => { if (e.key === "Escape") finish(null); };
      document.addEventListener("keydown", onEsc);
      els.modalRoot.addEventListener("click", (e) => { if (e.target === els.modalRoot) finish(null); }, { once: true });
      wireFn(els.modalRoot.querySelector(".modal"), finish);
    });
  }
  function promptInput(title, label, initial = "") {
    return showModalHtml(`
      <h3 class="modal-title">${escapeHtml(title)}</h3>
      <label style="display:block;font-size:12px;color:var(--text-dim);margin:0 0 6px">${escapeHtml(label)}</label>
      <input type="text" class="modal-input" value="${escapeHtml(initial)}" style="width:100%;background:var(--bg-elev-2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:5px;font-size:13px" />
      <div class="modal-actions">
        <button data-act="cancel">Avbryt</button>
        <button class="primary" data-act="ok">OK</button>
      </div>`,
    (m, finish) => {
      const input = m.querySelector(".modal-input");
      input.focus(); input.select();
      m.querySelector('[data-act="cancel"]').addEventListener("click", () => finish(null));
      m.querySelector('[data-act="ok"]').addEventListener("click", () => finish(input.value));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") finish(input.value);
      });
    });
  }
  function confirmModal(title, body) {
    return showModalHtml(`
      <h3 class="modal-title">${escapeHtml(title)}</h3>
      <p style="color:var(--text-dim);font-size:13px;margin:6px 0 0">${escapeHtml(body)}</p>
      <div class="modal-actions">
        <button data-act="cancel">Avbryt</button>
        <button class="primary" data-act="ok" style="background:var(--danger);border-color:var(--danger)">Slett</button>
      </div>`,
    (m, finish) => {
      m.querySelector('[data-act="cancel"]').addEventListener("click", () => finish(false));
      m.querySelector('[data-act="ok"]').addEventListener("click", () => finish(true));
    });
  }

  // Picker that lets the user toggle a path into one or more shelves, or create a new shelf.
  async function openShelfPicker(path) {
    const rec = state.files[path] || {};
    const renderRows = () => state.shelves.map(sh => {
      const inIt = sh.paths.includes(path);
      return `
        <div class="picker-row${inIt ? " in" : ""}" data-id="${escapeHtml(sh.id)}">
          <span>${escapeHtml(sh.name)} <span class="count">· ${sh.paths.length}</span></span>
          <span>${inIt ? "✓ I hyllen" : "+ Legg til"}</span>
        </div>`;
    }).join("") || `<div class="picker-row" style="cursor:default;color:var(--text-mute)">Ingen hyller enda</div>`;

    await showModalHtml(`
      <h3 class="modal-title">Legg "${escapeHtml(rec.title || path)}" i bokhylle</h3>
      <div class="picker-list" id="picker-list">${renderRows()}</div>
      <div class="picker-new-row">
        <input type="text" id="picker-new-name" placeholder="Lag ny hylle…" />
        <button id="picker-new-go">Opprett</button>
      </div>
      <div class="modal-actions">
        <button class="primary" data-act="close">Ferdig</button>
      </div>`,
    (m, finish) => {
      const refresh = () => { m.querySelector("#picker-list").innerHTML = renderRows(); wireRows(); };
      const wireRows = () => {
        m.querySelectorAll(".picker-row[data-id]").forEach(row => {
          row.addEventListener("click", () => {
            const id = row.dataset.id;
            const sh = findShelf(id); if (!sh) return;
            if (sh.paths.includes(path)) removeFromShelf(id, path);
            else addToShelf(id, path);
            refresh();
          });
        });
      };
      wireRows();
      m.querySelector("#picker-new-go").addEventListener("click", () => {
        const name = m.querySelector("#picker-new-name").value;
        const sh = createShelf(name);
        if (sh) { addToShelf(sh.id, path); m.querySelector("#picker-new-name").value = ""; refresh(); }
      });
      m.querySelector("#picker-new-name").addEventListener("keydown", (e) => {
        if (e.key === "Enter") m.querySelector("#picker-new-go").click();
      });
      m.querySelector('[data-act="close"]').addEventListener("click", () => finish(true));
    });
  }

  // ----- Personal shelf view (editable) -----
  function openMyShelf(id) {
    const sh = findShelf(id);
    if (!sh) { openLibrary(); return; }
    if (typeof ttsStop === "function") ttsStop();
    state.libraryOpen = false;
    state.currentShelf = null;
    state.currentSubject = null;
    state.currentMyShelf = id;
    state.current = null;
    document.body.classList.add("library-mode");
    renderMyShelf(sh);
    history.replaceState(null, "", "#$myshelf/" + encodeURIComponent(id));
    setStatus(`Min bokhylle: ${sh.name}`);
  }

  function renderMyShelf(sh) {
    const files = sh.paths
      .filter(p => state.files[p])
      .map(p => ({ path: p, name: p.split("/").pop() }));
    const missing = sh.paths.filter(p => !state.files[p]);

    // Render books in the user's chosen order (no sorting).
    const booksHtml = files.length
      ? `<div class="shelf-scroll"><div class="shelf">${files.map(f => {
          const html = bookHtml(f);
          // Inject a remove (×) button so edit mode can detach a page.
          return html.replace(/<\/a>$/, `<button class="remove-btn" data-remove="${escapeHtml(f.path)}" title="Fjern fra hyllen">×</button></a>`);
        }).join("")}</div></div>`
      : `<div class="shelf-empty">Hyllen er tom. Høyreklikk en side i menyen → "Legg i bokhylle…", eller dra og slipp en side på hyllens navn i sidemenyen.</div>`;

    const html = `
      <a href="#" class="library-exit" data-act="exit-library">× Lukk <kbd>Esc</kbd></a>
      <div class="library-view">
        <div class="library-stage">
          <header class="library-head">
            <a class="lib-back" href="#$library">← Bibliotek</a>
            <h1>${escapeHtml(sh.name)}
              <span class="shelf-head-actions">
                <button data-act="toggle-edit">Rediger</button>
                <button data-act="rename">Gi nytt navn</button>
                <button data-act="delete" class="danger">Slett hylle</button>
              </span>
            </h1>
            <div class="lib-sub">${files.length} sider${missing.length ? ` · ${missing.length} mangler` : ""}</div>
          </header>
          <section class="shelf-section">
            ${booksHtml}
          </section>
        </div>
      </div>`;

    els.view.innerHTML = html;
    els.toc.innerHTML = "";
    els.crumbs.textContent = `Min bokhylle / ${sh.name}`;
    highlightActive();
    wireLibraryExit(els.view);

    wireBookClicks(els.view, {
      contextExtrasFor: (path) => [
        { id: "remove", label: "Fjern fra hyllen",
          run: () => { removeFromShelf(sh.id, path); renderMyShelf(findShelf(sh.id)); },
          danger: true },
      ],
    });
    els.view.querySelectorAll(".lib-back").forEach(a => {
      a.addEventListener("click", (e) => { e.preventDefault(); openLibrary(); });
    });

    // Edit mode: drag-reorder + remove buttons.
    let editMode = false;
    const setEditMode = (on) => {
      editMode = on;
      els.view.querySelectorAll(".book").forEach(el => el.classList.toggle("removable", on));
      const btn = els.view.querySelector('[data-act="toggle-edit"]');
      if (btn) btn.textContent = on ? "Ferdig" : "Rediger";
    };
    els.view.querySelector('[data-act="toggle-edit"]').addEventListener("click", () => setEditMode(!editMode));
    els.view.querySelector('[data-act="rename"]').addEventListener("click", () => promptRenameShelf(sh.id));
    els.view.querySelector('[data-act="delete"]').addEventListener("click", () => confirmDeleteShelf(sh.id));

    els.view.querySelectorAll(".book").forEach((bookEl, idx) => {
      const path = bookEl.dataset.path;
      bookEl.querySelector(".remove-btn")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeFromShelf(sh.id, path);
        renderMyShelf(findShelf(sh.id));
      });
      // Drag-reorder within the shelf.
      bookEl.setAttribute("draggable", "true");
      bookEl.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/x-tb-shelf-idx", String(idx));
        e.dataTransfer.effectAllowed = "move";
      });
      bookEl.addEventListener("dragover", (e) => {
        if (!e.dataTransfer.types.includes("text/x-tb-shelf-idx")) return;
        e.preventDefault();
      });
      bookEl.addEventListener("drop", (e) => {
        if (!e.dataTransfer.types.includes("text/x-tb-shelf-idx")) return;
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData("text/x-tb-shelf-idx"), 10);
        const to = idx;
        if (Number.isFinite(from) && from !== to) {
          reorderShelf(sh.id, from, to);
          renderMyShelf(findShelf(sh.id));
        }
      });
    });

    const scroller = $(".pane-view");
    if (scroller) scroller.scrollTop = 0;
  }
  function exitLibrary() {
    state.libraryOpen = false;
    state.currentShelf = null;
    state.currentMyShelf = null;
    document.body.classList.remove("library-mode");
    const last = localStorage.getItem("tb.lastPath");
    if (last && state.files[last]) { openFile(last); return; }
    const landing = findLandingPage();
    if (landing) { openFile(landing); return; }
    // Nothing to fall back to: bare welcome.
    els.view.innerHTML = `<div class="welcome"><h1>Velkommen!</h1>
      <p>Åpne en side fra menyen, eller trykk <strong>📚</strong> for å se biblioteket.</p></div>`;
    els.crumbs.textContent = "Velg en side i menyen";
    history.replaceState(null, "", "#");
  }

  // ============================================================
  // Graph view (Obsidian-style)
  // ============================================================
  let activeGraphCloser = null;
  function graphIsOpen() { return !els.graphRoot.classList.contains("hidden"); }
  function toggleGraph() {
    if (graphIsOpen() && activeGraphCloser) activeGraphCloser();
    else openGraph();
  }
  function openGraph() {
    const allFiles = state.flatFiles.map(f => {
      const rec = state.files[f.path] || {};
      return {
        path: f.path,
        label: rec.title || f.name.replace(/\.(md|markdown|txt)$/i, ""),
        folder: f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "",
        tags: Array.isArray(rec.tags) ? rec.tags.map(t => String(t).toLowerCase()) : [],
        links: (rec.resolved_links || []).filter(d => d !== f.path),
      };
    });
    if (!allFiles.length) { setStatus("Ingen sider å vise i graf.", "err"); return; }

    els.graphRoot.innerHTML = `
      <div class="graph-head">
        <h3>Graf<span class="stats" id="graph-stats"></span></h3>
        <div class="graph-controls">
          <input type="search" id="graph-filter" placeholder="Filtrer noder…  (#tag for emne)" autocomplete="off" />
          <button data-act="recenter" title="Sentrer (R)">Sentrer</button>
          <button data-act="close" title="Lukk (Esc)">Lukk</button>
        </div>
      </div>
      <svg class="graph-svg">
        <g class="links"></g>
        <g class="nodes"></g>
      </svg>
      <div class="graph-hint">Skroll for å zoome · dra bakgrunnen for å panorere · dra en node for å flytte · klikk en node for å åpne</div>`;
    els.graphRoot.classList.remove("hidden");
    state.graphOpen = true;

    const svg = els.graphRoot.querySelector("svg");
    const linksG = svg.querySelector(".links");
    const nodesG = svg.querySelector(".nodes");
    const statsEl = els.graphRoot.querySelector("#graph-stats");
    const filterInput = els.graphRoot.querySelector("#graph-filter");
    const NS = "http://www.w3.org/2000/svg";

    const view = { x: -500, y: -400, w: 1000, h: 800 };
    function applyViewBox() { svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`); }
    applyViewBox();

    // Sunflower seeded layout
    const nodes = [];
    const byId = new Map();
    allFiles.forEach((f, i) => {
      const angle = i * 2.39996;
      const r = 14 * Math.sqrt(i + 1);
      const n = {
        id: f.path, label: f.label, folder: f.folder, tags: f.tags,
        x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0,
        degree: 0, neighbors: new Set(), fixed: false,
      };
      byId.set(f.path, n); nodes.push(n);
    });
    const links = [];
    const linkSet = new Set();
    for (const f of allFiles) {
      const a = byId.get(f.path); if (!a) continue;
      for (const dst of f.links) {
        const b = byId.get(dst);
        if (!b || a === b) continue;
        const key = a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id;
        if (linkSet.has(key)) continue;
        linkSet.add(key);
        links.push({ source: a, target: b });
        a.degree++; b.degree++;
        a.neighbors.add(b.id); b.neighbors.add(a.id);
      }
    }
    statsEl.textContent = ` ${nodes.length} noder · ${links.length} lenker`;

    function nodeRadius(n) { return 4 + Math.min(8, n.degree); }

    const linkEls = links.map(() => {
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("class", "link");
      linksG.appendChild(ln);
      return ln;
    });
    const nodeEls = nodes.map(n => {
      const r = nodeRadius(n);
      const labelText = n.label;
      const hitW = (r + 6) + labelText.length * 6 + 6;
      const hitH = Math.max(r * 2 + 8, 18);
      n._left = -(r + 4); n._right = -(r + 4) + hitW;
      n._top = -hitH / 2; n._bottom = hitH / 2;
      const g = document.createElementNS(NS, "g");
      const cls = ["node"];
      const prog = getProgress(n.id);
      if (prog.state === "read") cls.push("read");
      else if (prog.state === "partial") cls.push("partial");
      if (state.current && n.id === state.current.path) cls.push("active");
      g.setAttribute("class", cls.join(" "));
      g.dataset.id = n.id;
      const hit = document.createElementNS(NS, "rect");
      hit.setAttribute("class", "hit");
      hit.setAttribute("x", -(r + 4)); hit.setAttribute("y", -hitH / 2);
      hit.setAttribute("width", hitW); hit.setAttribute("height", hitH);
      hit.setAttribute("rx", 4);
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("r", r);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", r + 3); t.setAttribute("y", 3);
      t.textContent = labelText;
      const title = document.createElementNS(NS, "title");
      title.textContent = n.id;
      g.appendChild(title); g.appendChild(hit); g.appendChild(c); g.appendChild(t);
      nodesG.appendChild(g);
      attachNodeHandlers(g, n);
      return g;
    });

    function attachNodeHandlers(g, n) {
      g.addEventListener("click", (ev) => {
        if (g.dataset.dragged === "1") { delete g.dataset.dragged; return; }
        closeGraph();
        openFile(n.id);
      });
      g.addEventListener("mouseenter", () => {
        for (let i = 0; i < nodes.length; i++) {
          const other = nodes[i];
          const on = other.id === n.id || n.neighbors.has(other.id);
          nodeEls[i].classList.toggle("dim", !on);
          nodeEls[i].classList.toggle("hl", on && other.id !== n.id);
        }
        for (let i = 0; i < links.length; i++) {
          const l = links[i];
          const on = l.source.id === n.id || l.target.id === n.id;
          linkEls[i].classList.toggle("dim", !on);
          linkEls[i].classList.toggle("hl", on);
        }
      });
      g.addEventListener("mouseleave", () => {
        nodeEls.forEach(el => el.classList.remove("dim", "hl"));
        linkEls.forEach(el => el.classList.remove("dim", "hl"));
      });
    }

    let alpha = 1, raf = null;
    function paintPositions() {
      for (let i = 0; i < links.length; i++) {
        const l = links[i], el = linkEls[i];
        el.setAttribute("x1", l.source.x.toFixed(1));
        el.setAttribute("y1", l.source.y.toFixed(1));
        el.setAttribute("x2", l.target.x.toFixed(1));
        el.setAttribute("y2", l.target.y.toFixed(1));
      }
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        nodeEls[i].setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
      }
    }
    function tick() {
      // Repulsion (O(n²); fine for textbook scale)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let dist2 = dx * dx + dy * dy + 0.01;
          const f = 800 / dist2;
          const d = Math.sqrt(dist2);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }
      for (const l of links) {
        const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = (d - 80) * 0.02;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        l.source.vx += fx; l.source.vy += fy;
        l.target.vx -= fx; l.target.vy -= fy;
      }
      // Soft folder cohesion (weak, just to cluster topics)
      const groupCx = new Map(), groupCy = new Map(), groupN = new Map();
      for (const n of nodes) {
        if (!n.folder) continue;
        groupCx.set(n.folder, (groupCx.get(n.folder) || 0) + n.x);
        groupCy.set(n.folder, (groupCy.get(n.folder) || 0) + n.y);
        groupN.set(n.folder, (groupN.get(n.folder) || 0) + 1);
      }
      for (const n of nodes) {
        if (!n.folder) continue;
        const c = groupN.get(n.folder); if (c < 2) continue;
        const cx = groupCx.get(n.folder) / c, cy = groupCy.get(n.folder) / c;
        n.vx += (cx - n.x) * 0.015; n.vy += (cy - n.y) * 0.015;
      }
      for (const n of nodes) {
        if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
        n.vx -= n.x * 0.005; n.vy -= n.y * 0.005;
        n.x += n.vx * alpha; n.y += n.vy * alpha;
        n.vx *= 0.6; n.vy *= 0.6;
      }
      // Collision pass on label footprint
      const PAD = 4;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const aL = a.x + a._left - PAD, aR = a.x + a._right + PAD;
            const aT = a.y + a._top - PAD,  aB = a.y + a._bottom + PAD;
            const bL = b.x + b._left - PAD, bR = b.x + b._right + PAD;
            const bT = b.y + b._top - PAD,  bB = b.y + b._bottom + PAD;
            const ox = Math.min(aR, bR) - Math.max(aL, bL);
            const oy = Math.min(aB, bB) - Math.max(aT, bT);
            if (ox > 0 && oy > 0) {
              if (ox < oy) {
                const sign = (a.x < b.x) ? -1 : 1;
                const shift = (ox / 2) * sign;
                if (!a.fixed) a.x += shift;
                if (!b.fixed) b.x -= shift;
              } else {
                const sign = (a.y < b.y) ? -1 : 1;
                const shift = (oy / 2) * sign;
                if (!a.fixed) a.y += shift;
                if (!b.fixed) b.y -= shift;
              }
            }
          }
        }
      }
      alpha *= 0.985;
    }
    function step() {
      if (alpha < 0.01) { raf = null; paintPositions(); return; }
      tick(); paintPositions();
      raf = requestAnimationFrame(step);
    }
    function reheat(a = 1) { alpha = Math.max(alpha, a); if (!raf) step(); }

    function clientToSvg(cx, cy) {
      const pt = svg.createSVGPoint();
      pt.x = cx; pt.y = cy;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: cx, y: cy };
      const r = pt.matrixTransform(ctm.inverse());
      return { x: r.x, y: r.y };
    }
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const before = clientToSvg(e.clientX, e.clientY);
      view.w *= factor; view.h *= factor;
      applyViewBox();
      const after = clientToSvg(e.clientX, e.clientY);
      view.x += before.x - after.x;
      view.y += before.y - after.y;
      applyViewBox();
    }, { passive: false });

    let dragNode = null, dragNodeEl = null, panning = null;
    svg.addEventListener("mousedown", (e) => {
      const target = e.target.closest(".node");
      if (target) {
        const idx = nodeEls.indexOf(target);
        dragNode = nodes[idx]; dragNodeEl = target;
        dragNode.fixed = true;
        target.classList.add("dragging");
      } else {
        const ctm = svg.getScreenCTM();
        const sx = ctm ? 1 / ctm.a : view.w / svg.clientWidth;
        const sy = ctm ? 1 / ctm.d : view.h / svg.clientHeight;
        panning = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, sx, sy };
        svg.classList.add("panning");
      }
    });
    function onMouseMove(e) {
      if (dragNode) {
        const p = clientToSvg(e.clientX, e.clientY);
        const moved = Math.abs(p.x - dragNode.x) + Math.abs(p.y - dragNode.y);
        if (moved > 0.5) dragNodeEl.dataset.dragged = "1";
        dragNode.x = p.x; dragNode.y = p.y;
        dragNode.vx = 0; dragNode.vy = 0;
        reheat(0.3);
      } else if (panning) {
        view.x = panning.vx - (e.clientX - panning.x) * panning.sx;
        view.y = panning.vy - (e.clientY - panning.y) * panning.sy;
        applyViewBox();
      }
    }
    function onMouseUp() {
      if (dragNode) {
        dragNode.fixed = false;
        dragNodeEl.classList.remove("dragging");
        dragNode = null; dragNodeEl = null;
      }
      panning = null;
      svg.classList.remove("panning");
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    filterInput.addEventListener("input", () => {
      const raw = filterInput.value.trim().toLowerCase();
      const tagTerms = [], textTerms = [];
      for (const tok of raw.split(/\s+/).filter(Boolean)) {
        if (tok.startsWith("#")) { const t = tok.slice(1); if (t) tagTerms.push(t); }
        else textTerms.push(tok);
      }
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const tagHit = tagTerms.every(t => n.tags.some(nt => nt === t || nt.startsWith(t)));
        const textHit = textTerms.every(t =>
          n.label.toLowerCase().includes(t) ||
          n.id.toLowerCase().includes(t) ||
          n.tags.some(nt => nt.includes(t)) ||
          (n.folder && n.folder.toLowerCase().includes(t))
        );
        const hit = !raw || (tagHit && textHit);
        nodeEls[i].classList.toggle("filtered-out", !hit);
      }
    });

    function recenter() {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (n.x < minX) minX = n.x; if (n.y < minY) minY = n.y;
        if (n.x > maxX) maxX = n.x; if (n.y > maxY) maxY = n.y;
      }
      if (!isFinite(minX)) return;
      const pad = 80;
      view.x = minX - pad; view.y = minY - pad;
      view.w = Math.max(200, maxX - minX + pad * 2);
      view.h = Math.max(200, maxY - minY + pad * 2);
      applyViewBox();
    }

    function closeGraph() {
      if (raf) cancelAnimationFrame(raf);
      els.graphRoot.classList.add("hidden");
      els.graphRoot.innerHTML = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKey);
      activeGraphCloser = null;
      state.graphOpen = false;
    }
    function onKey(ev) {
      if (els.graphRoot.classList.contains("hidden")) return;
      if (ev.key === "Escape") { ev.preventDefault(); closeGraph(); }
      else if (ev.key === "r" && document.activeElement !== filterInput) { ev.preventDefault(); recenter(); }
      else if (ev.key === "/" && document.activeElement !== filterInput) { ev.preventDefault(); filterInput.focus(); }
    }
    activeGraphCloser = closeGraph;

    els.graphRoot.querySelector('[data-act="close"]').addEventListener("click", closeGraph);
    els.graphRoot.querySelector('[data-act="recenter"]').addEventListener("click", () => { recenter(); reheat(0.3); });
    document.addEventListener("keydown", onKey);

    // Settle synchronously for a stable initial layout
    for (let i = 0; i < 120 && alpha > 0.05; i++) tick();
    recenter();
    paintPositions();
    raf = requestAnimationFrame(step);
  }

  // ============================================================
  // Wire events
  // ============================================================
  function wireEvents() {
    els.search.addEventListener("input", onSearchInput);
    els.search.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { els.search.value = ""; onSearchInput(); }
    });

    els.btnLeftToggle.addEventListener("click", () => {
      state.leftCollapsed = !state.leftCollapsed;
      document.body.classList.toggle("left-collapsed", state.leftCollapsed);
      document.body.classList.toggle("left-open", !state.leftCollapsed);
      localStorage.setItem("tb.leftCollapsed", state.leftCollapsed ? "1" : "0");
    });

    els.btnTocToggle.addEventListener("click", () => {
      state.tocCollapsed = !state.tocCollapsed;
      $(".pane-view").classList.toggle("toc-collapsed", state.tocCollapsed);
      localStorage.setItem("tb.tocCollapsed", state.tocCollapsed ? "1" : "0");
    });

    els.btnTheme.addEventListener("click", openThemePicker);

    els.btnHelp.addEventListener("click", openShortcutsModal);

    els.btnSideToggle.addEventListener("click", () => {
      if (state.sideTab) {
        closeSidePane();
      } else if (state.tabs.length > 1 && state.activeIdx >= 0) {
        // Helpful default: split off whatever's NOT active so the user sees two docs.
        const other = state.tabs.findIndex((_, i) => i !== state.activeIdx);
        if (other >= 0) moveTabToSide(other);
      } else if (state.tabs.length === 1 && state.activeIdx >= 0) {
        // Only one tab — splitting it would empty the primary. Open library hint instead.
        setStatus("Åpne en side til først — så kan du dra fanen hit, eller bruk høyreklikk → “Åpne i sidepanel”.", "");
      } else {
        setStatus("Åpne en side først for å bruke sidepanelet.", "");
      }
    });

    els.sideClose.addEventListener("click", () => closeSidePane());
    wireSidePaneDrop();

    els.btnNewShelf.addEventListener("click", () => promptNewShelf());

    els.btnTts.addEventListener("click", toggleTtsPop);
    window.addEventListener("beforeunload", () => { if (tts.available) window.speechSynthesis.cancel(); });

    // Click anywhere in the reading view toggles TTS off (when active).
    // Exempt links and buttons so navigation and the per-heading ▶ button still work.
    els.view.addEventListener("click", (e) => {
      if (!(tts.isPlaying || tts.isPaused)) return;
      if (e.target.closest("a, button, input, select, textarea")) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      ttsStop();
    }, true);

    // Right-click inside the view → playback context menu.
    els.view.addEventListener("contextmenu", (e) => {
      if (e.target.closest("a, button, input, select, textarea")) return;
      const sid = sentenceIdFromEvent(e);
      // No sentences available at all and not playing → leave native menu.
      if (sid == null && !(tts.isPlaying || tts.isPaused)) return;
      e.preventDefault();
      const items = [];
      if (sid != null) {
        items.push({ id: "fromhere", label: "Les opp herfra", run: () => ttsPlayFrom(sid, Infinity) });
        const head = enclosingHeadingForSentence(sid);
        if (head) items.push({ id: "section", label: "Les opp denne seksjonen", run: () => ttsPlaySection(head) });
      }
      if (tts.isPlaying || tts.isPaused) {
        if (items.length) items.push({ sep: true });
        if (tts.isPaused) items.push({ id: "resume", label: "Fortsett opplesing", run: () => ttsResume() });
        else items.push({ id: "pause", label: "Pause opplesing", run: () => ttsPause() });
        items.push({ id: "stop", label: "Stopp opplesing", run: () => ttsStop(), danger: true });
      }
      if (items.length) items.push({ sep: true });
      items.push({ id: "pop", label: "Åpne opplesingsmeny", run: () => { if (!_ttsPop) openTtsPop(); } });
      openContextMenu(e.clientX, e.clientY, items);
    });

    // Right-click on the side header → small menu (move back to main / close).
    const sideHead = els.paneSide.querySelector(".side-head");
    if (sideHead) {
      sideHead.addEventListener("contextmenu", (e) => {
        if (!state.sideTab) return;
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, [
          { id: "main",  label: "Flytt til hovedpanel", run: () => moveSideToPrimary() },
          { sep: true },
          { id: "close", label: "Lukk sidepanel", run: () => closeSidePane(), danger: true },
        ]);
      });
    }

    // Track which pane is "active" for section-nav keys.
    els.paneView.addEventListener("mousedown", () => setActivePaneKey("primary"));
    els.paneSide.addEventListener("mousedown", () => setActivePaneKey("side"));

    els.btnFocus.addEventListener("click", () => toggleFocus());

    els.btnPrint.addEventListener("click", () => window.print());

    els.btnBookmark.addEventListener("click", toggleBookmark);
    els.btnShelfAdd.addEventListener("click", () => {
      const path = state.current && state.current.path;
      if (!path) { setStatus("Åpne en side først for å legge den i en bokhylle.", ""); return; }
      openShelfPicker(path);
    });
    els.btnMarkRead.addEventListener("click", toggleReadStatus);
    els.btnLibrary.addEventListener("click", () => {
      if (graphIsOpen() && activeGraphCloser) activeGraphCloser();
      openLibrary();
    });
    els.btnGraph.addEventListener("click", toggleGraph);

    document.querySelectorAll(".font-btn").forEach(b => {
      b.addEventListener("click", () => {
        const op = b.dataset.font;
        if (op === "inc") applyFontSize(state.fontSize + 1);
        else if (op === "dec") applyFontSize(state.fontSize - 1);
        else applyFontSize(17);
      });
    });
    document.querySelectorAll(".width-btn").forEach(b => {
      b.addEventListener("click", () => {
        const op = b.dataset.width;
        if (op === "inc") applyWidth(state.width + 80);
        else if (op === "dec") applyWidth(state.width - 80);
        else applyWidth(880);
      });
    });

    window.addEventListener("hashchange", () => {
      const h = decodeURIComponent((location.hash || "").replace(/^#/, ""));
      if (h === "$library") {
        if (!state.libraryOpen) openLibrary();
      } else if (h.startsWith("$shelf/")) {
        const p = h.slice("$shelf/".length);
        if (state.currentShelf !== p) openShelf(p);
      } else if (h.startsWith("$myshelf/")) {
        const id = h.slice("$myshelf/".length);
        if (state.currentMyShelf !== id) openMyShelf(id);
      } else if (h.startsWith("@")) {
        const sub = h.slice(1);
        if (state.currentSubject !== sub) openSubject(sub);
      } else if (h && state.files[h] && (!state.current || state.current.path !== h)) {
        openFile(h);
      }
    });

    document.addEventListener("keydown", (e) => {
      const inText = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);

      // Esc behaviors always available.
      if (e.key === "Escape") {
        if (state.focusMode) { e.preventDefault(); toggleFocus(false); return; }
        if (state.libraryOpen || state.currentShelf || state.currentMyShelf) { e.preventDefault(); exitLibrary(); return; }
        if (document.activeElement === els.search) { els.search.value = ""; onSearchInput(); return; }
      }

      const ctrl = e.ctrlKey || e.metaKey;

      // Shortcuts that work even while typing in inputs.
      if (e.key === "/" && !inText) {
        e.preventDefault();
        els.search.focus();
        els.search.select();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "k") {
        e.preventDefault();
        els.search.focus();
        els.search.select();
        return;
      }
      if (e.key === "F11") { e.preventDefault(); toggleFocus(); return; }
      if (ctrl && e.key.toLowerCase() === "b") { e.preventDefault(); els.btnLeftToggle.click(); return; }
      if (ctrl && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const s = getPaneScroller(state.activePaneKey);
        if (s) { e.preventDefault(); s.scrollTo({ top: e.key === "ArrowUp" ? 0 : s.scrollHeight, behavior: "smooth" }); }
        return;
      }
      if (ctrl && (e.key === "=" || e.key === "+")) { e.preventDefault(); applyFontSize(state.fontSize + 1); return; }
      if (ctrl && e.key === "-") { e.preventDefault(); applyFontSize(state.fontSize - 1); return; }
      if (ctrl && e.key === "0") { e.preventDefault(); applyFontSize(17); return; }

      // The remaining single-key bindings are suppressed while typing.
      if (inText) return;

      // Spacebar pauses/resumes TTS when active. Falls through to default scrolling otherwise.
      if (e.key === " " && (tts.isPlaying || tts.isPaused)) {
        e.preventDefault();
        if (tts.isPaused) ttsResume(); else ttsPause();
        return;
      }

      switch (e.key) {
        case "f": case "F":
          e.preventDefault(); toggleFocus(); return;
        case "c": case "C":
          e.preventDefault(); els.btnTocToggle.click(); return;
        case "t": case "T":
          e.preventDefault(); openThemePicker(); return;
        case "?":
          e.preventDefault(); openShortcutsModal(); return;
        case "ArrowLeft":
          e.preventDefault(); jumpSection(-1); return;
        case "ArrowRight":
          e.preventDefault(); jumpSection(1); return;
        case "+": case "=":
          e.preventDefault(); applyFontSize(state.fontSize + 1); return;
        case "-":
          e.preventDefault(); applyFontSize(state.fontSize - 1); return;
        case "0":
          e.preventDefault(); applyFontSize(17); return;
        case ".":
          e.preventDefault(); applyWidth(state.width + 80); return;
        case ",":
          e.preventDefault(); applyWidth(state.width - 80); return;
        case "9":
          e.preventDefault(); applyWidth(880); return;
      }
    });

    window.addEventListener("beforeunload", persistScroll);
  }

  function jumpSection(dir) {
    const scroller = getPaneScroller(state.activePaneKey);
    const view = getPaneView(state.activePaneKey);
    if (!scroller || !view) return;
    const headings = Array.from(view.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    if (!headings.length) {
      scroller.scrollBy({ top: dir * scroller.clientHeight * 0.85, behavior: "smooth" });
      return;
    }
    const containerTop = scroller.getBoundingClientRect().top;
    let curIdx = -1;
    for (let i = 0; i < headings.length; i++) {
      const t = headings[i].getBoundingClientRect().top - containerTop;
      if (t <= 24) curIdx = i;
      else break;
    }
    let nextIdx;
    if (dir > 0) {
      nextIdx = curIdx + 1;
      if (nextIdx >= headings.length) {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
        return;
      }
    } else {
      const cur = headings[Math.max(0, curIdx)];
      const t = cur ? cur.getBoundingClientRect().top - containerTop : 0;
      if (curIdx >= 0 && t < -24) nextIdx = curIdx;
      else nextIdx = curIdx - 1;
      if (nextIdx < 0) {
        scroller.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }
    headings[nextIdx].scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleFocus(force) {
    state.focusMode = typeof force === "boolean" ? force : !state.focusMode;
    document.body.classList.toggle("focus-mode", state.focusMode);
    if (state.focusMode && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (!state.focusMode && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  // Boot.
  document.addEventListener("DOMContentLoaded", bootstrap);
})();
