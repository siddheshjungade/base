import { QuartzTransformerPlugin } from "../types"
import LZString from "lz-string"
import fs from "fs"
import path from "path"

interface ExcalidrawElement {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  angle: number
  strokeColor: string
  backgroundColor: string
  fillStyle: string
  strokeWidth: number
  strokeStyle: string
  opacity: number
  roundness: { type: number; value?: number } | null
  text?: string
  fontSize?: number
  fontFamily?: number
  textAlign?: string
  verticalAlign?: string
  points?: number[][]
  startArrowhead?: string | null
  endArrowhead?: string | null
  isDeleted?: boolean
  containerId?: string | null
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function getStrokeDasharray(strokeStyle: string, strokeWidth: number): string {
  switch (strokeStyle) {
    case "dashed":
      return `${8 * strokeWidth} ${4 * strokeWidth}`
    case "dotted":
      return `${1.5 * strokeWidth} ${4 * strokeWidth}`
    default:
      return ""
  }
}

function getFontFamily(fontFamily?: number): string {
  switch (fontFamily) {
    case 1:
      return "Virgil, Segoe Print, cursive"
    case 2:
      return "Helvetica, Arial, sans-serif"
    case 3:
      return "Cascadia, monospace"
    default:
      return "Helvetica, Arial, sans-serif"
  }
}

function getElementBounds(el: ExcalidrawElement) {
  if (el.type === "arrow" || el.type === "line" || el.type === "freedraw") {
    const points = el.points || [[0, 0]]
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const [px, py] of points) {
      minX = Math.min(minX, el.x + px)
      minY = Math.min(minY, el.y + py)
      maxX = Math.max(maxX, el.x + px)
      maxY = Math.max(maxY, el.y + py)
    }
    // Add stroke width padding for lines/arrows
    const sw = (el.strokeWidth || 1) / 2 + 5
    return { minX: minX - sw, minY: minY - sw, maxX: maxX + sw, maxY: maxY + sw }
  }

  if (el.type === "text") {
    const fontSize = el.fontSize || 20
    const lines = (el.text || "").split("\n")
    const lineHeight = fontSize * 1.25
    const estimatedHeight = Math.max(el.height || 0, lines.length * lineHeight)
    const estimatedWidth = Math.max(
      el.width || 0,
      ...lines.map((l) => l.length * fontSize * 0.6),
    )
    return {
      minX: el.x,
      minY: el.y,
      maxX: el.x + estimatedWidth,
      maxY: el.y + estimatedHeight,
    }
  }

  return {
    minX: el.x,
    minY: el.y,
    maxX: el.x + (el.width || 0),
    maxY: el.y + (el.height || 0),
  }
}

