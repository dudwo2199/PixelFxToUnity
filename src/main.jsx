import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { APP_VERSION, CATEGORIES, CATEGORY_LABELS, EFFECTS, EFFECT_BY_ID, loadEffect, PALETTES, PALETTE_NAMES, SETTINGS_SCHEMA } from "./data/catalog.js";
import { createPlayer } from "./engine/pixel-render.js";
import { createUnityPackage } from "./engine/unity-package.js";
import "./style.css";

const STORAGE_KEY = "pixelfx-to-unity.settings.v1";
const PAGE_SIZE = 36;

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (stored.schema !== SETTINGS_SCHEMA || !stored.effects || typeof stored.effects !== "object") return {};
    return sanitizeConfigs(stored.effects);
  } catch {
    return {};
  }
}

function sanitizeConfigs(raw) {
  const next = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!EFFECT_BY_ID.has(id) || !value || typeof value !== "object") continue;
    const effect = EFFECT_BY_ID.get(id);
    const fps = Number(value.fps);
    const palette = value.palette ?? null;
    if (!Number.isInteger(fps) || fps < 1 || fps > 60) continue;
    if (palette !== null && !PALETTES[palette]) continue;
    if (fps === effect.meta.fps && palette === null) continue;
    next[id] = { fps, palette };
  }
  return next;
}

function settingsFor(effect, configs) {
  return configs[effect.id] ?? { fps: effect.meta.fps, palette: null };
}

