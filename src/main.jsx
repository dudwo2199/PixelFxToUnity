import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { APP_VERSION, CATEGORIES, CATEGORY_LABELS, CATEGORY_LABELS_KO, EFFECTS, EFFECT_BY_ID, loadEffect, PALETTES, PALETTE_NAMES, SETTINGS_SCHEMA } from "./data/catalog.js";
import { clearFrame, composite, createFrame, createFx } from "./vendor/pixelfx/core/index.js";
import { renderSpriteSheet } from "./engine/pixel-render.js";
import { createUnityPackage } from "./engine/unity-package.js";
import "./style.css";

const STORAGE_KEY = "pixelfx-to-unity.settings.v1";
const PREVIEW_BACKGROUND_KEY = "pixelfx-to-unity.preview-background.v1";

function readPreviewBackground() {
  try {
    const value = localStorage.getItem(PREVIEW_BACKGROUND_KEY);
    return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#fafbfe";
  } catch { return "#fafbfe"; }
}

function sanitizeConfigs(raw) {
  const next = {};
  for (const [id, value] of Object.entries(raw ?? {})) {
    if (!EFFECT_BY_ID.has(id) || !value || typeof value !== "object") continue;
    const effect = EFFECT_BY_ID.get(id);
    const fps = Number(value.fps);
    const palette = value.palette ?? null;
    const loop = typeof value.loop === "boolean" ? value.loop : effect.meta.loop;
    const exportTarget = value.exportTarget === "uiImage" ? "uiImage" : "spriteRenderer";
    if (!Number.isInteger(fps) || fps < 1 || fps > 60 || (palette !== null && !PALETTES[palette])) continue;
    if (fps === effect.meta.fps && palette === null && loop === effect.meta.loop && exportTarget === "spriteRenderer") continue;
    next[id] = { fps, palette, loop, exportTarget };
  }
  return next;
}

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return stored.schema === SETTINGS_SCHEMA ? sanitizeConfigs(stored.effects) : {};
  } catch { return {}; }
}

function settingsFor(effect, configs) {
  return configs[effect.id] ?? { fps: effect.meta.fps, palette: null, loop: effect.meta.loop, exportTarget: "spriteRenderer" };
}

function displayEffectName(effect) {
  return effect.meta.nameKo ? `${effect.name}(${effect.meta.nameKo})` : effect.name;
}

function displayCategoryName(categoryId) {
  const name = CATEGORY_LABELS[categoryId];
  const nameKo = CATEGORY_LABELS_KO[categoryId];
  return nameKo ? `${name}(${nameKo})` : name;
}