function renderElement(el: ExcalidrawElement, ox: number, oy: number): string {
  const opacity = (el.opacity ?? 100) / 100
  const sw = el.strokeWidth || 1
  const sc = el.strokeColor || "#1e1e1e"
  const bg = el.backgroundColor || "transparent"
  const fill = bg === "transparent" ? "none" : el.fillStyle === "solid" ? bg : "none"

  // For hachure/cross-hatch fills, approximate with semi-transparent solid fill
  const fillAttr =
    el.fillStyle !== "solid" && bg !== "transparent"
      ? `fill="${bg}" fill-opacity="0.3"`
      : `fill="${fill}"`

  const dash = getStrokeDasharray(el.strokeStyle, sw)
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ""

  const cx = el.x + (el.width || 0) / 2 - ox
  const cy = el.y + (el.height || 0) / 2 - oy
  const transformAttr = el.angle
    ? ` transform="rotate(${(el.angle * 180) / Math.PI}, ${cx}, ${cy})"`
    : ""

  switch (el.type) {
    case "rectangle": {
      const rx = el.roundness ? Math.min(el.width || 0, el.height || 0) * 0.1 : 0
      return `<rect x="${el.x - ox}" y="${el.y - oy}" width="${el.width}" height="${el.height}" rx="${rx}" ${fillAttr} stroke="${sc}" stroke-width="${sw}" opacity="${opacity}"${dashAttr}${transformAttr}/>`
    }

    case "ellipse":
      return `<ellipse cx="${cx}" cy="${cy}" rx="${(el.width || 0) / 2}" ry="${(el.height || 0) / 2}" ${fillAttr} stroke="${sc}" stroke-width="${sw}" opacity="${opacity}"${dashAttr}${transformAttr}/>`

    case "diamond": {
      const dx = el.x + (el.width || 0) / 2 - ox
      const dy = el.y + (el.height || 0) / 2 - oy
      const hw = (el.width || 0) / 2
      const hh = (el.height || 0) / 2
      return `<polygon points="${dx},${dy - hh} ${dx + hw},${dy} ${dx},${dy + hh} ${dx - hw},${dy}" ${fillAttr} stroke="${sc}" stroke-width="${sw}" opacity="${opacity}"${dashAttr}${transformAttr}/>`
    }

    case "text": {
      const text = el.text || ""
      const fontSize = el.fontSize || 20
      const ff = getFontFamily(el.fontFamily)
      const anchor =
        el.textAlign === "center" ? "middle" : el.textAlign === "right" ? "end" : "start"
      let tx = el.x - ox
      if (el.textAlign === "center") tx += (el.width || 0) / 2
      else if (el.textAlign === "right") tx += el.width || 0

      const lines = text.split("\n")
      const lineHeight = fontSize * 1.25

      let result = `<text font-size="${fontSize}" font-family="${ff}" text-anchor="${anchor}" fill="${sc}" opacity="${opacity}" dominant-baseline="text-before-edge"${transformAttr}>`
      let ty = el.y - oy
      for (const line of lines) {
        result += `<tspan x="${tx}" y="${ty}">${escapeXml(line)}</tspan>`
        ty += lineHeight
      }
      result += "</text>"
      return result
    }

    case "arrow":
    case "line": {
      const pts = el.points || []
      if (pts.length < 2) return ""

      let d = `M ${pts[0][0] + el.x - ox} ${pts[0][1] + el.y - oy}`
      for (let i = 1; i < pts.length; i++) {
        d += ` L ${pts[i][0] + el.x - ox} ${pts[i][1] + el.y - oy}`
      }

      let defs = ""
      let markers = ""

      if (el.type === "arrow" && el.endArrowhead !== "none") {
        const mid = `arw-${el.id.slice(0, 8)}`
        defs += `<marker id="${mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="${sc}" stroke-width="2"/></marker>`
        markers += ` marker-end="url(#${mid})"`
      }
      if (el.type === "arrow" && el.startArrowhead && el.startArrowhead !== "none") {
        const mid = `arws-${el.id.slice(0, 8)}`
        defs += `<marker id="${mid}" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 10 0 L 0 5 L 10 10" fill="none" stroke="${sc}" stroke-width="2"/></marker>`
        markers += ` marker-start="url(#${mid})"`
      }

      return `${defs ? `<defs>${defs}</defs>` : ""}<path d="${d}" fill="none" stroke="${sc}" stroke-width="${sw}" opacity="${opacity}"${dashAttr}${markers} stroke-linecap="round" stroke-linejoin="round"/>`
    }

    case "freedraw": {
      const pts = el.points || []
      if (pts.length < 2) return ""
      let d = `M ${pts[0][0] + el.x - ox} ${pts[0][1] + el.y - oy}`
      for (let i = 1; i < pts.length; i++) {
        d += ` L ${pts[i][0] + el.x - ox} ${pts[i][1] + el.y - oy}`
      }
      return `<path d="${d}" fill="none" stroke="${sc}" stroke-width="${sw}" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`
    }

    default:
      return ""
  }
}

function generateSvg(elements: ExcalidrawElement[], bgColor: string): string {
  const padding = 40

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const el of elements) {
    const b = getElementBounds(el)
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }

  if (!isFinite(minX)) return '<p class="excalidraw-empty">Empty diagram</p>'

  const ox = minX - padding
  const oy = minY - padding
  const w = maxX - minX + padding * 2
  const h = maxY - minY + padding * 2

  let content = ""
  for (const el of elements) {
    content += renderElement(el, ox, oy)
  }

  const bgFill =
    bgColor === "transparent" ? "" : `<rect width="${w}" height="${h}" fill="${bgColor}"/>`

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" class="excalidraw-svg-content">${bgFill}${content}</svg>`
}

const expandIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`

const closeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

function buildOutput(src: string, diagramHtml: string): string {
  const fmMatch = src.match(/^---\n([\s\S]*?)\n---/)
  const frontmatter = fmMatch ? fmMatch[0] : "---\n---"

  const textSection = src.match(/## Text Elements\n([\s\S]*?)(?=\n%%|\n## Drawing)/)
  let textContent = ""
  if (textSection) {
    textContent = textSection[1]
      .replace(/\^[\w]+/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  }

  return `${frontmatter}