function App() {
  const [configs, setConfigs] = useState(readSettings);
  const [selected, setSelected] = useState(() => new Set());
  const [activeId, setActiveId] = useState(EFFECTS[0]?.id ?? "");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const importRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: SETTINGS_SCHEMA, appVersion: APP_VERSION, effects: configs }));
  }, [configs]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = setTimeout(() => setNotice(""), 3600);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeEffect = EFFECT_BY_ID.get(activeId) ?? EFFECTS[0];
  const activeSettings = activeEffect ? settingsFor(activeEffect, configs) : null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return EFFECTS.filter((effect) => {
      if (category !== "all" && effect.category !== category) return false;
      if (!needle) return true;
      return [effect.name, effect.id, effect.meta.desc, ...(effect.meta.tags ?? [])].join(" ").toLocaleLowerCase().includes(needle);
    });
  }, [category, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [category, query]);

  const updateSetting = (effect, key, value) => {
    setConfigs((current) => {
      const defaults = settingsFor(effect, current);
      const nextEntry = { ...defaults, [key]: value };
      if (nextEntry.fps === effect.meta.fps && nextEntry.palette === null) {
        const next = { ...current };
        delete next[effect.id];
        return next;
      }
      return { ...current, [effect.id]: nextEntry };
    });
  };

  const resetEffect = (effect) => {
    setConfigs((current) => {
      if (!current[effect.id]) return current;
      const next = { ...current };
      delete next[effect.id];
      return next;
    });
    setNotice(`${effect.name} 설정을 원본으로 되돌렸습니다.`);
  };

  const toggleSelection = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleVisible = () => setSelected((current) => {
    const next = new Set(current);
    const allOn = shown.every((effect) => next.has(effect.id));
    for (const effect of shown) allOn ? next.delete(effect.id) : next.add(effect.id);
    return next;
  });

  const exportSettings = () => {
    const json = {
      format: "pixelfx-to-unity-settings",
      schema: SETTINGS_SCHEMA,
      appVersion: APP_VERSION,
      savedAt: new Date().toISOString(),
      effects: configs,
    };
    download(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }), "PixelFx-settings.json");
    setNotice("설정 JSON을 저장했습니다.");
  };

  const importSettings = async (file) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.format !== "pixelfx-to-unity-settings" || parsed.schema !== SETTINGS_SCHEMA || !parsed.effects || typeof parsed.effects !== "object") {
        throw new Error("PixelFx 설정 파일 형식 또는 버전이 맞지 않습니다.");
      }
      const valid = sanitizeConfigs(parsed.effects);
      const skipped = Object.keys(parsed.effects).length - Object.keys(valid).length;
      setConfigs(valid);
      setNotice(skipped ? `설정을 불러왔습니다. 사용할 수 없는 ${skipped}개 항목은 제외했습니다.` : "설정을 불러왔습니다.");
    } catch (error) {
      setNotice(error instanceof SyntaxError ? "JSON 파일을 읽을 수 없습니다." : error.message);
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  const exportPackage = async () => {
    const chosen = EFFECTS.filter((effect) => selected.has(effect.id));
    if (!chosen.length) {
      setNotice("먼저 내보낼 이펙트를 선택해 주세요.");
      return;
    }
    setBusy(true);
    setProgress({ current: 0, total: chosen.length, label: "준비 중" });
    try {
      const blob = await createUnityPackage(chosen, (effect) => settingsFor(effect, configs), setProgress);
      download(blob, "PixelFx-Effects.unitypackage");
      setNotice(`${chosen.length}개 이펙트를 Unity 패키지로 저장했습니다.`);
    } catch (error) {
      setNotice(`패키지 생성 실패: ${error.message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="PixelFx to Unity 홈">
        <span className="brand-mark"><i /><i /><i /><i /></span>
        <span className="brand-name">PIXELFX <span>→</span> UNITY</span>
        <span className="brand-badge">STUDIO</span>
      </a>
      <div className="top-actions">
        <span className="offline-indicator"><i /> 오프라인 에셋 준비됨</span>
        <button className="quiet-button" onClick={exportSettings} title="현재 편집 설정을 JSON으로 저장">설정 내보내기</button>
        <button className="quiet-button" onClick={() => importRef.current?.click()} title="JSON 설정 불러오기">설정 불러오기</button>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => event.target.files?.[0] && importSettings(event.target.files[0])} />
        <button className="export-button" disabled={busy} onClick={exportPackage}>
          {busy ? <><span className="spinner" /> 패키지 생성 중</> : <>선택 항목 내보내기 <span className="button-count">{selected.size}</span></>}
        </button>
      </div>
    </header>

    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-heading"><span>LIBRARY</span><span className="count-chip">{EFFECTS.length}</span></div>
        <button className={`category-link ${category === "all" ? "active" : ""}`} onClick={() => setCategory("all")}>
          <span className="category-glyph">▦</span><span>전체 이펙트</span><b>{EFFECTS.length}</b>
        </button>
        <div className="category-list">
          {CATEGORIES.map((item) => {
            const count = EFFECTS.filter((effect) => effect.category === item.id).length;
            return <button key={item.id} className={`category-link ${category === item.id ? "active" : ""}`} onClick={() => setCategory(item.id)}>
              <span className={`category-dot ${item.id}`} />
              <span>{item.name}</span><b>{count}</b>
            </button>;
          })}
        </div>
        <div className="sidebar-foot">
          <div className="license-label">SOURCE</div>
          <a href="https://github.com/patch-gg/pixelfx" target="_blank" rel="noreferrer">PixelFx · MIT <span>↗</span></a>
          <small>공식 에셋 232종을 로컬에 포함</small>
        </div>
      </aside>

      <main className="library-panel" id="top">
        <div className="library-intro">
          <div>
            <div className="eyebrow">PIXEL ART EFFECTS · UNITY PIPELINE</div>
            <h1>이펙트 라이브러리<span className="title-period">.</span></h1>
            <p>이펙트를 골라 속도와 팔레트를 조정하고, Unity 패키지로 한 번에 내보내세요.</p>
          </div>
          <div className="intro-stat"><strong>{EFFECTS.length}</strong><span>CURATED EFFECTS</span></div>
        </div>

        <div className="toolbar">
          <label className="search-field"><span className="search-icon">⌕</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이펙트 검색..." /><kbd>Ctrl K</kbd></label>
          <div className="toolbar-right"><span className="result-count">{filtered.length}개 결과</span><button className="select-visible" onClick={toggleVisible}>{shown.length && shown.every((effect) => selected.has(effect.id)) ? "현재 페이지 해제" : "현재 페이지 선택"}</button></div>
        </div>

        {selected.size > 0 && <div className="selection-banner"><span className="check-badge">✓</span><strong>{selected.size}개 이펙트 선택됨</strong><span>선택한 항목을 하나의 Unity 패키지로 내보냅니다.</span><button onClick={() => setSelected(new Set())}>선택 해제</button></div>}

        {shown.length ? <div className="effect-grid">
          {shown.map((effect) => <EffectCard key={effect.id} effect={effect} settings={settingsFor(effect, configs)} active={effect.id === activeId} selected={selected.has(effect.id)} onOpen={() => setActiveId(effect.id)} onToggle={() => toggleSelection(effect.id)} />)}
        </div> : <div className="empty-state"><div>⌕</div><strong>검색 결과가 없습니다</strong><span>다른 검색어나 카테고리를 선택해 보세요.</span></div>}

        {pageCount > 1 && <div className="pagination">
          <span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} / {filtered.length}</span>
          <div><button disabled={currentPage === 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>← 이전</button><b>{currentPage + 1} / {pageCount}</b><button disabled={currentPage >= pageCount - 1} onClick={() => setPage((n) => Math.min(pageCount - 1, n + 1))}>다음 →</button></div>
        </div>}
      </main>

      <aside className="inspector">
        {activeEffect && activeSettings ? <>
          <div className="inspector-head"><div><div className="eyebrow">WORKSPACE</div><h2>이펙트 편집</h2></div><span className="inspector-status">저장됨</span></div>
          <div className="preview-stage"><div className="stage-grid" /><EffectPreview effect={activeEffect} settings={activeSettings} large /><div className="preview-caption"><span>{activeEffect.meta.loop ? "LOOP" : "ONE SHOT"}</span><span>{activeEffect.meta.size[0]} × {activeEffect.meta.size[1]} PX</span></div></div>
          <div className="effect-heading">
            <div className="effect-breadcrumb">{CATEGORY_LABELS[activeEffect.category]} <span>/</span> {activeEffect.id}</div>
            <h3>{activeEffect.name}</h3>
            <p>{activeEffect.meta.desc || "PixelFx effect"}</p>
          </div>
          <section className="control-section">
            <div className="control-title"><label htmlFor="fps-range">애니메이션 속도</label><span className="unit">FPS</span></div>
            <div className="fps-row"><input id="fps-range" type="range" min="1" max="60" value={activeSettings.fps} style={{ "--range-progress": `${((activeSettings.fps - 1) / 59) * 100}%` }} onChange={(event) => updateSetting(activeEffect, "fps", Number(event.target.value))} /><output>{activeSettings.fps}<small>fps</small></output></div>
            <div className="range-labels"><span>1 FPS</span><span>60 FPS</span></div>
          </section>
          <section className="control-section palette-section">
            <div className="control-title"><label htmlFor="palette-select">팔레트</label><span className="unit">PRESET</span></div>
            <div className="select-wrap"><select id="palette-select" value={activeSettings.palette ?? ""} onChange={(event) => updateSetting(activeEffect, "palette", event.target.value || null)}>
              <option value="">원본 팔레트</option>
              {PALETTE_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select><span>⌄</span></div>
            <div className="palette-swatches">{(activeSettings.palette ? PALETTES[activeSettings.palette] : activeEffect.meta.options?.palette ?? []).map((color, index) => <span key={`${color}-${index}`} style={{ background: color }} title={color} />)}</div>
            <small className="helper-text">선택한 프리셋은 현재 이펙트에만 적용됩니다.</small>
          </section>
          <div className="inspector-bottom"><button className="reset-button" onClick={() => resetEffect(activeEffect)}>↺ <span>이펙트 초기화</span></button><span className="autosave"><i /> 자동 저장</span></div>
        </> : <div className="inspector-empty">편집할 이펙트를 선택해 주세요.</div>}
      </aside>
    </div>

    {busy && progress && <div className="progress-toast"><div className="progress-copy"><span>UNITY PACKAGE</span><strong>{progress.label || "에셋 처리 중"}</strong><small>{Math.min(progress.current, progress.total)} / {progress.total}</small></div><div className="progress-track"><i style={{ width: `${Math.min(100, progress.current / progress.total * 100)}%` }} /></div><div className="progress-hint">스프라이트 시트와 애니메이션 데이터를 만들고 있습니다.</div></div>}
    {notice && <div className="toast" role="status">{notice}</div>}
  </div>;
}

function EffectCard({ effect, settings, active, selected, onOpen, onToggle }) {
  const handleCardClick = () => {
    onOpen();
    onToggle();
  };

  return <article className={`effect-card ${active ? "active" : ""} ${selected ? "selected" : ""}`} onClick={handleCardClick}>
    <div className="card-preview"><div className="card-check-wrap" onClick={(event) => { event.stopPropagation(); onOpen(); }}><input type="checkbox" checked={selected} onChange={onToggle} aria-label={`${effect.name} 내보내기 선택`} /></div><EffectPreview effect={effect} settings={settings} /><span className="card-kind">{effect.meta.loop ? "LOOP" : `${effect.meta.duration.toFixed(1)}s`}</span></div>
    <div className="card-info"><div><strong>{effect.name}</strong><span>{CATEGORY_LABELS[effect.category]}</span></div><span className="card-fps">{settings.fps}<small> FPS</small></span></div>
  </article>;
}

function EffectPreview({ effect, settings, large = false }) {
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(large);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || large || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "100px" });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [large]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return undefined;
    let cleanup = undefined;
    let disposed = false;
    loadEffect(effect).then(() => {
      if (!disposed) cleanup = createPlayer(canvas, effect, settings);
    }).catch(() => {});
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [effect, settings.fps, settings.palette, visible]);
  return <canvas ref={canvasRef} className={`effect-canvas ${large ? "large" : ""}`} aria-label={`${effect.name} 미리보기`} />;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

class AppErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error("PixelFx app render failed", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="boot-error"><h1>화면을 표시하지 못했습니다</h1><p>{this.state.error.message}</p><pre>{this.state.error.stack}</pre></main>;
  }
}

createRoot(document.getElementById("root")).render(<AppErrorBoundary><App /></AppErrorBoundary>);