function normalizeSearchText(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

function App() {
  const [configs, setConfigs] = useState(readSettings);
  const [previewBackground, setPreviewBackground] = useState(readPreviewBackground);
  const [activeId, setActiveId] = useState(null);
  const [readyEffectId, setReadyEffectId] = useState("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [libraryView, setLibraryView] = useState("grid");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [frameSelections, setFrameSelections] = useState({});
  const searchRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: SETTINGS_SCHEMA, appVersion: APP_VERSION, effects: configs }));
  }, [configs]);
  useEffect(() => {
    localStorage.setItem(PREVIEW_BACKGROUND_KEY, previewBackground);
  }, [previewBackground]);
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

  const activeEffect = EFFECT_BY_ID.get(activeId) ?? null;
  const activeSettings = activeEffect ? settingsFor(activeEffect, configs) : null;
  const selectedFrameIndices = activeEffect ? frameSelections[activeEffect.id] ?? [] : [];
  const totalFrameCount = activeEffect && activeSettings ? Math.max(1, Math.round(activeEffect.meta.duration * activeSettings.fps) + (activeSettings.loop ? 0 : 1)) : 0;

  useEffect(() => {
    let cancelled = false;
    setReadyEffectId("");
    if (!activeEffect) return undefined;
    loadEffect(activeEffect).then(() => { if (!cancelled) setReadyEffectId(activeEffect.id); }).catch((error) => { if (!cancelled) setNotice(`이펙트를 불러오지 못했습니다: ${error.message}`); });
    return () => { cancelled = true; };
  }, [activeEffect]);
  const updateSetting = (effect, key, value) => {
    setConfigs((current) => {
      const nextEntry = { ...settingsFor(effect, current), [key]: value };
      if (nextEntry.fps === effect.meta.fps && nextEntry.palette === null && nextEntry.loop === effect.meta.loop && nextEntry.exportTarget === "spriteRenderer") {
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
    setNotice(`${displayEffectName(effect)} 설정을 원본으로 되돌렸습니다.`);
  };
  const exportPackage = async () => {
    if (!activeEffect || busy) return;
    setBusy(true);
    setProgress({ current: 0, total: 1, label: "준비 중" });
    try {
      const exportFrames = [...selectedFrameIndices];
      const blob = await createUnityPackage([activeEffect], () => settingsFor(activeEffect, configs), setProgress, () => exportFrames);
      download(blob, `PixelFx-${activeEffect.slug}.unitypackage`);
      setNotice(exportFrames.length ? `${displayEffectName(activeEffect)}의 선택한 ${exportFrames.length}개 프레임 패키지를 저장했습니다.` : `${displayEffectName(activeEffect)} 전체 프레임 패키지를 저장했습니다.`);
    } catch (error) {
      setNotice(`패키지 생성 실패: ${error.message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const filteredEffects = useMemo(() => {
    const needle = normalizeSearchText(query);
    return EFFECTS.filter((effect) => {
      if (categoryFilter !== "all" && effect.category !== categoryFilter) return false;
      if (!needle) return true;
      const searchableText = normalizeSearchText([effect.name, effect.meta.nameKo, effect.id, effect.meta.desc, effect.meta.descKo, ...(effect.meta.tags ?? [])].join(" "));
      return searchableText.includes(needle);
    });
  }, [query, categoryFilter]);

  return <div className="studio-app">
    <header className="studio-topbar">
      <a className="studio-brand" href="#top" onClick={(event) => { event.preventDefault(); setActiveId(null); }} aria-label="PixelFx to Unity - 라이브러리">
        <span className="studio-logo">✦</span><span>PixelFx <i>to</i> Unity</span>
      </a>
      <span className="studio-version">PIXEL ART EFFECT WORKSPACE</span>
    </header>

    <div className={`studio-workspace ${activeEffect ? "detail-mode" : "library-mode"}`}>
      <main className="studio-main" id="top">
        {activeEffect && activeSettings ? <>
          <div className="studio-breadcrumb"><button type="button" onClick={() => setActiveId(null)}>← 라이브러리</button><i>›</i><span>{displayCategoryName(activeEffect.category)}</span><i>›</i><b>{displayEffectName(activeEffect)}</b></div>
          <div className="studio-heading"><div><h1>{displayEffectName(activeEffect)}</h1><p>{activeEffect.meta.descKo}</p></div><span className="studio-category-tag">{displayCategoryName(activeEffect.category)}</span></div>
          {readyEffectId === activeEffect.id ? <EffectWorkspace key={activeEffect.id} effect={activeEffect} settings={activeSettings} previewBackground={previewBackground} onPreviewBackgroundChange={setPreviewBackground} selectedFrameIndices={selectedFrameIndices} onSelectionChange={(indices) => setFrameSelections((current) => ({ ...current, [activeEffect.id]: indices }))} /> : <div className="studio-sheet-loading">이펙트 준비 중…</div>}
        </> : <LibraryPage effects={filteredEffects} query={query} onQueryChange={setQuery} searchRef={searchRef} categoryFilter={categoryFilter} onCategoryChange={setCategoryFilter} view={libraryView} onViewChange={setLibraryView} onSelect={(effect) => setActiveId(effect.id)} />}
      </main>

      {activeEffect && <aside className="studio-inspector" aria-label="이펙트 설정">
        {activeEffect && activeSettings ? <>
          <div className="studio-inspector-head"><h2>이펙트 설정</h2><p>선택한 이펙트의 출력 옵션</p></div>
          <section className="studio-setting-section">
            <div className="studio-setting-label"><label htmlFor="studio-fps">재생 속도</label><output htmlFor="studio-fps">{activeSettings.fps} FPS</output></div>
            <input id="studio-fps" className="studio-fps" type="range" min="1" max="60" value={activeSettings.fps} style={{ "--range-progress": `${((activeSettings.fps - 1) / 59) * 100}%` }} onChange={(event) => updateSetting(activeEffect, "fps", Number(event.target.value))} />
            <div className="studio-range-labels"><span>느리게</span><span>빠르게</span></div>
          </section>
          <section className="studio-setting-section studio-loop-section">
            <div className="studio-setting-label"><span>재생 방식</span><span>{activeSettings.loop ? "반복" : "한 번 재생"}</span></div>
            <label className="studio-loop-toggle" htmlFor="studio-loop">
              <span><b>반복 재생</b><small>미리보기와 Unity 애니메이션에 적용</small></span>
              <input id="studio-loop" type="checkbox" role="switch" checked={activeSettings.loop} onChange={(event) => updateSetting(activeEffect, "loop", event.target.checked)} />
            </label>
          </section>
          <section className="studio-setting-section">
            <div className="studio-setting-label"><label htmlFor="studio-palette">색상 팔레트</label><span>{(activeSettings.palette ? PALETTES[activeSettings.palette] : activeEffect.meta.options?.palette ?? []).length} 색상</span></div>
            <select id="studio-palette" className="studio-palette-select" value={activeSettings.palette ?? ""} onChange={(event) => updateSetting(activeEffect, "palette", event.target.value || null)}>
              <option value="">원본 팔레트</option>{PALETTE_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <div className="studio-swatches">{(activeSettings.palette ? PALETTES[activeSettings.palette] : activeEffect.meta.options?.palette ?? []).map((color, index) => <span key={`${color}-${index}`} style={{ background: color }} title={color} />)}</div>
            <p className="studio-helper">선택한 팔레트가 미리보기에 적용됩니다.</p>
          </section>
          <section className="studio-setting-section studio-reset-section"><div className="studio-setting-label"><span>원본 설정</span></div><button type="button" className="studio-reset" onClick={() => resetEffect(activeEffect)}><ResetIcon />원본 설정으로 초기화</button></section>
          <section className="studio-export-section">
            <div className="studio-setting-label"><span>내보내기 정보</span></div>
            <label className="studio-export-target-label" htmlFor="studio-export-target">애니메이션 대상</label>
            <select id="studio-export-target" className="studio-palette-select studio-export-target" value={activeSettings.exportTarget} onChange={(event) => updateSetting(activeEffect, "exportTarget", event.target.value)}>
              <option value="spriteRenderer">SpriteRenderer (2D 오브젝트)</option>
              <option value="uiImage">Image (Canvas UI)</option>
            </select>
            <p className="studio-helper studio-export-target-help">{activeSettings.exportTarget === "uiImage" ? "Canvas의 Image 오브젝트에 Animator Controller를 연결해 사용하세요." : "SpriteRenderer가 있는 오브젝트에 Animator Controller를 연결해 사용하세요."}</p>
            <div className="studio-info-row"><span>대상</span><b>Unity Package</b></div>
            <div className="studio-info-row"><span>포함 에셋</span><b>{displayEffectName(activeEffect)} 1개</b></div>
            <div className="studio-info-row"><span>포함 프레임</span><b>{selectedFrameIndices.length ? `${selectedFrameIndices.length}개 선택` : `${totalFrameCount}개 전체`}</b></div>
            <button type="button" className="studio-export" disabled={busy} onClick={exportPackage}>{busy ? <><span className="studio-spinner" /> 패키지 생성 중</> : <><PackageExportIcon />Unity 패키지 내보내기</>}</button>
            <p className="studio-helper studio-export-helper">{selectedFrameIndices.length ? `선택한 ${selectedFrameIndices.length}개 프레임만 포함합니다.` : `전체 ${totalFrameCount}개 프레임을 포함합니다.`}</p>
          </section>
        </> : null}
      </aside>}
    </div>

    {busy && progress && <div className="studio-progress"><strong>{progress.label || "에셋 처리 중"}</strong><span>{Math.min(progress.current, progress.total)} / {progress.total}</span><div><i style={{ width: `${Math.min(100, progress.current / progress.total * 100)}%` }} /></div><small>Unity 패키지를 준비하고 있습니다.</small></div>}
    {notice && <div className="studio-toast" role="status">{notice}</div>}
  </div>;
}

function LibraryPage({ effects, query, onQueryChange, searchRef, categoryFilter, onCategoryChange, view, onViewChange, onSelect }) {
  const groups = CATEGORIES.map((category) => ({ ...category, effects: effects.filter((effect) => effect.category === category.id) })).filter((group) => group.effects.length);
  return <div className="studio-library-page">
    <div className="studio-library-heading">
      <div><span className="studio-library-eyebrow">PIXEL EFFECT LIBRARY</span><h1>이펙트 라이브러리</h1><p>미리보기를 살펴보고 사용할 이펙트를 선택하세요.</p></div>
      <span className="studio-library-count">{effects.length}<small> / {EFFECTS.length} 이펙트</small></span>
    </div>
    <div className="studio-library-toolbar">
      <label className="studio-library-search"><span aria-hidden="true">⌕</span><input ref={searchRef} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="한글·영문 이름, 설명, 태그 검색" aria-label="한글 및 영문 이펙트 이름, 설명, 태그 검색" /><kbd>Ctrl K</kbd></label>
      <select className="studio-library-category" value={categoryFilter} onChange={(event) => onCategoryChange(event.target.value)} aria-label="카테고리 필터">
        <option value="all">모든 카테고리</option>{CATEGORIES.map((category) => <option key={category.id} value={category.id}>{displayCategoryName(category.id)}</option>)}
      </select>
      <div className="studio-view-toggle" role="group" aria-label="라이브러리 보기 방식">
        <button type="button" className={view === "grid" ? "active" : ""} aria-pressed={view === "grid"} aria-label="그리드 보기" title="그리드 보기" onClick={() => onViewChange("grid")}><GridViewIcon /></button>
        <button type="button" className={view === "table" ? "active" : ""} aria-pressed={view === "table"} aria-label="테이블 보기" title="테이블 보기" onClick={() => onViewChange("table")}><TableViewIcon /></button>
      </div>
    </div>
    {groups.length ? <div className="studio-library-groups">
      {groups.map((group, index) => <LibraryCategorySection key={`${group.id}:${categoryFilter}`} group={group} view={view} initialOpen={categoryFilter !== "all" || index === 0} onSelect={onSelect} />)}
    </div> : <div className="studio-library-empty"><h2>검색 결과가 없습니다</h2><p>검색어나 카테고리 필터를 바꿔 보세요.</p></div>}
  </div>;
}

function LibraryCategorySection({ group, view, initialOpen, onSelect }) {
  const [open, setOpen] = useState(initialOpen);
  return <section className={`studio-library-group ${open ? "open" : ""}`}>
    <button type="button" className="studio-library-group-head" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className={`studio-library-group-dot category-${group.id}`} />
      <strong>{displayCategoryName(group.id)}</strong><span className="studio-library-group-count">{group.effects.length}개</span>
      <i className={open ? "expanded" : ""}>⌄</i>
    </button>
    {open && (view === "grid" ? <div className="studio-library-grid">
      {group.effects.map((effect) => <EffectCard key={effect.id} effect={effect} onSelect={onSelect} />)}
    </div> : <div className="studio-library-table-wrap"><table className="studio-library-table">
      <thead><tr><th>이펙트</th><th>카테고리</th><th>설명</th><th>기본 FPS</th><th>재생</th></tr></thead>
      <tbody>{group.effects.map((effect) => <LibraryEffectRow key={effect.id} effect={effect} onSelect={onSelect} />)}</tbody>
    </table></div>)}
  </section>;
}

function GridViewIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.75" y="2.75" width="6" height="6" rx="1.3" /><rect x="11.25" y="2.75" width="6" height="6" rx="1.3" /><rect x="2.75" y="11.25" width="6" height="6" rx="1.3" /><rect x="11.25" y="11.25" width="6" height="6" rx="1.3" /></svg>;
}

function TableViewIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="1.8" /><path d="M2.8 7.5h14.4M2.8 12h14.4M7.5 3.3v13.4" /></svg>;
}

function EffectCard({ effect, onSelect }) {
  const [previewPosition, setPreviewPosition] = useState(null);
  const updatePreviewPosition = (event) => setPreviewPosition(hoverPreviewPosition(event));
  return <>
    <button type="button" className="studio-effect-card" onClick={() => onSelect(effect)} onMouseEnter={updatePreviewPosition} onMouseMove={updatePreviewPosition} onMouseLeave={() => setPreviewPosition(null)}>
    <EffectCardArtwork effect={effect} />
    <span className={`studio-card-category category-${effect.category}`}>{displayCategoryName(effect.category)}</span>
    <strong>{displayEffectName(effect)}</strong><small>{effect.meta.descKo}</small>
    <span className="studio-card-meta">{effect.meta.fps} FPS <i /> {effect.meta.loop ? "반복" : "한 번 재생"}</span>
    </button>
    {previewPosition && <HoverEffectPreview effect={effect} position={previewPosition} />}
  </>;
}

function LibraryEffectRow({ effect, onSelect }) {
  const [previewPosition, setPreviewPosition] = useState(null);
  const updatePreviewPosition = (event) => setPreviewPosition(hoverPreviewPosition(event));
  return <>
  <tr tabIndex={0} onClick={() => onSelect(effect)} onMouseEnter={updatePreviewPosition} onMouseMove={updatePreviewPosition} onMouseLeave={() => setPreviewPosition(null)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(effect); } }}>
    <td><div className="studio-table-effect"><EffectCardArtwork effect={effect} /><strong>{displayEffectName(effect)}</strong></div></td>
    <td><span className={`studio-card-category category-${effect.category}`}>{displayCategoryName(effect.category)}</span></td>
    <td className="studio-table-desc">{effect.meta.descKo}</td><td>{effect.meta.fps} FPS</td><td>{effect.meta.loop ? "반복" : "한 번 재생"}</td>
  </tr>
  {previewPosition && <HoverEffectPreview effect={effect} position={previewPosition} />}
  </>;
}

function hoverPreviewPosition(event) {
  const width = 270, height = 230, gap = 16;
  const left = event.clientX + width + gap < window.innerWidth ? event.clientX + gap : Math.max(8, event.clientX - width - gap);
  const top = event.clientY + height + gap < window.innerHeight ? event.clientY + gap : Math.max(8, event.clientY - height - gap);
  return { left, top };
}

function HoverEffectPreview({ effect, position }) {
  return createPortal(<div className="studio-hover-preview" style={{ left: position.left, top: position.top }} aria-hidden="true">
    <EffectCardArtwork effect={effect} playing />
    <div><strong>{displayEffectName(effect)}</strong><span>{effect.meta.fps} FPS · 원본 미리보기</span></div>
  </div>, document.body);
}

function cardPreviewBounds(effect, paddingRatio = 0.24) {
  const [sourceWidth, sourceHeight] = effect.meta.size;
  const padding = Math.ceil(Math.max(sourceWidth, sourceHeight) * paddingRatio);
  const origin = effect.meta.origin ?? [sourceWidth / 2, sourceHeight / 2];
  return { width: sourceWidth + padding * 2, height: sourceHeight + padding * 2, x: origin[0] + padding, y: origin[1] + padding };
}

function EffectCardArtwork({ effect, playing = false }) {
  const ref = useRef(null);
  const canvasRef = useRef(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    if (!("IntersectionObserver" in window)) { setNearViewport(true); return undefined; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNearViewport(true); observer.disconnect(); }
    }, { rootMargin: "360px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!nearViewport) return undefined;
    let disposed = false;
    let url = "";
    loadEffect(effect).then(() => {
      const fps = effect.meta.fps ?? 30;
      const frameCount = Math.max(1, Math.round(effect.meta.duration * fps) + (effect.meta.loop ? 0 : 1));
      const previewFrame = Math.min(frameCount - 1, Math.floor(frameCount * 0.32));
      const bounds = cardPreviewBounds(effect, 1.0);
      const frame = createFrame(bounds.width, bounds.height);
      const instance = createFx(effect.mod, { x: bounds.x, y: bounds.y });
      if (previewFrame > 0) instance.update(previewFrame / fps);
      instance.draw(frame);
      const pixels = new Uint8ClampedArray(bounds.width * bounds.height * 4);
      composite(frame, pixels, null);
      let left = bounds.width, top = bounds.height, right = -1, bottom = -1;
      for (let y = 0; y < bounds.height; y += 1) {
        for (let x = 0; x < bounds.width; x += 1) {
          if (pixels[(y * bounds.width + x) * 4 + 3] === 0) continue;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
      if (right < left || bottom < top) { left = 0; top = 0; right = bounds.width - 1; bottom = bounds.height - 1; }
      const padding = Math.max(4, Math.ceil(Math.max(right - left + 1, bottom - top + 1) * 0.14));
      const surface = document.createElement("canvas");
      surface.width = right - left + 1 + padding * 2;
      surface.height = bottom - top + 1 + padding * 2;
      const context = surface.getContext("2d", { alpha: true });
      const image = new ImageData(pixels, bounds.width, bounds.height);
      context.putImageData(image, padding - left, padding - top);
      return new Promise((resolve) => surface.toBlob(resolve, "image/png"));
    }).then((blob) => {
      if (!blob) return;
      if (disposed) return;
      url = URL.createObjectURL(blob);
      setImageUrl(url);
    }).catch(() => {});
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [effect, nearViewport]);
  useEffect(() => {
    if (!nearViewport || !playing || !canvasRef.current) return undefined;
    let disposed = false;
    let animationId = 0;
    let instance = null;
    let previous = performance.now();
    let accumulator = 0;
    const canvas = canvasRef.current;
    const bounds = cardPreviewBounds(effect, 0.65);
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    const context = canvas.getContext("2d", { alpha: true });
    context.imageSmoothingEnabled = false;
    const frame = createFrame(bounds.width, bounds.height);
    const image = context.createImageData(bounds.width, bounds.height);
    const fps = effect.meta.fps ?? 30;
    const step = 1 / fps;
    const draw = () => {
      clearFrame(frame);
      instance.draw(frame);
      composite(frame, image.data, null);
      context.putImageData(image, 0, 0);
    };
    const tick = (now) => {
      if (disposed) return;
      const delta = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      accumulator = Math.min(accumulator + delta, step * 4);
      let changed = false;
      while (accumulator >= step) {
        accumulator -= step;
        if (!effect.meta.loop && instance.t >= effect.meta.duration) instance = createFx(effect.mod, { x: bounds.x, y: bounds.y });
        instance.update(step);
        changed = true;
      }
      if (changed) draw();
      animationId = requestAnimationFrame(tick);
    };
    loadEffect(effect).then(() => {
      if (disposed) return;
      instance = createFx(effect.mod, { x: bounds.x, y: bounds.y });
      draw();
      animationId = requestAnimationFrame(tick);
    }).catch(() => {});
    return () => { disposed = true; cancelAnimationFrame(animationId); };
  }, [effect, nearViewport, playing]);
  return <span className="studio-card-art" ref={ref} aria-hidden="true">
    {!playing && imageUrl ? <img src={imageUrl} alt="" /> : null}
    {playing && nearViewport ? <canvas className="studio-card-animation" ref={canvasRef} /> : !imageUrl ? <span className={`studio-card-art-placeholder category-${effect.category}`} /> : null}
  </span>;
}

function EffectWorkspace({ effect, settings, previewBackground, onPreviewBackgroundChange, selectedFrameIndices, onSelectionChange }) {
  const canvasRef = useRef(null);
  const playbackRef = useRef({ playing: true, move: null });
  const [playing, setPlaying] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const selectedFrames = new Set(selectedFrameIndices);
  const anchorRef = useRef(0);
  const [sheet, setSheet] = useState(null);
  const frameCount = Math.max(1, Math.round(effect.meta.duration * settings.fps) + (settings.loop ? 0 : 1));
  const selectedTimelinePosition = selectedFrameIndices.indexOf(currentFrame);
  const timelineValue = selectedFrameIndices.length ? Math.max(0, selectedTimelinePosition) : currentFrame;
  const timelineLength = selectedFrameIndices.length || frameCount;
  const stepFrame = (delta) => {
    const selected = [...selectedFrameIndices];
    if (!selected.length) return playbackRef.current.move?.(delta);
    const position = selected.indexOf(currentFrame);
    const next = position < 0 ? selected[0] : selected[(position + delta + selected.length) % selected.length];
    playbackRef.current.move?.(next, true);
  };
  const selectFrame = (index, event) => {
    playbackRef.current.playing = false;
    playbackRef.current.sequenceStarted = false;
    setPlaying(false);
    scrubFrame(index);
    let next;
    if (event.shiftKey) {
      const start = Math.min(anchorRef.current, index);
      const end = Math.max(anchorRef.current, index);
      next = Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
    } else if (event.ctrlKey || event.metaKey) {
      next = [...selectedFrameIndices];
      const position = next.indexOf(index);
      if (position >= 0) next.splice(position, 1); else next.push(index);
      anchorRef.current = index;
    } else {
      next = [index];
      anchorRef.current = index;
    }
    onSelectionChange(next);
    playbackRef.current.sequence = [...next];
    playbackRef.current.sequenceStarted = false;
  };
  const scrubFrame = (index) => playbackRef.current.move?.(index, true);
  const moveSelectedFrame = (sourceIndex, targetIndex) => {
    if (sourceIndex === targetIndex) return;
    const next = [...selectedFrameIndices];
    const sourcePosition = next.indexOf(sourceIndex);
    if (sourcePosition < 0 || !next.includes(targetIndex)) return;
    const [moving] = next.splice(sourcePosition, 1);
    const targetPosition = next.indexOf(targetIndex);
    next.splice(targetPosition, 0, moving);
    onSelectionChange(next);
    playbackRef.current.sequence = next;
    playbackRef.current.sequenceStarted = false;
  };
  const removeSelectedFrame = (frameIndex) => {
    if (!selectedFrameIndices.includes(frameIndex)) return;
    const next = selectedFrameIndices.filter((index) => index !== frameIndex);
    onSelectionChange(next);
    playbackRef.current.sequence = [...next];
    playbackRef.current.sequenceStarted = false;
    if (frameIndex === currentFrame && next.length) scrubFrame(next[0]);
  };
  useEffect(() => {
    let disposed = false;
    let animationId = 0;
    let sheetTimer = 0;
    let sheetUrl = "";
    let frameIndex = 0;
    let previous = performance.now();
    let accumulator = 0;
    let instance = null;
    playbackRef.current.playing = true;
    setPlaying(true);
    setCurrentFrame(0);
    const validSelection = selectedFrameIndices.filter((index) => index < frameCount);
    playbackRef.current.sequence = [...validSelection];
    if (validSelection.length !== selectedFrameIndices.length) onSelectionChange(validSelection);
    setSheet(null);

    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const previewBounds = cardPreviewBounds(effect, 0.38);
    canvas.width = previewBounds.width;
    canvas.height = previewBounds.height;
    const context = canvas.getContext("2d", { alpha: true });
    context.imageSmoothingEnabled = false;
    const frame = createFrame(previewBounds.width, previewBounds.height);
    const image = context.createImageData(previewBounds.width, previewBounds.height);
    const options = { x: previewBounds.x, y: previewBounds.y, ...(settings.palette ? { palette: PALETTES[settings.palette] } : {}) };
    const draw = () => {
      clearFrame(frame);
      instance.draw(frame);
      composite(frame, image.data, null);
      context.putImageData(image, 0, 0);
    };
    const restoreFrame = (index) => {
      frameIndex = (index + frameCount) % frameCount;
      instance = createFx(effect.mod, options);
      for (let step = 0; step < frameIndex; step += 1) instance.update(1 / settings.fps);
      draw();
      setCurrentFrame(frameIndex);
    };
    instance = createFx(effect.mod, options);
    draw();
    playbackRef.current.move = (delta, absolute = false) => restoreFrame(absolute ? delta : frameIndex + delta);
    playbackRef.current.toggle = () => {
      const nextPlaying = !playbackRef.current.playing;
      const sequence = playbackRef.current.sequence ?? [];
      if (nextPlaying && sequence.length && (!playbackRef.current.sequenceStarted || !sequence.includes(frameIndex))) {
        restoreFrame(sequence[0]);
        accumulator = 0;
        playbackRef.current.sequenceStarted = true;
      } else if (nextPlaying && !sequence.length && !settings.loop && frameIndex >= frameCount - 1) {
        restoreFrame(0);
        accumulator = 0;
      }
      playbackRef.current.playing = nextPlaying;
      setPlaying(nextPlaying);
    };

    const tick = (now) => {
      if (disposed) return;
      const delta = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      if (playbackRef.current.playing) {
        accumulator += delta;
        const interval = 1 / settings.fps;
        while (accumulator >= interval) {
          accumulator -= interval;
          const sequence = playbackRef.current.sequence ?? [];
          if (sequence.length) {
            const position = sequence.indexOf(frameIndex);
            if (position === sequence.length - 1 && !settings.loop) {
              playbackRef.current.playing = false;
              playbackRef.current.sequenceStarted = false;
              setPlaying(false);
              break;
            }
            const wraps = position === sequence.length - 1;
            const target = position < 0 ? sequence[0] : wraps ? sequence[0] : sequence[position + 1];
            if (target === frameIndex) break;
            if (position < 0 || wraps || target < frameIndex) restoreFrame(target);
            else {
              instance.update((target - frameIndex) * interval);
              frameIndex = target;
              draw();
              setCurrentFrame(frameIndex);
            }
          } else {
            if (!settings.loop && frameIndex >= frameCount - 1) {
              playbackRef.current.playing = false;
              setPlaying(false);
              break;
            }
            if (settings.loop && frameIndex >= frameCount - 1) {
              restoreFrame(0);
              continue;
            }
            instance.update(interval);
            frameIndex += 1;
            draw();
            setCurrentFrame(frameIndex);
          }
        }
      }
      animationId = requestAnimationFrame(tick);
    };
    animationId = requestAnimationFrame(tick);

    loadEffect(effect).then(async () => {
      if (disposed) return;
      sheetTimer = window.setTimeout(async () => {
        try {
          const rendered = await renderSpriteSheet(effect, settings);
          if (disposed) return;
          sheetUrl = URL.createObjectURL(rendered.sheetBlob);
          setSheet({ ...rendered, url: sheetUrl });
        } catch (error) {
          if (!disposed) setSheet({ error: error.message });
        }
      }, 100);
    }).catch((error) => { if (!disposed) setSheet({ error: error.message }); });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationId);
      clearTimeout(sheetTimer);
      if (sheetUrl) URL.revokeObjectURL(sheetUrl);
      playbackRef.current.move = null;
      playbackRef.current.toggle = null;
    };
  }, [effect, settings.fps, settings.loop, settings.palette]);

  return <div className="studio-panels">
    <section className="studio-panel studio-preview-panel" aria-label="애니메이션 미리보기">
      <header className="studio-panel-head"><h2>애니메이션 미리보기</h2><div className="studio-preview-head-actions"><label className="studio-background-picker" title="미리보기 배경색 선택"><span>배경</span><input type="color" value={previewBackground} onChange={(event) => onPreviewBackgroundChange(event.target.value)} aria-label="미리보기 배경색 선택" /></label><div className={`studio-playback-status ${playing ? "playing" : "paused"}`}><i /><span>{selectedFrameIndices.length ? (playing ? "선택 프레임 재생 중" : "선택 프레임 일시정지") : (playing ? "전체 애니메이션 재생 중" : "전체 애니메이션 일시정지")}</span>{selectedFrameIndices.length > 0 && <b>{selectedFrameIndices.indexOf(currentFrame) >= 0 ? `${String(selectedFrameIndices.indexOf(currentFrame) + 1).padStart(2, "0")} / ${String(selectedFrameIndices.length).padStart(2, "0")}` : "선택 대기"}</b>}</div></div></header>
      <div className="studio-preview-canvas" style={{ "--preview-bg": previewBackground }}>
        <canvas ref={canvasRef} aria-label={`${effect.name} 애니메이션`} />
        <span className="studio-canvas-caption">투명 배경 · {effect.meta.size[0]} × {effect.meta.size[1]} px</span>
      </div>
      <div className="studio-transport">
        <button type="button" className="studio-play" aria-label={playing ? "선택 프레임 일시정지" : "선택 프레임 재생"} onClick={() => playbackRef.current.toggle?.()}> {playing ? <PauseIcon /> : <PlayIcon />}</button>
        <button type="button" className="studio-step" aria-label="이전 프레임" onClick={() => stepFrame(-1)}><StepBackIcon /></button>
        <button type="button" className="studio-step" aria-label="다음 프레임" onClick={() => stepFrame(1)}><StepForwardIcon /></button>
        <input className="studio-timeline" type="range" min="0" max={Math.max(0, timelineLength - 1)} value={Math.min(timelineValue, timelineLength - 1)} style={{ "--range-progress": `${timelineLength > 1 ? timelineValue / (timelineLength - 1) * 100 : 0}%` }} onChange={(event) => scrubFrame(selectedFrameIndices.length ? selectedFrameIndices[Number(event.target.value)] : Number(event.target.value))} aria-label={selectedFrameIndices.length ? "선택한 프레임 순서 이동" : "애니메이션 프레임"} />
        <span className="studio-time">{String(Math.floor(currentFrame / settings.fps)).padStart(2, "0")}:{String(Math.floor((currentFrame % settings.fps) / settings.fps * 100)).padStart(2, "0")}</span>
      </div>
    </section>

    <section className={`studio-panel studio-sheet-panel ${selectedFrameIndices.length ? "has-selection" : ""}`} aria-label="스프라이트 시트">
      <header className="studio-panel-head"><h2>스프라이트 시트</h2><div className="studio-sheet-head-info"><span>{sheet?.count ?? frameCount} 프레임</span><small>Ctrl/⌘ 추가 · Shift 범위 선택</small></div></header>
      {sheet?.error ? <div className="studio-sheet-message">시트를 생성하지 못했습니다.<small>{sheet.error}</small></div> : !sheet ? <div className="studio-sheet-loading">프레임 시트를 만드는 중…</div> : <div className="studio-frame-grid">
        {Array.from({ length: sheet.count }, (_, index) => <SpriteFrame key={index} sheet={sheet} index={index} selected={selectedFrames.has(index)} order={selectedFrameIndices.indexOf(index) + 1} current={index === currentFrame} onSelect={(event) => selectFrame(index, event)} onRemove={() => removeSelectedFrame(index)} />)}
      </div>}
      {selectedFrameIndices.length > 0 && sheet?.url && <section className="studio-selected-tray" aria-label="선택한 프레임과 순서">
        <header className="studio-selected-tray-head"><div><b>선택한 프레임</b><span>{selectedFrameIndices.length}개 · 선택 순서대로 재생·내보내기</span></div><small>드래그하여 순서 변경 · Del 키로 제외</small></header>
        <div className="studio-selected-items" role="list" aria-label="선택 프레임의 재생 및 내보내기 순서">
          {selectedFrameIndices.map((frameIndex, orderIndex) => <SelectedFrameItem key={frameIndex} sheet={sheet} frameIndex={frameIndex} orderIndex={orderIndex} current={frameIndex === currentFrame} playing={playing} onReorder={moveSelectedFrame} onRemove={removeSelectedFrame} />)}
        </div>
      </section>}
      <footer className="studio-sheet-footer"><span>{selectedFrames.size ? `${selectedFrames.size}개 프레임 · 선택 순서로 재생·내보내기` : "전체 프레임 재생·내보내기"}</span><span>현재 {String(currentFrame + 1).padStart(2, "0")}　·　{effect.meta.size[0]} × {effect.meta.size[1]} px</span></footer>
    </section>
  </div>;
}

function FrameArtwork({ sheet, frameIndex, className = "" }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!sheet?.url || !canvasRef.current) return undefined;
    let disposed = false;
    const image = new Image();
    image.onload = () => {
      if (disposed) return;
      const context = canvasRef.current?.getContext("2d");
      if (!context) return;
      context.imageSmoothingEnabled = false;
      const column = frameIndex % sheet.columns;
      const row = Math.floor(frameIndex / sheet.columns);
      context.clearRect(0, 0, sheet.frameWidth, sheet.frameHeight);
      context.drawImage(image, column * sheet.frameWidth, row * sheet.frameHeight, sheet.frameWidth, sheet.frameHeight, 0, 0, sheet.frameWidth, sheet.frameHeight);
    };
    image.src = sheet.url;
    return () => { disposed = true; image.onload = null; };
  }, [sheet, frameIndex]);
  return <canvas ref={canvasRef} className={className} width={sheet.frameWidth} height={sheet.frameHeight} />;
}

function SpriteFrame({ sheet, index, selected, order, current, onSelect, onRemove }) {
  const onKeyDown = (event) => {
    if (selected && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      onRemove();
    }
  };
  return <button type="button" className={`studio-frame ${selected ? "selected" : ""} ${current ? "current" : ""}`} aria-pressed={selected} aria-current={current ? "step" : undefined} aria-label={`원본 프레임 ${index + 1} 선택`} onClick={onSelect} onKeyDown={onKeyDown}>
    <FrameArtwork sheet={sheet} frameIndex={index} className="studio-frame-artwork" />
    <span>{String(index + 1).padStart(2, "0")}</span>
    {selected && <i aria-hidden="true">{order}</i>}
  </button>;
}

function SelectedFrameItem({ sheet, frameIndex, orderIndex, current, playing, onReorder, onRemove }) {
  const onKeyDown = (event) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemove(frameIndex);
    }
  };
  return <div className={`studio-selected-item ${current ? "current" : ""}`} role="listitem" tabIndex={0} aria-current={current ? "step" : undefined} aria-keyshortcuts="Delete" aria-label={`선택 순서 ${orderIndex + 1}, 원본 프레임 ${frameIndex + 1}${current ? playing ? ", 재생 중" : ", 현재 프레임" : ""}`} draggable
    onKeyDown={onKeyDown}
    onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(frameIndex)); event.currentTarget.classList.add("dragging"); }}
    onDragEnd={(event) => event.currentTarget.classList.remove("dragging")}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; event.currentTarget.classList.add("drag-over"); }}
    onDragLeave={(event) => event.currentTarget.classList.remove("drag-over")}
    onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("drag-over"); const source = Number(event.dataTransfer.getData("text/plain")); if (Number.isInteger(source)) onReorder(source, frameIndex); }}>
    <span className="studio-selected-order">{String(orderIndex + 1).padStart(2, "0")}</span>
    <FrameArtwork sheet={sheet} frameIndex={frameIndex} className="studio-selected-artwork" />
    <span className="studio-selected-source">원본 {String(frameIndex + 1).padStart(2, "0")}</span>{current && <span className={`studio-selected-status ${playing ? "playing" : "paused"}`}>{playing ? "재생 위치" : "현재 프레임"}</span>}
    <button type="button" className="studio-selected-remove" aria-label={`선택에서 원본 프레임 ${frameIndex + 1} 제외`} title="선택에서 제외" onClick={() => onRemove(frameIndex)}><RemoveIcon /></button>
  </div>;
}

function RemoveIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>;
}function PlayIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.7c0-.6.7-.9 1.2-.6l10 6.2a.8.8 0 0 1 0 1.4l-10 6.2c-.5.3-1.2 0-1.2-.6V5.7Z" /></svg>;
}

function PauseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 5.5c0-.3.2-.5.5-.5h3c.3 0 .5.2.5.5v13c0 .3-.2.5-.5.5h-3c-.3 0-.5-.2-.5-.5v-13Zm6 0c0-.3.2-.5.5-.5h3c.3 0 .5.2.5.5v13c0 .3-.2.5-.5.5h-3c-.3 0-.5-.2-.5-.5v-13Z" /></svg>;
}

function StepBackIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 5v14M7 12l8-7v14l-8-7Z" /></svg>;
}

function StepForwardIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 5v14M9 5l8 7-8 7V5Z" /></svg>;
}

function PackageExportIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16.5V20h14v-3.5" /></svg>;
}

function ResetIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8A9 9 0 1 1 3 12" /><path d="M3 4.5V9h4.5" /></svg>;
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




