<div class="excalidraw-diagram">
<button class="excalidraw-expand-btn" aria-label="Expand diagram" onclick="this.parentElement.nextElementSibling.classList.add('active')">${expandIcon}</button>
${diagramHtml}
</div>
<div class="excalidraw-fullscreen">
<div class="excalidraw-fullscreen-inner">
<button class="excalidraw-close-btn" aria-label="Close" onclick="this.closest('.excalidraw-fullscreen').classList.remove('active')">${closeIcon}</button>
${diagramHtml}
</div>
</div>

${textContent ? `<div class="sr-only">\n\n${textContent}\n\n</div>` : ""}
`
}

function renderExcalidrawSource(fileContent: string): string | null {
  let sceneJson: string | null = null
  const compressedMatch = fileContent.match(/```compressed-json\n([\s\S]*?)\n```/)
  if (compressedMatch) {
    const compressed = compressedMatch[1].replace(/\s+/g, "")
    sceneJson = LZString.decompressFromBase64(compressed)
  }

  if (!sceneJson) {
    const jsonMatch = fileContent.match(/```json\n([\s\S]*?)\n```/)
    if (jsonMatch) {
      sceneJson = jsonMatch[1]
    }
  }

  if (!sceneJson) return null

  try {
    const scene = JSON.parse(sceneJson)
    const elements: ExcalidrawElement[] = (scene.elements || []).filter(
      (el: ExcalidrawElement) => !el.isDeleted,
    )

    if (elements.length === 0) {
      return '<p class="excalidraw-empty">Empty diagram</p>'
    }

    const bgColor = scene.appState?.viewBackgroundColor || "#ffffff"
    return generateSvg(elements, bgColor)
  } catch (e) {
    console.warn("[Excalidraw] Failed to parse excalidraw data:", e)
    return null
  }
}

function buildEmbedHtml(diagramHtml: string): string {
  return `<div class="excalidraw-diagram">
<button class="excalidraw-expand-btn" aria-label="Expand diagram" onclick="this.parentElement.nextElementSibling.classList.add('active')">${expandIcon}</button>
${diagramHtml}
</div>
<div class="excalidraw-fullscreen">
<div class="excalidraw-fullscreen-inner">
<button class="excalidraw-close-btn" aria-label="Close" onclick="this.closest('.excalidraw-fullscreen').classList.remove('active')">${closeIcon}</button>
${diagramHtml}
</div>
</div>`
}

// Match ![[something.excalidraw]] or ![[path/to/something.excalidraw]]
const excalidrawEmbedRegex = /!\[\[([^\[\]\|#]+\.excalidraw(?:\.md)?)\]\]/g

function resolveExcalidrawFile(contentDir: string, ref: string): string | null {
  // Normalize: ensure .md extension
  const fileName = ref.endsWith(".md") ? ref : ref + ".md"

  // Try exact path first
  const exactPath = path.join(contentDir, fileName)
  if (fs.existsSync(exactPath)) {
    return fs.readFileSync(exactPath, "utf-8")
  }

  // Try searching recursively (shortest path resolution)
  const baseName = path.basename(fileName)
  function findFile(dir: string): string | null {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && entry.name === baseName) {
        return fs.readFileSync(fullPath, "utf-8")
      }
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const found = findFile(fullPath)
        if (found) return found
      }
    }
    return null
  }

  return findFile(contentDir)
}

export const Excalidraw: QuartzTransformerPlugin = () => ({
  name: "Excalidraw",
  textTransform(ctx, src) {
    const contentDir = ctx.argv.directory

    // Handle embeds in any file: ![[file.excalidraw]]
    if (excalidrawEmbedRegex.test(src)) {
      excalidrawEmbedRegex.lastIndex = 0
      src = src.replace(excalidrawEmbedRegex, (_match, ref: string) => {
        const fileContent = resolveExcalidrawFile(contentDir, ref)
        if (!fileContent) {
          console.warn(`[Excalidraw] Could not find excalidraw file: ${ref}`)
          return `<p class="excalidraw-empty">Excalidraw file not found: ${escapeXml(ref)}</p>`
        }

        const svg = renderExcalidrawSource(fileContent)
        if (!svg) {
          return `<p class="excalidraw-empty">Failed to render: ${escapeXml(ref)}</p>`
        }

        return buildEmbedHtml(svg)
      })
    }

    // Handle standalone excalidraw files
    if (!src.includes("excalidraw-plugin:")) {
      return src
    }

    const svg = renderExcalidrawSource(src)
    if (!svg) return src

    return buildOutput(src, svg)
  },
})
