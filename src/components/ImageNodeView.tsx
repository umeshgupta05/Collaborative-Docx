import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  Type,
  Check,
  X,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Crop,
  Circle,
  Square,
  Sun,
  Contrast,
} from "lucide-react";

/* ── Size Presets ─────────────────────────────────── */
const SIZE_PRESETS = [
  { label: "S", value: "25%", title: "Small (25%)" },
  { label: "M", value: "50%", title: "Medium (50%)" },
  { label: "L", value: "75%", title: "Large (75%)" },
  { label: "Full", value: "100%", title: "Full width" },
];

/* ── Canvas helpers ───────────────────────────────── */
const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const canvasToDataUrl = (
  canvas: HTMLCanvasElement,
  mime = "image/png",
) => canvas.toDataURL(mime, 0.92);

const rotateImage = async (src: string, degrees: number): Promise<string> => {
  const img = await loadImage(src);
  const rad = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const w = Math.round(img.width * cos + img.height * sin);
  const h = Math.round(img.width * sin + img.height * cos);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return canvasToDataUrl(canvas);
};

const flipImage = async (
  src: string,
  direction: "horizontal" | "vertical",
): Promise<string> => {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  if (direction === "horizontal") {
    ctx.translate(img.width, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, img.height);
    ctx.scale(1, -1);
  }
  ctx.drawImage(img, 0, 0);
  return canvasToDataUrl(canvas);
};

const applyFilters = async (
  src: string,
  brightness: number,
  contrast: number,
): Promise<string> => {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
  ctx.drawImage(img, 0, 0);
  return canvasToDataUrl(canvas);
};

const cropImageCanvas = async (
  src: string,
  cropRect: { x: number; y: number; w: number; h: number },
  displayWidth: number,
  displayHeight: number,
): Promise<string> => {
  const img = await loadImage(src);
  const scaleX = img.naturalWidth / displayWidth;
  const scaleY = img.naturalHeight / displayHeight;
  const sx = Math.round(cropRect.x * scaleX);
  const sy = Math.round(cropRect.y * scaleY);
  const sw = Math.round(cropRect.w * scaleX);
  const sh = Math.round(cropRect.h * scaleY);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvasToDataUrl(canvas);
};

/* ── Toolbar section type ─────────────────────────── */
type ToolSection = "main" | "adjust";

/* ════════════════════════════════════════════════════ */
/*                 IMAGE NODE VIEW                     */
/* ════════════════════════════════════════════════════ */

