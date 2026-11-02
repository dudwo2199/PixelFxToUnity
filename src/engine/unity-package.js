import { renderSpriteSheet } from "./pixel-render.js";
import { loadEffect } from "../data/catalog.js";

const encoder = new TextEncoder();

export async function createUnityPackage(effects, settingsFor, onProgress = () => {}) {
  const entries = [];
  let rendered = 0;
  for (const effect of effects) {
    await loadEffect(effect);
    const settings = settingsFor(effect);
    const sheet = await renderSpriteSheet(effect, settings, (subProgress) => {
      onProgress({ current: rendered + subProgress, total: effects.length, label: effect.name });
    });
    const category = effect.category === "scifi" ? "Sci-Fi" : effect.category === "spawn" ? "Spawn & Death" : titleCase(effect.category);
    const base = `Assets/PixelFx/${category}/${safeName(effect.name)}`;
    const sheetPath = `${base}/${safeName(effect.slug)}.png`;
    const jsonPath = `${base}/${safeName(effect.slug)}.json`;
    const animPath = `${base}/${safeName(effect.slug)}.anim`;
    const controllerPath = `${base}/${safeName(effect.slug)}.controller`;
    const sheetGuid = await stableGuid(sheetPath);
    const spriteNames = sheet.json.frames.map((_, index) => `${safeName(effect.slug)}_${String(index).padStart(4, "0")}`);
    const spriteIds = await Promise.all(sheet.json.frames.map((_, index) => stableGuid(`${sheetPath}#sprite-${index}`)));
    const spriteFileIds = spriteIds.map((id) => stableInternalId(id));
    const spritePivots = sheet.json.frames.map(() => [effect.meta.origin[0] / sheet.frameWidth, 1 - effect.meta.origin[1] / sheet.frameHeight]);
    const animGuid = await stableGuid(animPath);
    const assets = [
      { path: sheetPath, data: new Uint8Array(await sheet.sheetBlob.arrayBuffer()), meta: textureMeta(sheetGuid, spriteNames, sheet.json.frames, sheet.json.meta.size.h, spritePivots, spriteFileIds, spriteIds) },
      { path: jsonPath, data: encoder.encode(JSON.stringify(sheet.json, null, 2)), meta: textMeta(await stableGuid(jsonPath)) },
      { path: animPath, data: encoder.encode(animationYaml(effect, sheetGuid, spriteFileIds, settings.fps, sheet.count, effect.meta.loop)), meta: nativeMeta(animGuid) },
      { path: controllerPath, data: encoder.encode(controllerYaml(effect, animGuid)), meta: nativeMeta(await stableGuid(controllerPath), 9100000) },
    ];
    for (const asset of assets) {
      const guid = asset.meta.match(/^guid: ([a-f0-9]+)/m)?.[1];
      entries.push({ guid, path: asset.path, asset: asset.data, meta: encoder.encode(asset.meta) });
    }
    rendered += 1;
    onProgress({ current: rendered, total: effects.length, label: effect.name });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const notice = "PixelFx effects by patch-gg. MIT License. Source: https://github.com/patch-gg/pixelfx\n";
  const noticePath = "Assets/PixelFx/THIRD-PARTY-NOTICES.txt";
  const noticeGuid = await stableGuid(noticePath);
  entries.push({ guid: noticeGuid, path: noticePath, asset: encoder.encode(notice), meta: encoder.encode(textMeta(noticeGuid)) });
  const tar = makeTar(entries);
  const gz = await gzip(tar);
  return new Blob([gz], { type: "application/gzip" });
}

function animationYaml(effect, sheetGuid, spriteFileIds, fps, frameCount, loop) {
  const keyframes = spriteFileIds.map((fileId, index) => `    - time: ${(index / fps).toFixed(6)}\n      value: {fileID: ${fileId}, guid: ${sheetGuid}, type: 3}`).join("\n");
  const objectReferences = spriteFileIds.map((fileId) => `    - {fileID: ${fileId}, guid: ${sheetGuid}, type: 3}`).join("\n");
  const duration = frameCount / fps;
  return `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!74 &7400000\nAnimationClip:\n  m_ObjectHideFlags: 0\n  m_CorrespondingSourceObject: {fileID: 0}\n  m_PrefabInstance: {fileID: 0}\n  m_PrefabAsset: {fileID: 0}\n  m_Name: ${safeYaml(effect.name)}\n  serializedVersion: 7\n  m_Legacy: 0\n  m_Compressed: 0\n  m_UseHighQualityCurve: 1\n  m_RotationCurves: []\n  m_CompressedRotationCurves: []\n  m_EulerCurves: []\n  m_PositionCurves: []\n  m_ScaleCurves: []\n  m_FloatCurves: []\n  m_PPtrCurves:\n  - curve:\n${keyframes}\n    attribute: m_Sprite\n    path: \n    classID: 212\n    script: {fileID: 0}\n  m_SampleRate: ${fps}\n  m_WrapMode: 0\n  m_Bounds:\n    m_Center: {x: 0, y: 0, z: 0}\n    m_Extent: {x: 0, y: 0, z: 0}\n  m_ClipBindingConstant:\n    genericBindings:\n    - serializedVersion: 2\n      path: 0\n      attribute: 0\n      script: {fileID: 0}\n      typeID: 212\n      customType: 23\n      isPPtrCurve: 1\n      isIntCurve: 0\n      isSerializeReferenceCurve: 0\n    pptrCurveMapping:\n${objectReferences}\n  m_AnimationClipSettings:\n    serializedVersion: 2\n    m_AdditiveReferencePose: {fileID: 0}\n    m_AdditiveReferencePoseFrame: 0\n    m_StartTime: 0\n    m_StopTime: ${duration.toFixed(6)}\n    m_OrientationOffsetY: 0\n    m_Level: 0\n    m_CycleOffset: 0\n    m_HasAdditiveReferencePose: 0\n    m_LoopTime: ${loop ? 1 : 0}\n    m_LoopBlend: 0\n    m_LoopBlendOrientation: 0\n    m_LoopBlendPositionY: 0\n    m_LoopBlendPositionXZ: 0\n    m_KeepOriginalOrientation: 0\n    m_KeepOriginalPositionY: 1\n    m_KeepOriginalPositionXZ: 0\n    m_HeightFromFeet: 0\n    m_Mirror: 0\n  m_EditorCurves: []\n  m_EulerEditorCurves: []\n  m_HasGenericRootTransform: 0\n  m_HasMotionFloatCurves: 0\n  m_GenerateMotion Curves: 0\n  m_Events: []\n`;
}

function controllerYaml(effect, clipGuid) {
  return `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!91 &9100000\nAnimatorController:\n  m_ObjectHideFlags: 0\n  m_CorrespondingSourceObject: {fileID: 0}\n  m_PrefabInstance: {fileID: 0}\n  m_PrefabAsset: {fileID: 0}\n  m_Name: ${safeYaml(effect.name)}\n  serializedVersion: 5\n  m_AnimatorParameters: []\n  m_AnimatorLayers:\n  - serializedVersion: 5\n    m_Name: Base Layer\n    m_StateMachine: {fileID: 110700000}\n    m_Mask: {fileID: 0}\n    m_Motions: []\n    m_Behaviours: []\n    m_BlendingMode: 0\n    m_SyncedLayerIndex: -1\n    m_DefaultWeight: 1\n    m_IKPass: 0\n    m_SyncedLayerAffectsTiming: 0\n    m_Controller: {fileID: 9100000}\n--- !u!1107 &110700000\nAnimatorStateMachine:\n  m_ObjectHideFlags: 1\n  m_CorrespondingSourceObject: {fileID: 0}\n  m_PrefabInstance: {fileID: 0}\n  m_PrefabAsset: {fileID: 0}\n  m_Name: Base Layer\n  serializedVersion: 6\n  m_ChildStates:\n  - serializedVersion: 1\n    m_State: {fileID: 110200000}\n    m_Position: {x: 200, y: 0, z: 0}\n  m_ChildStateMachines: []\n  m_AnyStateTransitions: []\n  m_EntryTransitions: []\n  m_StateMachineTransitions: {}\n  m_StateMachineBehaviours: []\n  m_AnyStatePosition: {x: 50, y: 20, z: 0}\n  m_EntryPosition: {x: 50, y: 120, z: 0}\n  m_ExitPosition: {x: 800, y: 120, z: 0}\n  m_ParentStateMachinePosition: {x: 800, y: 20, z: 0}\n  m_DefaultState: {fileID: 110200000}\n--- !u!1102 &110200000\nAnimatorState:\n  m_ObjectHideFlags: 1\n  m_CorrespondingSourceObject: {fileID: 0}\n  m_PrefabInstance: {fileID: 0}\n  m_PrefabAsset: {fileID: 0}\n  m_Name: ${safeYaml(effect.name)}\n  serializedVersion: 6\n  m_Speed: 1\n  m_CycleOffset: 0\n  m_Transitions: []\n  m_StateMachineBehaviours: []\n  m_Position: {x: 200, y: 0, z: 0}\n  m_IKOnFeet: 0\n  m_WriteDefaultValues: 1\n  m_Mirror: 0\n  m_SpeedParameterActive: 0\n  m_MirrorParameterActive: 0\n  m_CycleParameterActive: 0\n  m_Motion: {fileID: 7400000, guid: ${clipGuid}, type: 2}\n  m_Tag: \n  m_SpeedParameter: \n  m_MirrorParameter: \n  m_CycleParameter: \n`;
}

function textureMeta(guid, spriteNames, frames, sheetHeight, pivots, spriteFileIds, spriteIds) {
  const sprites = frames.map(({ frame }, index) => `    - serializedVersion: 2\n      name: ${spriteNames[index]}\n      rect:\n        serializedVersion: 2\n        x: ${frame.x}\n        y: ${sheetHeight - frame.y - frame.h}\n        width: ${frame.w}\n        height: ${frame.h}\n      alignment: 9\n      pivot: {x: ${pivots[index][0]}, y: ${pivots[index][1]}}\n      border: {x: 0, y: 0, z: 0, w: 0}\n      outline: []\n      physicsShape: []\n      tessellationDetail: 0\n      bones: []\n      spriteID: ${spriteIds[index]}\n      internalID: ${spriteFileIds[index]}\n      vertices: []\n      indices: \n      edges: []\n      weights: []`).join("\n");
  const idNames = spriteFileIds.map((fileId, index) => `  - first:\n      213: ${fileId}\n    second: ${spriteNames[index]}`).join("\n");
  return `fileFormatVersion: 2\nguid: ${guid}\nTextureImporter:\n  internalIDToNameTable:\n${idNames}\n  externalObjects: {}\n  serializedVersion: 13\n  mipmaps:\n    mipMapMode: 0\n    enableMipMap: 0\n    sRGBTexture: 1\n    linearTexture: 0\n    fadeOut: 0\n    borderMipMap: 0\n    mipMapsPreserveCoverage: 0\n    alphaTestReferenceValue: 0.5\n    mipMapFadeDistanceStart: 1\n    mipMapFadeDistanceEnd: 3\n  bumpmap:\n    convertToNormalMap: 0\n    externalNormalMap: 0\n    heightScale: 0.25\n    normalMapFilter: 0\n    flipGreenChannel: 0\n  isReadable: 0\n  streamingMipmaps: 0\n  streamingMipmapsPriority: 0\n  vTOnly: 0\n  ignoreMipmapLimit: 0\n  grayScaleToAlpha: 0\n  generateCubemap: 6\n  cubemapConvolution: 0\n  seamlessCubemap: 0\n  textureFormat: 1\n  maxTextureSize: 8192\n  textureSettings:\n    serializedVersion: 2\n    filterMode: 0\n    aniso: 1\n    mipBias: 0\n    wrapU: 1\n    wrapV: 1\n    wrapW: 1\n  nPOTScale: 0\n  lightmap: 0\n  compressionQuality: 50\n  spriteMode: 2\n  spriteExtrude: 1\n  spriteMeshType: 1\n  alignment: 9\n  spritePivot: {x: 0.5, y: 0.5}\n  spritePixelsToUnits: 100\n  spriteBorder: {x: 0, y: 0, z: 0, w: 0}\n  spriteGenerateFallbackPhysicsShape: 1\n  alphaUsage: 1\n  alphaIsTransparency: 1\n  textureType: 8\n  textureShape: 1\n  singleChannelComponent: 0\n  flipbookRows: 1\n  flipbookColumns: 1\n  maxTextureSizeSet: 0\n  compressionQualitySet: 0\n  textureFormatSet: 0\n  ignorePngGamma: 0\n  applyGammaDecoding: 0\n  cookieLightType: 0\n  platformSettings: []\n  spriteSheet:\n    serializedVersion: 2\n    sprites:\n${sprites}\n    outline: []\n    physicsShape: []\n    bones: []\n    spriteID: ${guid}\n    internalID: 0\n    vertices: []\n    indices: \n    edges: []\n    weights: []\n  spritePackingTag: \n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;
}

function textMeta(guid) {
  return `fileFormatVersion: 2\nguid: ${guid}\nTextScriptImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;
}

function nativeMeta(guid, mainObjectFileId = 7400000) {
  return `fileFormatVersion: 2\nguid: ${guid}\nNativeFormatImporter:\n  externalObjects: {}\n  mainObjectFileID: ${mainObjectFileId}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;
}

function safeName(value) {
  return String(value).normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "Effect";
}

function safeYaml(value) {
  return JSON.stringify(String(value).replace(/[\r\n]/g, " "));
}

function titleCase(value) {
  return value.replace(/(^|-)([a-z])/g, (_, separator, letter) => `${separator === "-" ? " " : ""}${letter.toUpperCase()}`);
}

async function stableGuid(value) {
  const bytes = encoder.encode(`PixelFxToUnity:${value}`);
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let a = 0x811c9dc5, b = 0x01000193, c = 0x9e3779b9, d = 0x85ebca6b;
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, 0x01000193); b = Math.imul(b ^ byte, 0x5bd1e995);
    c = Math.imul(c ^ byte, 0x27d4eb2d); d = Math.imul(d ^ byte, 0x165667b1);
  }
  return [a, b, c, d].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}

function stableInternalId(guid) {
  return (BigInt(`0x${guid.slice(0, 16)}`) & ((1n << 63n) - 1n)).toString();
}

function makeTar(entries) {
  const blocks = [];
  const pushFile = (name, bytes) => {
    const header = new Uint8Array(512);
    writeString(header, 0, 100, name);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, bytes.length);
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
    header.fill(32, 148, 156);
    header[156] = 48;
    writeString(header, 257, 6, "ustar\0");
    writeString(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeOctal(header, 148, 8, checksum);
    blocks.push(header, bytes);
    const remainder = bytes.length % 512;
    if (remainder) blocks.push(new Uint8Array(512 - remainder));
  };
  for (const entry of entries) {
    pushFile(`${entry.guid}/asset`, entry.asset);
    pushFile(`${entry.guid}/asset.meta`, entry.meta);
    pushFile(`${entry.guid}/pathname`, encoder.encode(entry.path));
  }
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const tar = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) { tar.set(block, offset); offset += block.length; }
  return tar;
}

function writeString(target, offset, length, value) {
  const bytes = encoder.encode(value);
  target.set(bytes.subarray(0, length), offset);
}

function writeOctal(target, offset, length, value) {
  const text = Math.max(0, value).toString(8).padStart(length - 1, "0").slice(-(length - 1));
  writeString(target, offset, length - 1, text);
  target[offset + length - 1] = 0;
}

async function gzip(bytes) {
  if (typeof CompressionStream === "undefined") throw new Error("이 브라우저는 gzip 압축을 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요.");
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