const ImageNodeView = ({
  node,
  updateAttributes,
  deleteNode,
  selected,
  editor,
}: NodeViewProps) => {
  const { src, alt, width, alignment } = node.attrs;

  /* ── State ── */
  const [isResizing, setIsResizing] = useState(false);
  const [showAltInput, setShowAltInput] = useState(false);
  const [altText, setAltText] = useState(alt || "");
  const [currentWidth, setCurrentWidth] = useState<number | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toolSection, setToolSection] = useState<ToolSection>("main");
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [roundedCorners, setRoundedCorners] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cropOverlayRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const resizeSideRef = useRef<"left" | "right">("right");

  const isEditable = editor?.isEditable ?? true;

  /* ── Resize logic ── */
  const handleResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent, side: "left" | "right") => {
      if (!isEditable || isCropping) return;
      e.preventDefault();
      e.stopPropagation();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const imgEl = imgRef.current;
      if (!imgEl) return;
      startXRef.current = clientX;
      startWidthRef.current = imgEl.offsetWidth;
      resizeSideRef.current = side;
      setIsResizing(true);
    },
    [isEditable, isCropping],
  );

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = "touches" in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const diff = clientX - startXRef.current;
      const delta = resizeSideRef.current === "left" ? -diff : diff;
      setCurrentWidth(Math.max(60, startWidthRef.current + delta));
    };
    const handleEnd = () => {
      setIsResizing(false);
      if (currentWidth !== null) {
        const container = containerRef.current?.parentElement;
        if (container) {
          const pct = Math.max(5, Math.min(100, Math.round((currentWidth / container.offsetWidth) * 100)));
          updateAttributes({ width: `${pct}%` });
        } else {
          updateAttributes({ width: `${currentWidth}px` });
        }
        setCurrentWidth(null);
      }
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleEnd);
    document.addEventListener("touchmove", handleMove, { passive: false });
    document.addEventListener("touchend", handleEnd);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleEnd);
    };
  }, [isResizing, currentWidth, updateAttributes]);

  /* ── Crop logic ── */
  const handleCropMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isCropping || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setCropStart({ x, y });
    setCropRect({ x, y, w: 0, h: 0 });
  }, [isCropping]);

  const handleCropMouseMove = useCallback((e: React.MouseEvent) => {
    if (!cropStart || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x2 = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y2 = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    setCropRect({
      x: Math.min(cropStart.x, x2),
      y: Math.min(cropStart.y, y2),
      w: Math.abs(x2 - cropStart.x),
      h: Math.abs(y2 - cropStart.y),
    });
  }, [cropStart]);

  const handleCropMouseUp = useCallback(() => {
    setCropStart(null);
  }, []);

  const applyCrop = useCallback(async () => {
    if (!cropRect || cropRect.w < 10 || cropRect.h < 10 || !imgRef.current) return;
    setIsProcessing(true);
    try {
      const newSrc = await cropImageCanvas(
        src,
        cropRect,
        imgRef.current.offsetWidth,
        imgRef.current.offsetHeight,
      );
      updateAttributes({ src: newSrc });
    } catch (err) {
      console.error("Crop failed:", err);
    }
    setIsCropping(false);
    setCropRect(null);
    setIsProcessing(false);
  }, [cropRect, src, updateAttributes]);

  const cancelCrop = () => {
    setIsCropping(false);
    setCropRect(null);
    setCropStart(null);
  };

  /* ── Transform actions ── */
  const handleRotate = useCallback(async (deg: number) => {
    setIsProcessing(true);
    try {
      const newSrc = await rotateImage(src, deg);
      updateAttributes({ src: newSrc });
    } catch (err) {
      console.error("Rotate failed:", err);
    }
    setIsProcessing(false);
  }, [src, updateAttributes]);

  const handleFlip = useCallback(async (dir: "horizontal" | "vertical") => {
    setIsProcessing(true);
    try {
      const newSrc = await flipImage(src, dir);
      updateAttributes({ src: newSrc });
    } catch (err) {
      console.error("Flip failed:", err);
    }
    setIsProcessing(false);
  }, [src, updateAttributes]);

  const handleApplyFilters = useCallback(async () => {
    if (brightness === 100 && contrast === 100) return;
    setIsProcessing(true);
    try {
      const newSrc = await applyFilters(src, brightness, contrast);
      updateAttributes({ src: newSrc });
      setBrightness(100);
      setContrast(100);
    } catch (err) {
      console.error("Filter failed:", err);
    }
    setIsProcessing(false);
  }, [src, brightness, contrast, updateAttributes]);

  /* ── Helpers ── */
  const handleSetAlignment = (a: string) => updateAttributes({ alignment: a });
  const handleSetWidth = (w: string) => { updateAttributes({ width: w }); setCurrentWidth(null); };
  const handleSaveAlt = () => { updateAttributes({ alt: altText }); setShowAltInput(false); };
  const handleCancelAlt = () => { setAltText(alt || ""); setShowAltInput(false); };

  const resolvedWidth = currentWidth !== null ? `${currentWidth}px` : width || "100%";
  const resolvedAlignment = alignment || "center";
  const justifyClass = resolvedAlignment === "left" ? "justify-start" : resolvedAlignment === "right" ? "justify-end" : "justify-center";

  /* ── Render ── */
  return (
    <NodeViewWrapper
      className={`image-node-wrapper flex ${justifyClass}`}
      data-drag-handle=""
      style={{ margin: "0.75rem 0" }}
    >
      <div
        ref={containerRef}
        className={`image-node-container relative inline-block group ${selected ? "image-node-selected" : ""} ${isResizing ? "image-node-resizing" : ""}`}
        style={{ width: resolvedWidth, maxWidth: "100%" }}
      >
        {/* Processing spinner overlay */}
        {isProcessing && (
          <div className="image-processing-overlay">
            <div className="image-processing-spinner" />
          </div>
        )}

        {/* Image */}
        <img
          ref={imgRef}
          src={src}
          alt={alt || ""}
          draggable={false}
          className={`image-node-img block w-full h-auto ${roundedCorners ? "rounded-2xl" : "rounded-md"}`}
          style={{
            userSelect: "none",
            filter: brightness !== 100 || contrast !== 100
              ? `brightness(${brightness}%) contrast(${contrast}%)`
              : undefined,
          }}
        />

        {/* Crop overlay */}
        {isCropping && (
          <div
            ref={cropOverlayRef}
            className="image-crop-overlay"
            onMouseDown={handleCropMouseDown}
            onMouseMove={handleCropMouseMove}
            onMouseUp={handleCropMouseUp}
          >
            {/* Dim outside the selection */}
            <div className="image-crop-dim" />
            {/* Selection box */}
            {cropRect && cropRect.w > 0 && cropRect.h > 0 && (
              <div
                className="image-crop-selection"
                style={{
                  left: cropRect.x,
                  top: cropRect.y,
                  width: cropRect.w,
                  height: cropRect.h,
                }}
              >
                <div className="image-crop-corner image-crop-corner-tl" />
                <div className="image-crop-corner image-crop-corner-tr" />
                <div className="image-crop-corner image-crop-corner-bl" />
                <div className="image-crop-corner image-crop-corner-br" />
              </div>
            )}
          </div>
        )}

        {/* Resize handles */}
        {isEditable && !isCropping && (
          <>
            <div className="image-resize-handle image-resize-handle-left" onMouseDown={(e) => handleResizeStart(e, "left")} onTouchStart={(e) => handleResizeStart(e, "left")} title="Drag to resize">
              <div className="image-resize-handle-bar" />
            </div>
            <div className="image-resize-handle image-resize-handle-right" onMouseDown={(e) => handleResizeStart(e, "right")} onTouchStart={(e) => handleResizeStart(e, "right")} title="Drag to resize">
              <div className="image-resize-handle-bar" />
            </div>
          </>
        )}

        {/* ── Floating Toolbar ── */}
        {isEditable && (selected || isResizing || isCropping) && !isProcessing && (
          <div className="image-toolbar">
            {/* Crop confirm/cancel bar */}
            {isCropping ? (
              <div className="image-toolbar-group">
                <span className="image-toolbar-label">Drag to crop</span>
                <button type="button" onClick={applyCrop} className="image-toolbar-btn image-toolbar-btn-confirm" title="Apply crop" disabled={!cropRect || cropRect.w < 10}>
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={cancelCrop} className="image-toolbar-btn" title="Cancel crop">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : showAltInput ? (
              <div className="image-toolbar-alt-row">
                <input
                  type="text"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveAlt(); if (e.key === "Escape") handleCancelAlt(); }}
                  placeholder="Alt text..."
                  className="image-toolbar-alt-input"
                  autoFocus
                />
                <button type="button" onClick={handleSaveAlt} className="image-toolbar-btn image-toolbar-btn-confirm" title="Save"><Check className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={handleCancelAlt} className="image-toolbar-btn" title="Cancel"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <>
                {/* Section tabs */}
                <div className="image-toolbar-tabs">
                  <button type="button" onClick={() => setToolSection("main")} className={`image-toolbar-tab ${toolSection === "main" ? "image-toolbar-tab-active" : ""}`}>Layout</button>
                  <button type="button" onClick={() => setToolSection("adjust")} className={`image-toolbar-tab ${toolSection === "adjust" ? "image-toolbar-tab-active" : ""}`}>Edit</button>
                </div>

                <div className="image-toolbar-divider" />

                {toolSection === "main" ? (
                  <>
                    {/* Alignment */}
                    <div className="image-toolbar-group">
                      <button type="button" onClick={() => handleSetAlignment("left")} className={`image-toolbar-btn ${resolvedAlignment === "left" ? "image-toolbar-btn-active" : ""}`} title="Align left"><AlignLeft className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => handleSetAlignment("center")} className={`image-toolbar-btn ${resolvedAlignment === "center" ? "image-toolbar-btn-active" : ""}`} title="Align center"><AlignCenter className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => handleSetAlignment("right")} className={`image-toolbar-btn ${resolvedAlignment === "right" ? "image-toolbar-btn-active" : ""}`} title="Align right"><AlignRight className="w-3.5 h-3.5" /></button>
                    </div>

                    <div className="image-toolbar-divider" />

                    {/* Size presets */}
                    <div className="image-toolbar-group">
                      {SIZE_PRESETS.map((p) => (
                        <button key={p.value} type="button" onClick={() => handleSetWidth(p.value)} className={`image-toolbar-btn image-toolbar-btn-text ${width === p.value ? "image-toolbar-btn-active" : ""}`} title={p.title}>{p.label}</button>
                      ))}
                    </div>

                    <div className="image-toolbar-divider" />

                    {/* Rounded corners */}
                    <button type="button" onClick={() => setRoundedCorners(!roundedCorners)} className={`image-toolbar-btn ${roundedCorners ? "image-toolbar-btn-active" : ""}`} title="Rounded corners">
                      {roundedCorners ? <Circle className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                    </button>

                    {/* Alt text */}
                    <button type="button" onClick={() => { setAltText(alt || ""); setShowAltInput(true); }} className="image-toolbar-btn" title="Edit alt text"><Type className="w-3.5 h-3.5" /></button>

                    {/* Delete */}
                    <button type="button" onClick={deleteNode} className="image-toolbar-btn image-toolbar-btn-danger" title="Remove image"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                ) : (
                  <>
                    {/* Crop */}
                    <button type="button" onClick={() => { setIsCropping(true); setCropRect(null); }} className="image-toolbar-btn" title="Crop image">
                      <Crop className="w-3.5 h-3.5" />
                    </button>

                    <div className="image-toolbar-divider" />

                    {/* Rotate */}
                    <button type="button" onClick={() => handleRotate(90)} className="image-toolbar-btn" title="Rotate 90° clockwise">
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>

                    <div className="image-toolbar-divider" />

                    {/* Flip */}
                    <button type="button" onClick={() => handleFlip("horizontal")} className="image-toolbar-btn" title="Flip horizontal">
                      <FlipHorizontal2 className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => handleFlip("vertical")} className="image-toolbar-btn" title="Flip vertical">
                      <FlipVertical2 className="w-3.5 h-3.5" />
                    </button>

                    <div className="image-toolbar-divider" />

                    {/* Brightness & Contrast */}
                    <div className="image-toolbar-slider-group">
                      <Sun className="w-3 h-3 text-muted-foreground" />
                      <input type="range" min="50" max="150" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="image-toolbar-slider" title={`Brightness: ${brightness}%`} />
                    </div>
                    <div className="image-toolbar-slider-group">
                      <Contrast className="w-3 h-3 text-muted-foreground" />
                      <input type="range" min="50" max="150" value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="image-toolbar-slider" title={`Contrast: ${contrast}%`} />
                    </div>

                    {(brightness !== 100 || contrast !== 100) && (
                      <button type="button" onClick={handleApplyFilters} className="image-toolbar-btn image-toolbar-btn-confirm" title="Apply brightness/contrast">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Caption */}
        {alt && !showAltInput && !isCropping && (
          <div className="image-node-caption">{alt}</div>
        )}
      </div>
    </NodeViewWrapper>
  );
};

export default ImageNodeView;
